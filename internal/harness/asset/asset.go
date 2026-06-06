// Package asset is the closed, curated Asset catalog (ADR-0010): a bounded
// registry that pairs a stable Asset KEY (a slug, e.g. the NASA folder slug)
// with a resolved, self-hosted model_ref URL, the Task types the Asset suits,
// and a per-Asset NORMALIZATION transform that fits a raw Asset into its Build
// envelope deterministically.
//
// Why a closed catalog? Live Build mode lets the Model place real Assets, but the
// Model must never emit a free-form model_ref string — a free ref could invent a
// path, point at a gone/unlicensed asset, or drift between runs (ADR-0010). So
// the Model (and a replay spec) reference an Asset by KEY only; the SERVER
// resolves key → model_ref before the browser ever sees it. The browser receives
// only resolved, self-hosted URLs, never raw keys.
//
// The normalization transform is PER-PLACEMENT FIT/ORIENTATION only — it applies
// on top of the Build op's own transform so a raw Asset sits correctly inside its
// envelope. Geometry-level fixes (up-axis, normals, recenter) are baked OFFLINE
// elsewhere; this transform never substitutes for that.
//
// Each .glb variant is a DISTINCT key: there is one entry per resolvable model,
// so resolution is a total, deterministic key → model_ref mapping.
//
// This catalog is DISTINCT from internal/blueprint's Blueprint catalog (which
// registers placeable structures); it mirrors that package's style (a Catalog
// value with Get/All and a DefaultCatalog) for consistency, but the two carry
// different things and never share entries.
package asset

import (
	"slices"
	"sort"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
)

// Transform is an Asset's per-placement NORMALIZATION transform (ADR-0010):
// {scale, offset, rotation} applied ON TOP of the Build op's own transform so a
// raw Asset fits and orients correctly inside its Build envelope deterministically.
// It is a fit/orientation nudge only — geometry-level fixes (up-axis, normals,
// recenter) are baked offline elsewhere, not here.
//
// Scale is a per-axis multiplier (the identity is {1,1,1}, NOT the zero value, so
// use Identity() / NewEntry rather than a bare Transform{}); Offset is a
// translation in the Asset's local frame; Rotation is Euler radians (X,Y,Z).
type Transform struct {
	Scale    domain.Vec3 `json:"scale"`
	Offset   domain.Vec3 `json:"offset"`
	Rotation domain.Vec3 `json:"rotation"`
}

// Identity is the no-op normalization transform: unit scale, zero offset, zero
// rotation. It is the sensible default for an Asset already baked to fit its
// envelope (the per-axis scale must be 1, not 0, or the Asset would collapse).
func Identity() Transform {
	return Transform{Scale: domain.Vec3{X: 1, Y: 1, Z: 1}}
}

// Entry is one Asset in the closed catalog: a stable Key (the slug the Model /
// replay spec references), the resolved self-hosted ModelRef URL the server hands
// the browser, the TaskTypes the Asset suits, and the per-Asset normalization
// Transform. Each .glb variant is its own Entry (its own Key).
type Entry struct {
	Key       string            `json:"key"`
	ModelRef  string            `json:"model_ref"`
	TaskTypes []domain.TaskType `json:"task_types,omitempty"`
	Transform Transform         `json:"transform"`
}

// SuitsType reports whether this Asset is suited to the given Task type. An Entry
// with no declared TaskTypes is treated as suiting EVERY type (an unrestricted
// Asset), so resolution never has to special-case the empty list.
func (e Entry) SuitsType(t domain.TaskType) bool {
	if len(e.TaskTypes) == 0 {
		return true
	}
	return slices.Contains(e.TaskTypes, t)
}

// Catalog is the closed registry of curated Assets, keyed by Asset key. It mirrors
// internal/blueprint.Catalog's shape (Get/All + a DefaultCatalog) so the two read
// consistently, but holds DISTINCT data: curated model Assets, not Blueprints.
type Catalog struct {
	byKey map[string]Entry
}

// NewCatalog builds a Catalog from the given entries, last-write-wins on a
// duplicate key. A nil/empty slice yields an empty (but non-nil) catalog whose
// Resolve always misses — a contract may legitimately carry no Assets.
func NewCatalog(entries ...Entry) *Catalog {
	c := &Catalog{byKey: make(map[string]Entry, len(entries))}
	for _, e := range entries {
		c.byKey[e.Key] = e
	}
	return c
}

// Resolve maps an Asset key to its resolved model_ref URL and normalization
// transform. ok is false when the key is not in the catalog (the caller decides
// what to do — this package never rejects; coordinator membership enforcement is
// a separate concern, ADR-0010 / issue #60). It is the single, testable seam the
// server uses so the browser only ever receives a resolved URL, never a raw key.
//
// A nil Catalog resolves nothing (ok=false) so callers need not nil-check.
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

// Get returns the full catalog Entry for a key and whether it exists.
func (c *Catalog) Get(key string) (Entry, bool) {
	if c == nil {
		return Entry{}, false
	}
	e, ok := c.byKey[key]
	return e, ok
}

// All returns every catalog Entry in key-sorted order (deterministic for prompts
// and tests).
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

// Keys returns just the Asset keys in sorted order — the short list the model-seam
// prompt carries for a Task's catalog (the Model picks a key, never a URL).
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

// DefaultCatalog is the global Asset catalog that backs any Build contract which
// does not carry its own (ADR-0010: "A global default catalog can still back
// contracts that don't specify one"). The curated realism Assets populate it; both
// replay and live draw from the SAME set. Keys follow the stable-slug convention
// (e.g. the NASA folder slug), and each .glb variant is a distinct key. ModelRefs
// are self-hosted URLs under the curated /assets/ mount.
func DefaultCatalog() *Catalog {
	return NewCatalog(
		// Habitat / base Assets (#55), NASA-PD, self-hosted under web/public/assets/
		// (see CREDITS.md). Each .glb variant is a distinct key. Transforms are
		// hand-tuned fit/orientation nudges to seat each raw model in a unit-ish
		// Build envelope; geometry-level fixes are baked offline (ADR-0010).

		// Radome — a clean self-contained dome, the cap of the structure.
		NewEntry("habitat-radome", "/assets/models/radome.glb",
			[]domain.TaskType{"dome-cap"},
			Transform{Scale: domain.Vec3{X: 0.5, Y: 0.5, Z: 0.5}}),

		// Habitat Demonstration Unit, part 1 — the base/foundation module shell.
		NewEntry("habitat-demo-unit-1", "/assets/models/habitat-demo-unit-1.glb",
			[]domain.TaskType{"foundation"},
			Transform{Scale: domain.Vec3{X: 0.25, Y: 0.25, Z: 0.25}}),

		// Habitat Demonstration Unit, part 2 — the upper wall module.
		NewEntry("habitat-demo-unit-2", "/assets/models/habitat-demo-unit-2.glb",
			[]domain.TaskType{"wall"},
			Transform{Scale: domain.Vec3{X: 0.25, Y: 0.25, Z: 0.25}}),

		// Construction props (#57), NASA-PD, conditioned + Draco-compressed and
		// self-hosted under web/public/assets/models/ (see CREDITS.md). Each is
		// keyed to its suited Build task type with a hand-tuned fit/orientation
		// nudge so the raw model seats sensibly in its unit-ish envelope.

		// Solar Sail Concept — a flat sun-facing array, the photovoltaic prop.
		NewEntry("solar-panel", "/assets/models/solar-panel.glb",
			[]domain.TaskType{"panel"},
			Transform{Scale: domain.Vec3{X: 1.4, Y: 1.4, Z: 1.4}, Offset: domain.Vec3{Y: 0.5}}),

		// Tether — a slender vertical strut, standing in for the comms mast.
		NewEntry("comms-mast", "/assets/models/comms-mast.glb",
			[]domain.TaskType{"mast"},
			Transform{Scale: domain.Vec3{X: 0.6, Y: 1.6, Z: 0.6}, Offset: domain.Vec3{Y: 0.8}}),

		// 70-meter Dish — a parabolic antenna, the comms dish prop.
		NewEntry("comms-dish", "/assets/models/comms-dish.glb",
			[]domain.TaskType{"mast", "panel"},
			Transform{Scale: domain.Vec3{X: 0.8, Y: 0.8, Z: 0.8}, Offset: domain.Vec3{Y: 0.4}}),
	)
}

// ResolveOp returns a copy of op with any Asset KEY resolved against this catalog
// (ADR-0010). When op carries an AssetKey that is in the catalog, the returned op
// has shape "model", the resolved self-hosted ModelRef, a cleared AssetKey (so the
// browser only ever sees a resolved URL, never a raw key), and the entry's
// NORMALIZATION transform composed ON TOP of the op's own pos/rot/scale (per-axis
// scale multiply, Euler rotation add, offset add to position) so the raw Asset fits
// its envelope deterministically. ok reports whether a key was resolved.
//
// An op WITHOUT an AssetKey is returned unchanged (ok=false) — procedural ops and
// already-resolved model ops pass through untouched. An op whose AssetKey is NOT in
// the catalog is ALSO returned unchanged with ok=false (this package never rejects;
// coordinator membership enforcement is a separate concern, ADR-0010 / issue #60).
// A nil Catalog resolves nothing.
func (c *Catalog) ResolveOp(op wire.BuildOp) (wire.BuildOp, bool) {
	// shape/model_ref are place-only concepts (Fold reduces move/delete into the
	// surviving places), so only a place can carry — and resolve — an Asset key. A
	// move/delete passes through untouched even if it somehow carries a key, so
	// resolution never mangles the patch log's transform-only ops.
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

// ResolveSpec returns a copy of the spec with every op's Asset KEY resolved to its
// self-hosted model_ref + normalization transform (see ResolveOp). It is the
// server-side seam that runs before a spec rides a snapshot, so the browser only
// ever receives resolved URLs, never raw keys. Ops without a (resolvable) key pass
// through unchanged. A nil/empty spec returns nil. The input is never mutated.
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

// NewEntry builds a catalog Entry, defaulting an all-zero Transform to Identity()
// so a caller can pass the zero value to mean "no normalization" without
// accidentally scaling the Asset to nothing. An explicitly non-zero Transform is
// kept verbatim.
func NewEntry(key, modelRef string, taskTypes []domain.TaskType, t Transform) Entry {
	if t == (Transform{}) {
		t = Identity()
	}
	return Entry{Key: key, ModelRef: modelRef, TaskTypes: taskTypes, Transform: t}
}
