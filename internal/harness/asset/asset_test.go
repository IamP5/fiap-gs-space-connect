package asset

import (
	"reflect"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
)

// Task-type literals reused across cases (kept as constants so the table-driven
// tests don't trip goconst on repeated string literals).
const (
	ttWall     domain.TaskType = "wall"
	ttDomeCap  domain.TaskType = "dome-cap"
	ttFndation domain.TaskType = "foundation"
	ttPanel    domain.TaskType = "panel"
	ttMast     domain.TaskType = "mast"

	// keyRadome is the radome habitat key, reused across the default-catalog cases.
	keyRadome = "habitat-radome"
)

// unit is a well-formed procedural place op reused as a base across cases.
func unit() wire.BuildOp {
	return wire.BuildOp{
		Op:       wire.BuildOpPlace,
		ID:       "p",
		Shape:    wire.ShapeBox,
		Pos:      domain.Vec3{X: 1, Y: 2, Z: 3},
		Rot:      domain.Vec3{X: 0, Y: 0, Z: 0},
		Scale:    domain.Vec3{X: 2, Y: 2, Z: 2},
		Material: wire.Material{Color: "#fff"},
	}
}

// TestResolve covers key → model_ref resolution, the default/global fallback, and
// the miss/nil cases.
func TestResolve(t *testing.T) {
	t.Parallel()

	custom := NewCatalog(
		NewEntry("rover", "/assets/rover.glb", []domain.TaskType{"mast"},
			Transform{Scale: domain.Vec3{X: 2, Y: 2, Z: 2}, Offset: domain.Vec3{X: 1}, Rotation: domain.Vec3{Y: 1}}),
	)

	cases := []struct {
		name    string
		cat     *Catalog
		key     string
		wantRef string
		wantOK  bool
	}{
		{"hit in custom catalog", custom, "rover", "/assets/rover.glb", true},
		{"miss in custom catalog", custom, "ghost", "", false},
		{"hit in default/global catalog", DefaultCatalog(), keyRadome, "/assets/models/radome.glb", true},
		{"miss in default catalog", DefaultCatalog(), "nope", "", false},
		{"empty key never resolves", DefaultCatalog(), "", "", false},
		{"nil catalog resolves nothing", nil, keyRadome, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ref, _, ok := tc.cat.Resolve(tc.key)
			if ok != tc.wantOK {
				t.Fatalf("Resolve(%q) ok = %v, want %v", tc.key, ok, tc.wantOK)
			}
			if ref != tc.wantRef {
				t.Fatalf("Resolve(%q) ref = %q, want %q", tc.key, ref, tc.wantRef)
			}
		})
	}
}

// TestResolveTransform proves the entry's normalization transform travels with the
// resolved key.
func TestResolveTransform(t *testing.T) {
	t.Parallel()
	want := Transform{Scale: domain.Vec3{X: 3, Y: 3, Z: 3}, Offset: domain.Vec3{Z: 5}, Rotation: domain.Vec3{X: 1}}
	c := NewCatalog(NewEntry("k", "/a.glb", nil, want))
	_, got, ok := c.Resolve("k")
	if !ok {
		t.Fatal("Resolve: want hit")
	}
	if got != want {
		t.Fatalf("transform = %+v, want %+v", got, want)
	}
}

// TestResolveOp is the headline server-side seam: an Asset-keyed op resolves to a
// model op with a self-hosted URL, a CLEARED key (browser never sees a raw key),
// and the normalization transform composed on top of the op's own transform.
func TestResolveOp(t *testing.T) {
	t.Parallel()
	c := NewCatalog(NewEntry("rover", "/assets/rover.glb", nil,
		Transform{Scale: domain.Vec3{X: 2, Y: 2, Z: 2}, Offset: domain.Vec3{X: 10, Z: -1}, Rotation: domain.Vec3{Y: 1}}))

	op := unit()
	op.AssetKey = "rover"
	got, ok := c.ResolveOp(op)
	if !ok {
		t.Fatal("ResolveOp: want resolved")
	}
	if got.AssetKey != "" {
		t.Fatalf("ResolveOp: asset_key must be cleared, got %q", got.AssetKey)
	}
	if got.Shape != wire.ShapeModel {
		t.Fatalf("ResolveOp: shape = %q, want model", got.Shape)
	}
	if got.ModelRef != "/assets/rover.glb" {
		t.Fatalf("ResolveOp: model_ref = %q, want /assets/rover.glb", got.ModelRef)
	}
	// Scale multiplies (2*2), rotation adds (0+1 on Y), offset adds to pos (1+10 X, 3-1 Z).
	if got.Scale != (domain.Vec3{X: 4, Y: 4, Z: 4}) {
		t.Fatalf("ResolveOp: scale = %+v, want {4 4 4}", got.Scale)
	}
	if got.Rot != (domain.Vec3{X: 0, Y: 1, Z: 0}) {
		t.Fatalf("ResolveOp: rot = %+v, want {0 1 0}", got.Rot)
	}
	if got.Pos != (domain.Vec3{X: 11, Y: 2, Z: 2}) {
		t.Fatalf("ResolveOp: pos = %+v, want {11 2 2}", got.Pos)
	}
}

// TestResolveOpPassthrough: ops without a (resolvable) key are returned unchanged.
func TestResolveOpPassthrough(t *testing.T) {
	t.Parallel()
	c := DefaultCatalog()

	t.Run("no asset key", func(t *testing.T) {
		t.Parallel()
		op := unit()
		got, ok := c.ResolveOp(op)
		if ok {
			t.Fatal("want no resolution for a keyless op")
		}
		if !reflect.DeepEqual(got, op) {
			t.Fatalf("keyless op was modified: %+v", got)
		}
	})

	t.Run("unknown key is left intact (no rejection here)", func(t *testing.T) {
		t.Parallel()
		op := unit()
		op.AssetKey = "does-not-exist"
		got, ok := c.ResolveOp(op)
		if ok {
			t.Fatal("want no resolution for an unknown key")
		}
		if !reflect.DeepEqual(got, op) {
			t.Fatalf("unknown-key op was modified: %+v", got)
		}
	})

	t.Run("move/delete op with a key is NOT resolved (place-only)", func(t *testing.T) {
		t.Parallel()
		dc := DefaultCatalog()
		for _, kind := range []string{wire.BuildOpMove, wire.BuildOpDelete} {
			op := unit()
			op.Op = kind
			op.AssetKey = keyRadome // a real key, but on the wrong op kind
			got, ok := dc.ResolveOp(op)
			if ok {
				t.Fatalf("%s op must not resolve an Asset key", kind)
			}
			if !reflect.DeepEqual(got, op) {
				t.Fatalf("%s op was modified: %+v", kind, got)
			}
		}
	})
}

// TestResolveSpec confirms the whole-spec seam resolves keyed ops, passes others
// through, never mutates the input, and clears every resolved key so the browser
// only ever sees resolved URLs.
func TestResolveSpec(t *testing.T) {
	t.Parallel()
	c := NewCatalog(NewEntry("dome", "/assets/dome.glb", nil, Identity()))

	keyed := unit()
	keyed.ID = "a"
	keyed.AssetKey = "dome"
	plain := unit()
	plain.ID = "b"
	in := []wire.BuildOp{keyed, plain}
	before := append([]wire.BuildOp(nil), in...)

	out := c.ResolveSpec(in)
	if len(out) != 2 {
		t.Fatalf("ResolveSpec: len = %d, want 2", len(out))
	}
	if out[0].ModelRef != "/assets/dome.glb" || out[0].AssetKey != "" || out[0].Shape != wire.ShapeModel {
		t.Fatalf("ResolveSpec: keyed op not resolved: %+v", out[0])
	}
	if !reflect.DeepEqual(out[1], plain) {
		t.Fatalf("ResolveSpec: plain op changed: %+v", out[1])
	}
	if !reflect.DeepEqual(in, before) {
		t.Fatalf("ResolveSpec mutated its input:\n before=%+v\n after =%+v", before, in)
	}
	// Identity transform leaves the op's own transform untouched.
	if out[0].Pos != keyed.Pos || out[0].Scale != keyed.Scale || out[0].Rot != keyed.Rot {
		t.Fatalf("ResolveSpec: identity transform altered geometry: %+v", out[0])
	}
}

// TestResolveSpecNilEmpty: nil/empty in ⇒ nil out (no allocation surprises).
func TestResolveSpecNilEmpty(t *testing.T) {
	t.Parallel()
	c := DefaultCatalog()
	if got := c.ResolveSpec(nil); got != nil {
		t.Fatalf("ResolveSpec(nil) = %+v, want nil", got)
	}
	if got := c.ResolveSpec([]wire.BuildOp{}); got != nil {
		t.Fatalf("ResolveSpec(empty) = %+v, want nil", got)
	}
}

// TestSuitsType covers the task-type suitability check, including the unrestricted
// (no declared types) entry.
func TestSuitsType(t *testing.T) {
	t.Parallel()
	restricted := NewEntry("k", "/a.glb", []domain.TaskType{ttWall, "panel"}, Identity())
	if !restricted.SuitsType(ttWall) {
		t.Fatal("want wall suited")
	}
	if restricted.SuitsType(ttDomeCap) {
		t.Fatal("want dome-cap NOT suited")
	}
	unrestricted := NewEntry("u", "/u.glb", nil, Identity())
	if !unrestricted.SuitsType("anything") {
		t.Fatal("an entry with no task types must suit every type")
	}
}

// entryCase is one curated-Asset expectation: the key must resolve to wantRef,
// suit `suits`, and NOT suit `notSuits`. Shared by the habitat (#55) and prop
// (#57) entry tables so both assert identically with no duplicated loop body.
type entryCase struct {
	key      string
	wantRef  string
	suits    domain.TaskType // the task type the Asset must suit
	notSuits domain.TaskType // a task type it must NOT suit
}

// assertEntries runs the shared per-entry assertions over a table of cases:
// Resolve(key) hits with the expected self-hosted model_ref, Get(key) hits, and
// SuitsType is true for `suits` / false for `notSuits`.
func assertEntries(t *testing.T, c *Catalog, cases []entryCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.key, func(t *testing.T) {
			t.Parallel()
			ref, _, ok := c.Resolve(tc.key)
			if !ok {
				t.Fatalf("Resolve(%q): want hit", tc.key)
			}
			if ref != tc.wantRef {
				t.Fatalf("Resolve(%q) ref = %q, want %q", tc.key, ref, tc.wantRef)
			}
			e, ok := c.Get(tc.key)
			if !ok {
				t.Fatalf("Get(%q): want hit", tc.key)
			}
			if !e.SuitsType(tc.suits) {
				t.Fatalf("%q must suit %q", tc.key, tc.suits)
			}
			if e.SuitsType(tc.notSuits) {
				t.Fatalf("%q must NOT suit %q", tc.key, tc.notSuits)
			}
			// A vendored, self-hosted glb under the curated /assets/ mount.
			if e.ModelRef[:len("/assets/")] != "/assets/" {
				t.Fatalf("%q model_ref %q is not self-hosted under /assets/", tc.key, e.ModelRef)
			}
		})
	}
}

// TestHabitatEntries pins the real, vendored habitat/base Assets (#55, NASA-PD):
// each habitat key resolves to its self-hosted, vendored glb model_ref and suits
// the intended dome/wall/foundation task type. Mirrors TestResolve/TestSuitsType.
func TestHabitatEntries(t *testing.T) {
	t.Parallel()
	assertEntries(t, DefaultCatalog(), []entryCase{
		{keyRadome, "/assets/models/radome.glb", ttDomeCap, ttFndation},
		{"habitat-demo-unit-1", "/assets/models/habitat-demo-unit-1.glb", ttFndation, ttDomeCap},
		{"habitat-demo-unit-2", "/assets/models/habitat-demo-unit-2.glb", ttWall, ttDomeCap},
	})
}

// TestPropEntries pins the real, vendored construction-prop Assets (#57, NASA-PD):
// each prop key resolves to its self-hosted, conditioned glb model_ref and suits
// the intended panel/mast task type. Mirrors TestHabitatEntries.
func TestPropEntries(t *testing.T) {
	t.Parallel()
	assertEntries(t, DefaultCatalog(), []entryCase{
		{"solar-panel", "/assets/models/solar-panel.glb", ttPanel, ttMast},
		{"comms-mast", "/assets/models/comms-mast.glb", ttMast, ttPanel},
		{"comms-dish", "/assets/models/comms-dish.glb", ttMast, ttWall},
	})
}

// TestPropTaskTypeCoverage proves the panel/mast task vocabulary each maps to at
// least one suited construction-prop Asset key (acceptance criterion #57).
func TestPropTaskTypeCoverage(t *testing.T) {
	t.Parallel()
	c := DefaultCatalog()
	for _, tt := range []domain.TaskType{ttPanel, ttMast} {
		found := false
		for _, e := range c.All() {
			if e.SuitsType(tt) && len(e.TaskTypes) > 0 {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("no catalog Asset suits task type %q", tt)
		}
	}
}

// TestHabitatTaskTypeCoverage proves the dome/wall/foundation task vocabulary each
// maps to at least one suited habitat Asset key (acceptance criterion #55).
func TestHabitatTaskTypeCoverage(t *testing.T) {
	t.Parallel()
	c := DefaultCatalog()
	for _, tt := range []domain.TaskType{ttDomeCap, ttWall, ttFndation} {
		found := false
		for _, e := range c.All() {
			if e.SuitsType(tt) && len(e.TaskTypes) > 0 {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("no catalog Asset suits task type %q", tt)
		}
	}
}

// TestNewEntryDefaultsIdentity guards the footgun: a zero Transform becomes
// Identity() (unit scale), never a collapse-to-nothing zero scale.
func TestNewEntryDefaultsIdentity(t *testing.T) {
	t.Parallel()
	e := NewEntry("k", "/a.glb", nil, Transform{})
	if e.Transform != Identity() {
		t.Fatalf("zero Transform should default to Identity(), got %+v", e.Transform)
	}
	explicit := Transform{Scale: domain.Vec3{X: 2, Y: 2, Z: 2}}
	e2 := NewEntry("k2", "/b.glb", nil, explicit)
	if e2.Transform != explicit {
		t.Fatalf("explicit Transform should be kept, got %+v", e2.Transform)
	}
}

// TestCatalogAccessors covers Get/All/Keys determinism and the duplicate-key
// last-write-wins rule.
func TestCatalogAccessors(t *testing.T) {
	t.Parallel()
	c := NewCatalog(
		NewEntry("b", "/b.glb", nil, Identity()),
		NewEntry("a", "/a1.glb", nil, Identity()),
		NewEntry("a", "/a2.glb", nil, Identity()), // last write wins
	)
	if e, ok := c.Get("a"); !ok || e.ModelRef != "/a2.glb" {
		t.Fatalf("Get(a) = %+v ok=%v, want last-write /a2.glb", e, ok)
	}
	if got := c.Keys(); !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("Keys() = %v, want [a b]", got)
	}
	all := c.All()
	if len(all) != 2 || all[0].Key != "a" || all[1].Key != "b" {
		t.Fatalf("All() not key-sorted: %+v", all)
	}
}

// TestDefaultCatalogPopulated proves the global fallback ships curated entries with
// resolvable self-hosted URLs and a non-zero (Identity-or-better) scale.
func TestDefaultCatalogPopulated(t *testing.T) {
	t.Parallel()
	c := DefaultCatalog()
	entries := c.All()
	if len(entries) == 0 {
		t.Fatal("DefaultCatalog must ship at least one curated Asset")
	}
	for _, e := range entries {
		if e.Key == "" || e.ModelRef == "" {
			t.Fatalf("default entry missing key/model_ref: %+v", e)
		}
		if e.Transform.Scale == (domain.Vec3{}) {
			t.Fatalf("default entry %q has a zero scale (would collapse)", e.Key)
		}
	}
}
