package model

import (
	"context"
	"encoding/json"
	"errors"
	"swarmbuild/internal/harness/spec"
	"swarmbuild/internal/wire"
	"testing"
)

// validSpecJSON is a well-formed strict-output envelope: one box op that passes
// spec.Validate. Used as the "model got it right" response.
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
	// Sanity: the fixture must itself be valid, else the test proves nothing.
	if err := spec.Validate(ops); err != nil {
		t.Fatalf("valid fixture failed validation: %v", err)
	}
	b, err := json.Marshal(specResponse{Ops: ops})
	if err != nil {
		t.Fatalf("marshal valid fixture: %v", err)
	}
	return b
}

// invalidSpecJSON is a structurally-decodable but schema-INVALID envelope: a
// degenerate zero scale, which spec.Validate rejects. It drives the repair path.
func invalidSpecJSON(t *testing.T) json.RawMessage {
	t.Helper()
	ops := []wire.BuildOp{{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeBox,
		Pos:      vec(0, 0, 0),
		Rot:      vec(0, 0, 0),
		Scale:    vec(0, 0, 0), // invalid: scale must be positive on every axis
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

// domainVec3 mirrors domain.Vec3's JSON shape (capital X/Y/Z) without importing
// the domain package into the test fixtures; wire.BuildOp's fields are
// domain.Vec3 so we alias it.
type domainVec3 = struct {
	X, Y, Z float64
}

func msgs() []Message {
	return []Message{
		{Role: "system", Content: "you build lunar habitat geometry"},
		{Role: "user", Content: "build a foundation"},
	}
}

// TestGenerateSpec_FirstTrySucceeds: a valid first response is returned as-is with
// exactly one Model call (no needless repair).
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

// TestGenerateSpec_RepairsOnce: an invalid first response, valid on the repair
// re-ask. Proves the validate-and-repair path: exactly two calls, valid ops out.
func TestGenerateSpec_RepairsOnce(t *testing.T) {
	f := &FakeModel{Responses: []json.RawMessage{
		invalidSpecJSON(t), // rejected → triggers one repair re-ask
		validSpecJSON(t),   // repaired
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

// TestGenerateSpec_FallbackOnExhaustion: invalid on BOTH the ask and the single
// repair. Proves exhaustion signals ErrFallback (the caller then uses the
// primitive geometry) and that we re-ask AT MOST once — exactly two calls.
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

// TestGenerateSpec_TransportErrorFallsBack: a provider/transport error is not
// repairable by re-asking, so GenerateSpec degrades to fallback immediately
// (a single call, no wasted repair).
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

// TestGenerateSpec_MalformedJSONRepairs: a non-decodable response is a repairable
// failure (re-ask once), then succeeds. Distinct from a schema-valid-but-wrong op.
func TestGenerateSpec_MalformedJSONRepairs(t *testing.T) {
	f := &FakeModel{Responses: []json.RawMessage{
		json.RawMessage(`{"ops": not-json`), // undecodable
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

// TestSpecRequestSchema_ObjectRooted asserts the strict request schema is an
// object with an "ops" array property and additionalProperties:false — the shape
// OpenAI strict mode requires (an array root is rejected by strict mode).
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

// TestSpecRequestSchema_StrictCompliant walks the whole schema and asserts every
// object node sets additionalProperties:false AND lists ALL its properties in
// "required" — the constraints OpenAI strict mode enforces. This is the guard
// that prevents a regression where an "optional" (omitted-from-required) field
// makes the API reject the schema and the live bake silently always falls back.
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
	// Recurse into nested schemas (properties values and array items).
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
