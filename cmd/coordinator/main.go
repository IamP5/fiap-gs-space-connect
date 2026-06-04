// Command coordinator runs the SwarmBuild coordinator against the NATS bus named
// by NATS_URL: it loads a wall blueprint and spawns the in-process rovers that
// build it. It is the live brain behind the dashboard, including the kill →
// self-heal money shot (slice 04).
package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"os"
	"os/signal"
	"syscall"
	"time"

	"swarmbuild/agent"
	"swarmbuild/coordinator"
	"swarmbuild/core/domain"
)

// ring places n points evenly on a circle of the given radius centred at the
// origin, starting from straight up (12 o'clock) and going clockwise, so the
// worksite reads as a dome footprint on the 2D canvas (+Y up).
func ring(n int, radius, startDeg float64) []domain.Vec2 {
	pts := make([]domain.Vec2, n)
	for i := 0; i < n; i++ {
		theta := (startDeg - float64(i)*360.0/float64(n)) * math.Pi / 180.0
		pts[i] = domain.Vec2{
			X: math.Round(radius*math.Cos(theta)*100) / 100,
			Y: math.Round(radius*math.Sin(theta)*100) / 100,
		}
	}
	return pts
}

func main() {
	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = "nats://127.0.0.1:4222"
	}

	// The real lunar habitat dome (slice 05). The DAG is the demo's actual
	// content — the structure visibly rises:
	//
	//	foundation-1..4  (no deps, built in parallel)
	//	   └─► wall-1..8  (two walls per foundation; each needs its foundation)
	//	          └─► dome-cap  (needs ALL eight walls)
	//
	// Geometry is a top-down dome footprint: eight walls evenly spaced on the
	// outer ring (an octagon), four foundations on an inner ring sitting under
	// each wall pair, and the dome-cap at the centre. Because all four foundations
	// are ready at once, the swarm builds them concurrently — the coordinator's
	// one-task-per-rover guard keeps any single rover from being awarded two at
	// once. Killing a rover mid-wall still lets a standby finish that wall, so the
	// dome always closes.
	wallPos := ring(8, 46, 90)       // outer octagon, wall-1 at 12 o'clock
	foundationPos := ring(4, 24, 68) // inner ring, offset to sit under each wall pair
	var blueprint []coordinator.BlueprintTask

	for i := 1; i <= 4; i++ {
		blueprint = append(blueprint, coordinator.BlueprintTask{
			Task: domain.Task{ID: domain.TaskID(fmt.Sprintf("foundation-%d", i)), Type: "foundation"},
			Pos:  foundationPos[i-1],
		})
	}
	wallIDs := make([]domain.TaskID, 0, 8)
	for i := 1; i <= 8; i++ {
		id := domain.TaskID(fmt.Sprintf("wall-%d", i))
		wallIDs = append(wallIDs, id)
		foundation := domain.TaskID(fmt.Sprintf("foundation-%d", (i-1)/2+1))
		blueprint = append(blueprint, coordinator.BlueprintTask{
			Task: domain.Task{ID: id, Type: "wall", Deps: []domain.TaskID{foundation}},
			Pos:  wallPos[i-1],
		})
	}
	blueprint = append(blueprint, coordinator.BlueprintTask{
		Task: domain.Task{ID: "dome-cap", Type: "dome-cap", Deps: wallIDs},
		Pos:  domain.Vec2{X: 0, Y: 0}, // the keystone at the centre
	})

	// A six-rover swarm parked below the worksite, each capable of every task type
	// so any rover can pick up any job (and any standby can heal any wall). Spread
	// positions and staggered batteries give every auction a clear, deterministic
	// winner while keeping several rovers busy in parallel.
	caps := []domain.Capability{"foundation", "wall", "dome-cap"}
	rovers := make([]agent.Config, 0, 6)
	for i := 0; i < 6; i++ {
		rovers = append(rovers, agent.Config{
			ID:           domain.RobotID(fmt.Sprintf("R%d", i+1)),
			Pos:          domain.Vec2{X: float64(-50 + i*20), Y: -70},
			Battery:      1.0 - float64(i)*0.05,
			Capabilities: caps,
		})
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
