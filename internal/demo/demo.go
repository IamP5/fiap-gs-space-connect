// Package demo is the SwarmBuild demo-pacing module: the single, named,
// server-authoritative home for the choreography of the live show (slice 06).
//
// A SwarmBuild auction is millisecond-fast. On its own, the kill→heal money shot
// would flash past before a first-time viewer could read it. This package turns
// it into a watchable ~12–20 s arc WITHOUT faking anything: it does so purely by
// (a) widening the real engine timings so each genuine beat lingers on screen —
// a draining TTL ring over the orphaned task, bid numbers flashing over bidding
// rovers, the winner's glow, the replacement driving over, the segment
// solidifying — and (b) scripting a reproducible board and a reproducible kill.
//
// Every visual beat the browser draws is triggered by a REAL engine event
// emitted by the coordinator (wire.Event*), never synthesized; this module only
// chooses WHEN the rehearsal kill happens and HOW WIDE the timing windows are.
// All of those knobs live here, in one Config block (TECHSPEC: the load-bearing
// wall of the wow gets its own home, not a frontend afterthought).
package demo

import (
	"fmt"
	"math"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"time"
)

// Config is the ONE place every demo-pacing timing is tuned. The defaults
// (Rehearsal) widen the real engine windows so the kill→heal arc reads in
// ~12–20 s; shrink them for a faster rehearsal or a CI smoke run. These map
// straight onto the coordinator's real auction/lease cadence — there is no
// separate "animation clock" to drift out of sync with the World Model.
type Config struct {
	// AuctionWindow is how long each auction collects bids. Widened (vs the ~400ms
	// production value) so the bid-flash beat is legible: several 10 Hz snapshots
	// carry the open bids before a winner is picked.
	AuctionWindow time.Duration
	// HeartbeatEvery × TTLFactor is the lease TTL — and therefore how long the
	// orphaned-task drain ring is visible after a kill before the task re-auctions.
	HeartbeatEvery time.Duration
	TTLFactor      int
	// SnapshotHz is the world-snapshot cadence to the browser.
	SnapshotHz int
	// KillAfterLeased is how long after the scripted target wall is leased the
	// rehearsal kill fires. A short beat (the rover has just started driving) makes
	// the orphan-and-heal unmistakable.
	KillAfterLeased time.Duration
	// KillTarget is the task whose builder is killed in the rehearsal. It must be a
	// task with standby rovers free to heal it (a wall, not the final dome-cap).
	KillTarget domain.TaskID
}

// Rehearsal is the default demo pacing: a kill→heal arc that reads in ~12–20 s.
func Rehearsal() Config {
	return Config{
		AuctionWindow:   900 * time.Millisecond,
		HeartbeatEvery:  700 * time.Millisecond,
		TTLFactor:       6, // TTL = 4.2 s: a long, legible drain ring over the orphan
		SnapshotHz:      12,
		KillAfterLeased: 900 * time.Millisecond,
		KillTarget:      "wall-1",
	}
}

// DomeScenario assembles the full scripted board for the rehearsal: the lunar
// habitat dome blueprint, a fixed six-rover swarm, and the single scripted kill,
// all folded into a coordinator.Config. Because the board (positions, batteries,
// blueprint) is fixed and the auction tie-breaks are deterministic, the same run
// reproduces beat-for-beat: the same rover wins the target wall, is killed at the
// same beat, and the same standby heals it — every time.
//
// natsURL is the bus to run against. Pass cfg from Rehearsal (or a tuned copy).
func DomeScenario(natsURL string, cfg Config) coordinator.Config {
	blueprint := DomeBlueprint()
	rovers := DomeRovers()

	scripted := []coordinator.ScriptedKill(nil)
	if cfg.KillTarget != "" {
		scripted = []coordinator.ScriptedKill{
			{WhenTaskLeased: cfg.KillTarget, After: cfg.KillAfterLeased},
		}
	}

	return coordinator.Config{
		NATSURL:        natsURL,
		Blueprint:      blueprint,
		Rovers:         rovers,
		AuctionWindow:  cfg.AuctionWindow,
		HeartbeatEvery: cfg.HeartbeatEvery,
		TTLFactor:      cfg.TTLFactor,
		SnapshotHz:     cfg.SnapshotHz,
		ScriptedKills:  scripted,
	}
}

// DomeBlueprint is the lunar habitat dome as a positioned blueprint (TECHSPEC
// §5): four foundations (no deps) on an inner ring, eight walls on an outer
// octagon (wall-i needs foundation-((i-1)/2+1)), and a dome-cap keystone at the
// centre that needs all eight walls. The geometry is a top-down dome footprint
// so the structure visibly rises as the swarm builds it.
func DomeBlueprint() []coordinator.BlueprintTask {
	wallPos := ring(8, 46, 90)       // outer octagon, wall-1 at 12 o'clock
	foundationPos := ring(4, 24, 68) // inner ring, offset to sit under each wall pair

	var bp []coordinator.BlueprintTask
	for i := 1; i <= 4; i++ {
		bp = append(bp, coordinator.BlueprintTask{
			Task: domain.Task{ID: domain.TaskID(fmt.Sprintf("foundation-%d", i)), Type: "foundation"},
			Pos:  foundationPos[i-1],
		})
	}
	wallIDs := make([]domain.TaskID, 0, 8)
	for i := 1; i <= 8; i++ {
		id := domain.TaskID(fmt.Sprintf("wall-%d", i))
		wallIDs = append(wallIDs, id)
		foundation := domain.TaskID(fmt.Sprintf("foundation-%d", (i-1)/2+1))
		bp = append(bp, coordinator.BlueprintTask{
			Task: domain.Task{ID: id, Type: "wall", Deps: []domain.TaskID{foundation}},
			Pos:  wallPos[i-1],
		})
	}
	bp = append(bp, coordinator.BlueprintTask{
		Task: domain.Task{ID: "dome-cap", Type: "dome-cap", Deps: wallIDs},
		Pos:  domain.Vec2{X: 0, Y: 0},
	})
	return bp
}

// DomeRovers is the fixed six-rover swarm parked below the worksite, each
// capable of every task type so any standby can heal any wall. Fixed positions
// and staggered batteries make every auction's winner deterministic.
func DomeRovers() []agent.Config {
	caps := []domain.Capability{"foundation", "wall", "dome-cap"}
	rovers := make([]agent.Config, 0, 6)
	for i := range 6 {
		rovers = append(rovers, agent.Config{
			ID:           domain.RobotID(fmt.Sprintf("R%d", i+1)),
			Pos:          domain.Vec2{X: float64(-50 + i*20), Y: -70},
			Battery:      1.0 - float64(i)*0.05,
			Capabilities: caps,
		})
	}
	return rovers
}

// ring places n points evenly on a circle of the given radius centred at the
// origin, starting from straight up (12 o'clock) and going clockwise, so the
// worksite reads as a dome footprint on the 2D canvas (+Y up). Coordinates are
// rounded to 0.01 so the scripted board is byte-stable across runs.
func ring(n int, radius, startDeg float64) []domain.Vec2 {
	pts := make([]domain.Vec2, n)
	for i := range n {
		theta := (startDeg - float64(i)*360.0/float64(n)) * math.Pi / 180.0
		pts[i] = domain.Vec2{
			X: math.Round(radius*math.Cos(theta)*100) / 100,
			Y: math.Round(radius*math.Sin(theta)*100) / 100,
		}
	}
	return pts
}
