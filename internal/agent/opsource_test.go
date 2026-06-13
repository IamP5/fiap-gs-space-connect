package agent

import (
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
)

const (
	kFoundation = "foundation"
	kWall       = "wall"
	kDome       = "dome"
	kPanel      = "panel"
	kMast       = "mast"
	kDish       = "dish"
	kDomeCap    = "dome-cap"
)

func TestStructureKind(t *testing.T) {
	cases := []struct {
		typ  domain.TaskType
		id   domain.TaskID
		want string
	}{
		{kFoundation, "lunar/foundation-1", kFoundation},
		{kWall, "lunar/wall-3", kWall},
		{kPanel, "solar-array/panel-2", kPanel},
		{kMast, "comms/mast", kMast},
		{kDomeCap, "lunar/dome-cap", kDome},
		{kDomeCap, "comms/antenna", kDish},
		{kDomeCap, "comms/dish-1", kDish},
		{"sometypewedontknow", "x", kDome},
	}
	for _, c := range cases {
		if got := structureKind(c.typ, c.id); got != c.want {
			t.Errorf("structureKind(%q,%q) = %q, want %q", c.typ, c.id, got, c.want)
		}
	}
}

func TestBuildOpsForModuleStream(t *testing.T) {
	cases := []struct {
		typ  domain.TaskType
		id   domain.TaskID
		kind string
	}{
		{kFoundation, "lunar/foundation-1", kFoundation},
		{kWall, "lunar/wall-1", kWall},
		{kDomeCap, "lunar/dome-cap", kDome},
		{kDomeCap, "comms/antenna", kDish},
		{kPanel, "solar-array/panel-1", kPanel},
		{kMast, "comms/mast", kMast},
	}
	for _, c := range cases {
		ops := buildOpsFor(c.id, c.typ)
		want := partSteps[c.kind]
		if want == 0 {
			t.Fatalf("partSteps[%q] is 0 — every kind must decompose into >=1 build step", c.kind)
		}
		if len(ops) != want {
			t.Errorf("buildOpsFor(%q,%q): got %d ops, want %d (partSteps[%q])", c.id, c.typ, len(ops), want, c.kind)
		}
		for i, op := range ops {
			if op.Shape != wire.ShapeModule {
				t.Errorf("op %d for %q: shape %q, want %q", i, c.kind, op.Shape, wire.ShapeModule)
			}
			if op.Part != c.kind {
				t.Errorf("op %d for %q: part %q, want %q", i, c.kind, op.Part, c.kind)
			}
		}
		if err := wire.Validate(ops); err != nil {
			t.Errorf("buildOpsFor(%q,%q) must produce a spec-valid stream: %v", c.id, c.typ, err)
		}
	}
}
