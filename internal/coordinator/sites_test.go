package coordinator_test

import (
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

const (
	siteLunar      = "lunar"
	siteShackleton = "shackleton"

	lunarTask = domain.TaskID("lunar/foundation-1")
	shackTask = domain.TaskID("shackleton/foundation-1")

	lunarR1 = domain.RobotID("lunar-R1")
	lunarR2 = domain.RobotID("lunar-R2")
	shackR1 = domain.RobotID("shackleton-R1")
)

func TestSites_DeterministicWinnerPerSite(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: lunarTask, Type: typeFoundation}, Pos: domain.Vec2{X: 0, Y: 0}, SiteID: siteLunar},
		{Task: domain.Task{ID: shackTask, Type: typeFoundation}, Pos: domain.Vec2{X: 400, Y: 0}, SiteID: siteShackleton},
	}
	rovers := []agent.Config{
		{ID: lunarR1, Pos: domain.Vec2{X: 0, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}, SiteID: siteLunar},
		{ID: shackR1, Pos: domain.Vec2{X: 400, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}, SiteID: siteShackleton},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
	}

	h := newSelfHealHarness(t, cfg, lunarTask, shackTask)

	h.poll("lunar/foundation-1 LEASED to lunar-R1", func() bool {
		x, ok := h.getTask(lunarTask)
		return ok && x.Status == domain.Leased && x.Assignee == lunarR1
	})
	h.poll("shackleton/foundation-1 LEASED to shackleton-R1", func() bool {
		x, ok := h.getTask(shackTask)
		return ok && x.Status == domain.Leased && x.Assignee == shackR1
	})

	lx, _ := h.getTask(lunarTask)
	if lx.SiteID != siteLunar {
		t.Fatalf("lunar task SiteID = %q, want %q", lx.SiteID, siteLunar)
	}
	sx, _ := h.getTask(shackTask)
	if sx.SiteID != siteShackleton {
		t.Fatalf("shackleton task SiteID = %q, want %q", sx.SiteID, siteShackleton)
	}
}

func TestSites_NoCrossSiteBids(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: shackTask, Type: typeFoundation}, Pos: domain.Vec2{X: 400, Y: 0}, SiteID: siteShackleton},
	}
	rovers := []agent.Config{
		{ID: lunarR1, Pos: domain.Vec2{X: 400, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}, SiteID: siteLunar},
		{ID: lunarR2, Pos: domain.Vec2{X: 400, Y: 0}, Battery: 0.9, Capabilities: []domain.Capability{typeFoundation}, SiteID: siteLunar},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  100 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
	}

	h := newSelfHealHarness(t, cfg, shackTask)

	end := time.Now().Add(700 * time.Millisecond)
	for time.Now().Before(end) {
		x, ok := h.getTask(shackTask)
		if ok && x.Status != domain.Unclaimed {
			t.Fatalf("shackleton task leaked to %s (assignee=%s); a lunar rover must never bid across sites", x.Status, x.Assignee)
		}
		time.Sleep(20 * time.Millisecond)
	}

	x, ok := h.getTask(shackTask)
	if !ok {
		t.Fatalf("shackleton task must be mirrored to KV")
	}
	if x.Status != domain.Unclaimed {
		t.Fatalf("shackleton task final status = %s, want UNCLAIMED (no cross-site bids)", x.Status)
	}
}

func TestSites_SameSiteHealing(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: lunarTask, Type: typeFoundation}, Pos: domain.Vec2{X: 0, Y: 0}, SiteID: siteLunar},
		{Task: domain.Task{ID: shackTask, Type: typeFoundation}, Pos: domain.Vec2{X: 400, Y: 0}, SiteID: siteShackleton},
	}
	rovers := []agent.Config{
		{ID: lunarR1, Pos: domain.Vec2{X: 0, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}, SiteID: siteLunar},
		{ID: lunarR2, Pos: domain.Vec2{X: 0, Y: 40}, Battery: 0.6, Capabilities: []domain.Capability{typeFoundation}, SiteID: siteLunar},
		{ID: shackR1, Pos: domain.Vec2{X: 400, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}, SiteID: siteShackleton},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
	}

	h := newSelfHealHarness(t, cfg, lunarTask, shackTask)

	h.poll("lunar/foundation-1 LEASED to lunar-R1", func() bool {
		x, ok := h.getTask(lunarTask)
		return ok && x.Status == domain.Leased && x.Assignee == lunarR1
	})

	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdKill, Robot: lunarR1}); err != nil {
		t.Fatalf("publish kill lunar-R1: %v", err)
	}
	_ = h.conn.Flush()

	h.poll("lunar/foundation-1 re-LEASED to lunar-R2", func() bool {
		x, ok := h.getTask(lunarTask)
		return ok && x.Status == domain.Leased && x.Assignee == lunarR2
	})

	h.poll("lunar/foundation-1 DONE", func() bool {
		x, ok := h.getTask(lunarTask)
		return ok && x.Status == domain.Done
	})

	x, _ := h.getTask(lunarTask)
	if x.Assignee != "" {
		t.Fatalf("done lunar task assignee = %q, want empty", x.Assignee)
	}
}
