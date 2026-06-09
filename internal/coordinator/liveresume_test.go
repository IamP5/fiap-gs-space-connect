package coordinator_test

import (
	"encoding/json"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/live"
	"swarmbuild/internal/harness/loop"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/harness/spec"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

func liveFoundation() []wire.BuildOp {
	box := func(pos, scale domain.Vec3, color string) wire.BuildOp {
		return wire.BuildOp{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: pos, Scale: scale, Material: wire.Material{Color: color}}
	}
	cyl := func(pos, scale domain.Vec3, color string) wire.BuildOp {
		return wire.BuildOp{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: pos, Scale: scale, Material: wire.Material{Color: color}}
	}
	return []wire.BuildOp{
		box(domain.Vec3{X: 0, Y: -1.0, Z: 0}, domain.Vec3{X: 1.8, Y: 0.3, Z: 1.8}, "#cfcfd6"),
		cyl(domain.Vec3{X: -0.6, Y: -0.2, Z: -0.6}, domain.Vec3{X: 0.2, Y: 0.9, Z: 0.2}, "#b8b8c2"),
		cyl(domain.Vec3{X: 0.6, Y: -0.2, Z: 0.6}, domain.Vec3{X: 0.2, Y: 0.9, Z: 0.2}, "#b8b8c2"),
		{Op: wire.BuildOpPlace, Shape: wire.ShapeSphere, Pos: domain.Vec3{X: 0, Y: 0.6, Z: 0}, Scale: domain.Vec3{X: 0.45, Y: 0.45, Z: 0.45}, Material: wire.Material{Color: "#e0e0ea"}},
	}
}

func liveSpecJSON(t *testing.T, ops []wire.BuildOp) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(struct {
		Ops []wire.BuildOp `json:"ops"`
	}{Ops: ops})
	if err != nil {
		t.Fatalf("marshal spec: %v", err)
	}
	return b
}

func newResumeBuilder(t *testing.T) agent.LiveBuilder {
	t.Helper()
	resp := make([]json.RawMessage, 0, 8)
	for range 8 {
		resp = append(resp, liveSpecJSON(t, liveFoundation()))
	}
	fake := &model.FakeModel{Responses: resp}
	return live.NewBuilderWithGenerator(loop.ModelGenerator{M: fake}, "fake", "fake-model")
}

func liveResumeConfig(t *testing.T, id domain.TaskID) coordinator.Config {
	t.Helper()
	blueprint := []coordinator.BlueprintTask{
		{Task: domain.Task{ID: id, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
	}
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}, Mode: agent.ModeLive, LiveBuilder: newResumeBuilder(t)},
		{ID: "R2", Pos: domain.Vec2{X: 0, Y: 60}, Battery: 0.6, Capabilities: []domain.Capability{typeFoundation}, Mode: agent.ModeLive, LiveBuilder: newResumeBuilder(t)},
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

func TestLiveResume_KillMidLiveBuildResumesAndCompletes(t *testing.T) {
	const id domain.TaskID = "build-live"
	h := newSelfHealHarness(t, liveResumeConfig(t, id), id)

	h.poll("build-live LEASED to R1", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R1"
	})

	want := len(liveFoundation())
	h.poll("build-live spec partially accumulated under R1", func() bool {
		got := h.getSpec(id)
		return len(got) > 0 && len(got) < want
	})
	partial := len(h.getSpec(id))

	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdKill, Robot: "R1"}); err != nil {
		t.Fatalf("publish kill R1: %v", err)
	}
	_ = h.conn.Flush()

	h.poll("build-live re-LEASED to R2 (live resume)", func() bool {
		if got := h.getSpec(id); len(got) < partial {
			t.Fatalf("accumulated ops LOST on kill: had %d, now %d", partial, len(got))
		}
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R2"
	})

	h.poll("build-live DONE after live resume", func() bool {
		if got := h.getSpec(id); len(got) < partial {
			t.Fatalf("accumulated ops LOST during resume: had %d, now %d", partial, len(got))
		}
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})

	h.poll("build-live final patch log folds to a coherent structure", func() bool {
		got := h.getSpec(id)
		if len(got) < partial {
			return false
		}
		folded, err := spec.Fold(got)
		return err == nil && len(folded) > 0
	})

	tk, _ := h.getTask(id)
	if tk.Assignee != "" {
		t.Fatalf("done build-live assignee = %q, want empty", tk.Assignee)
	}
}
