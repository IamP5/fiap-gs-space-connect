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
		mode    = flag.String("mode", "inproc", "rover host: inproc|container (container = standalone)")
		id      = flag.String("id", "R1", "rover id")
		posX    = flag.Float64("x", 0, "rover start X position")
		posY    = flag.Float64("y", 0, "rover start Y position")
		battery = flag.Float64("battery", 1.0, "rover battery in (0,1]")
		caps    = flag.String("capabilities", "foundation", "comma-separated capabilities")
		hbMS    = flag.Int("heartbeat-ms", 500, "heartbeat interval in milliseconds")
		natsURL = flag.String("nats-url", "", "NATS URL (overrides NATS_URL env)")
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
		ID:             domain.RobotID(*id),
		Pos:            domain.Vec2{X: *posX, Y: *posY},
		Battery:        *battery,
		Capabilities:   parseCapabilities(*caps),
		HeartbeatEvery: time.Duration(*hbMS) * time.Millisecond,
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
