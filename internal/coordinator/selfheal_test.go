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

const typeFoundation = "foundation"

const taskX domain.TaskID = "task-x"

const cmdKill = "kill"

type selfHealHarness struct {
	getTask func(id domain.TaskID) (domain.Task, bool)
	getSpec func(id domain.TaskID) []wire.BuildOp
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

	getSpec := func(id domain.TaskID) []wire.BuildOp {
		ops, ok, gerr := bus.GetJSON[[]wire.BuildOp](ctx, kv, wire.KVSpecKey(id))
		if gerr != nil {
			t.Fatalf("kv get spec %s: %v", id, gerr)
		}
		if !ok {
			return nil
		}
		return ops
	}

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

	return &selfHealHarness{getTask: getTask, getSpec: getSpec, poll: poll, conn: conn}
}

func TestSelfHeal_TTLExpiryReassigns(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: taskX, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}},
		{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{typeFoundation}},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
	}

	h := newSelfHealHarness(t, cfg, taskX)

	h.poll("task-x LEASED to R1", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Leased && x.Assignee == "R1"
	})

	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdKill, Robot: "R1"}); err != nil {
		t.Fatalf("publish kill R1: %v", err)
	}
	_ = h.conn.Flush()

	h.poll("task-x re-LEASED to R2", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Leased && x.Assignee == "R2"
	})

	h.poll("task-x DONE", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Done
	})

	x, _ := h.getTask(taskX)
	if x.Assignee != "" {
		t.Fatalf("done task-x assignee = %q, want empty", x.Assignee)
	}
	if x.Version < 4 {
		t.Fatalf("task-x version = %d, want ≥ 4 (lease→expiry→re-lease→done)", x.Version)
	}
}

func TestSelfHeal_ReportedFailureReassignsPromptly(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: taskX, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}, FailTask: taskX},
		{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{typeFoundation}},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
	}

	h := newSelfHealHarness(t, cfg, taskX)

	h.poll("task-x awarded to R1 (then released)", func() bool {
		x, ok := h.getTask(taskX)
		if !ok {
			return false
		}
		return x.Assignee == "R1" || x.Assignee == "R2" || x.Status == domain.Done
	})

	h.poll("task-x re-LEASED to R2", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Leased && x.Assignee == "R2"
	})

	h.poll("task-x DONE", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Done
	})

	x, _ := h.getTask(taskX)
	if x.Assignee != "" {
		t.Fatalf("done task-x assignee = %q, want empty", x.Assignee)
	}
}

func TestSelfHeal_NoEligibleRoverStaysUnclaimed(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: "task-impossible", Type: "welding"}, Pos: domain.Vec2{X: 5, Y: 5}},
	}
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 0, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}},
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
