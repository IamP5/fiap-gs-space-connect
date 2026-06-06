package vision

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"swarmbuild/internal/harness/evaluator"
	"testing"
)

// fakeVisionModel is a deterministic, NO-NETWORK vision.Model: it returns a scripted
// raw JSON response (or a configured error), and records the last request so a test
// can assert the screenshot bytes and strict schema actually reached the seam. It
// keeps the vision unit suite hermetic — no api.openai.com, no browser.
type fakeVisionModel struct {
	resp    json.RawMessage
	err     error
	lastReq modelRequest
	calls   int
}

func (f *fakeVisionModel) Generate(_ context.Context, req modelRequest) (json.RawMessage, error) {
	f.calls++
	f.lastReq = req
	if f.err != nil {
		return nil, f.err
	}
	return f.resp, nil
}

// sampleScreenshot loads the committed deterministic sample PNG fixture, so the
// unit suite scores a real (tiny) image without ever opening a browser.
func sampleScreenshot(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "sample_render.png"))
	if err != nil {
		t.Fatalf("read sample screenshot fixture: %v", err)
	}
	if len(b) == 0 {
		t.Fatal("sample screenshot fixture is empty")
	}
	return b
}

func scoreJSON(t *testing.T, score int, evidence string) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(silhouetteResponse{Score: score, Evidence: evidence})
	if err != nil {
		t.Fatalf("marshal score fixture: %v", err)
	}
	return b
}

// TestScoreSilhouette_ProducesScoreAndEvidence: a FakeModel + a fixed sample image
// yields a silhouette Score+evidence, and the screenshot + strict schema reached the
// model seam (the round-trip the bake-time vision pass relies on).
func TestScoreSilhouette_ProducesScoreAndEvidence(t *testing.T) {
	png := sampleScreenshot(t)
	fm := &fakeVisionModel{resp: scoreJSON(t, 2, "reads clearly as a domed cap with a coherent silhouette")}

	got, err := ScoreSilhouette(context.Background(), fm, png, Intent{
		TaskType:    "dome-cap",
		Description: "a keystone ring topped by a cap, closing the dome",
	})
	if err != nil {
		t.Fatalf("ScoreSilhouette: %v", err)
	}
	if got.Score != 2 {
		t.Fatalf("want score 2, got %d", got.Score)
	}
	if got.Evidence == "" {
		t.Fatal("want non-empty evidence")
	}

	// The screenshot bytes must have ridden the user message as an image part.
	if fm.calls != 1 {
		t.Fatalf("want exactly 1 vision call, got %d", fm.calls)
	}
	var sawImage bool
	for _, m := range fm.lastReq.Messages {
		if len(m.Images) > 0 {
			if string(m.Images[0]) != string(png) {
				t.Fatal("the screenshot bytes did not round-trip to the model seam")
			}
			sawImage = true
		}
	}
	if !sawImage {
		t.Fatal("the vision request carried no image part")
	}
	if fm.lastReq.SchemaName != "silhouette" || len(fm.lastReq.Schema) == 0 {
		t.Fatalf("the vision request must carry the strict silhouette schema, got name=%q schema=%s", fm.lastReq.SchemaName, fm.lastReq.Schema)
	}
}

// TestScoreSilhouette_AsRubricScore: the vision Score drops into the evaluator's
// soft-rubric Silhouette dimension unchanged (the coupling ADR-0008 defines).
func TestScoreSilhouette_AsRubricScore(t *testing.T) {
	got, err := ScoreSilhouette(context.Background(), &fakeVisionModel{resp: scoreJSON(t, 1, "ambiguous massing")},
		sampleScreenshot(t), Intent{TaskType: "wall"})
	if err != nil {
		t.Fatalf("ScoreSilhouette: %v", err)
	}
	rubric := got.AsRubricScore()
	want := evaluator.Score{Score: 1, Evidence: "ambiguous massing"}
	if rubric != want {
		t.Fatalf("AsRubricScore mismatch: got %+v want %+v", rubric, want)
	}
}

// TestScoreSilhouette_ClampsOutOfRange: a beta compat layer (Gemini) might emit a
// score outside 0–2; it is clamped into the rubric band (defensive — strict mode
// should prevent it, but we never trust a beta endpoint).
func TestScoreSilhouette_ClampsOutOfRange(t *testing.T) {
	for _, tc := range []struct {
		raw, want int
	}{{-3, 0}, {0, 0}, {2, 2}, {7, 2}} {
		got, err := ScoreSilhouette(context.Background(), &fakeVisionModel{resp: scoreJSON(t, tc.raw, "x")},
			sampleScreenshot(t), Intent{TaskType: "foundation"})
		if err != nil {
			t.Fatalf("ScoreSilhouette(%d): %v", tc.raw, err)
		}
		if got.Score != tc.want {
			t.Fatalf("score %d clamped to %d, want %d", tc.raw, got.Score, tc.want)
		}
	}
}

// TestScoreSilhouette_UnavailableIsNonFatal: a nil model, an empty screenshot, a
// transport error, and an unparseable response all surface ErrVisionUnavailable so
// the bake caller degrades gracefully (the soft rubric never blocks — ADR-0008).
func TestScoreSilhouette_UnavailableIsNonFatal(t *testing.T) {
	png := sampleScreenshot(t)

	if _, err := ScoreSilhouette(context.Background(), nil, png, Intent{}); !errors.Is(err, ErrVisionUnavailable) {
		t.Fatalf("nil model: want ErrVisionUnavailable, got %v", err)
	}
	if _, err := ScoreSilhouette(context.Background(), &fakeVisionModel{resp: scoreJSON(t, 2, "x")}, nil, Intent{}); !errors.Is(err, ErrVisionUnavailable) {
		t.Fatalf("empty screenshot: want ErrVisionUnavailable, got %v", err)
	}
	transport := &fakeVisionModel{err: errors.New("429 rate limited")}
	if _, err := ScoreSilhouette(context.Background(), transport, png, Intent{}); !errors.Is(err, ErrVisionUnavailable) {
		t.Fatalf("transport error: want ErrVisionUnavailable, got %v", err)
	}
	garbage := &fakeVisionModel{resp: json.RawMessage(`not json`)}
	if _, err := ScoreSilhouette(context.Background(), garbage, png, Intent{}); !errors.Is(err, ErrVisionUnavailable) {
		t.Fatalf("unparseable response: want ErrVisionUnavailable, got %v", err)
	}
}

// TestSilhouetteSchema_StrictObjectRoot: the request schema is an object-rooted
// strict schema (the bh-03 finding: OpenAI strict mode requires an object root with
// every property required and additionalProperties:false).
func TestSilhouetteSchema_StrictObjectRoot(t *testing.T) {
	var schema map[string]any
	if err := json.Unmarshal(silhouetteSchema(), &schema); err != nil {
		t.Fatalf("schema is not valid JSON: %v", err)
	}
	if schema["type"] != "object" {
		t.Fatalf("strict schema root must be an object, got %v", schema["type"])
	}
	if ap, ok := schema["additionalProperties"].(bool); !ok || ap {
		t.Fatalf("strict schema must set additionalProperties:false, got %v", schema["additionalProperties"])
	}
	req, ok := schema["required"].([]any)
	if !ok || len(req) != 2 {
		t.Fatalf("strict schema must require every property (score, evidence), got %v", schema["required"])
	}
}
