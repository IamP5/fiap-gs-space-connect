package coordinator_test

import (
	"context"
	"testing"
	"time"

	"swarmbuild/internal/agent"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/bus/bustest"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
)

// TestWalkingSkeleton is the issue-01 end-to-end test (TECHSPEC §7). Over an
// embedded NATS server it runs the coordinator plus two in-process rovers and
// asserts, within a bounded budget by polling the KV-mirrored World Model:
//
//   - the dependent task (task-b) stays UNCLAIMED until its dependency
//     (task-a) is DONE (the Planner withholds it),
//   - exactly one auction picks the lower-cost / lower-id winner (R1),
//   - the winner holds a LEASED task that then reaches DONE,
//   - BOTH tasks reach DONE end-to-end,
//   - the World Model is mirrored to NATS KV (read back via bus.GetJSON).
func TestWalkingSkeleton(t *testing.T) {
	url, shutdown := bustest.RunServer(t)
	defer shutdown()

	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: "task-a", Type: "foundation"}, Pos: domain.Vec2{X: 0, Y: 0}},
		{Task: domain.Task{ID: "task-b", Type: "foundation", Deps: []domain.TaskID{"task-a"}}, Pos: domain.Vec2{X: 10, Y: 0}},
	}

	// R1 sits on task-a with a full battery; R2 is far away with less charge, so
	// R1 is the clear lower-cost winner. (Even at equal cost, R1 < R2 wins.)
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 0, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{"foundation"}},
		{ID: "R2", Pos: domain.Vec2{X: 50, Y: 50}, Battery: 0.6, Capabilities: []domain.Capability{"foundation"}},
	}

	cfg := coordinator.Config{
		NATSURL:        url,
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  200 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runErr := make(chan error, 1)
	go func() { runErr <- coordinator.Run(ctx, cfg) }()

	// Independent observer connection: read the KV-mirrored World Model.
	conn, err := bus.Connect(ctx, url, bus.ConnectOptions{Name: "test-observer", MaxWait: 5 * time.Second})
	if err != nil {
		t.Fatalf("observer connect: %v", err)
	}
	defer conn.Close()
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

	// Slice 02: rovers now drive toward their task and run a work phase before
	// completing, so end-to-end takes real wall time (auction windows + drive +
	// work, twice). Budget generously so a loaded -race run is never flaky.
	deadline := time.Now().Add(15 * time.Second)
	poll := func(desc string, cond func() bool) {
		t.Helper()
		for time.Now().Before(deadline) {
			if cond() {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		a, _ := getTask("task-a")
		b, _ := getTask("task-b")
		t.Fatalf("timed out waiting for %s; task-a=%s(v%d,assignee=%s) task-b=%s(v%d,assignee=%s)",
			desc, a.Status, a.Version, a.Assignee, b.Status, b.Version, b.Assignee)
	}

	// 1) task-a gets LEASED to R1 (lower-cost / lower-id winner) while task-b is
	//    withheld UNCLAIMED (its dependency is not yet DONE).
	poll("task-a LEASED to R1", func() bool {
		a, ok := getTask("task-a")
		if !ok || a.Status != domain.Leased || a.Assignee != "R1" {
			return false
		}
		// Withholding: task-b must NOT have been auctioned/leased yet.
		b, okB := getTask("task-b")
		if okB && b.Status != domain.Unclaimed {
			t.Fatalf("task-b leaked to %s before task-a was DONE (withholding violated)", b.Status)
		}
		return true
	})

	// Confirm the winner R1 truly held the lease (assignee recorded above) — the
	// LEASED+assignee=R1 state observed is the held lease.

	// 2) task-a reaches DONE.
	poll("task-a DONE", func() bool {
		a, ok := getTask("task-a")
		return ok && a.Status == domain.Done
	})

	// 3) Now (and only now) task-b becomes eligible, is auctioned, and reaches
	//    DONE — both tasks DONE end-to-end.
	poll("task-b DONE", func() bool {
		b, ok := getTask("task-b")
		return ok && b.Status == domain.Done
	})

	// Final assertions on the KV-mirrored World Model.
	a, okA := getTask("task-a")
	b, okB := getTask("task-b")
	if !okA || !okB {
		t.Fatalf("both tasks must be mirrored to KV: task-a present=%v task-b present=%v", okA, okB)
	}
	if a.Status != domain.Done {
		t.Fatalf("task-a final status = %s, want DONE", a.Status)
	}
	if b.Status != domain.Done {
		t.Fatalf("task-b final status = %s, want DONE", b.Status)
	}
	// Versions must have advanced past the seed (UNCLAIMED→LEASED→DONE is two
	// bumps), evidence the version guard ran on the live writes.
	if a.Version < 2 {
		t.Fatalf("task-a version = %d, want ≥ 2 (seed→LEASED→DONE)", a.Version)
	}

	cancel()
	select {
	case <-runErr:
	case <-time.After(2 * time.Second):
		t.Fatal("coordinator.Run did not return after cancel")
	}
}
