// Command coordinator runs the SwarmBuild coordinator against the NATS bus named
// by NATS_URL: it loads a wall blueprint and spawns the in-process rovers that
// build it. It is the live brain behind the dashboard, including the kill →
// self-heal money shot (slice 04).
package main

import (
	"context"
	"fmt"
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

	// A wall, built segment by segment. Each segment depends on the previous one,
	// so the Planner releases exactly ONE ready task at a time — the auction
	// awards a single rover, which drives to that segment and builds it before the
	// next becomes ready. (The in-process rovers share a position model, so a
	// linear chain also keeps any one rover from being awarded two segments at
	// once.) The chain gives a sustained ~20s build you can interrupt: click the
	// building rover, hit KILL, and watch another rover take over its segment and
	// finish the wall — the self-heal money shot. A richer parallel dome blueprint
	// arrives in slice 05.
	const segments = 8
	blueprint := make([]coordinator.BlueprintTask, segments)
	for i := 0; i < segments; i++ {
		id := domain.TaskID(fmt.Sprintf("wall-%d", i+1))
		seg := domain.Task{ID: id, Type: "wall"}
		if i > 0 {
			seg.Deps = []domain.TaskID{domain.TaskID(fmt.Sprintf("wall-%d", i))}
		}
		blueprint[i] = coordinator.BlueprintTask{
			Task: seg,
			Pos:  domain.Vec2{X: float64(i * 10), Y: 0}, // a horizontal wall
		}
	}

	// Three rovers parked below the wall so each award triggers a visible drive,
	// and there is always a standby to take over after a kill. Differing
	// positions/battery give every auction a clear, deterministic winner.
	rovers := []agent.Config{
		{ID: "R1", Pos: domain.Vec2{X: -10, Y: -30}, Battery: 1.0, Capabilities: []domain.Capability{"wall"}},
		{ID: "R2", Pos: domain.Vec2{X: 35, Y: -34}, Battery: 0.85, Capabilities: []domain.Capability{"wall"}},
		{ID: "R3", Pos: domain.Vec2{X: 80, Y: -30}, Battery: 0.7, Capabilities: []domain.Capability{"wall"}},
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
