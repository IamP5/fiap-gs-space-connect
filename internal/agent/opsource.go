package agent

import (
	"fmt"
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
)

// opsource is the deterministic, hardcoded build-op stream a Rover emits as it
// works a Task (bh-02). It STANDS IN for the LLM/generation path (ADR-0007: the
// headline replays a cached, deterministic spec — the live generator lives in
// the lab path, off the money shot). Because it is a pure function of the Task
// (id,type), two different Rovers working the same Task — e.g. a killed builder
// and its replacement — yield the exact same ordered op sequence, which is what
// makes the resume-on-kill op-set converge byte-for-byte.
//
// Every op it yields is a well-formed wire.BuildOp that passes
// internal/harness/spec.Validate; the coordinator re-validates each op anyway
// before appending (defence in depth), but keeping the source clean means the
// happy path never trips the validator.
//
// Milestone 08: the ops are "module" steps of the procedural immersive structure
// the renderer draws for the Task (web/src/components/Structures.tsx). The Rover
// streams one module op per build step; the renderer reveals the structure
// step-by-step as the ops fold in, so the real habitat hardware (paneled dome,
// ribbed hab-walls, regolith pads, solar arrays, comms tower + dish) rises
// op-by-op and a killed builder's replacement resumes it exactly.

// buildOpsFor returns the full, ordered op stream for a Task with the given id and
// type: partSteps[kind] "module" ops, one per build step of the structure the
// renderer draws for that kind. A Task always resolves to a kind (an unknown type
// maps to the habitat dome), so it always yields a well-formed stream and
// completes (TECHSPEC §5).
func buildOpsFor(id domain.TaskID, t domain.TaskType) []wire.BuildOp {
	kind := structureKind(t, id)
	n := partSteps[kind]
	ops := make([]wire.BuildOp, n)
	for i := range ops {
		ops[i] = placeModule(kind)
	}
	return withIDs(ops)
}

// partSteps is the number of build STEPS each StructureKind decomposes into — and
// therefore how many module ops a Rover streams for it. It MUST stay in sync with
// the per-kind `steps` arrays in web/src/components/Structures.tsx: a rover that
// emits FEWER ops than the structure has steps would leave it visibly unfinished.
// The frontend clamps `reveal` to its own step count, so over-emitting is a
// harmless no-op (a couple of wasted ticks), under-emitting is not.
var partSteps = map[string]int{
	"foundation": 7,
	"wall":       7,
	"dome":       8,
	"panel":      5,
	"mast":       5,
	"dish":       3,
}

// structureKind resolves a Task's (type,id) to the StructureKind the renderer will
// draw. It MIRRORS web/src/components/Structures.tsx `kindOf` exactly: the type
// picks the family and the id only refines the ambiguous dome-cap (→ dish for the
// comms antenna, else the habitat dome).
func structureKind(t domain.TaskType, id domain.TaskID) string {
	ts := strings.ToLower(string(t))
	is := strings.ToLower(string(id))
	switch {
	case strings.Contains(ts, "foundation"):
		return "foundation"
	case strings.Contains(ts, "wall"):
		return "wall"
	case strings.Contains(ts, "panel"), strings.Contains(ts, "solar"):
		return "panel"
	case strings.Contains(ts, "mast"):
		return "mast"
	case strings.Contains(ts, "dome"), strings.Contains(ts, "cap"), strings.Contains(ts, "roof"):
		if strings.Contains(is, "antenna") || strings.Contains(is, "dish") {
			return "dish"
		}
		return "dome"
	default:
		return "dome"
	}
}

// placeModule builds one module-step op for a StructureKind. It carries NO geometry
// of its own (identity transform, placeholder material) — Part plus the Task's
// (type,id) fully determine what the renderer draws, and the procedural structure
// supplies its own palette + lighting. A valid placeholder Material (non-empty
// color) and a positive scale keep it passing spec.Validate.
func placeModule(kind string) wire.BuildOp {
	return wire.BuildOp{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeModule,
		Part:     kind,
		Pos:      domain.Vec3{},
		Rot:      domain.Vec3{},
		Scale:    domain.Vec3{X: 1, Y: 1, Z: 1},
		Material: opMat("#cfcfd6"),
	}
}

// withIDs stamps each place op with a stable, deterministic id derived from its
// position in the stream (bh-08a). These streams are place-only — a degenerate
// patch log — so distinct ids make them fold to themselves (pixel-identical
// replay, ADR-0006). The id is a pure function of the index, so two Rovers
// working the same Task (a killed builder and its replacement) emit identical
// ids, preserving the resume-on-kill convergence.
func withIDs(ops []wire.BuildOp) []wire.BuildOp {
	for i := range ops {
		ops[i].ID = fmt.Sprintf("op-%d", i)
	}
	return ops
}

// opMat is a shared procedural surface for the standalone op stream. Pointer
// fields are returned fresh per op so callers never alias a shared *float64.
func opMat(color string) wire.Material {
	rough := 0.85
	metal := 0.1
	return wire.Material{Color: color, Roughness: &rough, Metalness: &metal}
}
