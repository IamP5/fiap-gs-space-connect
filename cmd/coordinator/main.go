// Command coordinator runs the SwarmBuild coordinator against the NATS bus named
// by NATS_URL. It is the live brain behind the dashboard: it loads the scripted
// demo scenario from the demo package (the lunar habitat dome, the six-rover
// swarm, and the reproducible rehearsal kill) and spawns the in-process rovers
// that build it — including the kill → self-heal money shot, paced so a
// first-time viewer can read it (slice 06).
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/demo"
)

func main() {
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

	log.Printf("coordinator: starting against %s", natsURL)
	if err := coordinator.Run(ctx, cfg); err != nil && ctx.Err() == nil {
		log.Fatalf("coordinator: %v", err)
	}
	log.Printf("coordinator: shut down")
}
