package loop

import (
	"context"
	"encoding/json"
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/harness/trace"
	"swarmbuild/internal/wire"
	"testing"
)

// scriptedGen is a fake Generator: it returns a scripted op-set per Generate call
// (no network, no model), so a test stages exactly the per-iteration geometry it
// wants. An Err entry (nil ops) simulates a generation failure.
type scriptedGen struct {
	scripts [][]wire.BuildOp
	err     error
	calls   int
}

func (g *scriptedGen) Generate(_ context.Context, _ []model.Message) ([]wire.BuildOp, error) {
	g.calls++
	if g.err != nil {
		return nil, g.err
	}
	i := g.calls - 1
	if i >= len(g.scripts) {
		return nil, model.ErrFallback
	}
	return g.scripts[i], nil
}

func box(pos, scale domain.Vec3, color string) wire.BuildOp {
	return wire.BuildOp{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: pos, Scale: scale, Material: wire.Material{Color: color}}
}

func foundationEnv() evaluator.Envelope {
	return evaluator.Envelope{Center: domain.Vec3{}, Size: domain.Vec3{X: 2, Y: 1.6, Z: 2}}
}

func demoDone() evaluator.DoneCriteria { return evaluator.DoneCriteria{MinOps: 3, MinCoverage: 0.05} }

// richPlinth passes the hard gate AND clears the soft threshold (multi-shape).
func richPlinth() []wire.BuildOp {
	return []wire.BuildOp{
		{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: domain.Vec3{X: 0, Y: -0.7, Z: 0}, Scale: domain.Vec3{X: 1.8, Y: 0.2, Z: 1.8}, Material: wire.Material{Color: "#cfcfd6"}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: -0.6, Y: 0, Z: 0}, Scale: domain.Vec3{X: 0.2, Y: 0.8, Z: 0.2}, Material: wire.Material{Color: "#c0c0c0"}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: 0.6, Y: 0, Z: 0}, Scale: domain.Vec3{X: 0.2, Y: 0.8, Z: 0.2}, Material: wire.Material{Color: "#c0c0c0"}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeSphere, Pos: domain.Vec3{X: 0, Y: 0.6, Z: 0}, Scale: domain.Vec3{X: 0.4, Y: 0.3, Z: 0.4}, Material: wire.Material{Color: "#808080"}},
	}
}

// flatMass passes the hard gate (≥ MinOps, in envelope, ≥ MinCoverage) but scores
// LOW: single-shape + single-colour ⇒ coherence 1, and coverage only just clears
// the bar ⇒ coverage 1, for a soft score of 2 (< threshold 3). Used to drive the
// quality_flag:low path.
func flatMass() []wire.BuildOp {
	return []wire.BuildOp{
		box(domain.Vec3{X: -0.5, Y: -0.7, Z: 0}, domain.Vec3{X: 0.5, Y: 0.2, Z: 1.2}, "#cccccc"),
		box(domain.Vec3{X: 0, Y: -0.7, Z: 0}, domain.Vec3{X: 0.5, Y: 0.2, Z: 1.2}, "#cccccc"),
		box(domain.Vec3{X: 0.5, Y: -0.7, Z: 0}, domain.Vec3{X: 0.5, Y: 0.2, Z: 1.2}, "#cccccc"),
	}
}

// tooFew fails the done invariant (1 op < MinOps).
func tooFew() []wire.BuildOp {
	return []wire.BuildOp{box(domain.Vec3{X: 0, Y: -0.7, Z: 0}, domain.Vec3{X: 0.5, Y: 0.2, Z: 0.5}, "#ccc")}
}

func req(neighbours ...evaluator.Neighbour) Request {
	return Request{Envelope: foundationEnv(), Done: demoDone(), Neighbours: neighbours}
}

// TestLoop_AcceptsHighQualityFirstPass: a first-iteration rich spec is accepted as
// quality_flag:ok and the loop stops early (one Generate call).
func TestLoop_AcceptsHighQualityFirstPass(t *testing.T) {
	gen := &scriptedGen{scripts: [][]wire.BuildOp{richPlinth()}}
	out := Run(context.Background(), gen, evaluator.New(evaluator.Config{}), req())
	if !out.Accepted() {
		t.Fatalf("expected accepted, got %q (%s)", out.Result, out.Reason)
	}
	if out.QualityFlag != trace.QualityOK {
		t.Fatalf("expected quality ok, got %q", out.QualityFlag)
	}
	if gen.calls != 1 {
		t.Fatalf("a high-quality first pass must stop early; got %d Generate calls", gen.calls)
	}
	if len(out.Iterations) != 1 {
		t.Fatalf("want 1 iteration recorded, got %d", len(out.Iterations))
	}
}

// TestLoop_RefinesThenAccepts: a failing-then-passing sequence refines once and
// accepts; the trace records BOTH iterations with the failing then passing verdict.
func TestLoop_RefinesThenAccepts(t *testing.T) {
	gen := &scriptedGen{scripts: [][]wire.BuildOp{tooFew(), richPlinth()}}
	out := Run(context.Background(), gen, evaluator.New(evaluator.Config{}), req())
	if !out.Accepted() {
		t.Fatalf("expected accepted after one refine, got %q (%s)", out.Result, out.Reason)
	}
	if len(out.Iterations) != 2 {
		t.Fatalf("want 2 iterations (fail then pass), got %d", len(out.Iterations))
	}
	if out.Iterations[0].Verdict.Pass() {
		t.Fatal("first iteration should have FAILED the hard gate")
	}
	if !out.Iterations[1].Verdict.Pass() {
		t.Fatal("second iteration should have PASSED the hard gate")
	}
}

// TestLoop_LowQualityIsCachedNotWithheld: a hard-gate-passing but low-scoring spec
// is ACCEPTED (cacheable) and flagged quality_flag:low — never withheld (ADR-0008).
func TestLoop_LowQualityIsCachedNotWithheld(t *testing.T) {
	// Every iteration yields the same low-quality (but passing) flat mass: the loop
	// spends its budget trying to improve, never improves, and still accepts it low.
	gen := &scriptedGen{scripts: [][]wire.BuildOp{flatMass(), flatMass(), flatMass()}}
	out := Run(context.Background(), gen, evaluator.New(evaluator.Config{}), req())
	if !out.Accepted() {
		t.Fatalf("a passing low-quality spec must be ACCEPTED (cached), got %q (%s)", out.Result, out.Reason)
	}
	if out.QualityFlag != trace.QualityLow {
		t.Fatalf("expected quality_flag:low, got %q", out.QualityFlag)
	}
	if len(out.Ops) == 0 {
		t.Fatal("a low-quality accepted spec must still carry ops to cache")
	}
}

// TestLoop_ExhaustsToFallbackFlagged: a spec that never passes the hard gate within
// the cap falls back, is flagged, and the trace records the full iteration budget —
// the Task still "completes" (the caller uses the primitive).
func TestLoop_ExhaustsToFallbackFlagged(t *testing.T) {
	gen := &scriptedGen{scripts: [][]wire.BuildOp{tooFew(), tooFew(), tooFew(), tooFew()}}
	out := Run(context.Background(), gen, evaluator.New(evaluator.Config{}), req())
	if out.Accepted() {
		t.Fatal("expected fallback when the hard gate never passes")
	}
	if out.Result != trace.ResultFallback {
		t.Fatalf("expected ResultFallback, got %q", out.Result)
	}
	if out.Ops != nil {
		t.Fatal("a fallback outcome must carry no ops (the Task uses the primitive)")
	}
	if len(out.Iterations) != MaxIterations {
		t.Fatalf("loop must run exactly the hard cap %d iterations before falling back, got %d", MaxIterations, len(out.Iterations))
	}
	if gen.calls != MaxIterations {
		t.Fatalf("Generate must be called exactly the hard cap %d times, got %d", MaxIterations, gen.calls)
	}
	if out.Reason == "" {
		t.Fatal("a fallback must carry a human-readable reason for the operator review")
	}
}

// TestLoop_BoundedByHardCap: even with an endless supply of failing specs the loop
// NEVER exceeds MaxIterations.
func TestLoop_BoundedByHardCap(t *testing.T) {
	// An endless supply of failing-but-valid specs must NOT push the loop past the cap.
	failing := &scriptedGen{scripts: [][]wire.BuildOp{tooFew(), tooFew(), tooFew(), tooFew(), tooFew(), tooFew()}}
	out := Run(context.Background(), failing, evaluator.New(evaluator.Config{}), req())
	if len(out.Iterations) > MaxIterations {
		t.Fatalf("loop exceeded the hard cap: %d > %d", len(out.Iterations), MaxIterations)
	}
	if failing.calls > MaxIterations {
		t.Fatalf("Generate called %d times, exceeds the hard cap %d", failing.calls, MaxIterations)
	}
}

// TestLoop_GeneratorErrorFirstPassFallsBack: a transport error on the first pass
// (no spec ever produced) yields a flagged fallback.
func TestLoop_GeneratorErrorFirstPassFallsBack(t *testing.T) {
	gen := &scriptedGen{err: model.ErrFallback}
	out := Run(context.Background(), gen, evaluator.New(evaluator.Config{}), req())
	if out.Accepted() {
		t.Fatal("a first-pass generator error must fall back")
	}
	if !errorsIsFallbackReason(out.Reason) {
		t.Fatalf("reason should mention exhaustion/fallback, got %q", out.Reason)
	}
}

// TestLoop_KeepsPassingSpecOnLaterGeneratorError: if a passing spec was found and a
// LATER iteration's generator errors, the earlier passing spec is still accepted.
func TestLoop_KeepsPassingSpecOnLaterGeneratorError(t *testing.T) {
	// Pass 1: low-quality passing spec (loop keeps iterating for quality).
	// Pass 2: generator error → loop breaks but keeps the pass-1 spec.
	gen := &erringAfter{first: flatMass()}
	out := Run(context.Background(), gen, evaluator.New(evaluator.Config{}), req())
	if !out.Accepted() {
		t.Fatalf("a previously-found passing spec must survive a later generator error, got %q (%s)", out.Result, out.Reason)
	}
	if out.QualityFlag != trace.QualityLow {
		t.Fatalf("the kept spec was low-quality; expected quality_flag:low, got %q", out.QualityFlag)
	}
}

// erringAfter returns `first` on the first call, then errors.
type erringAfter struct {
	first []wire.BuildOp
	calls int
}

func (g *erringAfter) Generate(_ context.Context, _ []model.Message) ([]wire.BuildOp, error) {
	g.calls++
	if g.calls == 1 {
		return g.first, nil
	}
	return nil, model.ErrFallback
}

func errorsIsFallbackReason(reason string) bool {
	return strings.Contains(reason, "exhaust") || strings.Contains(reason, "fallback") || strings.Contains(reason, "error")
}

// TestModelGenerator_BridgesTheSeam: the production ModelGenerator forwards to
// GenerateSpec — a valid scripted FakeModel response flows through to ops, proving
// the seam wiring without a network.
func TestModelGenerator_BridgesTheSeam(t *testing.T) {
	valid, err := json.Marshal(struct {
		Ops []wire.BuildOp `json:"ops"`
	}{richPlinth()})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	fake := &model.FakeModel{Responses: []json.RawMessage{valid}}
	gen := ModelGenerator{M: fake}
	ops, gErr := gen.Generate(context.Background(), []model.Message{{Role: "user", Content: "x"}})
	if gErr != nil {
		t.Fatalf("ModelGenerator.Generate: %v", gErr)
	}
	if len(ops) != 4 {
		t.Fatalf("want 4 ops through the seam, got %d", len(ops))
	}
}
