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

func run() error {
	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = "nats://127.0.0.1:4222"
	}

	cfg := demo.Scenario(natsURL, demo.External())

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	slog.Info("coordinator starting", "nats_url", natsURL)
	if err := coordinator.Run(ctx, cfg); err != nil && ctx.Err() == nil {
		return err
	}
	slog.Info("coordinator shut down")
	return nil
}
