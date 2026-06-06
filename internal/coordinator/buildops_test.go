package coordinator_test

import (
	"bytes"
	"encoding/json"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

// testWallOps is a fixed, deterministic build-op stream the bh-02 tests inject
// via agent.Config.BuildOps, so the assertions do not depend on the agent's
// internal opsource. Five well-formed ops (each passes spec.Validate) is enough
// to be killed PART-WAY through: a kill lands after a couple of ops, leaving a
// genuine partial structure for the replacement to resume.
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

// specEqual reports whether two accumulated Build specs are the same ordered
// op-set: same length and the same op at every index, compared BY VALUE.
// wire.BuildOp carries *float64 material fields, so a raw == would compare
// pointer identity (which differs across a JSON round-trip through KV); we
// compare the marshalled JSON instead, which is value-stable.
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

// oneTaskConfig builds a single-task blueprint of type foundation with two
// rovers (R1 the clear winner on the task, R2 a capable standby further off) and
// the given per-type op stream injected. AuctionWindow/heartbeat are tuned so a
// kill expires the lease fast and the re-auction heals to R2. The op stream is
// paced (opEvery=120ms in the agent), so five ops take ~600ms to emit — long
// enough to kill mid-build.
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
		HeartbeatEvery: 100 * time.Millisecond, // TTL = 3×100ms; expires fast once a builder dies
		TTLFactor:      3,
		SnapshotHz:     20,
	}
}

// TestBuildOps_StreamAccumulatesAndMirrors is the baseline (uninterrupted) build:
// a single Rover streams its op-set as it works, the coordinator appends each op
// to the Task's Build spec and mirrors it to KV, and the Task reaches DONE with
// the FULL op-set durably recorded. It is the convergence reference the
// kill-resume test compares against.
func TestBuildOps_StreamAccumulatesAndMirrors(t *testing.T) {
	const id domain.TaskID = "build-x"
	want := testWallOps()
	h := newSelfHealHarness(t, oneTaskConfig(id, map[domain.TaskType][]wire.BuildOp{typeFoundation: want}), id)

	// The spec must grow incrementally: catch it partially built at least once,
	// proving ops accumulate op-by-op rather than landing in one blob.
	h.poll("build-x spec partially accumulated", func() bool {
		got := h.getSpec(id)
		return len(got) > 0 && len(got) < len(want)
	})

	// The Task reaches DONE with the full op-set mirrored to KV. The KV spec mirror
	// is eventually consistent, so poll the final spec rather than read once.
	h.poll("build-x DONE", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})
	h.poll("build-x full op-set mirrored", func() bool {
		return specEqual(h.getSpec(id), want)
	})
}

// TestBuildOps_KillMidBuildResumesAndConverges is the HEADLINE bh-02 test: a
// Rover with a PARTIAL Build spec is killed mid-build; its Task returns to
// UNCLAIMED WITHOUT losing the accumulated ops; the replacement Rover resumes
// appending; and the final op-set equals the uninterrupted op-set (convergence).
func TestBuildOps_KillMidBuildResumesAndConverges(t *testing.T) {
	const id domain.TaskID = "build-x"
	want := testWallOps()
	h := newSelfHealHarness(t, oneTaskConfig(id, map[domain.TaskType][]wire.BuildOp{typeFoundation: want}), id)

	// 1) The task is LEASED to R1, the clear winner.
	h.poll("build-x LEASED to R1", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R1"
	})

	// 2) Wait for a PARTIAL spec — some ops appended, but not the whole set — so
	//    the kill genuinely interrupts a half-built structure.
	h.poll("build-x spec partially accumulated under R1", func() bool {
		got := h.getSpec(id)
		return len(got) > 0 && len(got) < len(want)
	})
	partial := len(h.getSpec(id))

	// 3) KILL R1 mid-build over the dashboard control path: it stops heartbeating
	//    and emitting ops, so the lease TTL-expires and the task self-heals.
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdKill, Robot: "R1"}); err != nil {
		t.Fatalf("publish kill R1: %v", err)
	}
	_ = h.conn.Flush()

	// 4) The task returns to UNCLAIMED (or is re-LEASED to R2) WITHOUT losing the
	//    accumulated ops: the partial spec must never shrink. We witness the
	//    re-lease to a DIFFERENT rover (the self-heal) while asserting the durable
	//    partial spec is preserved across the expiry.
	h.poll("build-x re-LEASED to R2 (resume)", func() bool {
		if got := h.getSpec(id); len(got) < partial {
			t.Fatalf("accumulated ops LOST on kill: had %d, now %d", partial, len(got))
		}
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R2"
	})

	// 5) The replacement finishes: the task reaches DONE.
	h.poll("build-x DONE after resume", func() bool {
		if got := h.getSpec(id); len(got) < partial {
			t.Fatalf("accumulated ops LOST during resume: had %d, now %d", partial, len(got))
		}
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})

	// 6) CONVERGENCE: the final op-set after the kill equals the uninterrupted
	//    op-set, op-for-op. The replacement resumed and continued appending the
	//    SAME deterministic stream from where R1 stopped — never regenerated from
	//    scratch, never double-appended. The KV spec mirror is eventually
	//    consistent, so poll until it matches.
	h.poll("build-x converged to full op-set", func() bool {
		return specEqual(h.getSpec(id), want)
	})
}

// TestBuildOps_EmptyOpsByteForBytePreHarness is the best-effort INVARIANT test:
// with the op stream forced EMPTY, Task completion and self-heal behave exactly
// as before the build harness. The rover falls back to the fixed work timer, the
// Task still completes end-to-end, a mid-build kill still TTL-expires and
// re-auctions to a different rover, and NO Build spec is ever accumulated — the
// pre-harness path is untouched.
func TestBuildOps_EmptyOpsByteForBytePreHarness(t *testing.T) {
	const id domain.TaskID = "plain-x"
	// Forced-empty ops for the foundation type: the rover emits zero ops.
	noOps := map[domain.TaskType][]wire.BuildOp{typeFoundation: {}}
	h := newSelfHealHarness(t, oneTaskConfig(id, noOps), id)

	// 1) LEASED to R1.
	h.poll("plain-x LEASED to R1", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R1"
	})

	// 2) KILL R1: the lease TTL-expires and the task self-heals, exactly as in the
	//    pre-harness self-heal test — no Build spec involved.
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdKill, Robot: "R1"}); err != nil {
		t.Fatalf("publish kill R1: %v", err)
	}
	_ = h.conn.Flush()

	// 3) Re-auctioned and re-leased to a DIFFERENT rover (R2): self-heal unchanged.
	h.poll("plain-x re-LEASED to R2", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Leased && tk.Assignee == "R2"
	})

	// 4) The task completes end-to-end despite the kill.
	h.poll("plain-x DONE", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})

	// 5) The invariant: NO Build spec was ever accumulated — the spec mirror stays
	//    empty for this task, so the snapshot carries no build_spec and the
	//    renderer's primitive fallback is byte-for-byte the pre-harness behaviour.
	if got := h.getSpec(id); len(got) != 0 {
		t.Fatalf("forced-empty ops still accumulated %d ops; pre-harness invariant violated", len(got))
	}
}
