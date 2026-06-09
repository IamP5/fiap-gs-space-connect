package asset

import (
	"slices"
	"sort"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
)

type Transform struct {
	Scale    domain.Vec3 `json:"scale"`
	Offset   domain.Vec3 `json:"offset"`
	Rotation domain.Vec3 `json:"rotation"`
}

func Identity() Transform {
	return Transform{Scale: domain.Vec3{X: 1, Y: 1, Z: 1}}
}

type Entry struct {
	Key       string            `json:"key"`
	ModelRef  string            `json:"model_ref"`
	TaskTypes []domain.TaskType `json:"task_types,omitempty"`
	Transform Transform         `json:"transform"`
}

func (e Entry) SuitsType(t domain.TaskType) bool {
	if len(e.TaskTypes) == 0 {
		return true
	}
	return slices.Contains(e.TaskTypes, t)
}

type Catalog struct {
	byKey map[string]Entry
}

func NewCatalog(entries ...Entry) *Catalog {
	c := &Catalog{byKey: make(map[string]Entry, len(entries))}
	for _, e := range entries {
		c.byKey[e.Key] = e
	}
	return c
}

func (c *Catalog) Resolve(key string) (modelRef string, transform Transform, ok bool) {
	if c == nil {
		return "", Transform{}, false
	}
	e, found := c.byKey[key]
	if !found {
		return "", Transform{}, false
	}
	return e.ModelRef, e.Transform, true
}

func (c *Catalog) Get(key string) (Entry, bool) {
	if c == nil {
		return Entry{}, false
	}
	e, ok := c.byKey[key]
	return e, ok
}

func (c *Catalog) All() []Entry {
	if c == nil {
		return nil
	}
	keys := make([]string, 0, len(c.byKey))
	for k := range c.byKey {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]Entry, 0, len(keys))
	for _, k := range keys {
		out = append(out, c.byKey[k])
	}
	return out
}

func (c *Catalog) Keys() []string {
	if c == nil {
		return nil
	}
	keys := make([]string, 0, len(c.byKey))
	for k := range c.byKey {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func DefaultCatalog() *Catalog {
	return NewCatalog(

		NewEntry("habitat-radome", "/assets/models/radome.glb",
			[]domain.TaskType{"dome-cap"},
			Transform{Scale: domain.Vec3{X: 0.5, Y: 0.5, Z: 0.5}}),

		NewEntry("habitat-demo-unit-1", "/assets/models/habitat-demo-unit-1.glb",
			[]domain.TaskType{"foundation"},
			Transform{Scale: domain.Vec3{X: 0.25, Y: 0.25, Z: 0.25}}),

		NewEntry("habitat-demo-unit-2", "/assets/models/habitat-demo-unit-2.glb",
			[]domain.TaskType{"wall"},
			Transform{Scale: domain.Vec3{X: 0.25, Y: 0.25, Z: 0.25}}),

		NewEntry("solar-panel", "/assets/models/solar-panel.glb",
			[]domain.TaskType{"panel"},
			Transform{Scale: domain.Vec3{X: 1.4, Y: 1.4, Z: 1.4}, Offset: domain.Vec3{Y: 0.5}}),

		NewEntry("comms-mast", "/assets/models/comms-mast.glb",
			[]domain.TaskType{"mast"},
			Transform{Scale: domain.Vec3{X: 0.6, Y: 1.6, Z: 0.6}, Offset: domain.Vec3{Y: 0.8}}),

		NewEntry("comms-dish", "/assets/models/comms-dish.glb",
			[]domain.TaskType{"mast", "panel"},
			Transform{Scale: domain.Vec3{X: 0.8, Y: 0.8, Z: 0.8}, Offset: domain.Vec3{Y: 0.4}}),
	)
}

func (c *Catalog) ResolveOp(op wire.BuildOp) (wire.BuildOp, bool) {
	if op.AssetKey == "" || op.Op != wire.BuildOpPlace {
		return op, false
	}
	modelRef, t, ok := c.Resolve(op.AssetKey)
	if !ok {
		return op, false
	}
	op.Shape = wire.ShapeModel
	op.ModelRef = modelRef
	op.AssetKey = ""
	op.Scale = domain.Vec3{X: op.Scale.X * t.Scale.X, Y: op.Scale.Y * t.Scale.Y, Z: op.Scale.Z * t.Scale.Z}
	op.Rot = domain.Vec3{X: op.Rot.X + t.Rotation.X, Y: op.Rot.Y + t.Rotation.Y, Z: op.Rot.Z + t.Rotation.Z}
	op.Pos = domain.Vec3{X: op.Pos.X + t.Offset.X, Y: op.Pos.Y + t.Offset.Y, Z: op.Pos.Z + t.Offset.Z}
	return op, true
}

func (c *Catalog) ResolveSpec(ops []wire.BuildOp) []wire.BuildOp {
	if len(ops) == 0 {
		return nil
	}
	out := make([]wire.BuildOp, len(ops))
	for i, op := range ops {
		out[i], _ = c.ResolveOp(op)
	}
	return out
}

func NewEntry(key, modelRef string, taskTypes []domain.TaskType, t Transform) Entry {
	if t == (Transform{}) {
		t = Identity()
	}
	return Entry{Key: key, ModelRef: modelRef, TaskTypes: taskTypes, Transform: t}
}
