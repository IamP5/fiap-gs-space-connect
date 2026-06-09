package coordinator_test

import (
	"fmt"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

func TestKillControl_DeterministicHealing(t *testing.T) {
	const iterations = 4

	healers := make([]domain.RobotID, 0, iterations)
	for i := range iterations {
		t.Run(fmt.Sprintf("kill-%d", i+1), func(t *testing.T) {
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
			healers = append(healers, "R2")
		})
	}

	if len(healers) != iterations {
		t.Fatalf("only %d/%d iterations healed end-to-end", len(healers), iterations)
	}
	for i, h := range healers {
		if h != "R2" {
			t.Fatalf("iteration %d healed to %q, want R2 (non-deterministic healing)", i+1, h)
		}
	}
}
