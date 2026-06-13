package coordinator_test

import (
	"context"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/bus/bustest"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

//nolint:gocyclo // end-to-end walking-skeleton test: sequential poll/assert stages over real timing read as one narrative; splitting would obscure it.
func TestWalkingSkeleton(t *testing.T) {
	url, shutdown := bustest.RunServer(t)
	defer shutdown()

	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: "task-a", Type: typeFoundation}, Pos: domain.Vec2{X: 0, Y: 0}},
		{Task: domain.Task{ID: "task-b", Type: typeFoundation, Deps: []domain.TaskID{"task-a"}}, Pos: domain.Vec2{X: 10, Y: 0}},
	}

	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 0, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}},
		{ID: "R2", Pos: domain.Vec2{X: 50, Y: 50}, Battery: 0.6, Capabilities: []domain.Capability{typeFoundation}},
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

	poll("task-a LEASED to R1", func() bool {
		a, ok := getTask("task-a")
		if !ok || a.Status != domain.Leased || a.Assignee != "R1" {
			return false
		}
		b, okB := getTask("task-b")
		if okB && b.Status != domain.Unclaimed {
			t.Fatalf("task-b leaked to %s before task-a was DONE (withholding violated)", b.Status)
		}
		return true
	})

	poll("task-a DONE", func() bool {
		a, ok := getTask("task-a")
		return ok && a.Status == domain.Done
	})

	poll("task-b DONE", func() bool {
		b, ok := getTask("task-b")
		return ok && b.Status == domain.Done
	})

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
