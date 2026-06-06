// Command agent runs a single SwarmBuild rover as a standalone NATS client
// (--mode=container, the encore of ADR-0001). The same Robot Agent code runs
// in-process inside the coordinator (--mode=inproc); this binary is the
// container host. The coordinator cannot tell which host a rover runs in — that
// equivalence is the point.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/live"
	"swarmbuild/internal/harness/model"
	"syscall"
	"time"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if err := run(); err != nil {
		slog.Error("agent failed", "error", err)
		os.Exit(1)
	}
}

// run wires the rover from flags, connects to the bus, and drives it until the
// context is cancelled. It is split out from main so the deferred cleanup
// (signal stop, connection close) actually runs before the process exits on
// error — a fatal log inside main would skip every defer.
func run() error {
	var (
		mode      = flag.String("mode", "inproc", "rover host: inproc|container (container = standalone)")
		id        = flag.String("id", "R1", "rover id")
		posX      = flag.Float64("x", 0, "rover start X position")
		posY      = flag.Float64("y", 0, "rover start Y position")
		battery   = flag.Float64("battery", 1.0, "rover battery in (0,1]")
		caps      = flag.String("capabilities", "foundation", "comma-separated capabilities")
		hbMS      = flag.Int("heartbeat-ms", 500, "heartbeat interval in milliseconds")
		recoverMS = flag.Int("recover-ms", 6000, "recoverable-outage window: ms a killed rover stays down before reviving in place")
		settleMS  = flag.Int("settle-ms", 2500, "post-revival settle window: ms a revived rover holds station before bidding again")
		natsURL   = flag.String("nats-url", "", "NATS URL (overrides NATS_URL env)")
		buildMode = flag.String("build-mode", "replay", "rover Build mode: replay (cache/primitive, no model call) | live (run the harness inline via the Model seam)")
	)
	flag.Parse()

	url := *natsURL
	if url == "" {
		url = os.Getenv("NATS_URL")
	}
	if url == "" {
		url = "nats://127.0.0.1:4222"
	}

	cfg := agent.Config{
		ID:                domain.RobotID(*id),
		Pos:               domain.Vec2{X: *posX, Y: *posY},
		Battery:           *battery,
		Capabilities:      parseCapabilities(*caps),
		HeartbeatEvery:    time.Duration(*hbMS) * time.Millisecond,
		RecoverAfter:      time.Duration(*recoverMS) * time.Millisecond,
		SettleAfterRevive: time.Duration(*settleMS) * time.Millisecond,
	}

	// Live Build Mode (bh-08): opt-in inline generation. The composition root reads
	// the API key SERVER-SIDE (env-sourced via model.Config.APIKey) and constructs
	// the model-backed LiveBuilder; the agent package never imports the Model seam.
	// Replay (the default) is byte-for-byte the pre-08 path with ZERO model calls.
	if strings.EqualFold(*buildMode, string(agent.ModeLive)) {
		builder, err := buildLive()
		if err != nil {
			return err
		}
		cfg.Mode = agent.ModeLive
		cfg.LiveBuilder = builder
		slog.Info("rover build mode: live", "rover", cfg.ID)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	slog.Info("agent connecting", "rover", cfg.ID, "mode", *mode, "nats_url", url)
	conn, err := bus.Connect(ctx, url, bus.ConnectOptions{
		Name:    "rover-" + *id,
		MaxWait: 30 * time.Second,
	})
	if err != nil {
		return err
	}
	defer conn.Close()

	if err := agent.Run(ctx, cfg, conn); err != nil && ctx.Err() == nil {
		return err
	}
	slog.Info("agent shut down", "rover", cfg.ID)
	return nil
}

// buildLive constructs the live Build harness seam from the environment. The API
// key is read SERVER-SIDE ONLY (env-sourced via model.Config.APIKey) and never
// logged or shipped to the browser (ADR-0005 / bh-08). It mirrors cmd/{bake,
// gateway}'s provider swap: LAB_PROVIDER / LAB_MODEL select the provider + model,
// and the matching *_API_KEY authenticates it. A missing key is a hard error
// here (live mode was explicitly requested), unlike the gateway where the lab is
// optional.
func buildLive() (*live.Builder, error) {
	provider := strings.ToLower(getenv("LAB_PROVIDER", "openai"))
	modelID := getenv("LAB_MODEL", "gpt-4o-2024-08-06")
	apiKey, baseURL := keyAndBaseURL(provider)

	m, err := model.NewOpenAI(model.Config{
		Provider: provider,
		BaseURL:  baseURL,
		Model:    modelID,
		APIKey:   apiKey, // server-side only; never reaches the browser
	})
	if err != nil {
		return nil, err
	}
	return live.NewBuilder(m, provider, modelID), nil
}

// keyAndBaseURL resolves the API key + OpenAI-compatible base_url for a provider
// from the environment, mirroring cmd/{bake,gateway}'s provider swap.
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

// getenv returns the environment value for key, or def when it is unset/empty.
func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func parseCapabilities(s string) []domain.Capability {
	parts := strings.Split(s, ",")
	out := make([]domain.Capability, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, domain.Capability(p))
		}
	}
	return out
}
