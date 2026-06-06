// Package vision is the SwarmBuild bake-time VISION PASS (TECHSPEC §5, issue 06,
// ADR-0008): the "evaluator looks at the running artifact" lever that closes the
// loop the analytic hard gate cannot — structures that are geometrically valid but
// LOOK WRONG. It renders a candidate Build spec by driving headless Chrome against
// the real Scene3D (render.go), screenshots it, and feeds the PNG to a
// vision-capable model through the Model seam to score the `silhouette` soft-rubric
// dimension (0–2 + evidence).
//
// LOAD-BEARING (ADR-0005): this package reaches the Model seam, so — exactly like
// loop/bake — it MUST stay OUT of the hot-path import closure. The archtest names
// it explicitly. The headline replays a frozen spec and makes ZERO vision/model
// calls; only the offline bake/lab path (cmd/bake) constructs a Scorer.
//
// The scoring orchestration here is provider-agnostic and FAKEABLE: it calls the
// narrow model.Model.Generate with a strict object-rooted JSON schema (the same
// strict-mode pattern the generation seam uses) and parses a {score, evidence}
// object. A FakeModel + a committed sample screenshot make the unit suite
// deterministic and network/browser-free; the LIVE render + LIVE vision call are
// explicit manual bake steps.
package vision

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"swarmbuild/internal/harness/evaluator"
)

// Score is the vision pass's silhouette verdict for one spec: a 0–2 quality score
// and a cited evidence string, in the same shape as an evaluator soft-rubric
// dimension so it drops straight into evaluator.Rubric.Silhouette.
type Score struct {
	Score    int    `json:"score"`
	Evidence string `json:"evidence"`
}

// AsRubricScore converts the vision Score into the evaluator's Score type (the
// silhouette rubric dimension). Kept as a method so the coupling between the two
// packages is one explicit, legible line at the call site.
func (s Score) AsRubricScore() evaluator.Score {
	return evaluator.Score{Score: s.Score, Evidence: s.Evidence}
}

// Intent describes what the rendered structure is SUPPOSED to read as, so the
// vision model judges silhouette against the contract rather than in a vacuum. It
// is built from the Build contract by the bake caller (task type + the done
// description). All fields are advisory prompt context; none are secret.
type Intent struct {
	TaskType    string // e.g. "foundation" | "wall" | "dome-cap"
	Description string // the contract's done-criteria description
	Style       string // optional style guidance
}

// Model is the narrow vision seam: the SAME model.Model.Generate contract, named
// locally so this package depends only on the method it uses (a text+image →
// structured-JSON call). The bake path passes the openai adapter; tests pass a
// fake. It is an interface (not model.Model) so the vision package's surface is
// exactly one method and a fake needs implement only that.
type Model interface {
	Generate(ctx context.Context, req modelRequest) (json.RawMessage, error)
}

// modelRequest mirrors model.Request's shape for the fields the vision pass sets:
// the chat messages (a user turn carrying the screenshot) and the strict response
// schema. It is a local alias-free struct so the vision package does not force the
// model package's exact Request type onto a fake; the adapter in scorer.go bridges
// to the real model.Request.
type modelRequest struct {
	Messages   []visionMessage
	SchemaName string
	Schema     json.RawMessage
}

// visionMessage is one chat message for the vision call: a role, text, and (on the
// user turn) the screenshot PNG bytes.
type visionMessage struct {
	Role    string
	Content string
	Images  [][]byte
}

// silhouetteResponse is the strict structured-output envelope the vision model
// emits: an object (OpenAI strict mode requires an object root) wrapping the 0–2
// score and the evidence. The field names match silhouetteSchema below.
type silhouetteResponse struct {
	Score    int    `json:"score"`
	Evidence string `json:"evidence"`
}

// ErrVisionUnavailable signals the vision pass could not produce a score (no model
// configured, a transport error, or an unparseable/out-of-range response). It is
// NON-FATAL by contract: the bake caller logs it and proceeds with the silhouette
// dimension left unscored — the analytic hard gate and the rest of the soft rubric
// still cache the spec (ADR-0008: the soft rubric never blocks).
var ErrVisionUnavailable = errors.New("vision: silhouette score unavailable")

// ScoreSilhouette runs the vision pass for one screenshot: it asks the model to
// score how well the rendered structure reads as the intended thing, parses the
// strict {score, evidence} object, clamps the score to 0–2, and returns it as a
// Score. A nil model, a transport error, or an unparseable response yields
// ErrVisionUnavailable (wrapping the cause) so the caller degrades gracefully.
//
// It makes exactly ONE model call (no repair loop — a silhouette judgement is not
// schema-repairable the way a Build spec is; a bad response simply leaves the
// dimension unscored). png is the rendered screenshot; intent is the contract
// context the score is judged against.
func ScoreSilhouette(ctx context.Context, m Model, png []byte, intent Intent) (Score, error) {
	if m == nil {
		return Score{}, fmt.Errorf("%w: no vision model configured", ErrVisionUnavailable)
	}
	if len(png) == 0 {
		return Score{}, fmt.Errorf("%w: empty screenshot", ErrVisionUnavailable)
	}

	req := modelRequest{
		Messages: []visionMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt(intent), Images: [][]byte{png}},
		},
		SchemaName: "silhouette",
		Schema:     silhouetteSchema(),
	}

	raw, err := m.Generate(ctx, req)
	if err != nil {
		return Score{}, fmt.Errorf("%w: provider call failed: %w", ErrVisionUnavailable, err)
	}

	var resp silhouetteResponse
	if uErr := json.Unmarshal(raw, &resp); uErr != nil {
		return Score{}, fmt.Errorf("%w: decode vision output: %w", ErrVisionUnavailable, uErr)
	}
	score := clampScore(resp.Score)
	evidence := strings.TrimSpace(resp.Evidence)
	if evidence == "" {
		evidence = fmt.Sprintf("vision score %d (no evidence returned)", score)
	}
	return Score{Score: score, Evidence: evidence}, nil
}

// clampScore forces an out-of-range model score into the rubric's 0–2 band (strict
// mode constrains it, but a beta OpenAI-compat layer — Gemini — may not enforce the
// enum, so we clamp defensively).
func clampScore(s int) int {
	switch {
	case s < 0:
		return 0
	case s > 2:
		return 2
	default:
		return s
	}
}

// systemPrompt pins the vision model's role: a strict art-director judging whether
// a rendered low-poly structure reads as the intended moon-base element, scoring
// 0–2 with concrete visual evidence.
const systemPrompt = "You are a strict art director reviewing a screenshot of a procedurally-generated " +
	"low-poly structure for a lunar-habitat construction game. You judge SILHOUETTE: does the rendered " +
	"shape read clearly as the intended structure when seen on stage? Score 0–2: " +
	"0 = unrecognizable / reads as a random blob or single block; " +
	"1 = roughly the right massing but ambiguous or unbalanced; " +
	"2 = clearly reads as the intended structure with a coherent, deliberate silhouette. " +
	"Return STRICT JSON: {\"score\": <0|1|2>, \"evidence\": \"<one concrete sentence citing what you see>\"}."

// userPrompt carries the contract intent so the score is judged against what the
// structure is SUPPOSED to be, not in a vacuum.
func userPrompt(intent Intent) string {
	var b strings.Builder
	fmt.Fprintf(&b, "This screenshot should read as a %q for a moon-base dome.", intent.TaskType)
	if intent.Description != "" {
		fmt.Fprintf(&b, " Intended structure: %s.", intent.Description)
	}
	if intent.Style != "" {
		fmt.Fprintf(&b, " Style: %s.", intent.Style)
	}
	b.WriteString(" Score its silhouette 0–2 and cite one concrete visual observation as evidence.")
	return b.String()
}

// silhouetteSchema returns the OpenAI strict-mode JSON Schema (object-rooted, every
// property required, additionalProperties:false) the vision model scores against:
// {"score": 0|1|2, "evidence": string}. Same strict-mode discipline as the
// generation seam's request schema (bh-03 finding: strict mode needs an object
// root with every prop required).
func silhouetteSchema() json.RawMessage {
	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"score":    map[string]any{"type": "integer", "enum": []int{0, 1, 2}},
			"evidence": map[string]any{"type": "string"},
		},
		"required":             sortedKeys("score", "evidence"),
		"additionalProperties": false,
	}
	out, err := json.Marshal(schema)
	if err != nil {
		panic(fmt.Sprintf("vision: cannot marshal silhouette schema: %v", err))
	}
	return out
}

// sortedKeys returns its arguments sorted, so the strict "required" array is stable
// across runs (the schema bytes are otherwise identical every call).
func sortedKeys(keys ...string) []string {
	out := append([]string(nil), keys...)
	sort.Strings(out)
	return out
}
