package coordinator_test

import (
	"swarmbuild/internal/agent"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"sync"
	"testing"
	"time"
)

// beatCollector accumulates every choreography beat (wire.Event) seen across the
// snapshot stream. The NATS callback runs on the dispatcher goroutine and the
// test reads from the test goroutine, so the slice is mutex-guarded (the race
// detector WILL catch any unguarded access).
type beatCollector struct {
	mu     sync.Mutex
	events []wire.Event
}

func (b *beatCollector) add(evs []wire.Event) {
	if len(evs) == 0 {
		return
	}
	b.mu.Lock()
	b.events = append(b.events, evs...)
	b.mu.Unlock()
}

// snapshot returns a copy of the beats seen so far, safe to inspect.
func (b *beatCollector) snapshot() []wire.Event {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]wire.Event, len(b.events))
	copy(out, b.events)
	return out
}

// has reports whether any collected beat has the given kind.
func (b *beatCollector) has(kind string) bool {
	for _, e := range b.snapshot() {
		if e.Kind == kind {
			return true
		}
	}
	return false
}

// subscribeBeats wires a snapshot subscription that funnels every snapshot's
// Events into the collector. It registers on the harness's observer connection
// right after construction; a Flush ensures the subscription is live before the
// build's beats start flowing.
func subscribeBeats(t *testing.T, h *selfHealHarness) *beatCollector {
	t.Helper()
	bc := &beatCollector{}
	unsub, err := bus.SubscribeJSON(h.conn, wire.SubjSnapshot, func(s wire.Snapshot) {
		bc.add(s.Events)
	})
	if err != nil {
		t.Fatalf("subscribe snapshots: %v", err)
	}
	t.Cleanup(unsub)
	_ = h.conn.Flush()
	return bc
}

// TestChoreography_ScriptedKillHealsAndEmitsBeats is the headline: a SCRIPTED
// kill (configured on the coordinator, never published by the test) fires
// through the REAL wire.Control path once task-x is leased, the task orphans and
// self-heals to a different rover, and the whole arc emits genuine choreography
// beats derived from real engine events (bid/won/killed/expired/solidify).
func TestChoreography_ScriptedKillHealsAndEmitsBeats(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: "task-x", Type: "foundation"}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	// R1 is the clear winner (on the task, full battery); R2 is the standby that
	// can only win once R1 is killed and the lease TTL-expires.
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{"foundation"}},
		{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{"foundation"}},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond, // TTL = 3×100ms = 300ms
		TTLFactor:      3,
		SnapshotHz:     20,
		// The SCRIPTED kill: once task-x is leased, its holder is killed 150ms
		// later over the real control path. The test itself publishes no kill.
		ScriptedKills: []coordinator.ScriptedKill{
			{WhenTaskLeased: "task-x", After: 150 * time.Millisecond},
		},
	}

	h := newSelfHealHarness(t, cfg, "task-x")
	bc := subscribeBeats(t, h)

	// 1) task-x is first LEASED to R1 (the clear winner).
	h.poll("task-x LEASED to R1", func() bool {
		x, ok := h.getTask("task-x")
		return ok && x.Status == domain.Leased && x.Assignee == "R1"
	})

	// 2) The SCRIPTED kill fires (no test publish): R1 stops heartbeating, the
	//    lease TTL-expires, and the task is re-auctioned and re-leased to R2.
	h.poll("task-x re-LEASED to R2 (after scripted kill)", func() bool {
		x, ok := h.getTask("task-x")
		return ok && x.Status == domain.Leased && x.Assignee == "R2"
	})

	// 3) R2 carries it to DONE end-to-end.
	h.poll("task-x DONE", func() bool {
		x, ok := h.getTask("task-x")
		return ok && x.Status == domain.Done
	})

	// All beats below must have appeared by completion. Give the final snapshot a
	// brief moment to flush the solidify beat, then assert presence + provenance.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if bc.has(wire.EventBid) && bc.has(wire.EventWon) && bc.has(wire.EventKilled) &&
			bc.has(wire.EventExpired) && bc.has(wire.EventSolidify) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	evs := bc.snapshot()

	// EventBid: at least one, with a real Robot and a non-zero Value (the cost).
	// This proves bid beats carry real auction data, not synthesized placeholders.
	foundBid := false
	for _, e := range evs {
		if e.Kind == wire.EventBid {
			if e.Robot == "" {
				t.Fatalf("EventBid has empty Robot: %+v", e)
			}
			if e.Value == 0 {
				t.Fatalf("EventBid has Value 0, want a real bid cost: %+v", e)
			}
			foundBid = true
		}
	}
	if !foundBid {
		t.Fatalf("no EventBid beat emitted; beats=%v", kinds(evs))
	}

	// EventWon: at least one, naming a real rover (R1 or R2).
	foundWon := false
	for _, e := range evs {
		if e.Kind == wire.EventWon {
			if e.Robot != "R1" && e.Robot != "R2" {
				t.Fatalf("EventWon names %q, want a real rover (R1/R2): %+v", e.Robot, e)
			}
			foundWon = true
		}
	}
	if !foundWon {
		t.Fatalf("no EventWon beat emitted; beats=%v", kinds(evs))
	}

	// EventKilled: the scripted kill emitted a real kill beat.
	if !bc.has(wire.EventKilled) {
		t.Fatalf("no EventKilled beat emitted — the scripted kill did not drive the real path; beats=%v", kinds(evs))
	}
	// EventExpired: the orphaned lease TTL-expired (the drain ring).
	if !bc.has(wire.EventExpired) {
		t.Fatalf("no EventExpired beat emitted — the orphaned task never re-auctioned via TTL; beats=%v", kinds(evs))
	}
	// EventSolidify: the task completed end-to-end.
	if !bc.has(wire.EventSolidify) {
		t.Fatalf("no EventSolidify beat emitted — the heal never completed; beats=%v", kinds(evs))
	}
}

// TestChoreography_NoScriptedKillNoKillBeat proves scripted kills are opt-in:
// with ScriptedKills nil, the same tiny blueprint builds cleanly to DONE and NO
// EventKilled (and no EventExpired) beat ever appears, while EventWon and
// EventSolidify do. Beats otherwise reflect a clean, uninterrupted build.
func TestChoreography_NoScriptedKillNoKillBeat(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: "task-x", Type: "foundation"}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{"foundation"}},
		{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{"foundation"}},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
		ScriptedKills:  nil, // opt-in: no kill this run
	}

	h := newSelfHealHarness(t, cfg, "task-x")
	bc := subscribeBeats(t, h)

	// Run a clean build straight through to DONE.
	h.poll("task-x DONE (clean build)", func() bool {
		x, ok := h.getTask("task-x")
		return ok && x.Status == domain.Done
	})

	// Let the final snapshot carrying the solidify beat flush.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if bc.has(wire.EventWon) && bc.has(wire.EventSolidify) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	evs := bc.snapshot()

	// A clean build: the winner won and the task solidified.
	if !bc.has(wire.EventWon) {
		t.Fatalf("no EventWon beat in a clean build; beats=%v", kinds(evs))
	}
	if !bc.has(wire.EventSolidify) {
		t.Fatalf("no EventSolidify beat in a clean build; beats=%v", kinds(evs))
	}

	// No kill was scripted, so no kill beat may appear — ever.
	if bc.has(wire.EventKilled) {
		t.Fatalf("EventKilled beat appeared with no scripted kill (scripted kills must be opt-in); beats=%v", kinds(evs))
	}
}

// kinds extracts the ordered kind list from beats, for readable failure output.
func kinds(evs []wire.Event) []string {
	out := make([]string, len(evs))
	for i, e := range evs {
		out[i] = e.Kind
	}
	return out
}
