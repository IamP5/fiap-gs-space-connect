// Command gateway runs the SwarmBuild WS Gateway: it tails NATS world snapshots
// and fans them out to browser WebSocket clients, and relays browser control
// messages back onto NATS. The browser never speaks NATS — only this gateway
// does (TECHSPEC §3/§4).
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/gateway"
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

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
