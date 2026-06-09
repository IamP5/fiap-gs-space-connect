package evaluator

import (
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
)

// box is a test helper: a place-op box at pos with the given full scale and a
// non-empty material (so it passes spec.Validate).
func box(pos, scale domain.Vec3, color string) wire.BuildOp {
	return wire.BuildOp{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeBox,
		Pos:      pos,
		Rot:      domain.Vec3{},
		Scale:    scale,
		Material: wire.Material{Color: color},
	}
}

// foundationEnv is a 2×1.6×2 envelope centred at the origin (the demo foundation).
func foundationEnv() Envelope {
	return Envelope{Center: domain.Vec3{}, Size: domain.Vec3{X: 2, Y: 1.6, Z: 2}}
}

// goodPlinth is a hard-gate-PASSING, high-quality foundation spec: a grounded slab,
// two pillars, a finial — multi-shape, inside the envelope, ≥ 3 ops.
func goodPlinth() []wire.BuildOp {
	return []wire.BuildOp{
		{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: domain.Vec3{X: 0, Y: -0.7, Z: 0}, Scale: domain.Vec3{X: 1.8, Y: 0.2, Z: 1.8}, Material: wire.Material{Color: "#cfcfd6"}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: -0.6, Y: 0, Z: 0}, Scale: domain.Vec3{X: 0.2, Y: 0.8, Z: 0.2}, Material: wire.Material{Color: "#c0c0c0"}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: 0.6, Y: 0, Z: 0}, Scale: domain.Vec3{X: 0.2, Y: 0.8, Z: 0.2}, Material: wire.Material{Color: "#c0c0c0"}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeSphere, Pos: domain.Vec3{X: 0, Y: 0.6, Z: 0}, Scale: domain.Vec3{X: 0.4, Y: 0.3, Z: 0.4}, Material: wire.Material{Color: "#808080"}},
	}
}

func demoDone() DoneCriteria { return DoneCriteria{MinOps: 3, MinCoverage: 0.05} }

// TestHardGate_PassCase: a well-formed, in-envelope, non-colliding, done-meeting
// spec passes every hard-gate invariant.
func TestHardGate_PassCase(t *testing.T) {
	e := New(Config{})
	v := e.Evaluate(goodPlinth(), foundationEnv(), demoDone(), domain.Vec3{}, nil)
	if !v.HardGate.Pass() {
		t.Fatalf("expected hard gate to pass, got %+v (reasons: %v)", v.HardGate, v.Reasons())
	}
	if !v.HardGate.Envelope || !v.HardGate.Collision || !v.HardGate.Done {
		t.Fatalf("every invariant must hold: %+v", v.HardGate)
	}
}

// TestHardGate_RejectsOutOfEnvelope: an op whose AABB pokes outside the envelope
// fails the `envelope` invariant (and only that one).
func TestHardGate_RejectsOutOfEnvelope(t *testing.T) {
	e := New(Config{})
	ops := goodPlinth()
	// Push a pillar far out on +X so its AABB exceeds the envelope wall (env half-X = 1).
	ops = append(ops, box(domain.Vec3{X: 1.5, Y: 0, Z: 0}, domain.Vec3{X: 0.4, Y: 0.4, Z: 0.4}, "#ff0000"))

	v := e.Evaluate(ops, foundationEnv(), demoDone(), domain.Vec3{}, nil)
	if v.HardGate.Envelope {
		t.Fatal("expected envelope invariant to FAIL for an out-of-envelope op")
	}
	if v.HardGate.Pass() {
		t.Fatal("hard gate must block when an op is out of envelope")
	}
}

// TestHardGate_RejectsNeighbourCollision: a spec that overlaps a neighbour task's
// accumulated ops (lifted to the world frame) fails the `collision` invariant.
func TestHardGate_RejectsNeighbourCollision(t *testing.T) {
	e := New(Config{})

	// Subject sits at world origin; neighbour sits 1 unit over on +X and has a wide
	// slab that reaches back into the subject's footprint when both are world-lifted.
	subjectOrigin := domain.Vec3{}
	neighbour := Neighbour{
		TaskID: "neighbour",
		Origin: domain.Vec3{X: 1.0, Y: 0, Z: 0},
		Ops: []wire.BuildOp{
			box(domain.Vec3{X: -0.6, Y: -0.7, Z: 0}, domain.Vec3{X: 1.6, Y: 0.2, Z: 1.6}, "#aaaaaa"),
		},
	}

	v := e.Evaluate(goodPlinth(), foundationEnv(), demoDone(), subjectOrigin, []Neighbour{neighbour})
	if v.HardGate.Collision {
		t.Fatal("expected collision invariant to FAIL when ops overlap a neighbour")
	}
	if v.HardGate.Pass() {
		t.Fatal("hard gate must block on a neighbour collision")
	}

	// Move the neighbour clear (far on +X) ⇒ collision invariant holds again.
	neighbour.Origin = domain.Vec3{X: 10, Y: 0, Z: 0}
	v2 := e.Evaluate(goodPlinth(), foundationEnv(), demoDone(), subjectOrigin, []Neighbour{neighbour})
	if !v2.HardGate.Collision {
		t.Fatalf("a well-separated neighbour must NOT collide, got %+v", v2.HardGate)
	}
}

// TestHardGate_TouchingNeighbourIsNotACollision: abutting faces (shared plane, zero
// overlap volume) are NOT a collision — walls can sit flush.
func TestHardGate_TouchingNeighbourIsNotACollision(t *testing.T) {
	e := New(Config{})
	subject := []wire.BuildOp{box(domain.Vec3{X: 0, Y: 0, Z: 0}, domain.Vec3{X: 1, Y: 1, Z: 1}, "#fff")}
	// Neighbour box exactly abuts on +X: its left face at x=0.5 meets the subject's
	// right face at x=0.5.
	neighbour := Neighbour{
		TaskID: "n",
		Origin: domain.Vec3{X: 1, Y: 0, Z: 0},
		Ops:    []wire.BuildOp{box(domain.Vec3{}, domain.Vec3{X: 1, Y: 1, Z: 1}, "#000")},
	}
	env := Envelope{Center: domain.Vec3{}, Size: domain.Vec3{X: 4, Y: 4, Z: 4}}
	v := e.Evaluate(subject, env, DoneCriteria{}, domain.Vec3{}, []Neighbour{neighbour})
	if !v.HardGate.Collision {
		t.Fatal("abutting (touching) neighbour must not count as a collision")
	}
}

// TestHardGate_RejectsUnmetDone: a spec with too few ops fails the `done` invariant
// (MinOps not met), while envelope/collision still hold.
func TestHardGate_RejectsUnmetDone(t *testing.T) {
	e := New(Config{})
	// One small in-envelope box: schema-valid, in envelope, no neighbours — but only
	// 1 op vs MinOps 3.
	ops := []wire.BuildOp{box(domain.Vec3{X: 0, Y: -0.7, Z: 0}, domain.Vec3{X: 0.5, Y: 0.2, Z: 0.5}, "#ccc")}
	v := e.Evaluate(ops, foundationEnv(), demoDone(), domain.Vec3{}, nil)
	if v.HardGate.Done {
		t.Fatal("expected done invariant to FAIL when MinOps is not met")
	}
	if v.HardGate.Envelope == false || v.HardGate.Collision == false {
		t.Fatalf("only done should fail; got %+v", v.HardGate)
	}
	if v.HardGate.Pass() {
		t.Fatal("hard gate must block when done-criteria are unmet")
	}
}

// TestHardGate_RejectsUnmetCoverage: enough ops but too little envelope coverage
// fails the `done` invariant via the MinCoverage criterion.
func TestHardGate_RejectsUnmetCoverage(t *testing.T) {
	e := New(Config{})
	// Three tiny boxes: ≥ MinOps but negligible coverage vs MinCoverage 0.5.
	tiny := domain.Vec3{X: 0.05, Y: 0.05, Z: 0.05}
	ops := []wire.BuildOp{
		box(domain.Vec3{X: 0, Y: -0.7, Z: 0}, tiny, "#a"),
		box(domain.Vec3{X: 0.1, Y: -0.7, Z: 0}, tiny, "#b"),
		box(domain.Vec3{X: -0.1, Y: -0.7, Z: 0}, tiny, "#c"),
	}
	done := DoneCriteria{MinOps: 3, MinCoverage: 0.5}
	v := e.Evaluate(ops, foundationEnv(), done, domain.Vec3{}, nil)
	if v.HardGate.Done {
		t.Fatal("expected done invariant to FAIL when coverage is below MinCoverage")
	}
}

// TestHardGate_RejectsInvalidSchema: a schema-invalid spec (degenerate scale) fails
// every analytic invariant — the Evaluator never blesses an unparseable spec.
func TestHardGate_RejectsInvalidSchema(t *testing.T) {
	e := New(Config{})
	ops := []wire.BuildOp{box(domain.Vec3{}, domain.Vec3{X: 0, Y: 0, Z: 0}, "#fff")} // zero scale
	v := e.Evaluate(ops, foundationEnv(), DoneCriteria{}, domain.Vec3{}, nil)
	if v.HardGate.Envelope || v.HardGate.Collision || v.HardGate.Done {
		t.Fatalf("a schema-invalid spec must fail every hard-gate invariant, got %+v", v.HardGate)
	}
}

// TestSoftRubric_ScoresQualityWithEvidence: the soft rubric scores a rich spec high
// (with evidence) and never gates — both a high and a low-quality spec PASS the hard
// gate, differing only in soft score.
func TestSoftRubric_ScoresQualityWithEvidence(t *testing.T) {
	e := New(Config{})

	high := e.Evaluate(goodPlinth(), foundationEnv(), demoDone(), domain.Vec3{}, nil)
	if !high.HardGate.Pass() {
		t.Fatalf("rich plinth must pass the hard gate, got %+v", high.HardGate)
	}
	if high.SoftScore() < e.Threshold() {
		t.Fatalf("rich plinth should score at/above threshold %d, got %d", e.Threshold(), high.SoftScore())
	}
	if high.Rubric.DoneCoverage.Evidence == "" || high.Rubric.Coherence.Evidence == "" {
		t.Fatal("soft rubric dimensions must carry evidence strings")
	}

	// A flat, single-shape, single-colour 3-box mass: passes the hard gate (≥ MinOps,
	// in envelope, covers enough) but scores LOW on coherence (no variety).
	flat := []wire.BuildOp{
		box(domain.Vec3{X: -0.5, Y: -0.7, Z: 0}, domain.Vec3{X: 0.5, Y: 0.2, Z: 1.8}, "#cccccc"),
		box(domain.Vec3{X: 0, Y: -0.7, Z: 0}, domain.Vec3{X: 0.5, Y: 0.2, Z: 1.8}, "#cccccc"),
		box(domain.Vec3{X: 0.5, Y: -0.7, Z: 0}, domain.Vec3{X: 0.5, Y: 0.2, Z: 1.8}, "#cccccc"),
	}
	low := e.Evaluate(flat, foundationEnv(), demoDone(), domain.Vec3{}, nil)
	if !low.HardGate.Pass() {
		t.Fatalf("flat mass must STILL pass the hard gate (soft score never blocks): %+v", low.HardGate)
	}
	if low.SoftScore() >= high.SoftScore() {
		t.Fatalf("flat mass should score below the rich plinth: flat=%d rich=%d", low.SoftScore(), high.SoftScore())
	}
}
