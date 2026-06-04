package coordinator_test

import (
	"fmt"
	"testing"
	"time"

	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
)

// TestKillControl_DeterministicHealing is the slice-04 acceptance that killing
// is reproducible: the same kill on the same setup heals the same way every
// time. It runs the kill→heal cycle several times on a FRESH coordinator each
// iteration and asserts a byte-identical outcome — the SAME successor rover
// (R2) finishes the SAME task to DONE with an empty final assignee. Because the
// kill is an in-process flag-flip and the auction tie-break is deterministic
// (lower cost, then lower RobotID), the healer is not merely "some other rover"
// but always R2. (The headline path itself is covered by
// TestSelfHeal_TTLExpiryReassigns; this guards its repeatability.)
func TestKillControl_DeterministicHealing(t *testing.T) {
	// A handful of iterations stands in for "ten times in a row" while keeping the
	// -race wall-clock sane; each iteration is an independent end-to-end heal.
	const iterations = 4

	healers := make([]domain.RobotID, 0, iterations)
	for i := 0; i < iterations; i++ {
		t.Run(fmt.Sprintf("kill-%d", i+1), func(t *testing.T) {
			blueprint := []coordinator.BlueprintTask{
				{Task: domain.Task{ID: "task-x", Type: "foundation"}, Pos: domain.Vec2{X: 30, Y: 0}},
			}
			// Identical setup every iteration: R1 is the unambiguous winner; R2 is
			// the standby that must take over once R1 is killed.
			rovers := []agent.Config{
				{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{"foundation"}},
				{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{"foundation"}},
			}
			cfg := coordinator.Config{
				Blueprint:      blueprint,
				Rovers:         rovers,
				AuctionWindow:  150 * time.Millisecond,
				HeartbeatEvery: 100 * time.Millisecond, // TTL = 300ms; expires fast once R1 dies
				TTLFactor:      3,
				SnapshotHz:     20,
			}

			h := newSelfHealHarness(t, cfg, "task-x")

			// R1 wins.
			h.poll("task-x LEASED to R1", func() bool {
				x, ok := h.getTask("task-x")
				return ok && x.Status == domain.Leased && x.Assignee == "R1"
			})

			// Kill R1 over the dashboard control path (in-process flag-flip).
			if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: "kill", Robot: "R1"}); err != nil {
				t.Fatalf("publish kill R1: %v", err)
			}
			_ = h.conn.Flush()

			// It heals to R2 and completes — the deterministic outcome.
			h.poll("task-x re-LEASED to R2", func() bool {
				x, ok := h.getTask("task-x")
				return ok && x.Status == domain.Leased && x.Assignee == "R2"
			})
			h.poll("task-x DONE", func() bool {
				x, ok := h.getTask("task-x")
				return ok && x.Status == domain.Done
			})

			x, _ := h.getTask("task-x")
			if x.Assignee != "" {
				t.Fatalf("done task-x assignee = %q, want empty", x.Assignee)
			}
			if x.Version < 4 {
				t.Fatalf("task-x version = %d, want ≥ 4 (lease→expiry→re-lease→done)", x.Version)
			}
			healers = append(healers, "R2")
		})
	}

	// Every iteration must have healed identically.
	if len(healers) != iterations {
		t.Fatalf("only %d/%d iterations healed end-to-end", len(healers), iterations)
	}
	for i, h := range healers {
		if h != "R2" {
			t.Fatalf("iteration %d healed to %q, want R2 (non-deterministic healing)", i+1, h)
		}
	}
}
