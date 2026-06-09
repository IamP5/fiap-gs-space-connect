package evaluator

import (
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
)

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

func foundationEnv() Envelope {
	return Envelope{Center: domain.Vec3{}, Size: domain.Vec3{X: 2, Y: 1.6, Z: 2}}
}

func goodPlinth() []wire.BuildOp {
	return []wire.BuildOp{
		{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: domain.Vec3{X: 0, Y: -0.7, Z: 0}, Scale: domain.Vec3{X: 1.8, Y: 0.2, Z: 1.8}, Material: wire.Material{Color: "#cfcfd6"}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: -0.6, Y: 0, Z: 0}, Scale: domain.Vec3{X: 0.2, Y: 0.8, Z: 0.2}, Material: wire.Material{Color: "#c0c0c0"}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: 0.6, Y: 0, Z: 0}, Scale: domain.Vec3{X: 0.2, Y: 0.8, Z: 0.2}, Material: wire.Material{Color: "#c0c0c0"}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeSphere, Pos: domain.Vec3{X: 0, Y: 0.6, Z: 0}, Scale: domain.Vec3{X: 0.4, Y: 0.3, Z: 0.4}, Material: wire.Material{Color: "#808080"}},
	}
}

func demoDone() DoneCriteria { return DoneCriteria{MinOps: 3, MinCoverage: 0.05} }

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

func TestHardGate_RejectsOutOfEnvelope(t *testing.T) {
	e := New(Config{})
	ops := goodPlinth()
	ops = append(ops, box(domain.Vec3{X: 1.5, Y: 0, Z: 0}, domain.Vec3{X: 0.4, Y: 0.4, Z: 0.4}, "#ff0000"))

	v := e.Evaluate(ops, foundationEnv(), demoDone(), domain.Vec3{}, nil)
	if v.HardGate.Envelope {
		t.Fatal("expected envelope invariant to FAIL for an out-of-envelope op")
	}
	if v.HardGate.Pass() {
		t.Fatal("hard gate must block when an op is out of envelope")
	}
}

func TestHardGate_RejectsNeighbourCollision(t *testing.T) {
	e := New(Config{})

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

	neighbour.Origin = domain.Vec3{X: 10, Y: 0, Z: 0}
	v2 := e.Evaluate(goodPlinth(), foundationEnv(), demoDone(), subjectOrigin, []Neighbour{neighbour})
	if !v2.HardGate.Collision {
		t.Fatalf("a well-separated neighbour must NOT collide, got %+v", v2.HardGate)
	}
}

func TestHardGate_TouchingNeighbourIsNotACollision(t *testing.T) {
	e := New(Config{})
	subject := []wire.BuildOp{box(domain.Vec3{X: 0, Y: 0, Z: 0}, domain.Vec3{X: 1, Y: 1, Z: 1}, "#fff")}
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

func TestHardGate_RejectsUnmetDone(t *testing.T) {
	e := New(Config{})
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

func TestHardGate_RejectsUnmetCoverage(t *testing.T) {
	e := New(Config{})
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

func TestHardGate_RejectsInvalidSchema(t *testing.T) {
	e := New(Config{})
	ops := []wire.BuildOp{box(domain.Vec3{}, domain.Vec3{X: 0, Y: 0, Z: 0}, "#fff")}
	v := e.Evaluate(ops, foundationEnv(), DoneCriteria{}, domain.Vec3{}, nil)
	if v.HardGate.Envelope || v.HardGate.Collision || v.HardGate.Done {
		t.Fatalf("a schema-invalid spec must fail every hard-gate invariant, got %+v", v.HardGate)
	}
}

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
