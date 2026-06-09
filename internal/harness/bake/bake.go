// Package bake is the SwarmBuild offline generation path (TECHSPEC §3/§4,
// ADR-0007): for ONE demo Task it builds a minimal Build contract + world-snapshot
// context, calls the Model seam with validate-and-repair, and writes the approved
// Build spec to the committed cache. It is the ONLY caller of internal/harness/model
// outside tests, keeping the live generator strictly off the headline path.
//
// Bake is explicit and manual (cmd/bake). The headline never bakes — it replays
// the committed cache. On exhaustion (the model can't produce a valid spec after
// the single repair) Bake returns model.ErrFallback and writes NOTHING, so the
// demo's Task simply falls back to the primitive (the Task still completes).
package bake

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/asset"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/harness/model"
)

// Vec3 mirrors domain.Vec3 in the Build contract JSON (capital X/Y/Z), matching
// the schema's vec3 shape so the contract reads consistently with emitted ops.
type Vec3 = domain.Vec3

// Envelope is the Build envelope (TECHSPEC §4): the axis-aligned bounds, in the
// Task's frame, that the generated geometry must stay within. Center is usually
// the origin (the spec is expressed relative to the Task envelope frame); Size is
// the full extent.
type Envelope struct {
	Center Vec3 `json:"center"`
	Size   Vec3 `json:"size"`
}

// Done is the measurable "done" condition the Architect hands the harness. It
// carries free-form guidance (Description, surfaced to the prompt) AND the analytic
// criteria the Evaluator's hard gate checks deterministically (MinOps,
// MinCoverage) — so "done" is a real, unit-testable invariant, not just prose
// (ADR-0008).
type Done struct {
	Description string  `json:"description"`
	MinOps      int     `json:"min_ops,omitempty"`
	MinCoverage float64 `json:"min_coverage,omitempty"`
}

// Contract is the Build contract (Architect → Build harness, TECHSPEC §4): what to
// build, the envelope it must fit, and a measurable done. ContractHash over its
// canonical JSON is part of the cache key, so a contract change re-bakes.
type Contract struct {
	BlueprintID string          `json:"blueprint_id"`
	TaskID      domain.TaskID   `json:"task_id"`
	Type        domain.TaskType `json:"type"`
	Envelope    Envelope        `json:"envelope"`
	Done        Done            `json:"done"`
	Style       string          `json:"style,omitempty"`
	// Catalog is the closed Asset catalog this contract scopes (ADR-0010): the
	// curated key → model_ref Assets a Rover's Build harness (replay or live) may
	// place by KEY for this Task. The Model emits only a key from it, never a path;
	// the server resolves key → model_ref before the browser sees the op. Nil ⇒ the
	// global asset.DefaultCatalog() backs the contract (an unscoped contract still
	// has the curated set available). It is DISTINCT from coordinator.Config's
	// blueprint Catalog (placeable structures) — this one carries model Assets — but
	// mirrors that field's "nil ⇒ default" style for consistency. It is excluded
	// from the contract's canonical JSON (and so from the cache key) so that
	// re-scoping the available Assets does not re-bake every Task's geometry.
	Catalog *asset.Catalog `json:"-"`
}

// AssetCatalog returns the contract's Asset catalog, falling back to the global
// asset.DefaultCatalog() when the contract does not scope one (ADR-0010: a default
// catalog backs contracts that don't specify their own). It never returns nil.
func (c Contract) AssetCatalog() *asset.Catalog {
	if c.Catalog != nil {
		return c.Catalog
	}
	return asset.DefaultCatalog()
}

// JSON returns the contract's canonical JSON bytes (the input to ContractHash and
// the prompt). Go marshals map/struct fields deterministically, so the bytes are
// stable across runs.
func (c Contract) JSON() (json.RawMessage, error) {
	b, err := json.Marshal(c)
	if err != nil {
		return nil, fmt.Errorf("marshal build contract: %w", err)
	}
	return b, nil
}

// EvalEnvelope returns the Build envelope in the analytic Evaluator's shape.
func (c Contract) EvalEnvelope() evaluator.Envelope {
	return evaluator.Envelope{Center: c.Envelope.Center, Size: c.Envelope.Size}
}

// EvalDone returns the analytic done-criteria the Evaluator's hard gate checks.
func (c Contract) EvalDone() evaluator.DoneCriteria {
	return evaluator.DoneCriteria{
		MinOps:      c.Done.MinOps,
		MinCoverage: c.Done.MinCoverage,
		Description: c.Done.Description,
	}
}

// WorldContext is the snapshot context handed to the model alongside the contract:
// where the Task sits in the world, a terse note, and — the key bh-04 addition —
// the accumulated ops of NEIGHBOUR tasks within/near this Task's envelope, so the
// Generator authors geometry that fits a coherent, already-rising world (and the
// Evaluator can check for collisions). Neighbours are lifted into the world frame
// at the subject's SubjectOrigin.
type WorldContext struct {
	TaskPos       domain.Vec2           `json:"task_pos"`
	Note          string                `json:"note,omitempty"`
	SubjectOrigin domain.Vec3           `json:"subject_origin"`
	Neighbours    []evaluator.Neighbour `json:"neighbours,omitempty"`
}

// BuildPrompt assembles the system + user messages for one generation: a system
// message pinning the role and the declarative-data invariant (ADR-0006), and a
// user message carrying the Build contract, the world context, and the exact
// output envelope shape. The strict response_format json_schema (set by
// GenerateSpec) constrains the structure; the prompt supplies intent. It is
// exported so the in-app live lab (internal/harness/lab) drives the SAME prompt
// the offline bake uses, keeping the lab and the headline-cache generation honest.
func BuildPrompt(c Contract, contractJSON json.RawMessage, world WorldContext) ([]model.Message, error) {
	worldJSON, err := json.Marshal(world)
	if err != nil {
		return nil, fmt.Errorf("marshal world context: %w", err)
	}

	system := "You are a SwarmBuild Build harness for a lunar-habitat construction swarm. " +
		"You emit DECLARATIVE geometry only — an ordered list of `place` ops (box | cylinder | sphere) " +
		"with pos/rot/scale (finite X,Y,Z; positive scale on every axis) and a PBR material " +
		"(non-empty hex color, optional roughness/metalness in [0,1]). " +
		"All coordinates are RELATIVE to the Task's Build-envelope frame and MUST stay within the envelope. " +
		"You never emit code; the renderer interprets your ops. Return strict JSON of the form {\"ops\": [ ... ]}." +
		assetCatalogNote(c)

	neighbourNote := ""
	if len(world.Neighbours) > 0 {
		neighbourNote = fmt.Sprintf(
			"\n\nNeighbouring structures already exist nearby (their accumulated ops are in the world "+
				"context above, in world coordinates). Do NOT overlap them; your geometry must abut or clear "+
				"them, never collide. There are %d neighbour task(s) near your envelope.",
			len(world.Neighbours),
		)
	}

	// Explicit numeric bounds: each op's bounding box (pos ± scale/2 per axis) MUST
	// stay within these half-extents. Stating them deterministically — and asking for
	// a small safety margin — keeps the Generator inside the analytic envelope gate
	// (the dominant cause of fallbacks is a slab/finial whose AABB just pokes past a
	// wall).
	hx, hy, hz := c.Envelope.Size.X/2, c.Envelope.Size.Y/2, c.Envelope.Size.Z/2
	boundsNote := fmt.Sprintf(
		"\n\nHARD BOUNDS (envelope half-extents, centred on the origin): "+
			"X in [%.2f, %.2f], Y in [%.2f, %.2f], Z in [%.2f, %.2f]. "+
			"For EVERY op, pos.AXIS ± scale.AXIS/2 must lie within these limits — keep a ~10%% margin off each "+
			"wall. The base sits on the floor (lowest point near Y=%.2f); build upward from there.",
		-hx, hx, -hy, hy, -hz, hz, -hy,
	)

	user := fmt.Sprintf(
		"Build the geometry for this Task.\n\nBuild contract:\n%s\n\nWorld context:\n%s%s%s\n\n"+
			"Produce 3–8 ops that form a recognizable, structurally-plausible %s for a moon-base dome. "+
			"Keep every op strictly inside the HARD BOUNDS above; rise from the ground up.",
		string(contractJSON), string(worldJSON), neighbourNote, boundsNote, c.Type,
	)

	if c.TaskID == "" || c.Type == "" {
		return nil, errors.New("bake: contract must have a task_id and type")
	}

	return []model.Message{
		{Role: "system", Content: system},
		{Role: "user", Content: user},
	}, nil
}

// assetCatalogNote renders the system-prompt addendum that offers the model the
// contract's closed Asset catalog (ADR-0010, issue #61). It lists the available
// catalog KEYS — names ONLY, with each key's suited Task type(s) — and instructs the
// model that it MAY set `asset_key: "<key>"` on a `place` op to drop in a curated
// Asset instead of authoring a procedural shape. It NEVER leaks a model_ref/URL/path
// (the server resolves key → self-hosted model_ref before the browser sees the op),
// so the model can only ever pick a key. Keys come from the contract's catalog, which
// is the SAME set replay and live draw from (AssetCatalog() falls back to the global
// asset.DefaultCatalog() when the contract scopes none). An empty catalog yields an
// empty note (no Asset offer), so the prompt stays purely procedural.
func assetCatalogNote(c Contract) string {
	cat := c.AssetCatalog()
	keys := cat.Keys()
	if len(keys) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("\n\nCURATED ASSET CATALOG (ADR-0010): you MAY place a real, curated Asset instead of a " +
		"procedural shape by setting `asset_key` on a `place` op to one of the KEYS below (and you may still " +
		"set a fallback shape on the same op). NEVER invent a model_ref/URL/path — the server resolves the key " +
		"to a self-hosted model and fits it to your op's pos/rot/scale. Place an Asset only when its suited " +
		"type matches this Task; otherwise emit procedural shapes. Available keys (key — suited task type(s)):")
	for _, k := range keys {
		entry, ok := cat.Get(k)
		if !ok {
			continue
		}
		suited := "any task type"
		if len(entry.TaskTypes) > 0 {
			parts := make([]string, len(entry.TaskTypes))
			for i, t := range entry.TaskTypes {
				parts[i] = string(t)
			}
			suited = strings.Join(parts, ", ")
		}
		fmt.Fprintf(&b, "\n  - %s — %s", k, suited)
	}
	return b.String()
}
