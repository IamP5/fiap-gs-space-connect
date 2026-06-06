// Command gateway runs the SwarmBuild WS Gateway: it tails NATS world snapshots
// and fans them out to browser WebSocket clients, and relays browser control
// messages back onto NATS. The browser never speaks NATS — only this gateway
// does (TECHSPEC §3/§4).
//
// It ALSO hosts the in-app LIVE lab (bh-07a): when an API key is present at
// startup (OPENAI_API_KEY / GEMINI_API_KEY), it constructs the lab Service from
// internal/harness/lab and injects it into the gateway, enabling the
// /lab/generate SSE endpoint that streams a real Generator↔Evaluator run to the
// dashboard. The lab is reached ONLY through this gateway-side seam and never
// touches the World Model — it is strictly off the headline/hot path (ADR-0005):
// the snapshot fan-out makes zero model calls and the archtest enforces that the
// hot-path packages never import the lab/model.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/gateway"
	"swarmbuild/internal/harness/lab"
	"swarmbuild/internal/harness/model"
	"syscall"
	"time"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if err := run(); err != nil {
		slog.Error("gateway failed", "error", err)
		os.Exit(1)
	}
}

// run connects to NATS, serves the WebSocket fan-out, and blocks until the
// context is cancelled, then drains gracefully. It is split out from main so the
// deferred cleanup (signal stop, connection close, fan-out stop) actually runs
// before the process exits on error.
func run() error {
	natsURL := getenv("NATS_URL", "nats://127.0.0.1:4222")
	addr := getenv("GATEWAY_ADDR", ":8080")

	// Graceful shutdown on SIGINT/SIGTERM.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	slog.Info("gateway connecting", "nats_url", natsURL)
	conn, err := bus.Connect(ctx, natsURL, bus.ConnectOptions{Name: "gateway"})
	if err != nil {
		return err
	}
	defer conn.Close()

	g, stopFanout, err := gateway.Run(ctx, conn)
	if err != nil {
		return err
	}
	defer func() { _ = stopFanout() }()

	// Optional in-app live lab (bh-07a). Constructed only when an API key is present
	// (read from the environment / a best-effort .env, server-side ONLY — never sent
	// to the browser). Absent ⇒ the lab routes 503 and the headline runs unchanged.
	if runner := buildLab(); runner != nil {
		g.WithLab(runner)
		slog.Info("in-app live lab ENABLED", "endpoint", "/lab/generate", "provider", runner.provider, "model", runner.modelID)
	} else {
		slog.Info("in-app live lab disabled (no API key); /lab routes will 503")
	}

	listenAddr, shutdown, err := g.ListenAndServe(ctx, addr)
	if err != nil {
		return err
	}
	slog.Info("gateway serving", "addr", listenAddr, "ws", "ws://"+listenAddr+"/ws", "health", "/healthz")

	<-ctx.Done()
	slog.Info("gateway shutting down")

	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := shutdown(sctx); err != nil {
		slog.Error("gateway shutdown", "error", err)
	}
	return nil
}

// labRunner adapts the lab Service onto the gateway's LabRunner seam: it decodes
// the SSE request body into a lab.Request, bridges the gateway's SSEWriter into a
// lab.Sink, and bounds each run with a timeout so a hung provider can't pin the
// connection forever. It carries the provider/model labels for startup logging.
type labRunner struct {
	svc      *lab.Service
	provider string
	modelID  string
	timeout  time.Duration
}

// labSink bridges the gateway SSEWriter into the lab.Sink the Service streams to:
// each lab.Event is marshalled to JSON and written as one SSE frame.
type labSink struct{ w gateway.SSEWriter }

func (s labSink) Send(e lab.Event) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	return s.w.Send(b)
}

// Run decodes the request, applies a per-run timeout, and streams the live loop's
// events to w. A decode failure is surfaced as a single error event on the stream
// (the HTTP status is already 200 for SSE).
func (r labRunner) Run(ctx context.Context, reqBody []byte, w gateway.SSEWriter) error {
	var req lab.Request
	if err := json.Unmarshal(reqBody, &req); err != nil {
		return w.Send([]byte(`{"kind":"error","reason":"invalid lab request body"}`))
	}
	rctx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	return r.svc.Run(rctx, req, labSink{w: w})
}

// CatalogJSON returns the selectable Task-type list for the Lab dropdown.
func (r labRunner) CatalogJSON() []byte {
	b, _ := json.Marshal(lab.Catalog())
	return b
}

// buildLab constructs the live lab runner from the environment, or nil when no
// API key is configured (so the gateway still serves the headline without one).
// The key is read server-side ONLY and never logged or shipped to the browser.
func buildLab() *labRunner {
	loadDotEnv(".env") // best-effort; a missing/empty .env is fine

	provider := strings.ToLower(getenv("LAB_PROVIDER", "openai"))
	modelID := getenv("LAB_MODEL", "gpt-4o-2024-08-06")

	apiKey, baseURL := keyAndBaseURL(provider)
	if apiKey == "" {
		return nil
	}
	m, err := model.NewOpenAI(model.Config{
		Provider: provider,
		BaseURL:  baseURL,
		Model:    modelID,
		APIKey:   apiKey,
	})
	if err != nil {
		slog.Warn("lab disabled: model adapter init failed", "error", err)
		return nil
	}
	return &labRunner{
		svc:      lab.NewService(m, provider, modelID),
		provider: provider,
		modelID:  modelID,
		timeout:  90 * time.Second,
	}
}

// keyAndBaseURL resolves the API key + OpenAI-compatible base_url for a provider
// from the environment, mirroring cmd/bake's provider swap.
func keyAndBaseURL(provider string) (apiKey, baseURL string) {
	switch provider {
	case "gemini":
		return os.Getenv("GEMINI_API_KEY"), model.BaseURLGemini
	case "local":
		// Ollama needs no real key; accept a placeholder so the adapter's non-empty
		// check passes.
		k := os.Getenv("OPENAI_API_KEY")
		if k == "" {
			k = "ollama"
		}
		return k, model.BaseURLLocal
	default:
		return os.Getenv("OPENAI_API_KEY"), model.BaseURLOpenAI
	}
}

// loadDotEnv loads KEY=VALUE lines from path into the process environment WITHOUT
// overriding already-set variables, and never logs values. A missing file is a
// silent no-op. It exists only so the live-lab manual step is convenient; the key
// stays server-side.
func loadDotEnv(path string) {
	f, err := os.Open(path) //nolint:gosec // operator-supplied local .env path
	if err != nil {
		return
	}
	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.Trim(strings.TrimSpace(val), `"'`)
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		_ = os.Setenv(key, val)
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
