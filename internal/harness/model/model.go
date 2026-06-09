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

type Model interface {
	Generate(ctx context.Context, req Request) (json.RawMessage, error)
}

type Message struct {
	Role    string
	Content string
	Images  [][]byte
}

type Request struct {
	Messages   []Message
	SchemaName string
	Schema     json.RawMessage
}

type Config struct {
	Provider string
	BaseURL  string
	Model    string
	APIKey   string
}

var ErrFallback = errors.New("model: generation exhausted, fall back to primitive")

type specResponse struct {
	Ops []wire.BuildOp `json:"ops"`
}

func GenerateSpec(ctx context.Context, m Model, messages []Message) ([]wire.BuildOp, error) {
	const maxAttempts = 2

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
			return nil, fmt.Errorf("%w: provider error on attempt %d: %w", ErrFallback, attempt, err)
		}

		ops, verr := parseAndValidate(raw)
		if verr == nil {
			return ops, nil
		}
		lastErr = verr

		convo = append(convo,
			Message{Role: "assistant", Content: string(raw)},
			Message{Role: "user", Content: repairPrompt(verr)},
		)
	}

	return nil, fmt.Errorf("%w: last validation error: %w", ErrFallback, lastErr)
}

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

func repairPrompt(err error) string {
	return fmt.Sprintf(
		"The previous Build spec was REJECTED by the server-side validator with this error:\n  %s\n"+
			"Return a corrected Build spec as the same strict JSON object {\"ops\": [...]}. "+
			"Every op must satisfy the schema: op is \"place\"; shape is one of box|cylinder|sphere; "+
			"pos/rot/scale each have finite X,Y,Z; scale is positive on every axis; material.color is non-empty.",
		err.Error(),
	)
}

func specRequestSchema() json.RawMessage {
	out, err := json.Marshal(strictRequestSchema)
	if err != nil {
		panic(fmt.Sprintf("model: cannot marshal strict request schema: %v", err))
	}
	return out
}

const kwType = "type"

func strictObj(props map[string]any) map[string]any {
	required := make([]string, 0, len(props))
	for k := range props {
		required = append(required, k)
	}
	sort.Strings(required)
	return map[string]any{
		kwType:                 "object",
		"properties":           props,
		"required":             required,
		"additionalProperties": false,
	}
}

func prim(types ...string) map[string]any { return map[string]any{kwType: types} }

func enum(values ...string) map[string]any {
	return map[string]any{kwType: "string", "enum": values}
}

func nullable(t string) map[string]any { return prim(t, "null") }

var vec3Schema = strictObj(map[string]any{
	"X": prim("number"), "Y": prim("number"), "Z": prim("number"),
})

var materialSchema = strictObj(map[string]any{
	"color":     prim("string"),
	"roughness": nullable("number"),
	"metalness": nullable("number"),
	"map":       nullable("string"),
})

var buildOpSchema = strictObj(map[string]any{
	"op":        enum(wire.BuildOpPlace),
	"shape":     enum(string(wire.ShapeBox), string(wire.ShapeCylinder), string(wire.ShapeSphere)),
	"pos":       vec3Schema,
	"rot":       vec3Schema,
	"scale":     vec3Schema,
	"material":  materialSchema,
	"model_ref": nullable("string"),
	"asset_key": nullable("string"),
})

var strictRequestSchema = strictObj(map[string]any{
	"ops": map[string]any{"type": "array", "items": buildOpSchema},
})
