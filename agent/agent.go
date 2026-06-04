// Package agent is the SwarmBuild Robot Agent: a single rover that lives on the
// NATS bus and behaves identically whether it is hosted as an in-process
// goroutine (--mode=inproc, the live demo) or as a standalone container
// (--mode=container, the encore). See ADR-0001 and ADR-0002: a rover is a real
// autonomous NATS client in both modes, with its own bids, heartbeats and
// telemetry.
//
// The Robot Agent is a frontier (integration) module, not a pure deep module.
// It imports the bus and wire contracts and the Allocation cost function so a
// rover scores its OWN bids exactly as the coordinator's auction expects.
package agent

import (
	"context"
	"log"
	"sync"
	"time"

	"swarmbuild/bus"
	"swarmbuild/core/allocation"
	"swarmbuild/core/domain"
	"swarmbuild/wire"
)

// Config is the static identity and starting state of one rover. HeartbeatEvery
// is how often the rover renews a lease it holds (and is the cadence the
// coordinator's TTL is sized against, TTL ≥ 3× this).
type Config struct {
	ID             domain.RobotID
	Pos            domain.Vec2
	Battery        float64
	Capabilities   []domain.Capability
	HeartbeatEvery time.Duration // e.g. 500ms
}

// executeBeat is the skeleton's stand-in for doing the work: the rover holds the
// lease for a short fixed beat (no movement yet, ADR-0001) then reports
// completion. Real behaviour-tree execution arrives in a later slice.
const executeBeat = 300 * time.Millisecond

// telemetryEvery is how often a rover self-reports position/battery/health/load.
const telemetryEvery = 200 * time.Millisecond

// rover is the mutable self-state a Robot Agent owns. It is guarded by its own
// small mutex because the NATS dispatcher goroutine (announce/award callbacks)
// and the telemetry ticker goroutine both read and write it.
type rover struct {
	mu      sync.Mutex
	pos     domain.Vec2
	battery float64
	load    int // tasks currently held
	alive   bool
}

// snapshot returns a consistent copy of the rover's scoring-relevant state.
func (r *rover) snapshot() (pos domain.Vec2, battery float64, load int, alive bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.pos, r.battery, r.load, r.alive
}

func (r *rover) addLoad(delta int) {
	r.mu.Lock()
	r.load += delta
	if r.load < 0 {
		r.load = 0
	}
	r.mu.Unlock()
}

// Run drives one rover until ctx is cancelled. It connects to NATS (hardened),
// subscribes to announces and awards, and runs a telemetry ticker. It returns
// when ctx is done or a fatal setup error occurs.
//
// Behaviour:
//   - On wire.Announce: if the rover can perform the task type it computes its
//     OWN cost via allocation.Cost from its current state and publishes a
//     wire.Bid on wire.SubjBid(taskID). An ineligible rover sends no bid.
//   - On wire.Award naming THIS rover: it "executes" the task — holds the lease
//     for a short fixed beat, sending wire.Heartbeat on wire.SubjHeartbeat(id)
//     every HeartbeatEvery while leased — then publishes wire.Complete on
//     wire.SubjTaskComplete.
//   - Periodically publishes wire.Telemetry on wire.SubjTelemetry(id).
func Run(ctx context.Context, cfg Config, conn *bus.Conn) error {
	hb := cfg.HeartbeatEvery
	if hb <= 0 {
		hb = 500 * time.Millisecond
	}

	st := &rover{
		pos:     cfg.Pos,
		battery: cfg.Battery,
		alive:   true,
	}
	weights := allocation.DefaultWeights()

	// Bid on every announced task this rover is eligible for. The callback runs
	// on the NATS dispatcher goroutine; it only reads rover state (under the
	// rover mutex) and publishes — it mutates no shared coordinator state.
	unsubAnnounce, err := bus.SubscribeJSON(conn, wire.SubjTaskAnnounce, func(a wire.Announce) {
		pos, battery, load, alive := st.snapshot()
		if !alive {
			return
		}
		rs := domain.RoverState{
			ID:           cfg.ID,
			Pos:          pos,
			Battery:      battery,
			Capabilities: cfg.Capabilities,
			CurrentLoad:  load,
		}
		cost, bids := allocation.Cost(weights, rs, a.Type, a.Pos)
		if !bids {
			return // ineligible: no bid
		}
		_ = conn.PublishJSON(wire.SubjBid(a.TaskID), wire.Bid{
			TaskID: a.TaskID,
			Robot:  cfg.ID,
			Cost:   cost,
		})
	})
	if err != nil {
		return err
	}
	defer unsubAnnounce()

	// Execute any task awarded to THIS rover. The award callback hands work off
	// to its own goroutine so the short execute beat never blocks the NATS
	// dispatcher.
	unsubAward, err := bus.SubscribeJSON(conn, wire.SubjTaskAward, func(aw wire.Award) {
		if aw.Robot != cfg.ID {
			return // not ours
		}
		go execute(ctx, cfg, conn, st, hb, aw)
	})
	if err != nil {
		return err
	}
	defer unsubAward()

	// Telemetry ticker: the rover's self-report stream.
	ticker := time.NewTicker(telemetryEvery)
	defer ticker.Stop()

	publishTelemetry(conn, cfg, st)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			publishTelemetry(conn, cfg, st)
		}
	}
}

// execute runs the skeleton work for one awarded task: bump load, heartbeat the
// lease until the fixed beat elapses, then report completion and drop load.
func execute(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, hb time.Duration, aw wire.Award) {
	st.addLoad(1)
	defer st.addLoad(-1)

	log.Printf("rover %s: awarded %s, executing", cfg.ID, aw.TaskID)

	beat := time.NewTimer(executeBeat)
	defer beat.Stop()
	heart := time.NewTicker(hb)
	defer heart.Stop()

	// Heartbeat immediately so the lease is renewed before the first TTL window
	// can lapse, then on every tick until the work beat completes.
	sendHeartbeat(conn, cfg.ID, aw.TaskID)
	for {
		select {
		case <-ctx.Done():
			return
		case <-heart.C:
			sendHeartbeat(conn, cfg.ID, aw.TaskID)
		case <-beat.C:
			_ = conn.PublishJSON(wire.SubjTaskComplete, wire.Complete{
				TaskID: aw.TaskID,
				Robot:  cfg.ID,
			})
			log.Printf("rover %s: completed %s", cfg.ID, aw.TaskID)
			return
		}
	}
}

func sendHeartbeat(conn *bus.Conn, id domain.RobotID, task domain.TaskID) {
	_ = conn.PublishJSON(wire.SubjHeartbeat(id), wire.Heartbeat{
		Robot:  id,
		TaskID: task,
		At:     nowTick(),
	})
}

func publishTelemetry(conn *bus.Conn, cfg Config, st *rover) {
	pos, battery, load, alive := st.snapshot()
	_ = conn.PublishJSON(wire.SubjTelemetry(cfg.ID), wire.Telemetry{
		Robot:   cfg.ID,
		Pos:     pos,
		Battery: battery,
		Alive:   alive,
		Load:    load,
		At:      nowTick(),
	})
}

// nowTick maps the wall clock to a domain.Tick in milliseconds, matching the
// coordinator's wall clock so heartbeat timestamps are comparable.
func nowTick() domain.Tick {
	return domain.Tick(time.Now().UnixMilli())
}
