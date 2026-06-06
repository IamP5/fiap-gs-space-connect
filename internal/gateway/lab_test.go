package gateway_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"swarmbuild/internal/gateway"
	"testing"
)

// fakeBus satisfies the gateway's busConn needs for a handler-only test (no NATS):
// Connected/PublishJSON are never exercised by the lab routes.
type fakeBus struct{}

func (fakeBus) PublishJSON(string, any) error { return nil }
func (fakeBus) Connected() bool               { return true }

// fakeLab is a deterministic LabRunner: it streams a fixed started→ops→verdict→done
// sequence so the SSE plumbing can be tested without a model call.
type fakeLab struct{ catalog string }

func (f fakeLab) Run(_ context.Context, _ []byte, w gateway.SSEWriter) error {
	for _, frame := range []string{
		`{"kind":"started","task_type":"foundation"}`,
		`{"kind":"ops","iter":1}`,
		`{"kind":"verdict","iter":1,"pass":true}`,
		`{"kind":"done","result":"accepted"}`,
	} {
		if err := w.Send([]byte(frame)); err != nil {
			return err
		}
	}
	return nil
}

func (f fakeLab) CatalogJSON() []byte { return []byte(f.catalog) }

// do issues a context-bound request (satisfying the noctx linter) and returns the
// response for the test to inspect/close.
func do(t *testing.T, method, url, body string) *http.Response {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, url, r)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	return resp
}

func TestServeLabGenerate_StreamsSSEFrames(t *testing.T) {
	g := gateway.New(fakeBus{}).WithLab(fakeLab{catalog: `[]`})
	srv := httptest.NewServer(g.Handler())
	defer srv.Close()

	resp := do(t, http.MethodPost, srv.URL+"/lab/generate", `{"task_type":"foundation"}`)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("content-type = %q, want text/event-stream", ct)
	}

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	body := string(raw)

	// Each event is one `data: {json}` SSE frame, in order.
	for _, want := range []string{
		`data: {"kind":"started"`,
		`data: {"kind":"ops"`,
		`data: {"kind":"verdict"`,
		`data: {"kind":"done"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("SSE body missing %q\n--- body ---\n%s", want, body)
		}
	}
}

func TestServeLabGenerate_503WhenNoRunner(t *testing.T) {
	g := gateway.New(fakeBus{}) // no WithLab
	srv := httptest.NewServer(g.Handler())
	defer srv.Close()

	resp := do(t, http.MethodPost, srv.URL+"/lab/generate", `{}`)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when no lab runner", resp.StatusCode)
	}
}

func TestServeLabCatalog_ReturnsRunnerJSON(t *testing.T) {
	g := gateway.New(fakeBus{}).WithLab(fakeLab{catalog: `[{"type":"foundation","label":"F"}]`})
	srv := httptest.NewServer(g.Handler())
	defer srv.Close()

	resp := do(t, http.MethodGet, srv.URL+"/lab/catalog", "")
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(raw), `"foundation"`) {
		t.Fatalf("catalog body = %q, want it to contain the runner JSON", string(raw))
	}
}

func TestServeLabGenerate_RejectsGET(t *testing.T) {
	g := gateway.New(fakeBus{}).WithLab(fakeLab{catalog: `[]`})
	srv := httptest.NewServer(g.Handler())
	defer srv.Close()

	resp := do(t, http.MethodGet, srv.URL+"/lab/generate", "")
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405 for GET", resp.StatusCode)
	}
}

func TestServeLabGenerate_AnswersCORSPreflight(t *testing.T) {
	// The browser dashboard (e.g. :5173) POSTs application/json to the gateway
	// (:8080) cross-origin — under a k8s port-forward or docker-compose — so it
	// sends an OPTIONS preflight first. The gateway must answer with permissive
	// CORS headers, or the browser blocks the live lab run.
	g := gateway.New(fakeBus{}).WithLab(fakeLab{catalog: `[]`})
	srv := httptest.NewServer(g.Handler())
	defer srv.Close()

	resp := do(t, http.MethodOptions, srv.URL+"/lab/generate", "")
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Allow-Origin = %q, want *", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(got, "POST") {
		t.Fatalf("Allow-Methods = %q, want it to allow POST", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Headers"); !strings.Contains(got, "Content-Type") {
		t.Fatalf("Allow-Headers = %q, want it to allow Content-Type", got)
	}
}
