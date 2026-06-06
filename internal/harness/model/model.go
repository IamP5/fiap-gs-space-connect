// Package model is the SwarmBuild Model seam (TECHSPEC §4, ADR-0005): one narrow
// interface a Build harness calls to turn a Build contract into a structured
// Build spec, with the provider chosen by config (base_url swap). An openai-go/v3
// adapter lives behind it; provider/base_url/model/api_key are all config so the
// same seam drives OpenAI, a Gemini OpenAI-compatible endpoint, or a local
// Ollama without touching callers.
//
// LOAD-BEARING ARCHITECTURE INVARIANT (ADR-0005): this package MUST NOT be in the
// import closure of the hot-path packages (allocation/auction, lease/heartbeat,
// expiry, single-writer tick). A live model call may never sit on an award,
// heartbeat, or expiry. The Model seam is reached ONLY by the offline bake/lab
// path (cmd/bake); the headline replays a cached, validated spec with no model
// call. internal/harness/archtest enforces this mechanically in `go test`.
//
// Generation is best-effort. GenerateSpec wraps a Model with the server-side
// validate-and-repair pass (ADR-0006): on a schema failure it re-asks ONCE with
// the validation error appended, and on a second failure it signals fallback so
// the caller degrades the Task to its primitive geometry — the core never blocks
// on the model.
package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"swarmbuild/internal/harness/spec"
	"swarmbuild/internal/wire"
)

// Model is the narrow generation seam. Generate sends a Request (prompt +
// messages + the strict JSON schema the output must conform to) to a provider and
// returns the raw structured-output JSON. It is the ONLY method an adapter must
// implement; everything else (validate-and-repair, fallback) is provider-agnostic
// orchestration in this package.
type Model interface {
	Generate(ctx context.Context, req Request) (json.RawMessage, error)
}

// Message is one chat message in a Request (role + text content). Roles follow
// the OpenAI chat convention ("system" | "user" | "assistant"); the repair pass
// appends a "user" message carrying the validation error.
type Message struct {
	Role    string
	Content string
}

// Request is one structured-generation call. Messages is the conversation so far;
// SchemaName/Schema are the strict response_format json_schema the provider must
// emit against. Schema is the raw JSON Schema bytes (an object wrapping the
// Build-spec array, see specRequestSchema) so strict mode — which requires an
// object root — is satisfied.
type Request struct {
	Messages   []Message
	SchemaName string
	Schema     json.RawMessage
}

// Config selects and authenticates a provider. Provider is advisory (for logs);
// BaseURL is the actual swap point. APIKey is read from the environment by the
// bake command and never logged or shipped to the browser.
//
//	OpenAI → https://api.openai.com/v1
//	Gemini → https://generativelanguage.googleapis.com/v1beta/openai/
//	local  → http://localhost:11434/v1
type Config struct {
	Provider string // "openai" | "gemini" | "local" (advisory label)
	BaseURL  string // provider endpoint; empty ⇒ adapter default (OpenAI)
	Model    string // model id, e.g. "gpt-4o-2024-08-06"
	APIKey   string // secret; server-side only, never browser-bound
}

// ErrFallback signals that generation could not produce a valid spec after the
// single repair re-ask (exhaustion). The caller degrades the Task to its
// primitive fallback (ADR-0005); the Task still completes. It wraps the last
// underlying cause for the audit log.
var ErrFallback = errors.New("model: generation exhausted, fall back to primitive")

// specResponse is the strict-structured-output envelope. OpenAI strict mode
// requires the schema root to be an object, but a Build spec is an array
// (TECHSPEC §4), so the model emits {"ops": [...]} and we unwrap Ops. The field
// name matches specRequestSchema below.
type specResponse struct {
	Ops []wire.BuildOp `json:"ops"`
}

// GenerateSpec runs one validate-and-repair generation against m for the given
// prompt messages and returns the approved, schema-valid Build spec ops.
//
// Flow (ADR-0006): call the Model with strict response_format json_schema → parse
// → spec.Validate. On a validation (or parse) failure, re-ask ONCE with the error
// appended as a repair instruction. On a SECOND failure — or any transport error
// on the repair — it returns ErrFallback (wrapping the cause) so the caller uses
// the primitive geometry. A successful first or repaired call returns the ops.
//
// maxAttempts is fixed at two: the initial ask plus a single repair (TECHSPEC §4
// "re-ask once"). It makes no network calls itself; m does.
func GenerateSpec(ctx context.Context, m Model, messages []Message) ([]wire.BuildOp, error) {
	const maxAttempts = 2 // initial ask + one repair re-ask

	convo := make([]Message, len(messages))
	copy(convo, messages)

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		req := Request{
			Messages:   convo,
			SchemaName: "build_spec",
			Schema:     specRequestSchema(),
		}
		raw, err := m.Generate(ctx, req)
		if err != nil {
			// A transport/provider error is not repairable by re-asking with a
			// schema message; degrade to fallback immediately. Both the fallback
			// sentinel and the underlying cause are wrapped so callers can match
			// errors.Is(err, ErrFallback) and still inspect the provider error.
			return nil, fmt.Errorf("%w: provider error on attempt %d: %w", ErrFallback, attempt, err)
		}

		ops, verr := parseAndValidate(raw)
		if verr == nil {
			return ops, nil // approved spec
		}
		lastErr = verr

		// Append the model's own (rejected) output and a repair instruction naming
		// the exact validation failure, then loop to re-ask once.
		convo = append(convo,
			Message{Role: "assistant", Content: string(raw)},
			Message{Role: "user", Content: repairPrompt(verr)},
		)
	}

	return nil, fmt.Errorf("%w: last validation error: %w", ErrFallback, lastErr)
}

// parseAndValidate unmarshals the strict-output envelope and runs the same
// server-side gate (spec.Validate) the coordinator uses before any op rides a
// snapshot. A malformed envelope or any invalid op is a repairable failure.
func parseAndValidate(raw json.RawMessage) ([]wire.BuildOp, error) {
	var resp specResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("decode structured output: %w", err)
	}
	if len(resp.Ops) == 0 {
		return nil, errors.New("structured output contained zero build ops")
	}
	if err := spec.Validate(resp.Ops); err != nil {
		return nil, err
	}
	return resp.Ops, nil
}

// repairPrompt is the single re-ask instruction: it hands the model the exact
// validation error so its next attempt corrects that specific defect rather than
// guessing. Kept terse and imperative.
func repairPrompt(err error) string {
	return fmt.Sprintf(
		"The previous Build spec was REJECTED by the server-side validator with this error:\n  %s\n"+
			"Return a corrected Build spec as the same strict JSON object {\"ops\": [...]}. "+
			"Every op must satisfy the schema: op is \"place\"; shape is one of box|cylinder|sphere; "+
			"pos/rot/scale each have finite X,Y,Z; scale is positive on every axis; material.color is non-empty.",
		err.Error(),
	)
}

// specRequestSchema returns the OpenAI strict-mode JSON Schema (object-rooted)
// the provider generates against: {"ops": [BuildOp]}.
//
// OpenAI strict mode (response_format json_schema, strict:true) imposes
// constraints the canonical Build-spec schema in internal/harness/spec does NOT
// satisfy: the root must be an OBJECT (ours is an array), every object must set
// additionalProperties:false AND list EVERY property in "required", and an
// "optional" field is expressed as a nullable required field
// (`"type": ["T","null"]`) rather than an omitted one. So we build the strict
// schema here from the same field set rather than embedding the lenient one.
//
// spec.Validate stays the AUTHORITATIVE server-side gate (ADR-0006): nullable
// optionals come back as Go zero values (a null roughness ⇒ nil *float64, a null
// model_ref ⇒ ""), which the validator already treats as "renderer default", so
// the strict schema and the validator agree on what a valid op is. Computed on
// every call (cheap; called at most twice per bake).
func specRequestSchema() json.RawMessage {
	out, err := json.Marshal(strictRequestSchema)
	if err != nil {
		panic(fmt.Sprintf("model: cannot marshal strict request schema: %v", err))
	}
	return out
}

// kwType is the JSON Schema "type" keyword, named so the schema builders below
// define it once rather than repeating the literal.
const kwType = "type"

// strictObj builds an OpenAI-strict object schema: every key of props is forced
// into "required" (strict mode mandates it) and additionalProperties is false.
// Centralising it keeps the schema definitions terse and the strict-mode rules in
// ONE place.
func strictObj(props map[string]any) map[string]any {
	required := make([]string, 0, len(props))
	for k := range props {
		required = append(required, k)
	}
	sort.Strings(required) // stable schema bytes across runs (map order is random)
	return map[string]any{
		kwType:                 "object",
		"properties":           props,
		"required":             required,
		"additionalProperties": false,
	}
}

// prim is a primitive (non-object) schema node, e.g. prim("number") or
// prim("string","null") for a strict-mode nullable.
func prim(types ...string) map[string]any { return map[string]any{kwType: types} }

// enum is a string schema node constrained to a fixed value set.
func enum(values ...string) map[string]any {
	return map[string]any{kwType: "string", "enum": values}
}

// nullable renders an OpenAI-strict optional field: required, but allowed to be
// null. The decoder/validator treats null as the renderer default.
func nullable(t string) map[string]any { return prim(t, "null") }

// vec3Schema is the strict schema for a domain.Vec3 (capital X/Y/Z, all required).
var vec3Schema = strictObj(map[string]any{
	"X": prim("number"), "Y": prim("number"), "Z": prim("number"),
})

// materialSchema is the strict schema for wire.Material: color is mandatory;
// roughness/metalness/map are nullable-required (the strict-mode form of optional).
var materialSchema = strictObj(map[string]any{
	"color":     prim("string"),
	"roughness": nullable("number"),
	"metalness": nullable("number"),
	"map":       nullable("string"),
})

// buildOpSchema is the strict schema for one wire.BuildOp. shape is constrained to
// the rendered primitives so the model never wastes an op on the no-op "model"
// slot; model_ref is nullable (only meaningful for that future shape).
var buildOpSchema = strictObj(map[string]any{
	"op":        enum(wire.BuildOpPlace),
	"shape":     enum(string(wire.ShapeBox), string(wire.ShapeCylinder), string(wire.ShapeSphere)),
	"pos":       vec3Schema,
	"rot":       vec3Schema,
	"scale":     vec3Schema,
	"material":  materialSchema,
	"model_ref": nullable("string"),
})

// strictRequestSchema is the object-rooted strict request schema:
// {"ops": [BuildOp]} with ops required and no extra properties.
var strictRequestSchema = strictObj(map[string]any{
	"ops": map[string]any{"type": "array", "items": buildOpSchema},
})
