package agent

import (
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
)

// opsource is the deterministic, hardcoded build-op stream a Rover emits as it
// works a Task (bh-02). It STANDS IN for the LLM/generation path (ADR-0007: the
// headline replays a cached, deterministic spec — the live generator lives in
// the lab path, off the money shot). Because it is a pure function of the Task
// type, two different Rovers working the same Task — e.g. a killed builder and
// its replacement — yield the exact same ordered op sequence, which is what
// makes the resume-on-kill op-set converge byte-for-byte.
//
// Every op it yields is a well-formed wire.BuildOp that passes
// internal/harness/spec.Validate; the coordinator re-validates each op anyway
// before appending (defence in depth), but keeping the source clean means the
// happy path never trips the validator.

// buildOpsFor returns the full, ordered op stream for a Task of the given type.
// An unknown task type yields no ops, so the renderer falls back to the
// deterministic primitive and the Task still completes (TECHSPEC §5).
func buildOpsFor(t domain.TaskType) []wire.BuildOp {
	switch t {
	case "foundation":
		return foundationOps()
	case "wall":
		return wallOps()
	case "dome-cap":
		return domeCapOps()
	default:
		return nil
	}
}

// opMat is a shared procedural surface for the standalone op stream. Pointer
// fields are returned fresh per op so callers never alias a shared *float64.
func opMat(color string) wire.Material {
	rough := 0.85
	metal := 0.1
	return wire.Material{Color: color, Roughness: &rough, Metalness: &metal}
}

func placeBox(x, y, z, sx, sy, sz float64, color string) wire.BuildOp {
	return wire.BuildOp{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeBox,
		Pos:      domain.Vec3{X: x, Y: y, Z: z},
		Rot:      domain.Vec3{},
		Scale:    domain.Vec3{X: sx, Y: sy, Z: sz},
		Material: opMat(color),
	}
}

func placeCyl(x, y, z, sx, sy, sz float64, color string) wire.BuildOp {
	return wire.BuildOp{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeCylinder,
		Pos:      domain.Vec3{X: x, Y: y, Z: z},
		Rot:      domain.Vec3{},
		Scale:    domain.Vec3{X: sx, Y: sy, Z: sz},
		Material: opMat(color),
	}
}

func placeSphere(x, y, z, r float64, color string) wire.BuildOp {
	return wire.BuildOp{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeSphere,
		Pos:      domain.Vec3{X: x, Y: y, Z: z},
		Rot:      domain.Vec3{},
		Scale:    domain.Vec3{X: r, Y: r, Z: r},
		Material: opMat(color),
	}
}

// foundationOps lays a slab then two pillars then a finial: a small plinth that
// is clearly richer than the single primitive block, and rises op-by-op.
func foundationOps() []wire.BuildOp {
	return []wire.BuildOp{
		placeBox(0, 0.15, 0, 1.4, 0.3, 1.4, "#cfcfd6"),
		placeCyl(-0.45, 0.7, -0.45, 0.2, 0.9, 0.2, "#b8b8c2"),
		placeCyl(0.45, 0.7, 0.45, 0.2, 0.9, 0.2, "#b8b8c2"),
		placeBox(0, 0.45, 0, 1.0, 0.5, 1.0, "#c4c4ce"),
		placeSphere(0, 1.3, 0, 0.45, "#e0e0ea"),
	}
}

// wallOps stacks four courses of brick that rise visibly as the Rover works,
// capped by a coping stone. This is the op stream the kill→resume convergence
// test exercises: a killed builder leaves the lower courses, its replacement
// continues stacking from there.
func wallOps() []wire.BuildOp {
	return []wire.BuildOp{
		placeBox(0, 0.25, 0, 1.6, 0.5, 0.6, "#9aa0aa"),
		placeBox(0, 0.75, 0, 1.6, 0.5, 0.6, "#a4aab4"),
		placeBox(0, 1.25, 0, 1.6, 0.5, 0.6, "#9aa0aa"),
		placeBox(0, 1.75, 0, 1.6, 0.5, 0.6, "#a4aab4"),
		placeBox(0, 2.15, 0, 1.8, 0.3, 0.8, "#cfcfd6"),
	}
}

// domeCapOps places the keystone ring then the cap sphere.
func domeCapOps() []wire.BuildOp {
	return []wire.BuildOp{
		placeCyl(0, 0.4, 0, 1.2, 0.8, 1.2, "#b8b8c2"),
		placeSphere(0, 1.4, 0, 1.0, "#e0e0ea"),
	}
}
