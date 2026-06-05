package coordinator_test

import (
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

// TestReloadDemo_RebuildsBoardFromScratch covers the reloadDemo control: a built
// board is reset IN-PROCESS so the swarm rebuilds the dome from scratch. It drives
// one task to DONE, publishes wire.Control{Cmd:"reloadDemo"} on wire.SubjControl,
// and asserts the previously-DONE task returns to UNCLAIMED at a STRICTLY HIGHER
// version (the monotonic World Model would reject any lower-version reset), then
// re-completes — proving the rebuild runs end-to-end after the reset.
func TestReloadDemo_RebuildsBoardFromScratch(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: taskX, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	// One clear winner sitting on the task with a full battery. After the reload it
	// is the obvious winner again and rebuilds the task.
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

	// 1) task-x reaches DONE end-to-end (the first build).
	h.poll("task-x DONE (first build)", func() bool {
		x, ok := h.getTask(taskX)
		return ok && x.Status == domain.Done
	})
	built, _ := h.getTask(taskX)
	builtVersion := built.Version

	// 2) Reload the demo via the dashboard control path: publish from the observer
	//    connection; the coordinator routes evReload onto the single writer, which
	//    resets the board.
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: "reloadDemo"}); err != nil {
		t.Fatalf("publish reloadDemo: %v", err)
	}
	_ = h.conn.Flush()

	// 3) The reset lands: task-x's version moves STRICTLY ABOVE the DONE record —
	//    the reset record must beat the monotonic World Model guard, which is the
	//    crux of onReload. The reset stamps UNCLAIMED, but the lone idle rover may
	//    re-auction it to LEASED before a poll observes the transient UNCLAIMED, so
	//    the load-bearing assertion is the version bump; we separately confirm the
	//    task left DONE by watching it reach UNCLAIMED-or-LEASED at the new version.
	h.poll("task-x reset above the built version", func() bool {
		x, ok := h.getTask(taskX)
		if !ok {
			return false
		}
		return x.Version > builtVersion && x.Status != domain.Done
	})

	// 4) The rebuild completes: task-x reaches DONE again, at a version beyond the
	//    reset base — evidence the full auction→lease→complete arc ran post-reload.
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
