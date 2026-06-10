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

func allCaps() []domain.Capability {
	return []domain.Capability{
		domain.Capability(blueprint.TypeFoundation),
		domain.Capability(blueprint.TypeWall),
		domain.Capability(blueprint.TypeDomeCap),
		domain.Capability(blueprint.TypePanel),
		domain.Capability(blueprint.TypeMast),
	}
}

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

func placementConfig() coordinator.Config {
	return coordinator.Config{
		Blueprint:      nil,
		Rovers:         placementSwarm(),
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
		WorldBounds:    400,
	}
}

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

func place(t *testing.T, h *selfHealHarness, id string, origin domain.Vec2, rotation float64) {
	t.Helper()
	ctl := wire.Control{Cmd: "placeBlueprint", BlueprintID: id, Origin: origin, Rotation: rotation}
	if err := h.conn.PublishJSON(wire.SubjControl, ctl); err != nil {
		t.Fatalf("publish placeBlueprint %s: %v", id, err)
	}
	_ = h.conn.Flush()
}

func instanceIDs(instance string, locals ...domain.TaskID) []domain.TaskID {
	out := make([]domain.TaskID, len(locals))
	for i, l := range locals {
		out[i] = domain.TaskID(instance + "/" + string(l))
	}
	return out
}

func TestPlaceBlueprint_InjectsAuctionsAndBuilds(t *testing.T) {
	ids := instanceIDs("bp1", "pad-1", "pad-2", "panel-1", "panel-2")
	h := newSelfHealHarness(t, placementConfig(), ids...)
	waitCoordinatorReady(t, h)

	place(t, h, "solar-array", domain.Vec2{X: 0, Y: 0}, 0)

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

	panel, _ := h.getTask("bp1/panel-1")
	if panel.Version < 2 {
		t.Fatalf("panel-1 version = %d, want >= 2 (auctioned+leased+done)", panel.Version)
	}
}

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

func TestPlaceBlueprint_RejectsInvalid(t *testing.T) {
	cfg := placementConfig()
	cfg.WorldBounds = 60
	h := newSelfHealHarness(t, cfg)
	waitCoordinatorReady(t, h)

	place(t, h, "solar-array", domain.Vec2{X: 500, Y: 500}, 0)
	place(t, h, "comms-mast", domain.Vec2{X: 0, Y: 0}, 0)
	place(t, h, "comms-mast", domain.Vec2{X: 0, Y: 0}, 0)

	mast := instanceIDs("bp1", "base", "mast", "antenna")
	for _, id := range mast {
		h.poll(fmt.Sprintf("%s DONE", id), func() bool {
			tk, ok := h.getTask(id)
			return ok && tk.Status == domain.Done
		})
	}

	for _, inst := range []string{"bp1", "bp2", "bp3"} {
		for _, local := range []domain.TaskID{"pad-1", "panel-1"} {
			id := domain.TaskID(inst + "/" + string(local))
			if _, ok := h.getTask(id); ok {
				t.Fatalf("out-of-bounds solar-array task %s was injected; placement validation failed", id)
			}
		}
	}
	if _, ok := h.getTask("bp2/base"); ok {
		t.Fatalf("overlapping comms-mast (bp2) was injected; no-overlap validation failed")
	}
}

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

	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: "reloadDemo"}); err != nil {
		t.Fatalf("publish reloadDemo: %v", err)
	}
	_ = h.conn.Flush()

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

	place(t, h, "comms-mast", domain.Vec2{X: 50, Y: 0}, 0)
	for _, id := range instanceIDs("bp2", "base", "mast", "antenna") {
		h.poll(fmt.Sprintf("%s DONE after reload", id), func() bool {
			tk, ok := h.getTask(id)
			return ok && tk.Status == domain.Done
		})
	}
}
