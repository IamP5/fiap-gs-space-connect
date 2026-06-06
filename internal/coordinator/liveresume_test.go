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

// liveFoundation is a hard-gate-passing, soft-threshold-clearing foundation spec
// (multi-shape plinth inside the demo foundation envelope, 3.0×2.4×3.0). It is the
// structure the live harness converges to in the resume integration test — rich
// enough that the agent paces it over several opEvery ticks, so a kill lands
// mid-build and leaves a genuine partial patch log for the replacement to resume.
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

// liveSpecJSON wraps ops in the strict {"ops":[...]} envelope a provider emits, so a
// model.FakeModel can return them through the real validate-and-repair seam.
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

// newResumeBuilder builds a REAL live.Builder driven by a no-network FakeModel that
// always returns the same hard-gate-passing foundation spec. Each Rover gets its own
// builder/model so a kill of one never perturbs the other; both converge to the same
// structure, so the resume continues — not restarts — the half-built foundation.
func newResumeBuilder(t *testing.T) agent.LiveBuilder {
	t.Helper()
	// A handful of identical responses covers the loop's repair/refine re-asks across
	// both the killed Rover and the replacement without ever exhausting.
	resp := make([]json.RawMessage, 0, 8)
	for range 8 {
		resp = append(resp, liveSpecJSON(t, liveFoundation()))
	}
	fake := &model.FakeModel{Responses: resp}
	return live.NewBuilderWithGenerator(loop.ModelGenerator{M: fake}, "fake", "fake-model")
}

// liveResumeConfig is oneTaskConfig's live-mode sibling: two capable rovers (R1 the
// clear winner, R2 the standby) running in ModeLive with an injected REAL live
// builder, no BuildOps override so liveEnabled() is true. Timings match the bh-02
// kill-resume test so a kill expires the lease fast and the structure paces slowly
// enough to be caught half-built.
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
		HeartbeatEvery: 100 * time.Millisecond, // TTL = 3×100ms; expires fast once a builder dies
		TTLFactor:      3,
		SnapshotHz:     20,
	}
}

// TestLiveResume_KillMidLiveBuildResumesAndCompletes is the bh-08e HEADLINE: a LIVE
// Rover building a Task via the real Generator↔Evaluator harness is killed
// mid-build; its Task returns to UNCLAIMED with the durable patch log INTACT; the
// replacement Rover wins it, is handed the prior patch log on the Award, FOLDS it,
// CONTINUES the live loop from the half-built structure, and the Task completes with
// a coherent final structure (the streamed patch log folds cleanly). No restart from
// scratch — the partial ops are never lost or re-placed.
func TestLiveResume_KillMidLiveBuildResumesAndCompletes(t *testing.T) {
	const id domain.TaskID = "build-live"
	h := newSelfHealHarness(t, liveResumeConfig(t, id), id)

	// 1) The task is LEASED to R1, the clear winner, which begins live-building.
	h.poll("build-live LEASED to R1", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R1"
	})

	// 2) Wait for a PARTIAL live spec — some ops appended, but fewer than the full
	//    structure — so the kill genuinely interrupts a half-built structure.
	want := len(liveFoundation())
	h.poll("build-live spec partially accumulated under R1", func() bool {
		got := h.getSpec(id)
		return len(got) > 0 && len(got) < want
	})
	partial := len(h.getSpec(id))

	// 3) KILL R1 mid-live-build: it stops heartbeating and its in-flight model call
	//    is cancelled, so the lease TTL-expires and the task self-heals. The partial
	//    patch log is never cleared (onExpired returns the task to UNCLAIMED only).
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdKill, Robot: "R1"}); err != nil {
		t.Fatalf("publish kill R1: %v", err)
	}
	_ = h.conn.Flush()

	// 4) The task re-LEASES to R2 (the self-heal) WITHOUT losing the accumulated ops:
	//    the durable partial patch log must never shrink across the expiry/handoff.
	h.poll("build-live re-LEASED to R2 (live resume)", func() bool {
		if got := h.getSpec(id); len(got) < partial {
			t.Fatalf("accumulated ops LOST on kill: had %d, now %d", partial, len(got))
		}
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R2"
	})

	// 5) The replacement resumes the live loop and carries the Task to DONE.
	h.poll("build-live DONE after live resume", func() bool {
		if got := h.getSpec(id); len(got) < partial {
			t.Fatalf("accumulated ops LOST during resume: had %d, now %d", partial, len(got))
		}
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})

	// 6) COHERENCE: the final durable patch log folds CLEANLY to a non-empty
	//    structure at least as rich as the killed Rover's partial — the resumed work
	//    composed with the partial (the patch log grew monotonically across the
	//    handoff and the renderer fold stays valid), rather than restarting empty.
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
