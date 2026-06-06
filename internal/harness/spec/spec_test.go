package spec

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
)

// white is a throwaway material color reused across the table cases.
const white = "#fff"

// ptr is a tiny helper for the optional 0..1 material coefficients.
func ptr(f float64) *float64 { return &f }

// validBox is a minimal well-formed op reused as the base for malformed cases.
func validBox() wire.BuildOp {
	return wire.BuildOp{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeBox,
		Pos:      domain.Vec3{X: 0, Y: 0, Z: 0},
		Rot:      domain.Vec3{X: 0, Y: 0, Z: 0},
		Scale:    domain.Vec3{X: 1, Y: 1, Z: 1},
		Material: wire.Material{Color: "#cfcfd6", Roughness: ptr(0.8), Metalness: ptr(0.1)},
	}
}

func TestValidate(t *testing.T) {
	t.Parallel()

	// mutate clones validBox and applies f, so each case is independent.
	mutate := func(f func(*wire.BuildOp)) []wire.BuildOp {
		op := validBox()
		f(&op)
		return []wire.BuildOp{op}
	}

	cases := []struct {
		name    string
		ops     []wire.BuildOp
		wantErr bool
	}{
		{"nil spec is valid (primitive fallback)", nil, false},
		{"empty spec is valid", []wire.BuildOp{}, false},
		{"valid box", []wire.BuildOp{validBox()}, false},
		{
			"valid cylinder + sphere + optional fields omitted",
			[]wire.BuildOp{
				{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Scale: domain.Vec3{X: 1, Y: 2, Z: 1}, Material: wire.Material{Color: white}},
				{Op: wire.BuildOpPlace, Shape: wire.ShapeSphere, Scale: domain.Vec3{X: 0.5, Y: 0.5, Z: 0.5}, Material: wire.Material{Color: "#abc"}},
			},
			false,
		},
		{
			"valid model with model_ref (forward-compatible slot)",
			[]wire.BuildOp{{Op: wire.BuildOpPlace, Shape: wire.ShapeModel, Scale: domain.Vec3{X: 1, Y: 1, Z: 1}, Material: wire.Material{Color: white}, ModelRef: "habitat.glb"}},
			false,
		},
		{"unknown op", mutate(func(o *wire.BuildOp) { o.Op = "execute" }), true},
		{"unknown shape", mutate(func(o *wire.BuildOp) { o.Shape = "torus" }), true},
		{"empty shape", mutate(func(o *wire.BuildOp) { o.Shape = "" }), true},
		{"model without model_ref", mutate(func(o *wire.BuildOp) { o.Shape = wire.ShapeModel }), true},
		{"primitive with stray model_ref", mutate(func(o *wire.BuildOp) { o.ModelRef = "x.glb" }), true},
		{"zero scale", mutate(func(o *wire.BuildOp) { o.Scale = domain.Vec3{X: 0, Y: 1, Z: 1} }), true},
		{"negative scale", mutate(func(o *wire.BuildOp) { o.Scale = domain.Vec3{X: 1, Y: -1, Z: 1} }), true},
		{"NaN pos", mutate(func(o *wire.BuildOp) { o.Pos = domain.Vec3{X: math.NaN(), Y: 0, Z: 0} }), true},
		{"inf rot", mutate(func(o *wire.BuildOp) { o.Rot = domain.Vec3{X: math.Inf(1), Y: 0, Z: 0} }), true},
		{"inf scale", mutate(func(o *wire.BuildOp) { o.Scale = domain.Vec3{X: math.Inf(1), Y: 1, Z: 1} }), true},
		{"empty material color", mutate(func(o *wire.BuildOp) { o.Material.Color = "" }), true},
		{"roughness out of range", mutate(func(o *wire.BuildOp) { o.Material.Roughness = ptr(1.5) }), true},
		{"negative metalness", mutate(func(o *wire.BuildOp) { o.Material.Metalness = ptr(-0.1) }), true},
		{"NaN roughness", mutate(func(o *wire.BuildOp) { o.Material.Roughness = ptr(math.NaN()) }), true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := Validate(tc.ops)
			if tc.wantErr && err == nil {
				t.Fatalf("Validate(%s): want error, got nil", tc.name)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("Validate(%s): want nil, got %v", tc.name, err)
			}
		})
	}
}

// TestValidateReportsIndex checks the error names the offending op so later
// slices (validate-and-repair) can target it.
func TestValidateReportsIndex(t *testing.T) {
	t.Parallel()
	ops := []wire.BuildOp{validBox(), {Op: wire.BuildOpPlace, Shape: "torus", Scale: domain.Vec3{X: 1, Y: 1, Z: 1}, Material: wire.Material{Color: white}}}
	err := Validate(ops)
	if err == nil {
		t.Fatal("want error for malformed op at index 1")
	}
	if got := err.Error(); !strings.Contains(got, "build op 1") {
		t.Fatalf("error should name op index 1, got %q", got)
	}
}

// TestRoundTrip proves the Go BuildSpec marshals to JSON and decodes back
// identically — the contract the TS mirror relies on (field names, optional
// pointers). It also confirms a decoded valid spec passes Validate.
func TestRoundTrip(t *testing.T) {
	t.Parallel()
	original := []wire.BuildOp{
		{
			Op:       wire.BuildOpPlace,
			Shape:    wire.ShapeBox,
			Pos:      domain.Vec3{X: 1, Y: 2, Z: 3},
			Rot:      domain.Vec3{X: 0, Y: math.Pi, Z: 0},
			Scale:    domain.Vec3{X: 2, Y: 0.5, Z: 2},
			Material: wire.Material{Color: "#cfcfd6", Roughness: ptr(0.9), Metalness: ptr(0.05)},
		},
		{
			Op:       wire.BuildOpPlace,
			Shape:    wire.ShapeModel,
			Pos:      domain.Vec3{X: 0, Y: 0, Z: 0},
			Rot:      domain.Vec3{X: 0, Y: 0, Z: 0},
			Scale:    domain.Vec3{X: 1, Y: 1, Z: 1},
			Material: wire.Material{Color: white},
			ModelRef: "future.glb",
		},
	}

	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded []wire.BuildOp
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(original, decoded) {
		t.Fatalf("round-trip mismatch:\n original=%+v\n decoded =%+v", original, decoded)
	}
	if err := Validate(decoded); err != nil {
		t.Fatalf("decoded valid spec rejected: %v", err)
	}

	// Confirm the snake_case JSON field names the TS mirror reads are present.
	for _, want := range []string{`"op"`, `"shape"`, `"model_ref"`, `"material"`, `"roughness"`, `"metalness"`} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("marshalled JSON missing field %s: %s", want, raw)
		}
	}
}

// TestRejectMalformedJSON decodes an attacker-shaped payload (unknown shape) and
// confirms the validator rejects it — the server-side gate from ADR-0006.
func TestRejectMalformedJSON(t *testing.T) {
	t.Parallel()
	raw := `[{"op":"place","shape":"pyramid","pos":{"X":0,"Y":0,"Z":0},"rot":{"X":0,"Y":0,"Z":0},"scale":{"X":1,"Y":1,"Z":1},"material":{"color":"#fff"}}]`
	var ops []wire.BuildOp
	if err := json.Unmarshal([]byte(raw), &ops); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if err := Validate(ops); err == nil {
		t.Fatal("want malformed spec rejected, got nil")
	}
}

// TestSchemaIsValidJSON guards the embedded canonical schema: it must parse and
// declare itself an array of build ops (the contract later slices serve to the
// Model seam).
func TestSchemaIsValidJSON(t *testing.T) {
	t.Parallel()
	var doc map[string]any
	if err := json.Unmarshal(Schema(), &doc); err != nil {
		t.Fatalf("embedded schema.json is not valid JSON: %v", err)
	}
	if doc["type"] != "array" {
		t.Fatalf("schema root type = %v, want array", doc["type"])
	}
}
