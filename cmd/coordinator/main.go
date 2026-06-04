// Command coordinator runs the SwarmBuild coordinator with a trivial 2-task
// skeleton blueprint and two in-process rovers, against the NATS bus named by
// NATS_URL. It is the live brain of issue 01's walking skeleton.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"swarmbuild/agent"
	"swarmbuild/coordinator"
	"swarmbuild/core/domain"
)

func main() {
	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = "nats://127.0.0.1:4222"
	}

	// Trivial 2-task blueprint: task-b depends on task-a. Both are "foundation"
	// type, which both rovers can perform, so the Planner withholds task-b until
	// task-a is DONE.
	blueprint := []coordinator.BlueprintTask{
		{
			Task: domain.Task{ID: "task-a", Type: "foundation"},
			Pos:  domain.Vec2{X: 0, Y: 0},
		},
		{
			Task: domain.Task{ID: "task-b", Type: "foundation", Deps: []domain.TaskID{"task-a"}},
			Pos:  domain.Vec2{X: 10, Y: 0},
		},
	}

	// Two rovers parked away from the worksite so each award triggers a visible
	// drive (slice 02). R1 starts nearer/fresher, so it is the clear lower-cost
	// winner and you watch it interpolate to task-a, work, then drive on to
	// task-b once the dependency clears; R2 idles far off as the standby bidder.
	rovers := []agent.Config{
		{
			ID:           "R1",
			Pos:          domain.Vec2{X: -6, Y: 14},
			Battery:      1.0,
			Capabilities: []domain.Capability{"foundation"},
		},
		{
			ID:           "R2",
			Pos:          domain.Vec2{X: 50, Y: 50},
			Battery:      0.6,
			Capabilities: []domain.Capability{"foundation"},
		},
	}

	cfg := coordinator.Config{
		NATSURL:        natsURL,
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  400 * time.Millisecond,
		HeartbeatEvery: 500 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     10,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Printf("coordinator: starting against %s", natsURL)
	if err := coordinator.Run(ctx, cfg); err != nil && ctx.Err() == nil {
		log.Fatalf("coordinator: %v", err)
	}
	log.Printf("coordinator: shut down")
}
