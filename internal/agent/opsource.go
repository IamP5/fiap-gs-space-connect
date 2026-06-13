package agent

import (
	"fmt"
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
)

func buildOpsFor(id domain.TaskID, t domain.TaskType) []wire.BuildOp {
	kind := structureKind(t, id)
	n := partSteps[kind]
	ops := make([]wire.BuildOp, n)
	for i := range ops {
		ops[i] = placeModule(kind)
	}
	return withIDs(ops)
}

var partSteps = map[string]int{
	"foundation": 7,
	"wall":       7,
	"dome":       8,
	"panel":      5,
	"mast":       5,
	"dish":       3,
}

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

func withIDs(ops []wire.BuildOp) []wire.BuildOp {
	for i := range ops {
		ops[i].ID = fmt.Sprintf("op-%d", i)
	}
	return ops
}

func opMat(color string) wire.Material {
	rough := 0.85
	metal := 0.1
	return wire.Material{Color: color, Roughness: &rough, Metalness: &metal}
}
