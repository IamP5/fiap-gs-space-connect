package coordinator_test

import (
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

// Two-site lunar surface (epic 04): a single coordinator tags every Task and rover
// with a SiteID, and the auction is gated by site (wire.Announce.SiteID vs the
// agent's Config.SiteID). These tests assert the three load-bearing site
// properties: a rover only ever wins its OWN site's task (deterministic winner per
// site), a rover NEVER bids on the other site's task (no cross-site bids), and a
// killed rover's task is healed by a SAME-SITE standby (same-site self-heal).

// Site ids + the per-site task/rover ids reused across the two-site tests, factored
// out so the literals stay in lockstep (and to keep goconst happy).
const (
	siteLunar      = "lunar"
	siteShackleton = "shackleton"

	lunarTask = domain.TaskID("lunar/foundation-1")
	shackTask = domain.TaskID("shackleton/foundation-1")

	lunarR1 = domain.RobotID("lunar-R1")
	lunarR2 = domain.RobotID("lunar-R2")
	shackR1 = domain.RobotID("shackleton-R1")
)

// TestSites_DeterministicWinnerPerSite asserts each site's task is won by a rover
// stationed at that SAME site, never the other site's swarm — even when the other
// site's rover sits closer in raw world coords. With the site gate, only same-site
// rovers bid, so the per-site winner is deterministic.
func TestSites_DeterministicWinnerPerSite(t *testing.T) {
	// Lunar task at the origin; Shackleton task offset far away — the standard
	// two-site world layout.
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: lunarTask, Type: typeFoundation}, Pos: domain.Vec2{X: 0, Y: 0}, SiteID: siteLunar},
		{Task: domain.Task{ID: shackTask, Type: typeFoundation}, Pos: domain.Vec2{X: 400, Y: 0}, SiteID: siteShackleton},
	}
	// One rover per site, each parked on its own task. The lunar rover is closest to
	// BOTH tasks in raw distance only for the lunar one; the gate (not distance) is
	// what keeps each rover on its own site.
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

	// Each site's task is leased to its OWN site's rover.
	h.poll("lunar/foundation-1 LEASED to lunar-R1", func() bool {
		x, ok := h.getTask(lunarTask)
		return ok && x.Status == domain.Leased && x.Assignee == lunarR1
	})
	h.poll("shackleton/foundation-1 LEASED to shackleton-R1", func() bool {
		x, ok := h.getTask(shackTask)
		return ok && x.Status == domain.Leased && x.Assignee == shackR1
	})

	// And the World Model carries the site tag on each task record.
	lx, _ := h.getTask(lunarTask)
	if lx.SiteID != siteLunar {
		t.Fatalf("lunar task SiteID = %q, want %q", lx.SiteID, siteLunar)
	}
	sx, _ := h.getTask(shackTask)
	if sx.SiteID != siteShackleton {
		t.Fatalf("shackleton task SiteID = %q, want %q", sx.SiteID, siteShackleton)
	}
}

// TestSites_NoCrossSiteBids asserts a task on one site is NEVER leased when the
// only capable rovers belong to the OTHER site: the site gate drops their bids, so
// the task stays UNCLAIMED forever (re-announced every tick but never won). This is
// the negative twin of the deterministic-winner test — there is nothing to heal to
// across a site boundary.
func TestSites_NoCrossSiteBids(t *testing.T) {
	// A Shackleton task, but every rover is a LUNAR rover sitting right on it.
	// Distance/capability would make them the obvious winner; only the site gate
	// keeps them off it.
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

	// Run several auction cycles; the Shackleton task must STAY UNCLAIMED — no lunar
	// rover may win it, so it never leases.
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

// TestSites_SameSiteHealing asserts the headline self-heal stays LOCAL to a site:
// when the lunar winner is killed, a DIFFERENT LUNAR standby heals the task — never
// the Shackleton swarm, even though a Shackleton rover is also capable. The kill
// goes out on the real control path; the heal that follows is genuine and same-site.
func TestSites_SameSiteHealing(t *testing.T) {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: lunarTask, Type: typeFoundation}, Pos: domain.Vec2{X: 0, Y: 0}, SiteID: siteLunar},
		// A Shackleton task too, so the Shackleton swarm has its own work and a
		// Shackleton rover that finishes early is still gated off the lunar heal.
		{Task: domain.Task{ID: shackTask, Type: typeFoundation}, Pos: domain.Vec2{X: 400, Y: 0}, SiteID: siteShackleton},
	}
	rovers := []agent.Config{
		// Lunar: R1 is the clear winner (on the task, full battery); R2 is the
		// same-site standby that heals once R1 is gone.
		{ID: lunarR1, Pos: domain.Vec2{X: 0, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}, SiteID: siteLunar},
		{ID: lunarR2, Pos: domain.Vec2{X: 0, Y: 40}, Battery: 0.6, Capabilities: []domain.Capability{typeFoundation}, SiteID: siteLunar},
		// Shackleton: capable, but gated off the lunar task by site — it must never
		// win the lunar heal.
		{ID: shackR1, Pos: domain.Vec2{X: 400, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}, SiteID: siteShackleton},
	}

	cfg := coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond, // TTL = 300ms; expires fast once R1 dies
		TTLFactor:      3,
		SnapshotHz:     20,
	}

	h := newSelfHealHarness(t, cfg, lunarTask, shackTask)

	// 1) lunar task is LEASED to lunar-R1 (the clear same-site winner).
	h.poll("lunar/foundation-1 LEASED to lunar-R1", func() bool {
		x, ok := h.getTask(lunarTask)
		return ok && x.Status == domain.Leased && x.Assignee == lunarR1
	})

	// 2) KILL lunar-R1 over the real control path: it stops heartbeating, its lease
	//    TTL-expires, and the task self-heals.
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdKill, Robot: lunarR1}); err != nil {
		t.Fatalf("publish kill lunar-R1: %v", err)
	}
	_ = h.conn.Flush()

	// 3) the lunar task re-leases to the SAME-SITE standby lunar-R2 — never the
	//    Shackleton rover.
	h.poll("lunar/foundation-1 re-LEASED to lunar-R2", func() bool {
		x, ok := h.getTask(lunarTask)
		return ok && x.Status == domain.Leased && x.Assignee == lunarR2
	})

	// 4) it carries to DONE end-to-end, and the assignee was never the cross-site rover.
	h.poll("lunar/foundation-1 DONE", func() bool {
		x, ok := h.getTask(lunarTask)
		return ok && x.Status == domain.Done
	})

	x, _ := h.getTask(lunarTask)
	if x.Assignee != "" {
		t.Fatalf("done lunar task assignee = %q, want empty", x.Assignee)
	}
}
