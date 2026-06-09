package coordinator_test

import (
	"bytes"
	"encoding/json"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/asset"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

func testWallOps() []wire.BuildOp {
	rough := 0.85
	metal := 0.1
	mat := func(c string) wire.Material { return wire.Material{Color: c, Roughness: &rough, Metalness: &metal} }
	box := func(y float64, c string) wire.BuildOp {
		return wire.BuildOp{
			Op: wire.BuildOpPlace, Shape: wire.ShapeBox,
			Pos: domain.Vec3{X: 0, Y: y, Z: 0}, Scale: domain.Vec3{X: 1.6, Y: 0.5, Z: 0.6},
			Material: mat(c),
		}
	}
	return []wire.BuildOp{
		box(0.25, "#9aa0aa"),
		box(0.75, "#a4aab4"),
		box(1.25, "#9aa0aa"),
		box(1.75, "#a4aab4"),
		box(2.15, "#cfcfd6"),
	}
}

func specEqual(a, b []wire.BuildOp) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		ja, _ := json.Marshal(a[i])
		jb, _ := json.Marshal(b[i])
		if !bytes.Equal(ja, jb) {
			return false
		}
	}
	return true
}

func oneTaskConfig(id domain.TaskID, ops map[domain.TaskType][]wire.BuildOp) coordinator.Config {
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: id, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}, BuildOps: ops},
		{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{typeFoundation}, BuildOps: ops},
	}
	return coordinator.Config{
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
	}
}

func TestBuildOps_StreamAccumulatesAndMirrors(t *testing.T) {
	const id domain.TaskID = "build-x"
	want := testWallOps()
	h := newSelfHealHarness(t, oneTaskConfig(id, map[domain.TaskType][]wire.BuildOp{typeFoundation: want}), id)

	h.poll("build-x spec partially accumulated", func() bool {
		got := h.getSpec(id)
		return len(got) > 0 && len(got) < len(want)
	})

	h.poll("build-x DONE", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})
	h.poll("build-x full op-set mirrored", func() bool {
		return specEqual(h.getSpec(id), want)
	})
}

func TestBuildOps_KillMidBuildResumesAndConverges(t *testing.T) {
	const id domain.TaskID = "build-x"
	want := testWallOps()
	h := newSelfHealHarness(t, oneTaskConfig(id, map[domain.TaskType][]wire.BuildOp{typeFoundation: want}), id)

	h.poll("build-x LEASED to R1", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R1"
	})

	h.poll("build-x spec partially accumulated under R1", func() bool {
		got := h.getSpec(id)
		return len(got) > 0 && len(got) < len(want)
	})
	partial := len(h.getSpec(id))

	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdKill, Robot: "R1"}); err != nil {
		t.Fatalf("publish kill R1: %v", err)
	}
	_ = h.conn.Flush()

	h.poll("build-x re-LEASED to R2 (resume)", func() bool {
		if got := h.getSpec(id); len(got) < partial {
			t.Fatalf("accumulated ops LOST on kill: had %d, now %d", partial, len(got))
		}
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R2"
	})

	h.poll("build-x DONE after resume", func() bool {
		if got := h.getSpec(id); len(got) < partial {
			t.Fatalf("accumulated ops LOST during resume: had %d, now %d", partial, len(got))
		}
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})

	h.poll("build-x converged to full op-set", func() bool {
		return specEqual(h.getSpec(id), want)
	})
}

func TestBuildOps_EmptyOpsByteForBytePreHarness(t *testing.T) {
	const id domain.TaskID = "plain-x"
	noOps := map[domain.TaskType][]wire.BuildOp{typeFoundation: {}}
	h := newSelfHealHarness(t, oneTaskConfig(id, noOps), id)

	h.poll("plain-x LEASED to R1", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R1"
	})

	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdKill, Robot: "R1"}); err != nil {
		t.Fatalf("publish kill R1: %v", err)
	}
	_ = h.conn.Flush()

	h.poll("plain-x re-LEASED to R2", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R2"
	})

	h.poll("plain-x DONE", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})

	if got := h.getSpec(id); len(got) != 0 {
		t.Fatalf("forced-empty ops still accumulated %d ops; pre-harness invariant violated", len(got))
	}
}

func assetKeyOp(key string) wire.BuildOp {
	rough, metal := 0.85, 0.1
	return wire.BuildOp{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeBox,
		AssetKey: key,
		Pos:      domain.Vec3{X: 0, Y: 0.25, Z: 0},
		Scale:    domain.Vec3{X: 1.6, Y: 0.5, Z: 0.6},
		Material: wire.Material{Color: "#9aa0aa", Roughness: &rough, Metalness: &metal},
	}
}

func assetKeyConfig(id domain.TaskID, ops map[domain.TaskType][]wire.BuildOp, cat *asset.Catalog) coordinator.Config {
	cfg := oneTaskConfig(id, ops)
	cfg.AssetCatalog = cat
	return cfg
}

func TestBuildOps_InCatalogAssetKeyAccepted(t *testing.T) {
	const id domain.TaskID = "build-x"
	cat := asset.NewCatalog(
		asset.NewEntry("test-key", "/assets/test.glb", []domain.TaskType{typeFoundation}, asset.Identity()),
	)
	want := []wire.BuildOp{assetKeyOp("test-key")}
	h := newSelfHealHarness(t, assetKeyConfig(id, map[domain.TaskType][]wire.BuildOp{typeFoundation: want}, cat), id)

	h.poll("build-x in-catalog op accepted and durable", func() bool {
		return specEqual(h.getSpec(id), want)
	})

	h.poll("build-x DONE", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})
}

func TestBuildOps_OutOfCatalogAssetKeyRejected(t *testing.T) {
	const id domain.TaskID = "build-x"
	cat := asset.NewCatalog(
		asset.NewEntry("test-key", "/assets/test.glb", []domain.TaskType{typeFoundation}, asset.Identity()),
	)
	ops := []wire.BuildOp{assetKeyOp("hallucinated-key")}
	h := newSelfHealHarness(t, assetKeyConfig(id, map[domain.TaskType][]wire.BuildOp{typeFoundation: ops}, cat), id)

	h.poll("build-x DONE despite rejected op", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})

	if got := h.getSpec(id); len(got) != 0 {
		t.Fatalf("out-of-catalog AssetKey leaked into the spec: %d ops accumulated, want 0", len(got))
	}
}

func TestBuildOps_TypeUnsuitedAssetKeyRejected(t *testing.T) {
	const id domain.TaskID = "build-x"
	cat := asset.NewCatalog(
		asset.NewEntry("test-key", "/assets/test.glb", []domain.TaskType{"wall"}, asset.Identity()),
	)
	ops := []wire.BuildOp{assetKeyOp("test-key")}
	h := newSelfHealHarness(t, assetKeyConfig(id, map[domain.TaskType][]wire.BuildOp{typeFoundation: ops}, cat), id)

	h.poll("build-x DONE despite type-unsuited op", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})

	if got := h.getSpec(id); len(got) != 0 {
		t.Fatalf("type-unsuited AssetKey leaked into the spec: %d ops accumulated, want 0", len(got))
	}
}
