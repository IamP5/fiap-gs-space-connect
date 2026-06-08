package coordinator_test

import (
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

// heroWall is the Epic 07 climax target the coordinator holds un-leasable until a
// cueKill control releases it (ADR-0011). It mirrors the demo's lunar/wall-1 shape.
const heroWall domain.TaskID = "lunar/wall-1"

// cmdCueKill is the operator's Epic 07 climax cue: the Coordinator releases the
// held hero wall and fires the in-process kill on its leaseholder.
const cmdCueKill = "cueKill"

// TestCueKill_HeldWallStaysUnclaimedUntilCue is the hold half of the Epic 07
// acceptance (ADR-0011): with HeldTask set, the hero wall is NEVER leased while the
// cue has not arrived — the dome builds everything it can EXCEPT the held wall, so
// the climax target is always available when the operator fires. Here the only task
// is the held wall, so it must sit UNCLAIMED through several auction cycles even
// though a clearly-capable rover is parked on it.
func TestCueKill_HeldWallStaysUnclaimedUntilCue(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: heroWall, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}},
		{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{typeFoundation}},
	}
	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  100 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
		HeldTask:       heroWall, // held un-leasable until the cueKill cue
		CueKillAfter:   150 * time.Millisecond,
	}

	h := newSelfHealHarness(t, cfg, heroWall)

	// Several auction cycles pass; the held wall must stay UNCLAIMED the whole time —
	// the cue has not arrived, so the Auction never announces it.
	end := time.Now().Add(700 * time.Millisecond)
	for time.Now().Before(end) {
		x, ok := h.getTask(heroWall)
		if ok && x.Status != domain.Unclaimed {
			t.Fatalf("held wall leaked to %s (assignee=%s) before the cueKill cue; it must stay un-leasable", x.Status, x.Assignee)
		}
		time.Sleep(20 * time.Millisecond)
	}
	x, ok := h.getTask(heroWall)
	if !ok || x.Status != domain.Unclaimed {
		t.Fatalf("held wall final status = %s, want UNCLAIMED (held until cueKill)", x.Status)
	}
}

// TestCueKill_OrchestratesReleaseKillAndDeterministicHeal is the headline Epic 07
// acceptance (ADR-0011): a {cmd:"cueKill"} orchestrates the whole climax on the
// Coordinator — RELEASE the held hero wall → a Rover (R1, the clear winner) leases
// it → the Coordinator fires the in-process kill on R1 → its Lease Expires → the
// task Re-auctions → a SURVIVING Rover (R2) seals the dome. It is deterministic: the
// same R1 is held-then-killed and the same R2 heals, with no pod delete (the kill is
// the existing `{cmd:"kill"}` control path the pod-agent honours in place).
func TestCueKill_OrchestratesReleaseKillAndDeterministicHeal(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: heroWall, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	// R1 is the unambiguous winner (parked on the wall, full battery); R2 is the
	// survivor that must seal it once R1 is killed.
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}},
		{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{typeFoundation}},
	}
	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond, // TTL = 300ms; expires fast once R1 dies
		TTLFactor:      3,
		SnapshotHz:     20,
		HeldTask:       heroWall,
		CueKillAfter:   150 * time.Millisecond, // kill shortly after R1 leases the released wall
	}

	h := newSelfHealHarness(t, cfg, heroWall)

	// 1) Before the cue, the wall is held: confirm it sits UNCLAIMED for a beat.
	beat := time.Now().Add(300 * time.Millisecond)
	for time.Now().Before(beat) {
		x, ok := h.getTask(heroWall)
		if ok && x.Status != domain.Unclaimed {
			t.Fatalf("held wall leaked to %s before the cue; it must stay un-leasable", x.Status)
		}
		time.Sleep(15 * time.Millisecond)
	}

	// 2) Fire the cue. The Coordinator releases the hold and arms the kill.
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdCueKill}); err != nil {
		t.Fatalf("publish cueKill: %v", err)
	}
	_ = h.conn.Flush()

	// 3) The released wall is leased to R1 (the clear winner), then the Coordinator
	//    fires the in-process kill — R1's lease TTL-expires.
	h.poll("hero wall LEASED to R1", func() bool {
		x, ok := h.getTask(heroWall)
		return ok && x.Status == domain.Leased && x.Assignee == "R1"
	})

	// 4) Self-heal: the task re-auctions to a DIFFERENT, surviving rover (R2).
	h.poll("hero wall re-LEASED to R2 (survivor seals it)", func() bool {
		x, ok := h.getTask(heroWall)
		return ok && x.Status == domain.Leased && x.Assignee == "R2"
	})

	// 5) R2 carries it to DONE — the dome seals.
	h.poll("hero wall DONE", func() bool {
		x, ok := h.getTask(heroWall)
		return ok && x.Status == domain.Done
	})

	x, _ := h.getTask(heroWall)
	if x.Assignee != "" {
		t.Fatalf("done hero wall assignee = %q, want empty", x.Assignee)
	}
	// seed→(released)→LEASED(R1)→UNCLAIMED(expiry)→LEASED(R2)→DONE is ≥ 4 bumps.
	if x.Version < 4 {
		t.Fatalf("hero wall version = %d, want ≥ 4 (lease→expiry→re-lease→done)", x.Version)
	}
}

// TestCueKill_IgnoredWhenNothingHeld asserts the negative: a cueKill with no held
// task is a harmless no-op — it never perturbs an ordinary build. The single task
// auctions and completes normally whether or not a stray cue arrives.
func TestCueKill_IgnoredWhenNothingHeld(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: taskX, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}},
	}
	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  100 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
		// No HeldTask: a cueKill must do nothing.
	}

	h := newSelfHealHarness(t, cfg, taskX)

	// Fire a stray cue; it must be ignored (nothing held to release/kill).
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdCueKill}); err != nil {
		t.Fatalf("publish cueKill: %v", err)
	}
	_ = h.conn.Flush()

	// The ordinary build still completes — R1 leases and finishes task-x, no kill.
	h.poll("task-x DONE (cue ignored, no kill)", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Done
	})
}
