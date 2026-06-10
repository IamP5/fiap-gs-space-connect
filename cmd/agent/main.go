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
