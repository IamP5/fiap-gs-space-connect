package agent

import (
	"fmt"
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
		return withIDs(foundationOps())
	case "wall":
		return withIDs(wallOps())
	case "dome-cap":
		return withIDs(domeCapOps())
	case "panel":
		return withIDs(panelOps())
	case "mast":
		return withIDs(mastOps())
	default:
		return nil
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

// Self-hosted CC0 PBR skin URLs (#57, see web/public/assets/CREDITS.md). Each set
// is a diffuse/albedo (sRGB) + tangent-space normal (GL) + roughness map; the
// renderer's SpecPrimitive loads them with the correct colorSpace and falls back
// SILENTLY to the flat base color if any map is missing/fails (ADR-0004), so the
// scene never depends on a texture.
const (
	solarDiff  = "/assets/textures/solar_diff_512.jpg"
	solarNorGL = "/assets/textures/solar_nor_gl_512.jpg"
	solarRough = "/assets/textures/solar_rough_512.jpg"

	metalDiff  = "/assets/textures/metal_diff_512.jpg"
	metalNorGL = "/assets/textures/metal_nor_gl_512.jpg"
	metalRough = "/assets/textures/metal_rough_512.jpg"
)

// opMatSolar dresses a PV/solar-array op in the CC0 solar-panel PBR skin (diffuse
// + normal + roughness). A glossy, near-conductive surface (low roughness, high
// metalness) reads like a photovoltaic cell. The base color is kept sane so a
// missing texture still reads as a dark-blue panel (flat-color fallback).
func opMatSolar(color string) wire.Material {
	rough := 0.35
	metal := 0.7
	return wire.Material{
		Color:        color,
		Roughness:    &rough,
		Metalness:    &metal,
		Map:          solarDiff,
		NormalMap:    solarNorGL,
		RoughnessMap: solarRough,
	}
}

// opMatMetal dresses a metal op (mast segments, struts) in the CC0 metal-plates
// PBR skin (diffuse + normal + roughness). The base color is kept sane so a
// missing texture still reads as brushed metal (flat-color fallback).
func opMatMetal(color string) wire.Material {
	rough := 0.5
	metal := 0.9
	return wire.Material{
		Color:        color,
		Roughness:    &rough,
		Metalness:    &metal,
		Map:          metalDiff,
		NormalMap:    metalNorGL,
		RoughnessMap: metalRough,
	}
}

// placeBoxMat / placeCylMat / placeSphereMat mirror placeBox/placeCyl/placeSphere
// but take an explicit Material so an op can carry a PBR skin instead of the
// shared flat opMat surface.
func placeBoxMat(x, y, z, sx, sy, sz float64, mat wire.Material) wire.BuildOp {
	op := placeBox(x, y, z, sx, sy, sz, mat.Color)
	op.Material = mat
	return op
}

func placeCylMat(x, y, z, sx, sy, sz float64, mat wire.Material) wire.BuildOp {
	op := placeCyl(x, y, z, sx, sy, sz, mat.Color)
	op.Material = mat
	return op
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

// panelOps builds a photovoltaic array (solar-array catalog Blueprint): a mounting
// base and post carrying three sun-facing PV slats — richer than a single block,
// rising op-by-op. Stays within the "panel" demo envelope (demo.go).
func panelOps() []wire.BuildOp {
	return []wire.BuildOp{
		// Metal mounting base + support post carry the metal-plates skin.
		placeBoxMat(0, 0.15, 0, 1.4, 0.3, 1.0, opMatMetal("#b8b8c2")),  // mounting base
		placeCylMat(0, 0.8, 0, 0.18, 1.0, 0.18, opMatMetal("#a4aab4")), // support post
		// PV slats carry the solar-panel skin.
		placeBoxMat(-0.55, 1.3, 0, 0.45, 0.12, 1.5, opMatSolar("#1f3a6b")), // PV slat
		placeBoxMat(0, 1.34, 0, 0.45, 0.12, 1.5, opMatSolar("#24417a")),    // PV slat
		placeBoxMat(0.55, 1.3, 0, 0.45, 0.12, 1.5, opMatSolar("#1f3a6b")),  // PV slat
	}
}

// mastOps raises a comms mast (comms-mast catalog Blueprint): a footing, two
// tapering lattice segments, and an antenna seat at the top. Stays within the
// "mast" demo envelope (demo.go).
func mastOps() []wire.BuildOp {
	return []wire.BuildOp{
		// Footing and the two lattice segments are metal — metal-plates skin.
		placeBoxMat(0, 0.2, 0, 0.9, 0.4, 0.9, opMatMetal("#9aa0aa")),   // footing
		placeCylMat(0, 1.1, 0, 0.22, 1.4, 0.22, opMatMetal("#a4aab4")), // lower segment
		placeCylMat(0, 2.3, 0, 0.15, 1.0, 0.15, opMatMetal("#b8b8c2")), // upper segment
		placeSphere(0, 3.1, 0, 0.32, "#e0e0ea"),                        // antenna seat
	}
}
