package coordinator_test

import (
	"fmt"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/blueprint"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"sync"
	"testing"
	"time"
)

// allCaps lets a rover bid on every catalog task type, so an injected Blueprint
// of any shape can be auctioned and built by the placement-test swarm.
func allCaps() []domain.Capability {
	return []domain.Capability{
		domain.Capability(blueprint.TypeFoundation),
		domain.Capability(blueprint.TypeWall),
		domain.Capability(blueprint.TypeDomeCap),
		domain.Capability(blueprint.TypePanel),
		domain.Capability(blueprint.TypeMast),
	}
}

// placementSwarm is a six-rover swarm parked below the worksite, each fully
// capable, with staggered batteries so bids differ (deterministic winners).
func placementSwarm() []agent.Config {
	rovers := make([]agent.Config, 6)
	for i := range 6 {
		rovers[i] = agent.Config{
			ID:           domain.RobotID(fmt.Sprintf("R%d", i+1)),
			Pos:          domain.Vec2{X: float64(-50 + i*20), Y: -120},
			Battery:      1.0 - float64(i)*0.05,
			Capabilities: allCaps(),
		}
	}
	return rovers
}

// placementConfig starts the coordinator with NO startup blueprint — the only
// tasks that ever exist come from placeBlueprint injections. This isolates the
// bh-05 path: an empty board proves the injected DAG (not a pre-loaded one)
// auctions and builds.
func placementConfig() coordinator.Config {
	return coordinator.Config{
		Blueprint:      nil, // empty board: tasks arrive only via placeBlueprint
		Rovers:         placementSwarm(),
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
		WorldBounds:    400,
	}
}

// waitCoordinatorReady blocks until the coordinator is publishing snapshots, so a
// placeBlueprint control frame can't be dropped by core NATS before the
// coordinator's control subscription is registered (a startup race). It waits for
// the first world.snapshot frame — emitted only once Run is fully wired.
func waitCoordinatorReady(t *testing.T, h *selfHealHarness) {
	t.Helper()
	ready := make(chan struct{})
	var once sync.Once
	unsub, err := bus.SubscribeJSON(h.conn, wire.SubjSnapshot, func(_ wire.Snapshot) {
		once.Do(func() { close(ready) })
	})
	if err != nil {
		t.Fatalf("subscribe snapshot: %v", err)
	}
	defer unsub()
	_ = h.conn.Flush()
	select {
	case <-ready:
	case <-time.After(10 * time.Second):
		t.Fatal("coordinator never published a snapshot (not ready)")
	}
}

// place publishes a placeBlueprint control frame over the bus, exactly as the
// gateway relays a dashboard drag-to-place. mode is optional (bh-08c): omit it for
// the replay default, or pass a single "live"/"replay" to tag the placement.
func place(t *testing.T, h *selfHealHarness, id string, origin domain.Vec2, rotation float64, mode ...string) {
	t.Helper()
	ctl := wire.Control{Cmd: "placeBlueprint", BlueprintID: id, Origin: origin, Rotation: rotation}
	if len(mode) > 0 {
		ctl.Mode = mode[0]
	}
	if err := h.conn.PublishJSON(wire.SubjControl, ctl); err != nil {
		t.Fatalf("publish placeBlueprint %s: %v", id, err)
	}
	_ = h.conn.Flush()
}

// instanceIDs returns the prefixed task ids of a placed Blueprint instance, e.g.
// instanceIDs("bp1", "pad-1") → ["bp1/pad-1"].
func instanceIDs(instance string, locals ...domain.TaskID) []domain.TaskID {
	out := make([]domain.TaskID, len(locals))
	for i, l := range locals {
		out[i] = domain.TaskID(instance + "/" + string(l))
	}
	return out
}

// TestPlaceBlueprint_InjectsAuctionsAndBuilds is the bh-05 e2e proof: a dragged-in
// Blueprint's pre-baked DAG is injected, the injected Tasks auction via the
// UNCHANGED Auction/Lease flow, and the whole structure builds to DONE — observed
// only through the KV-mirrored World Model (never coordinator internals).
func TestPlaceBlueprint_InjectsAuctionsAndBuilds(t *testing.T) {
	ids := instanceIDs("bp1", "pad-1", "pad-2", "panel-1", "panel-2")
	h := newSelfHealHarness(t, placementConfig(), ids...)
	waitCoordinatorReady(t, h)

	// Drag-to-place a solar array at a clear spot.
	place(t, h, "solar-array", domain.Vec2{X: 0, Y: 0}, 0)

	// The injected tasks must appear in the World Model, then build to DONE.
	for _, id := range ids {
		h.poll(fmt.Sprintf("%s injected", id), func() bool {
			_, ok := h.getTask(id)
			return ok
		})
	}
	for _, id := range ids {
		h.poll(fmt.Sprintf("%s DONE", id), func() bool {
			tk, ok := h.getTask(id)
			return ok && tk.Status == domain.Done
		})
	}

	// A panel depends on its pad, so the DONE versions must have advanced past the
	// seed — evidence the live auction/lease writes ran (UNCLAIMED→LEASED→DONE).
	panel, _ := h.getTask("bp1/panel-1")
	if panel.Version < 2 {
		t.Fatalf("panel-1 version = %d, want >= 2 (auctioned+leased+done)", panel.Version)
	}
}

// TestPlaceBlueprint_MultipleConcurrent proves multiple Blueprints can be placed
// in ONE world and both build: a solar array and a comms mast, placed far apart,
// each injected as its own DAG the Auction feeds on — every task of both reaches
// DONE.
func TestPlaceBlueprint_MultipleConcurrent(t *testing.T) {
	solar := instanceIDs("bp1", "pad-1", "pad-2", "panel-1", "panel-2")
	mast := instanceIDs("bp2", "base", "mast", "antenna")
	all := append(append([]domain.TaskID{}, solar...), mast...)

	h := newSelfHealHarness(t, placementConfig(), all...)
	waitCoordinatorReady(t, h)

	place(t, h, "solar-array", domain.Vec2{X: -100, Y: 0}, 0)
	place(t, h, "comms-mast", domain.Vec2{X: 100, Y: 0}, 0)

	for _, id := range all {
		h.poll(fmt.Sprintf("%s DONE", id), func() bool {
			tk, ok := h.getTask(id)
			return ok && tk.Status == domain.Done
		})
	}
}

// TestPlaceBlueprint_ModeTagsTasksAndCoexist is the bh-08c proof: the coordinator
// stamps each injected Task with the placement's chosen build mode, and a LIVE
// blueprint and a REPLAY blueprint coexist in ONE world and both build to DONE.
//
// The placement swarm wires no LiveBuilder, so a live-tagged Task degrades to the
// deterministic replay/primitive stream and still completes — which is exactly the
// model-free, back-compat-safe guarantee this slice needs (the mode tag rides the
// World Model whether or not a model is wired). The default placement carries no
// mode (empty ⇒ replay), and an explicit "live" placement carries "live".
func TestPlaceBlueprint_ModeTagsTasksAndCoexist(t *testing.T) {
	replayIDs := instanceIDs("bp1", "pad-1", "pad-2", "panel-1", "panel-2")
	liveIDs := instanceIDs("bp2", "base", "mast", "antenna")
	all := append(append([]domain.TaskID{}, replayIDs...), liveIDs...)

	h := newSelfHealHarness(t, placementConfig(), all...)
	waitCoordinatorReady(t, h)

	// A default (replay) solar array and an explicit LIVE comms mast, far apart.
	place(t, h, "solar-array", domain.Vec2{X: -100, Y: 0}, 0) // omitted mode ⇒ replay
	place(t, h, "comms-mast", domain.Vec2{X: 100, Y: 0}, 0, "live")

	// Both DAGs build to DONE in the same world (coexistence).
	for _, id := range all {
		h.poll(fmt.Sprintf("%s DONE", id), func() bool {
			tk, ok := h.getTask(id)
			return ok && tk.Status == domain.Done
		})
	}

	// The coordinator stamped each injected Task with the placement's mode in the
	// World Model: the default (omitted-mode) array tasks are normalized to the
	// canonical replay tag, the live mast tasks carry "live". Either way the
	// effective build path is replay for the array (an empty or "replay" tag both
	// resolve to replay on the rover), so this is back-compat-safe.
	for _, id := range replayIDs {
		tk, _ := h.getTask(id)
		if tk.Mode != string(agent.ModeReplay) {
			t.Fatalf("default-placement task %s mode = %q, want %q (replay)", id, tk.Mode, agent.ModeReplay)
		}
	}
	for _, id := range liveIDs {
		tk, _ := h.getTask(id)
		if tk.Mode != string(agent.ModeLive) {
			t.Fatalf("live task %s mode = %q, want %q", id, tk.Mode, agent.ModeLive)
		}
	}
}

// TestPlaceBlueprint_RejectsInvalid proves placement validation gates tasks BEFORE
// they go live: an out-of-bounds placement and an overlapping placement are both
// rejected — no task is injected for either. A subsequent VALID placement still
// works, proving a rejection does not wedge the path.
func TestPlaceBlueprint_RejectsInvalid(t *testing.T) {
	// Tight bounds so an off-board origin is clearly out of bounds.
	cfg := placementConfig()
	cfg.WorldBounds = 60
	h := newSelfHealHarness(t, cfg)
	waitCoordinatorReady(t, h)

	// 1) Out of bounds: origin far outside the ±60 build square.
	place(t, h, "solar-array", domain.Vec2{X: 500, Y: 500}, 0)
	// 2) A valid placement near the origin.
	place(t, h, "comms-mast", domain.Vec2{X: 0, Y: 0}, 0)
	// 3) Overlapping: another comms-mast dropped on the same spot must be rejected.
	place(t, h, "comms-mast", domain.Vec2{X: 0, Y: 0}, 0)

	// The valid comms-mast (instance bp1, since the out-of-bounds attempt rolled its
	// counter back) must build; the rejected placements inject nothing.
	mast := instanceIDs("bp1", "base", "mast", "antenna")
	for _, id := range mast {
		h.poll(fmt.Sprintf("%s DONE", id), func() bool {
			tk, ok := h.getTask(id)
			return ok && tk.Status == domain.Done
		})
	}

	// The out-of-bounds solar array must NOT exist under any instance prefix.
	for _, inst := range []string{"bp1", "bp2", "bp3"} {
		for _, local := range []domain.TaskID{"pad-1", "panel-1"} {
			id := domain.TaskID(inst + "/" + string(local))
			if _, ok := h.getTask(id); ok {
				t.Fatalf("out-of-bounds solar-array task %s was injected; placement validation failed", id)
			}
		}
	}
	// The overlapping second mast must NOT exist (only bp1's mast does).
	if _, ok := h.getTask("bp2/base"); ok {
		t.Fatalf("overlapping comms-mast (bp2) was injected; no-overlap validation failed")
	}
}

// TestPlaceBlueprint_ReloadClearsPlacement proves onReload still resets cleanly
// when Blueprints have been placed (bh-05): after a reloadDemo, the placed
// structure's tasks end terminal (no longer UNCLAIMED work the Auction would
// announce), and a Blueprint placed AFTER the reload gets a fresh instance id
// (bp2) and builds — proving the placement tracking was forgotten and the path
// still works post-reload.
func TestPlaceBlueprint_ReloadClearsPlacement(t *testing.T) {
	mast := instanceIDs("bp1", "base", "mast", "antenna")
	h := newSelfHealHarness(t, placementConfig(), mast...)
	waitCoordinatorReady(t, h)

	place(t, h, "comms-mast", domain.Vec2{X: 0, Y: 0}, 0)
	for _, id := range mast {
		h.poll(fmt.Sprintf("%s DONE", id), func() bool {
			tk, ok := h.getTask(id)
			return ok && tk.Status == domain.Done
		})
	}

	// Reload the board IN-PROCESS.
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: "reloadDemo"}); err != nil {
		t.Fatalf("publish reloadDemo: %v", err)
	}
	_ = h.conn.Flush()

	// Wait for the reload to land (the old bp1/base record version bumps). The mast
	// was already DONE, so it stays DONE — never bouncing back to UNCLAIMED.
	pre, _ := h.getTask("bp1/base")
	preVersion := pre.Version
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		tk, ok := h.getTask("bp1/base")
		if ok && tk.Version > preVersion {
			if tk.Status != domain.Done {
				t.Fatalf("reloaded placed task bp1/base = %s, want DONE (must not re-auction)", tk.Status)
			}
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	// A NEW placement after reload gets instance bp2 (counter not reset) and builds.
	place(t, h, "comms-mast", domain.Vec2{X: 50, Y: 0}, 0)
	for _, id := range instanceIDs("bp2", "base", "mast", "antenna") {
		h.poll(fmt.Sprintf("%s DONE after reload", id), func() bool {
			tk, ok := h.getTask(id)
			return ok && tk.Status == domain.Done
		})
	}
}
