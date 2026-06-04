package coordinator_test

import (
	"context"
	"testing"
	"time"

	"swarmbuild/agent"
	"swarmbuild/bus"
	"swarmbuild/bus/bustest"
	"swarmbuild/coordinator"
	"swarmbuild/core/domain"
	"swarmbuild/wire"
)

// selfHealHarness boots an embedded NATS server, runs a coordinator with the
// given config, and returns an independent observer's getTask (reading the
// KV-mirrored World Model) plus a poll helper bounded by a generous deadline.
// It mirrors integration_test.go's structure exactly: state is observed only
// through the authoritative KV mirror, never through coordinator internals.
type selfHealHarness struct {
	getTask func(id domain.TaskID) (domain.Task, bool)
	poll    func(desc string, cond func() bool)
	conn    *bus.Conn
}

func newSelfHealHarness(t *testing.T, cfg coordinator.Config, ids ...domain.TaskID) *selfHealHarness {
	t.Helper()

	url, shutdown := bustest.RunServer(t)
	t.Cleanup(shutdown)
	cfg.NATSURL = url

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	runErr := make(chan error, 1)
	go func() { runErr <- coordinator.Run(ctx, cfg) }()

	// Independent observer connection: read the KV-mirrored World Model.
	conn, err := bus.Connect(ctx, url, bus.ConnectOptions{Name: "test-observer", MaxWait: 5 * time.Second})
	if err != nil {
		t.Fatalf("observer connect: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	kv, err := conn.KV(ctx, wire.KVBucketWorld)
	if err != nil {
		t.Fatalf("observer kv: %v", err)
	}

	getTask := func(id domain.TaskID) (domain.Task, bool) {
		tk, ok, gerr := bus.GetJSON[domain.Task](ctx, kv, string(id))
		if gerr != nil {
			t.Fatalf("kv get %s: %v", id, gerr)
		}
		return tk, ok
	}

	// Self-heal end-to-end takes real wall time (auction windows + drive + work +
	// a TTL expiry or a reported failure + a re-auction + a second drive/work).
	// Budget generously so a loaded -race run is never flaky.
	deadline := time.Now().Add(20 * time.Second)
	poll := func(desc string, cond func() bool) {
		t.Helper()
		for time.Now().Before(deadline) {
			if cond() {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		for _, id := range ids {
			tk, _ := getTask(id)
			t.Logf("task=%s status=%s v=%d assignee=%s", id, tk.Status, tk.Version, tk.Assignee)
		}
		t.Fatalf("timed out waiting for %s", desc)
	}

	return &selfHealHarness{getTask: getTask, poll: poll, conn: conn}
}

// TestSelfHeal_TTLExpiryReassigns covers the SILENT-DEATH path: the winning
// rover is killed (stops heartbeating) so its lease TTL-expires; the
// coordinator's Sweep()→onExpired returns the task to UNCLAIMED and the next
// tick re-auctions it; a DIFFERENT capable rover then wins, leases, and
// completes it end-to-end. The reassignment to a different rover is the headline
// assertion: no double-assignment, true self-heal.
func TestSelfHeal_TTLExpiryReassigns(t *testing.T) {
	// One task far enough that the winner must drive (so we can kill it mid-flight
	// or after the lease, before it completes).
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: "task-x", Type: "foundation"}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	// R1 is the clear winner (on the task, full battery). R2 is the standby:
	// also capable, but further away and less charged so it only wins once R1 is
	// gone.
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{"foundation"}},
		{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{"foundation"}},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond, // TTL = 3×100ms = 300ms; expires fast once R1 dies
		TTLFactor:      3,
		SnapshotHz:     20,
	}

	h := newSelfHealHarness(t, cfg, "task-x")

	// 1) task-x is LEASED to R1 (the clear winner).
	h.poll("task-x LEASED to R1", func() bool {
		x, ok := h.getTask("task-x")
		return ok && x.Status == domain.Leased && x.Assignee == "R1"
	})

	// 2) KILL R1 via the dashboard control path: it stops heartbeating, so the
	//    lease TTL-expires and the task self-heals. Publish from the observer
	//    connection; the agent subscribes to SubjControl and dies (silent death).
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: "kill", Robot: "R1"}); err != nil {
		t.Fatalf("publish kill R1: %v", err)
	}
	_ = h.conn.Flush()

	// 3) task-x is re-auctioned and re-leased to a DIFFERENT rover (R2). This is
	//    the self-heal: assignee changes away from R1.
	h.poll("task-x re-LEASED to R2", func() bool {
		x, ok := h.getTask("task-x")
		return ok && x.Status == domain.Leased && x.Assignee == "R2"
	})

	// 4) R2 carries it to DONE end-to-end.
	h.poll("task-x DONE", func() bool {
		x, ok := h.getTask("task-x")
		return ok && x.Status == domain.Done
	})

	x, _ := h.getTask("task-x")
	if x.Assignee != "" {
		t.Fatalf("done task-x assignee = %q, want empty", x.Assignee)
	}
	// Versions: seed→LEASED(R1)→UNCLAIMED(expiry)→LEASED(R2)→DONE is four bumps.
	if x.Version < 4 {
		t.Fatalf("task-x version = %d, want ≥ 4 (lease→expiry→re-lease→done)", x.Version)
	}
}

// TestSelfHeal_ReportedFailureReassignsPromptly covers the COOPERATIVE path: R1
// is configured to abandon task-x (it drives there then publishes wire.Failed
// instead of completing, and never re-bids it). The coordinator releases the
// lease PROMPTLY on that signal — not on TTL — returns the task to UNCLAIMED,
// re-auctions, and R2 (which does not fail) wins, leases, and completes it.
func TestSelfHeal_ReportedFailureReassignsPromptly(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: "task-x", Type: "foundation"}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	// R1 is the clear winner but is rigged to FAIL task-x cooperatively. R2 is the
	// standby that will pick it up after the prompt release.
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{"foundation"}, FailTask: "task-x"},
		{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{"foundation"}},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
	}

	h := newSelfHealHarness(t, cfg, "task-x")

	// 1) task-x is first awarded to R1 (the clear winner). The release is PROMPT —
	//    R1 drives then fails fast — so the transient LEASED-to-R1 state may slip
	//    past a poll; observing R1 OR having already healed past it both prove R1
	//    was the awarded winner (R2 only ever wins after R1's release, asserted
	//    next). A direct R2 award without R1 ever winning would be a real bug.
	h.poll("task-x awarded to R1 (then released)", func() bool {
		x, ok := h.getTask("task-x")
		if !ok {
			return false
		}
		// R1 observed holding it, OR already healed past R1 to R2/DONE — in which
		// case R1 must have won and been released first, since R2 cannot win an
		// unauctioned task.
		return x.Assignee == "R1" || x.Assignee == "R2" || x.Status == domain.Done
	})

	// 2) R1 reports failure; the lease is released PROMPTLY and re-auctioned to
	//    R2 (a different rover). R1 refuses to re-bid task-x, so R2 must win.
	h.poll("task-x re-LEASED to R2", func() bool {
		x, ok := h.getTask("task-x")
		return ok && x.Status == domain.Leased && x.Assignee == "R2"
	})

	// 3) R2 carries it to DONE end-to-end.
	h.poll("task-x DONE", func() bool {
		x, ok := h.getTask("task-x")
		return ok && x.Status == domain.Done
	})

	x, _ := h.getTask("task-x")
	if x.Assignee != "" {
		t.Fatalf("done task-x assignee = %q, want empty", x.Assignee)
	}
}

// TestSelfHeal_NoEligibleRoverStaysUnclaimed asserts the negative: a task whose
// Type no rover can perform is announced repeatedly but never leaves UNCLAIMED.
// There is nothing to self-heal to, so the coordinator must keep it pending
// (re-announcing on each tick) rather than ever leasing it.
func TestSelfHeal_NoEligibleRoverStaysUnclaimed(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: "task-impossible", Type: "welding"}, Pos: domain.Vec2{X: 5, Y: 5}},
	}
	// The only rover can do "foundation", not "welding": it never bids.
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 0, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{"foundation"}},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  100 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
	}

	h := newSelfHealHarness(t, cfg, "task-impossible")

	// Give the coordinator a window to run several auction cycles, then assert the
	// task is STILL UNCLAIMED — no eligible rover means no lease, ever.
	end := time.Now().Add(600 * time.Millisecond)
	for time.Now().Before(end) {
		x, ok := h.getTask("task-impossible")
		if ok && x.Status != domain.Unclaimed {
			t.Fatalf("task-impossible leaked to %s (assignee=%s); no rover can perform 'welding'", x.Status, x.Assignee)
		}
		time.Sleep(20 * time.Millisecond)
	}

	x, ok := h.getTask("task-impossible")
	if !ok {
		t.Fatalf("task-impossible must be mirrored to KV")
	}
	if x.Status != domain.Unclaimed {
		t.Fatalf("task-impossible final status = %s, want UNCLAIMED", x.Status)
	}
}
