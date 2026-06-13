package wire

import (
	"errors"
	"fmt"
	"math"
	"swarmbuild/internal/core/domain"
)

var validShapes = map[BuildShape]bool{
	ShapeBox:      true,
	ShapeCylinder: true,
	ShapeSphere:   true,
	ShapeModel:    true,
	ShapeModule:   true,
}

func Fold(ops []BuildOp) ([]BuildOp, error) {
	order := make([]string, 0, len(ops))
	byID := make(map[string]BuildOp, len(ops))
	for i, op := range ops {
		switch op.Op {
		case BuildOpPlace:
			key := op.ID
			if key == "" {
				key = fmt.Sprintf("\x00anon-%d", i)
			}
			if _, seen := byID[key]; !seen {
				order = append(order, key)
			}
			byID[key] = op
			continue
		case BuildOpMove:
			cur, ok := byID[op.ID]
			if !ok {
				return nil, fmt.Errorf("build op %d: move targets unknown id %q", i, op.ID)
			}
			cur.Pos, cur.Rot, cur.Scale = op.Pos, op.Rot, op.Scale
			byID[op.ID] = cur
		case BuildOpDelete:
			if _, ok := byID[op.ID]; !ok {
				return nil, fmt.Errorf("build op %d: delete targets unknown id %q", i, op.ID)
			}
			delete(byID, op.ID)
		default:
			return nil, fmt.Errorf("build op %d: unknown op %q (want %q|%q|%q)",
				i, op.Op, BuildOpPlace, BuildOpMove, BuildOpDelete)
		}
	}
	out := make([]BuildOp, 0, len(byID))
	emitted := make(map[string]bool, len(byID))
	for _, id := range order {
		if emitted[id] {
			continue
		}
		if op, ok := byID[id]; ok {
			out = append(out, op)
			emitted[id] = true
		}
	}
	return out, nil
}

func Validate(ops []BuildOp) error {
	folded, err := Fold(ops)
	if err != nil {
		return err
	}
	for i, op := range folded {
		if err := validateOp(op); err != nil {
			return fmt.Errorf("build op %d: %w", i, err)
		}
	}
	return nil
}

func validateOp(op BuildOp) error {
	if op.Op != BuildOpPlace {
		return fmt.Errorf("unknown op %q (only %q is supported)", op.Op, BuildOpPlace)
	}
	if !validShapes[op.Shape] {
		return fmt.Errorf("unknown shape %q", op.Shape)
	}
	if err := validateShapeFields(op); err != nil {
		return err
	}
	if err := validateVec(op.Pos, "pos"); err != nil {
		return err
	}
	if err := validateVec(op.Rot, "rot"); err != nil {
		return err
	}
	if err := validateVec(op.Scale, "scale"); err != nil {
		return err
	}
	if op.Scale.X <= 0 || op.Scale.Y <= 0 || op.Scale.Z <= 0 {
		return fmt.Errorf("scale must be positive on every axis, got %+v", op.Scale)
	}
	return validateMaterial(op.Material)
}

func validateShapeFields(op BuildOp) error {
	if op.Shape == ShapeModel {
		if op.ModelRef == "" {
			return errors.New(`shape "model" requires a non-empty model_ref`)
		}
	} else if op.ModelRef != "" {
		return fmt.Errorf("model_ref is only valid with shape %q, not %q", ShapeModel, op.Shape)
	}
	if op.Shape == ShapeModule {
		if op.Part == "" {
			return errors.New(`shape "module" requires a non-empty part`)
		}
	} else if op.Part != "" {
		return fmt.Errorf("part is only valid with shape %q, not %q", ShapeModule, op.Shape)
	}
	return nil
}

func validateVec(v domain.Vec3, name string) error {
	for axis, c := range map[string]float64{"X": v.X, "Y": v.Y, "Z": v.Z} {
		if math.IsNaN(c) || math.IsInf(c, 0) {
			return fmt.Errorf("%s.%s is not a finite number (%v)", name, axis, c)
		}
	}
	return nil
}

func validateMaterial(m Material) error {
	if m.Color == "" {
		return errors.New("material.color must be non-empty")
	}
	if err := validateUnit(m.Roughness, "material.roughness"); err != nil {
		return err
	}
	return validateUnit(m.Metalness, "material.metalness")
}

func validateUnit(p *float64, name string) error {
	if p == nil {
		return nil
	}
	v := *p
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return fmt.Errorf("%s is not a finite number (%v)", name, v)
	}
	if v < 0 || v > 1 {
		return fmt.Errorf("%s must be in [0,1], got %v", name, v)
	}
	return nil
}
