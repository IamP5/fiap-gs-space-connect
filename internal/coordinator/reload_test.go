package coordinator_test

import (
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

func TestReloadDemo_RebuildsBoardFromScratch(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: taskX, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}},
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

	h.poll("task-x DONE (first build)", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Done
	})
	built, _ := h.getTask(taskX)
	builtVersion := built.Version

	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: "reloadDemo"}); err != nil {
		t.Fatalf("publish reloadDemo: %v", err)
	}
	_ = h.conn.Flush()

	h.poll("task-x reset above the built version", func() bool {
		x, ok := h.getTask(taskX)
		if !ok {
			return false
		}
		return x.Version > builtVersion && x.Status != domain.Done
	})

	h.poll("task-x DONE (rebuild)", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Done && x.Version > builtVersion
	})

	rebuilt, _ := h.getTask(taskX)
	if rebuilt.Assignee != "" {
		t.Fatalf("rebuilt task-x assignee = %q, want empty", rebuilt.Assignee)
	}
	if rebuilt.Version <= builtVersion {
		t.Fatalf("rebuilt task-x version = %d, want > first-build version %d", rebuilt.Version, builtVersion)
	}
}
