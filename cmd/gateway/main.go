// Command gateway runs the SwarmBuild WS Gateway: it tails NATS world snapshots
// and fans them out to browser WebSocket clients, and relays browser control
// messages back onto NATS. The browser never speaks NATS — only this gateway
// does (TECHSPEC §3/§4).
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/gateway"
	"syscall"
	"time"
)

func main() {
	natsURL := getenv("NATS_URL", "nats://127.0.0.1:4222")
	addr := getenv("GATEWAY_ADDR", ":8080")

	// Graceful shutdown on SIGINT/SIGTERM.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Printf("gateway: connecting to NATS at %s", natsURL)
	conn, err := bus.Connect(ctx, natsURL, bus.ConnectOptions{Name: "gateway"})
	if err != nil {
		log.Fatalf("gateway: connect NATS: %v", err)
	}
	defer conn.Close()

	g, stopFanout, err := gateway.Run(ctx, conn)
	if err != nil {
		log.Fatalf("gateway: subscribe snapshots: %v", err)
	}
	defer func() { _ = stopFanout() }()

	listenAddr, shutdown, err := g.ListenAndServe(ctx, addr)
	if err != nil {
		log.Fatalf("gateway: listen %s: %v", addr, err)
	}
	log.Printf("gateway: serving WebSocket on ws://%s/ws (health: /healthz)", listenAddr)

	<-ctx.Done()
	log.Printf("gateway: shutting down")

	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := shutdown(sctx); err != nil {
		log.Printf("gateway: shutdown: %v", err)
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
