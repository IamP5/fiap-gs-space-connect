package coordinator_test

import (
	"context"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"sync/atomic"
	"testing"
	"time"
)

type failingLiveBuilder struct {
	attempts atomic.Int64
}

func (f *failingLiveBuilder) BuildLive(_ context.Context, _ domain.TaskID, _ domain.TaskType, _ []wire.BuildOp, _ func([]wire.BuildOp)) bool {
	f.attempts.Add(1)
	return false
}

func (f *failingLiveBuilder) BuildLiveFault(_ context.Context, _ domain.TaskID, _ domain.TaskType, _ []wire.BuildOp, _ func([]wire.BuildOp)) (ok, modelFailed bool) {
	f.attempts.Add(1)
	return false, true
}

func TestLiveHeal_ModelFailureKillsRoverAndReauctions(t *testing.T) {
	builder := &failingLiveBuilder{}

	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: taskX, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	rovers := []agent.Config{
		{
			ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0,
			Capabilities:         []domain.Capability{typeFoundation},
			Mode:                 agent.ModeLive,
			LiveBuilder:          builder,
			LiveFailureThreshold: 1,
		},
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

	h.poll("task-x awarded to R1 (live)", func() bool {
		x, ok := h.getTask(taskX)
		return ok && (x.Assignee == "R1" || x.Assignee == "R2" || x.Status == domain.Done)
	})

	h.poll("task-x re-LEASED to R2 after R1 dies", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Leased && x.Assignee == "R2"
	})

	h.poll("task-x DONE", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Done
	})

	if got := builder.attempts.Load(); got == 0 {
		t.Fatalf("the live rover never reached its (failing) model seam")
	}

	x, _ := h.getTask(taskX)
	if x.Assignee != "" {
		t.Fatalf("done task-x assignee = %q, want empty", x.Assignee)
	}
	if x.Version < 4 {
		t.Fatalf("task-x version = %d, want ≥ 4 (lease→expiry→re-lease→done)", x.Version)
	}

	if spec := h.getSpec(taskX); len(spec) == 0 {
		t.Fatalf("completed task-x must carry the replacement rover's build spec, got none")
	}
}

func TestLiveBreaker_PrimitiveFinishesAfterRepeatedBuilderDeaths(t *testing.T) {
	builder := &failingLiveBuilder{}

	const breaker = 3
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: taskX, Type: typeFoundation, Mode: string(agent.ModeLive)}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	mkRover := func(id domain.RobotID, pos domain.Vec2, battery float64) agent.Config {
		return agent.Config{
			ID: id, Pos: pos, Battery: battery,
			Capabilities:         []domain.Capability{typeFoundation},
			LiveBuilder:          builder,
			LiveFailureThreshold: 1,
			RecoverAfter:         150 * time.Millisecond,
			SettleAfterRevive:    50 * time.Millisecond,
		}
	}
	rovers := []agent.Config{
		mkRover("R1", domain.Vec2{X: 30, Y: 0}, 1.0),
		mkRover("R2", domain.Vec2{X: 0, Y: 60}, 0.6),
	}

	cfg := coordinator.Config{
		Blueprint:           blueprint,
		Rovers:              rovers,
		AuctionWindow:       100 * time.Millisecond,
		HeartbeatEvery:      100 * time.Millisecond,
		TTLFactor:           3,
		SnapshotHz:          20,
		BuilderDeathBreaker: breaker,
	}

	h := newSelfHealHarness(t, cfg, taskX)

	h.poll("task-x DONE via primitive circuit breaker", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Done
	})

	x, _ := h.getTask(taskX)
	if x.Assignee != "" {
		t.Fatalf("done task-x assignee = %q, want empty", x.Assignee)
	}
	if x.Mode == string(agent.ModeLive) {
		t.Fatalf("done task-x still tagged live (%q); breaker should have downgraded it to replay", x.Mode)
	}
	if got := builder.attempts.Load(); got < int64(breaker) {
		t.Fatalf("live builder attempts = %d, want ≥ %d (one per builder death before the breaker tripped)", got, breaker)
	}
	if spec := h.getSpec(taskX); len(spec) == 0 {
		t.Fatalf("breaker-finished task-x must carry the primitive build spec, got none")
	}
}
