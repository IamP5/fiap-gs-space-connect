// Command killer runs the SwarmBuild killer sidecar (the container Encore of
// ADR-0001): the one process allowed to touch docker.sock. It joins the swarm bus
// as a plain NATS client, listens for the dashboard's killContainer control, and
// does a real `docker kill` on the mapped container so its Lease TTL-expires and
// the swarm Self-heals by Re-auction over the real bus. The browser never touches
// docker.sock — it only emits the control frame; this sidecar is the sole holder
// of the socket (see deploy/docker-compose.yml).
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/killer"
	"syscall"
	"time"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if err := run(); err != nil {
		slog.Error("killer failed", "error", err)
		os.Exit(1)
	}
}

// run wires the sidecar from flags/env, connects to the bus, and serves until the
// context is cancelled. It is split out from main so the deferred cleanup (signal
// stop, connection close) actually runs before the process exits on error — a
// fatal log inside main would skip every defer (mirrors cmd/agent/main.go).
func run() error {
	var (
		targets = flag.String("targets", "", "robot→container allowlist, e.g. R7=swarmbuild-rover-encore (comma-separated); overrides KILLER_TARGETS")
		natsURL = flag.String("nats-url", "", "NATS URL (overrides NATS_URL env)")
	)
	flag.Parse()

	spec := *targets
	if spec == "" {
		spec = os.Getenv("KILLER_TARGETS")
	}
	allowlist, err := killer.ParseTargets(spec)
	if err != nil {
		return err
	}

	url := *natsURL
	if url == "" {
		url = os.Getenv("NATS_URL")
	}
	if url == "" {
		url = "nats://127.0.0.1:4222"
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	slog.Info("killer connecting", "nats_url", url, "targets", len(allowlist))
	conn, err := bus.Connect(ctx, url, bus.ConnectOptions{
		Name:    "killer",
		MaxWait: 30 * time.Second,
	})
	if err != nil {
		return err
	}
	defer conn.Close()

	if err := killer.Run(ctx, conn, killer.Config{
		Targets: allowlist,
		Kill:    killer.DockerKill,
	}); err != nil && ctx.Err() == nil {
		return err
	}
	slog.Info("killer shut down")
	return nil
}
