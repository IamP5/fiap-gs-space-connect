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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/cache"
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

// Done is the measurable "done" condition the Architect hands the harness — kept
// as free-form guidance here (e.g. a target silhouette) since the demo bakes a
// single Task and the analytic gate is the spec validator.
type Done struct {
	Description string `json:"description"`
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

// WorldContext is the snapshot context handed to the model alongside the contract:
// where the Task sits in the world and a terse note. It keeps the prompt grounded
// in the actual board without putting the model anywhere near the live loop.
type WorldContext struct {
	TaskPos domain.Vec2 `json:"task_pos"`
	Note    string      `json:"note,omitempty"`
}

// Result is one bake outcome: the approved ops, whether a repair re-ask was
// needed, and the cache key/path the entry was written to.
type Result struct {
	Key      cache.Key
	Path     string
	Ops      int
	Repaired bool
}

// Bake generates and caches the Build spec for one Task. It builds the prompt from
// the contract + world context, runs model.GenerateSpec (validate-and-repair),
// and on success writes a cache.Entry via store, returning where it landed. On
// model exhaustion it returns model.ErrFallback and writes nothing.
//
// provider/modelID are recorded in the cache key + entry so a vendor swap yields a
// distinct cache file. m is the (already-constructed) Model seam — Bake never
// constructs a provider itself, so a test can drive it with a fake.
func Bake(ctx context.Context, m model.Model, store *cache.Store, c Contract, world WorldContext, provider, modelID string) (Result, error) {
	contractJSON, err := c.JSON()
	if err != nil {
		return Result{}, err
	}

	messages, err := buildPrompt(c, contractJSON, world)
	if err != nil {
		return Result{}, err
	}

	ops, genErr := model.GenerateSpec(ctx, m, messages)
	if genErr != nil {
		// Exhaustion ⇒ fallback: surface it so the operator knows the demo Task will
		// use the primitive, and write nothing.
		return Result{}, genErr
	}

	// A repair was needed iff GenerateSpec made more than one underlying call. We
	// don't have the count here, so record repaired=false; the cmd reports the
	// generation outcome. (The trace-rich path is a later lab slice, ADR-0008.)
	key := cache.Key{
		BlueprintID:  c.BlueprintID,
		TaskID:       string(c.TaskID),
		ContractHash: cache.ContractHash(contractJSON),
		Model:        modelID,
	}
	entry := cache.Entry{
		BlueprintID:  c.BlueprintID,
		TaskID:       string(c.TaskID),
		TaskType:     string(c.Type),
		ContractHash: key.ContractHash,
		Model:        modelID,
		Provider:     provider,
		Ops:          ops,
		Contract:     contractJSON,
	}

	path, wErr := store.Write(key, entry)
	if wErr != nil {
		return Result{}, fmt.Errorf("cache write: %w", wErr)
	}
	return Result{Key: key, Path: path, Ops: len(ops)}, nil
}

// buildPrompt assembles the system + user messages for one bake: a system message
// pinning the role and the declarative-data invariant (ADR-0006), and a user
// message carrying the Build contract, the world context, and the exact output
// envelope shape. The strict response_format json_schema (set by GenerateSpec)
// constrains the structure; the prompt supplies intent.
func buildPrompt(c Contract, contractJSON json.RawMessage, world WorldContext) ([]model.Message, error) {
	worldJSON, err := json.Marshal(world)
	if err != nil {
		return nil, fmt.Errorf("marshal world context: %w", err)
	}

	system := "You are a SwarmBuild Build harness for a lunar-habitat construction swarm. " +
		"You emit DECLARATIVE geometry only — an ordered list of `place` ops (box | cylinder | sphere) " +
		"with pos/rot/scale (finite X,Y,Z; positive scale on every axis) and a PBR material " +
		"(non-empty hex color, optional roughness/metalness in [0,1]). " +
		"All coordinates are RELATIVE to the Task's Build-envelope frame and MUST stay within the envelope. " +
		"You never emit code; the renderer interprets your ops. Return strict JSON of the form {\"ops\": [ ... ]}."

	user := fmt.Sprintf(
		"Build the geometry for this Task.\n\nBuild contract:\n%s\n\nWorld context:\n%s\n\n"+
			"Produce 3–8 ops that form a recognizable, structurally-plausible %s for a moon-base dome. "+
			"Keep every op inside the envelope; rise from the ground up.",
		string(contractJSON), string(worldJSON), c.Type,
	)

	if c.TaskID == "" || c.Type == "" {
		return nil, errors.New("bake: contract must have a task_id and type")
	}

	return []model.Message{
		{Role: "system", Content: system},
		{Role: "user", Content: user},
	}, nil
}
