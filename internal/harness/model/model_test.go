package model

import (
	"context"
	"encoding/json"
	"errors"
	"swarmbuild/internal/harness/spec"
	"swarmbuild/internal/wire"
	"testing"
)

func validSpecJSON(t *testing.T) json.RawMessage {
	t.Helper()
	ops := []wire.BuildOp{{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeBox,
		Pos:      vec(0, 0.5, 0),
		Rot:      vec(0, 0, 0),
		Scale:    vec(1, 1, 1),
		Material: wire.Material{Color: "#cfcfd6"},
	}}
	if err := spec.Validate(ops); err != nil {
		t.Fatalf("valid fixture failed validation: %v", err)
	}
	b, err := json.Marshal(specResponse{Ops: ops})
	if err != nil {
		t.Fatalf("marshal valid fixture: %v", err)
	}
	return b
}

func invalidSpecJSON(t *testing.T) json.RawMessage {
	t.Helper()
	ops := []wire.BuildOp{{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeBox,
		Pos:      vec(0, 0, 0),
		Rot:      vec(0, 0, 0),
		Scale:    vec(0, 0, 0),
		Material: wire.Material{Color: "#cfcfd6"},
	}}
	if err := spec.Validate(ops); err == nil {
		t.Fatal("invalid fixture unexpectedly passed validation")
	}
	b, err := json.Marshal(specResponse{Ops: ops})
	if err != nil {
		t.Fatalf("marshal invalid fixture: %v", err)
	}
	return b
}

func vec(x, y, z float64) (v domainVec3) {
	v.X, v.Y, v.Z = x, y, z
	return v
}

type domainVec3 = struct {
	X, Y, Z float64
}

func msgs() []Message {
	return []Message{
		{Role: "system", Content: "you build lunar habitat geometry"},
		{Role: "user", Content: "build a foundation"},
	}
}

func TestGenerateSpec_FirstTrySucceeds(t *testing.T) {
	f := &FakeModel{Responses: []json.RawMessage{validSpecJSON(t)}}
	ops, err := GenerateSpec(context.Background(), f, msgs())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ops) != 1 {
		t.Fatalf("want 1 op, got %d", len(ops))
	}
	if got := f.Calls(); got != 1 {
		t.Fatalf("want 1 model call, got %d", got)
	}
	if err := spec.Validate(ops); err != nil {
		t.Fatalf("returned ops should be valid: %v", err)
	}
}

func TestGenerateSpec_RepairsOnce(t *testing.T) {
	f := &FakeModel{Responses: []json.RawMessage{
		invalidSpecJSON(t),
		validSpecJSON(t),
	}}
	ops, err := GenerateSpec(context.Background(), f, msgs())
	if err != nil {
		t.Fatalf("unexpected error after repair: %v", err)
	}
	if got := f.Calls(); got != 2 {
		t.Fatalf("want exactly 2 model calls (ask + 1 repair), got %d", got)
	}
	if err := spec.Validate(ops); err != nil {
		t.Fatalf("repaired ops should be valid: %v", err)
	}
}

func TestGenerateSpec_FallbackOnExhaustion(t *testing.T) {
	f := &FakeModel{Responses: []json.RawMessage{
		invalidSpecJSON(t),
		invalidSpecJSON(t),
	}}
	ops, err := GenerateSpec(context.Background(), f, msgs())
	if !errors.Is(err, ErrFallback) {
		t.Fatalf("want ErrFallback on exhaustion, got %v", err)
	}
	if ops != nil {
		t.Fatalf("want nil ops on fallback, got %v", ops)
	}
	if got := f.Calls(); got != 2 {
		t.Fatalf("want exactly 2 model calls before fallback, got %d", got)
	}
}

func TestGenerateSpec_TransportErrorFallsBack(t *testing.T) {
	f := &FakeModel{Err: errors.New("simulated timeout")}
	_, err := GenerateSpec(context.Background(), f, msgs())
	if !errors.Is(err, ErrFallback) {
		t.Fatalf("want ErrFallback on transport error, got %v", err)
	}
	if got := f.Calls(); got != 1 {
		t.Fatalf("want exactly 1 model call on transport error, got %d", got)
	}
}

func TestGenerateSpec_MalformedJSONRepairs(t *testing.T) {
	f := &FakeModel{Responses: []json.RawMessage{
		json.RawMessage(`{"ops": not-json`),
		validSpecJSON(t),
	}}
	ops, err := GenerateSpec(context.Background(), f, msgs())
	if err != nil {
		t.Fatalf("unexpected error after repair: %v", err)
	}
	if got := f.Calls(); got != 2 {
		t.Fatalf("want 2 calls, got %d", got)
	}
	if err := spec.Validate(ops); err != nil {
		t.Fatalf("ops invalid: %v", err)
	}
}

func TestSpecRequestSchema_ObjectRooted(t *testing.T) {
	var s map[string]any
	if err := json.Unmarshal(specRequestSchema(), &s); err != nil {
		t.Fatalf("schema is not valid JSON: %v", err)
	}
	if s["type"] != "object" {
		t.Fatalf("strict schema root must be object, got %v", s["type"])
	}
	if s["additionalProperties"] != false {
		t.Fatalf("strict schema must set additionalProperties:false")
	}
	props, ok := s["properties"].(map[string]any)
	if !ok || props["ops"] == nil {
		t.Fatalf("strict schema must carry an 'ops' property, got %v", s["properties"])
	}
}

func TestSpecRequestSchema_AssetKeyNullable(t *testing.T) {
	var s map[string]any
	if err := json.Unmarshal(specRequestSchema(), &s); err != nil {
		t.Fatalf("schema is not valid JSON: %v", err)
	}
	ops, _ := s["properties"].(map[string]any)["ops"].(map[string]any)
	items, _ := ops["items"].(map[string]any)
	opProps, _ := items["properties"].(map[string]any)
	ak, ok := opProps["asset_key"].(map[string]any)
	if !ok {
		t.Fatalf("build op schema must carry an asset_key property, got %v", opProps)
	}
	types := toStringSet(ak["type"])
	if !types["string"] || !types["null"] {
		t.Fatalf("asset_key must be nullable string, got type %v", ak["type"])
	}
}

func TestSpecRequestSchema_StrictCompliant(t *testing.T) {
	var root any
	if err := json.Unmarshal(specRequestSchema(), &root); err != nil {
		t.Fatalf("schema is not valid JSON: %v", err)
	}
	assertStrict(t, root, "$")
}

func assertStrict(t *testing.T, node any, path string) {
	t.Helper()
	obj, ok := node.(map[string]any)
	if !ok {
		return
	}
	if obj["type"] == "object" {
		if obj["additionalProperties"] != false {
			t.Fatalf("%s: object must set additionalProperties:false", path)
		}
		props, _ := obj["properties"].(map[string]any)
		required := toStringSet(obj["required"])
		for name := range props {
			if !required[name] {
				t.Fatalf("%s: strict mode requires property %q to be in 'required'", path, name)
			}
		}
		if len(required) != len(props) {
			t.Fatalf("%s: 'required' (%d) must list exactly the properties (%d)", path, len(required), len(props))
		}
	}
	if props, ok := obj["properties"].(map[string]any); ok {
		for name, v := range props {
			assertStrict(t, v, path+"."+name)
		}
	}
	if items, ok := obj["items"]; ok {
		assertStrict(t, items, path+"[]")
	}
}

func toStringSet(v any) map[string]bool {
	out := map[string]bool{}
	if list, ok := v.([]any); ok {
		for _, e := range list {
			if s, ok := e.(string); ok {
				out[s] = true
			}
		}
	}
	return out
}
