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
			ID:       "slab",
			Shape:    wire.ShapeBox,
			Pos:      domain.Vec3{X: 1, Y: 2, Z: 3},
			Rot:      domain.Vec3{X: 0, Y: math.Pi, Z: 0},
			Scale:    domain.Vec3{X: 2, Y: 0.5, Z: 2},
			Material: wire.Material{Color: "#cfcfd6", Roughness: ptr(0.9), Metalness: ptr(0.05)},
		},
		{
			Op:       wire.BuildOpPlace,
			ID:       "model-1",
			Shape:    wire.ShapeModel,
			Pos:      domain.Vec3{X: 0, Y: 0, Z: 0},
			Rot:      domain.Vec3{X: 0, Y: 0, Z: 0},
			Scale:    domain.Vec3{X: 1, Y: 1, Z: 1},
			Material: wire.Material{Color: white},
			ModelRef: "future.glb",
		},
		// A move + delete must round-trip too (bh-08a patch log).
		{Op: wire.BuildOpMove, ID: "slab", Pos: domain.Vec3{X: 1, Y: 9, Z: 3}, Rot: domain.Vec3{}, Scale: domain.Vec3{X: 2, Y: 0.5, Z: 2}},
		{Op: wire.BuildOpDelete, ID: "model-1"},
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
	for _, want := range []string{`"op"`, `"id"`, `"shape"`, `"model_ref"`, `"material"`, `"roughness"`, `"metalness"`} {
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

// boxAt is a well-formed place op with a stable id at the given position, reused
// by the fold cases.
func boxAt(id string, x, y, z float64) wire.BuildOp {
	op := validBox()
	op.ID = id
	op.Pos = domain.Vec3{X: x, Y: y, Z: z}
	return op
}

// TestFold_PlaceMoveDelete is the headline fold case (bh-08a acceptance): place
// 3, move 1, delete 1 → the correct final 2 pieces in the correct positions.
func TestFold_PlaceMoveDelete(t *testing.T) {
	t.Parallel()
	ops := []wire.BuildOp{
		boxAt("a", 0, 0, 0),
		boxAt("b", 1, 0, 0),
		boxAt("c", 2, 0, 0),
		{Op: wire.BuildOpMove, ID: "b", Pos: domain.Vec3{X: 1, Y: 5, Z: 0}, Rot: domain.Vec3{}, Scale: domain.Vec3{X: 1, Y: 1, Z: 1}},
		{Op: wire.BuildOpDelete, ID: "a"},
	}
	got, err := Fold(ops)
	if err != nil {
		t.Fatalf("Fold: unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("Fold: want 2 survivors, got %d", len(got))
	}
	// Survivors keep first-seen order: b (moved) then c. a is deleted.
	if got[0].ID != "b" || got[1].ID != "c" {
		t.Fatalf("Fold: survivor order = [%s %s], want [b c]", got[0].ID, got[1].ID)
	}
	// b's transform was updated by the move (Y 0 → 5); c is unchanged.
	if got[0].Pos != (domain.Vec3{X: 1, Y: 5, Z: 0}) {
		t.Fatalf("Fold: moved piece pos = %+v, want {1 5 0}", got[0].Pos)
	}
	if got[1].Pos != (domain.Vec3{X: 2, Y: 0, Z: 0}) {
		t.Fatalf("Fold: untouched piece pos = %+v, want {2 0 0}", got[1].Pos)
	}
	// A move must NOT clobber the place's shape/material.
	if got[0].Shape != wire.ShapeBox || got[0].Material.Color != "#cfcfd6" {
		t.Fatalf("Fold: move clobbered shape/material: %+v", got[0])
	}
}

// TestFold_PlaceOnlyFoldsToItself is the load-bearing regression guard: a
// place-only log (with OR without ids — today's cache omits ids) folds to itself,
// op-for-op, so existing replay renders pixel-identically (ADR-0006).
func TestFold_PlaceOnlyFoldsToItself(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"with-ids", "no-ids (legacy cache)"} {
		ops := []wire.BuildOp{boxAt("", 0, 0, 0), boxAt("", 1, 0, 0), boxAt("", 0, 1, 0)}
		if name == "with-ids" {
			ops = []wire.BuildOp{boxAt("a", 0, 0, 0), boxAt("b", 1, 0, 0), boxAt("c", 0, 1, 0)}
		}
		t.Run(name, func(t *testing.T) {
			got, err := Fold(ops)
			if err != nil {
				t.Fatalf("Fold: %v", err)
			}
			if !reflect.DeepEqual(got, ops) {
				t.Fatalf("place-only log did not fold to itself:\n in =%+v\n out=%+v", ops, got)
			}
		})
	}
}

// TestFold_LastWriteWins confirms a re-placed id and repeated moves resolve to
// the last write, keeping the original insertion order.
func TestFold_LastWriteWins(t *testing.T) {
	t.Parallel()
	ops := []wire.BuildOp{
		boxAt("a", 0, 0, 0),
		boxAt("b", 1, 0, 0),
		boxAt("a", 9, 9, 9), // re-place a: overwrites, keeps original slot
	}
	got, err := Fold(ops)
	if err != nil {
		t.Fatalf("Fold: %v", err)
	}
	if len(got) != 2 || got[0].ID != "a" || got[1].ID != "b" {
		t.Fatalf("Fold: want [a b], got %+v", got)
	}
	if got[0].Pos != (domain.Vec3{X: 9, Y: 9, Z: 9}) {
		t.Fatalf("Fold: re-placed a pos = %+v, want {9 9 9}", got[0].Pos)
	}
}

// TestFold_PlaceAfterDeleteDeduped: a place → delete → re-place of the SAME id
// folds to exactly ONE surviving piece (the last placed value), at its original
// slot. Without the emit dedupe the re-place would re-append the key to the order
// list and the survivor would appear twice. This is reachable across the bh-08e
// kill→resume handoff: a predecessor that deleted then re-placed a slot, or a
// replacement re-placing a slot its predecessor deleted, must fold to one piece.
func TestFold_PlaceAfterDeleteDeduped(t *testing.T) {
	t.Parallel()
	ops := []wire.BuildOp{
		boxAt("a", 0, 0, 0),
		boxAt("b", 1, 0, 0),
		{Op: wire.BuildOpDelete, ID: "a"},
		boxAt("a", 9, 9, 9), // re-place a after its delete
	}
	got, err := Fold(ops)
	if err != nil {
		t.Fatalf("Fold: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("Fold: re-placed-after-delete must fold to 2 pieces, got %d: %+v", len(got), got)
	}
	// a survives once at its original slot with the re-placed value; b follows.
	if got[0].ID != "a" || got[1].ID != "b" {
		t.Fatalf("Fold: want [a b] in original order, got %+v", got)
	}
	if got[0].Pos != (domain.Vec3{X: 9, Y: 9, Z: 9}) {
		t.Fatalf("Fold: re-placed a pos = %+v, want {9 9 9}", got[0].Pos)
	}
}

// TestFold_UnknownTarget rejects a move or delete that targets an id no place
// introduced (including targeting an anonymous/empty-id place).
func TestFold_UnknownTarget(t *testing.T) {
	t.Parallel()
	cases := map[string][]wire.BuildOp{
		"move unknown id":         {boxAt("a", 0, 0, 0), {Op: wire.BuildOpMove, ID: "ghost", Scale: domain.Vec3{X: 1, Y: 1, Z: 1}}},
		"delete unknown id":       {boxAt("a", 0, 0, 0), {Op: wire.BuildOpDelete, ID: "ghost"}},
		"delete before any place": {{Op: wire.BuildOpDelete, ID: "a"}},
		"move anonymous place":    {boxAt("", 0, 0, 0), {Op: wire.BuildOpMove, ID: "", Scale: domain.Vec3{X: 1, Y: 1, Z: 1}}},
		"unknown op kind":         {boxAt("a", 0, 0, 0), {Op: "execute", ID: "a"}},
	}
	for name, ops := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Fold(ops); err == nil {
				t.Fatalf("Fold(%s): want error, got nil", name)
			}
			if err := Validate(ops); err == nil {
				t.Fatalf("Validate(%s): want error, got nil", name)
			}
		})
	}
}

// TestFold_IsPure confirms Fold never mutates its input slice (so it is safe to
// fold the accumulating spec on every snapshot).
func TestFold_IsPure(t *testing.T) {
	t.Parallel()
	ops := []wire.BuildOp{
		boxAt("a", 0, 0, 0),
		{Op: wire.BuildOpMove, ID: "a", Pos: domain.Vec3{X: 7, Y: 0, Z: 0}, Scale: domain.Vec3{X: 1, Y: 1, Z: 1}},
	}
	before := append([]wire.BuildOp(nil), ops...)
	if _, err := Fold(ops); err != nil {
		t.Fatalf("Fold: %v", err)
	}
	if !reflect.DeepEqual(ops, before) {
		t.Fatalf("Fold mutated its input:\n before=%+v\n after =%+v", before, ops)
	}
}

// TestValidate_FoldedResult proves validation runs against the FOLDED geometry,
// not per op: a malformed place that is later DELETED leaves valid survivors and
// passes, while a surviving malformed place is rejected.
func TestValidate_FoldedResult(t *testing.T) {
	t.Parallel()
	bad := validBox()
	bad.ID = "x"
	bad.Shape = "torus" // malformed

	// The malformed place is deleted before folding completes ⇒ valid survivors.
	deleted := []wire.BuildOp{boxAt("a", 0, 0, 0), bad, {Op: wire.BuildOpDelete, ID: "x"}}
	if err := Validate(deleted); err != nil {
		t.Fatalf("Validate: a deleted malformed place should not be checked, got %v", err)
	}
	// The malformed place survives ⇒ rejected.
	if err := Validate([]wire.BuildOp{boxAt("a", 0, 0, 0), bad}); err == nil {
		t.Fatal("Validate: a surviving malformed place should be rejected")
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
