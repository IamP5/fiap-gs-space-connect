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

// failingLiveBuilder is a no-network agent.LiveBuilder whose every live build fails
// as a MODEL FAILURE (bh-08f): it emits nothing and reports modelFailed=true via the
// optional BuildLiveFault seam. It counts attempts so a test can assert the rover
// actually reached the live seam (and retried before dying). It models an LLM that
// will not cooperate — which, past the rover's failure threshold, must make the rover
// die so the swarm self-heals the Task.
type failingLiveBuilder struct {
	attempts atomic.Int64
}

// BuildLive satisfies the base interface: a failed build emits nothing, ok=false.
func (f *failingLiveBuilder) BuildLive(_ context.Context, _ domain.TaskID, _ domain.TaskType, _ []wire.BuildOp, _ func([]wire.BuildOp)) bool {
	f.attempts.Add(1)
	return false
}

// BuildLiveFault is the richer seam the rover prefers: ok=false, modelFailed=true so
// the failure routes through self-heal (counts toward the death threshold).
func (f *failingLiveBuilder) BuildLiveFault(_ context.Context, _ domain.TaskID, _ domain.TaskType, _ []wire.BuildOp, _ func([]wire.BuildOp)) (ok, modelFailed bool) {
	f.attempts.Add(1)
	return false, true
}

// TestLiveHeal_ModelFailureKillsRoverAndReauctions is the bh-08f acceptance: a
// live-mode rover whose model will not cooperate (every build is a model failure)
// crosses its per-Rover failure threshold, DIES (stops heartbeating / releases its
// lease), and the EXISTING expiry → re-auction path reassigns task-x to a healthy
// replay-mode rover that completes it. No special supervisory logic, no primitive
// geometry on the dying rover's path — an LLM that won't build is just another dead
// robot.
func TestLiveHeal_ModelFailureKillsRoverAndReauctions(t *testing.T) {
	builder := &failingLiveBuilder{}

	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: taskX, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	// R1 is the clear winner (on the task, full battery) but runs in LIVE mode with a
	// model that always fails: it will die past its threshold. R2 is the standby
	// replay rover (model-free) that picks up the re-auctioned task and completes it.
	rovers := []agent.Config{
		{
			ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0,
			Capabilities:         []domain.Capability{typeFoundation},
			Mode:                 agent.ModeLive,
			LiveBuilder:          builder,
			LiveFailureThreshold: 1, // one model failure is enough to kill R1 in this test
		},
		{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{typeFoundation}},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond, // TTL = 3×100ms = 300ms; expires fast once R1 dies
		TTLFactor:      3,
		SnapshotHz:     20,
	}

	h := newSelfHealHarness(t, cfg, taskX)

	// 1) task-x is LEASED to R1 (the clear winner), which then drives to the worksite
	//    and reaches its live builder — observing R1 OR already-healed-past proves R1
	//    won first (R2 cannot win an unauctioned task).
	h.poll("task-x awarded to R1 (live)", func() bool {
		x, ok := h.getTask(taskX)
		return ok && (x.Assignee == "R1" || x.Assignee == "R2" || x.Status == domain.Done)
	})

	// 2) R1's model fails past its threshold ⇒ R1 dies (stops heartbeating); the lease
	//    TTL-expires and the task self-heals onto R2 — the assignee changes away from
	//    the dead live rover, exactly the existing expiry → re-auction path.
	h.poll("task-x re-LEASED to R2 after R1 dies", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Leased && x.Assignee == "R2"
	})

	// 3) R2 carries it to DONE end-to-end (the replacement completes the abandoned task).
	h.poll("task-x DONE", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Done
	})

	// The dying live rover DID reach its model seam (and retried before dying).
	if got := builder.attempts.Load(); got == 0 {
		t.Fatalf("the live rover never reached its (failing) model seam")
	}

	x, _ := h.getTask(taskX)
	if x.Assignee != "" {
		t.Fatalf("done task-x assignee = %q, want empty", x.Assignee)
	}
	// seed→LEASED(R1)→UNCLAIMED(expiry)→LEASED(R2)→DONE is four version bumps.
	if x.Version < 4 {
		t.Fatalf("task-x version = %d, want ≥ 4 (lease→expiry→re-lease→done)", x.Version)
	}

	// The only ops task-x carries come from R2's replay/primitive stream: R1 emitted
	// NOTHING (it died rather than fall back to primitive on the model-failure path,
	// bh-08f). A non-empty spec is the replacement's work.
	if spec := h.getSpec(taskX); len(spec) == 0 {
		t.Fatalf("completed task-x must carry the replacement rover's build spec, got none")
	}
}
