package main

import (
	"context"
	"errors"
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

func run() error {
	var (
		mode      = flag.String("mode", "inproc", "rover host: inproc|container (container = standalone)")
		id        = flag.String("id", "R1", "rover id")
		posX      = flag.Float64("x", 0, "rover start X position")
		posY      = flag.Float64("y", 0, "rover start Y position")
		battery   = flag.Float64("battery", 1.0, "rover battery in (0,1]")
		caps      = flag.String("capabilities", "foundation", "comma-separated capabilities")
		hbMS      = flag.Int("heartbeat-ms", 500, "heartbeat interval in milliseconds")
		opEveryMS = flag.Int("op-every-ms", 0, "build-op pacing: ms between emitted ops while working a Task (0 = brisk default; widen for the cinematic so the dome rises across the establishing beats)")
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
		OpEvery:           time.Duration(*opEveryMS) * time.Millisecond,
		RecoverAfter:      time.Duration(*recoverMS) * time.Millisecond,
		SettleAfterRevive: time.Duration(*settleMS) * time.Millisecond,
	}

	wantLive := strings.EqualFold(*buildMode, string(agent.ModeLive))
	if builder, ok := buildLiveFromEnv(); ok {
		cfg.LiveBuilder = builder
		if wantLive {
			cfg.Mode = agent.ModeLive
			slog.Info("rover build mode: live (whole-rover default)", "rover", cfg.ID)
		} else {
			slog.Info("rover live-capable: a per-Task live tag opts in (default replay)", "rover", cfg.ID)
		}
	} else if wantLive {
		return errors.New("--build-mode=live requires an API key (set OPENAI_API_KEY or GEMINI_API_KEY, optionally LAB_PROVIDER)")
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

func buildLiveFromEnv() (*live.Builder, bool) {
	provider := strings.ToLower(getenv("LAB_PROVIDER", "openai"))
	modelID := getenv("LAB_MODEL", "gpt-4o-2024-08-06")
	apiKey, baseURL := keyAndBaseURL(provider)
	if apiKey == "" {
		return nil, false
	}
	m, err := model.NewOpenAI(model.Config{
		Provider: provider,
		BaseURL:  baseURL,
		Model:    modelID,
		APIKey:   apiKey,
	})
	if err != nil {
		slog.Warn("live build requested but Model seam init failed; staying replay", "error", err)
		return nil, false
	}
	return live.NewBuilder(m, provider, modelID), true
}

func keyAndBaseURL(provider string) (apiKey, baseURL string) {
	switch provider {
	case "gemini":
		return os.Getenv("GEMINI_API_KEY"), model.BaseURLGemini
	case "local":
		k := os.Getenv("OPENAI_API_KEY")
		if k == "" {
			k = "ollama"
		}
		return k, model.BaseURLLocal
	default:
		return os.Getenv("OPENAI_API_KEY"), model.BaseURLOpenAI
	}
}

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
