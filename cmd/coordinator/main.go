// Command coordinator runs the SwarmBuild coordinator against the NATS bus named
// by NATS_URL. It is the live brain behind the dashboard: it loads the scripted
// demo scenario from the demo package (the lunar habitat dome, the six-rover
// swarm, and the reproducible rehearsal kill) and spawns the in-process rovers
// that build it — including the kill → self-heal money shot, paced so a
// first-time viewer can read it (slice 06).
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/demo"
	"syscall"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if err := run(); err != nil {
		slog.Error("coordinator failed", "error", err)
		os.Exit(1)
	}
}

// run loads the scripted demo scenario and runs the coordinator until the
// context is cancelled. It is split out from main so the deferred signal stop
// runs before the process exits on error.
func run() error {
	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = "nats://127.0.0.1:4222"
	}

	// The whole demo — board, swarm, pacing, and the scripted kill — comes from
	// the demo package, the single server-authoritative home for the
	// choreography. Every visual beat the browser draws is triggered by a real
	// engine event emitted while this scenario runs; demo only sets WHEN the
	// rehearsal kill fires and HOW WIDE the timing windows are.
	cfg := demo.DomeScenario(natsURL, demo.Rehearsal())

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	slog.Info("coordinator starting", "nats_url", natsURL)
	if err := coordinator.Run(ctx, cfg); err != nil && ctx.Err() == nil {
		return err
	}
	slog.Info("coordinator shut down")
	return nil
}
