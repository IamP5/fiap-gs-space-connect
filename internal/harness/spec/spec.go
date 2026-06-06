// Package spec validates SwarmBuild Build specs (TECHSPEC §4, ADR-0006) before
// they reach a world snapshot. A Build spec is declarative geometry the renderer
// interprets, never executes; this validator is the server-side gate that
// rejects malformed ops (unknown shape, missing transform, NaN/inf, out-of-range
// material) so the browser only ever sees well-formed data.
//
// It is a clean, dependency-free standalone API reused by later slices (the
// Model seam's validate-and-repair pass, the bake path). The canonical schema
// lives beside this file in schema.json; the Go checks here enforce the same
// shape without pulling in a heavyweight JSON-schema runtime.
package spec

import (
	_ "embed"
	"errors"
	"fmt"
	"math"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
)

// schemaJSON is the canonical Build-spec JSON schema (the wire contract,
// TECHSPEC §4). It is embedded so the schema travels with the binary and later
// slices (the Model seam's strict response_format json_schema) can serve it to a
// provider. The Go checks in Validate enforce the same shape at runtime.
//
//go:embed schema.json
var schemaJSON []byte

// Schema returns the raw Build-spec JSON schema bytes.
func Schema() []byte { return schemaJSON }

// validShapes is the set of shapes the schema permits. "model" is accepted
// (forward-compatible glTF slot) but is a renderer no-op today.
var validShapes = map[wire.BuildShape]bool{
	wire.ShapeBox:      true,
	wire.ShapeCylinder: true,
	wire.ShapeSphere:   true,
	wire.ShapeModel:    true,
}

// Validate reports the first reason the ordered Build spec is malformed, or nil
// if every op is well-formed. A nil/empty spec is valid (the renderer falls back
// to the primitive). The error names the offending op index so callers can log
// or repair it. This is the single server-side gate referenced by the ADR-0006
// "validated before accepted" invariant.
func Validate(ops []wire.BuildOp) error {
	for i, op := range ops {
		if err := validateOp(op); err != nil {
			return fmt.Errorf("build op %d: %w", i, err)
		}
	}
	return nil
}

func validateOp(op wire.BuildOp) error {
	if op.Op != wire.BuildOpPlace {
		return fmt.Errorf("unknown op %q (only %q is supported)", op.Op, wire.BuildOpPlace)
	}
	if !validShapes[op.Shape] {
		return fmt.Errorf("unknown shape %q", op.Shape)
	}
	// "model" requires a model_ref; the rendered primitives must NOT carry one.
	if op.Shape == wire.ShapeModel {
		if op.ModelRef == "" {
			return errors.New(`shape "model" requires a non-empty model_ref`)
		}
	} else if op.ModelRef != "" {
		return fmt.Errorf("model_ref is only valid with shape %q, not %q", wire.ShapeModel, op.Shape)
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
	// A degenerate (zero/negative) scale renders to nothing or inside-out
	// geometry; reject it so the renderer never receives an unusable primitive.
	if op.Scale.X <= 0 || op.Scale.Y <= 0 || op.Scale.Z <= 0 {
		return fmt.Errorf("scale must be positive on every axis, got %+v", op.Scale)
	}
	return validateMaterial(op.Material)
}

// validateVec rejects NaN/inf components, which would corrupt the renderer's
// transform math and can sneak through plain JSON decoding.
func validateVec(v domain.Vec3, name string) error {
	for axis, c := range map[string]float64{"X": v.X, "Y": v.Y, "Z": v.Z} {
		if math.IsNaN(c) || math.IsInf(c, 0) {
			return fmt.Errorf("%s.%s is not a finite number (%v)", name, axis, c)
		}
	}
	return nil
}

func validateMaterial(m wire.Material) error {
	if m.Color == "" {
		return errors.New("material.color must be non-empty")
	}
	if err := validateUnit(m.Roughness, "material.roughness"); err != nil {
		return err
	}
	return validateUnit(m.Metalness, "material.metalness")
}

// validateUnit checks an optional 0..1 PBR coefficient (nil ⇒ renderer default).
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
