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

// Movement and work tuning. Movement is visual interpolation only — the rover
// lerps its position toward the task each tick, no physics (ADR-0001). The
// constants are chosen so a ~10-unit drive is watchable (~0.5s) yet keeps the
// demo and tests fast.
const (
	// moveStep is the movement integration tick: the rover advances its
	// position toward the target this often during the drive.
	moveStep = 50 * time.Millisecond

	// roverSpeed is the constant cruise speed in world-units per second. At
	// 18 u/s a 10-unit drive takes ~0.55s: long enough to see on the web,
	// short enough that a test converges in a handful of ticks.
	roverSpeed = 18.0

	// arriveEps is the arrival epsilon: within this distance of the target the
	// rover is considered to have arrived (avoids asymptotic crawl).
	arriveEps = 0.05

	// drainPerUnit is battery drained per world-unit travelled. Small so a
	// full demo route (tens of units) costs a fraction of a charge but the
	// drop is still visible in telemetry. Fraction units (battery ∈ (0,1]).
	drainPerUnit = 0.004

	// drainPerWorkSec is battery drained per second of the work phase. Working
	// a task costs a little charge even when stationary.
	drainPerWorkSec = 0.05

	// workDuration is how long the rover "works" the task after arriving,
	// before reporting completion.
	workDuration = 600 * time.Millisecond

	// minBattery floors the charge so 1/battery (used by the cost function for
	// bidding) stays finite — the rover never bricks itself in the demo.
	minBattery = 0.02
)

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

	// inFlight is the set of tasks currently being executed by this rover. It
	// guards against a redelivered/duplicate wire.Award spawning a second
	// execute goroutine for the same task. Guarded by mu.
	inFlight map[domain.TaskID]struct{}
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

// claim marks task as in flight for this rover, returning false if it was
// already in flight (a duplicate/redelivered award). The matching release()
// clears it. Both run under the rover mutex.
func (r *rover) claim(task domain.TaskID) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.inFlight == nil {
		r.inFlight = make(map[domain.TaskID]struct{})
	}
	if _, dup := r.inFlight[task]; dup {
		return false
	}
	r.inFlight[task] = struct{}{}
	return true
}

func (r *rover) release(task domain.TaskID) {
	r.mu.Lock()
	delete(r.inFlight, task)
	r.mu.Unlock()
}

// moveToward advances the rover's position toward target by at most maxStep
// world-units (visual interpolation only, no physics — ADR-0001), draining
// battery by the distance actually moved × drainPerUnit. It returns true once
// the rover is within arriveEps of the target, snapping exactly onto it; an
// already-arrived call drains nothing and reports arrived.
func (r *rover) moveToward(target domain.Vec2, maxStep float64) (arrived bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	d := r.pos.Dist(target)
	if d <= arriveEps {
		r.pos = target
		return true
	}
	step := maxStep
	if step >= d {
		// Final step: land exactly on the target.
		r.drainLocked(d * drainPerUnit)
		r.pos = target
		return true
	}
	// Partial step: lerp along the straight line toward the target.
	t := step / d
	r.pos = domain.Vec2{
		X: r.pos.X + (target.X-r.pos.X)*t,
		Y: r.pos.Y + (target.Y-r.pos.Y)*t,
	}
	r.drainLocked(step * drainPerUnit)
	return false
}

// drainOverTime drains battery by amount (a fraction), flooring at minBattery.
// Used by the work phase, which drains drainPerWorkSec per elapsed second.
func (r *rover) drainOverTime(amount float64) {
	r.mu.Lock()
	r.drainLocked(amount)
	r.mu.Unlock()
}

// drainLocked subtracts amount from battery, flooring at minBattery so 1/battery
// stays finite for bidding. Caller must hold r.mu.
func (r *rover) drainLocked(amount float64) {
	r.battery -= amount
	if r.battery < minBattery {
		r.battery = minBattery
	}
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

// execute runs one awarded task: bump load, drive toward aw.Pos by visual
// interpolation (draining battery with distance), then work the task for a
// short phase (draining battery with time), then report completion and drop
// load. Heartbeats are sent at the hb cadence THROUGHOUT both the drive and the
// work phase so the coordinator's lease (TTL ≥ 3× hb) never false-expires while
// the rover is still driving (ADR-0001: movement is visual interpolation only,
// there is no physics).
//
// A duplicate/redelivered award for the same task is dropped (st.claim) so one
// rover never runs two concurrent execute goroutines for one task.
func execute(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, hb time.Duration, aw wire.Award) {
	if !st.claim(aw.TaskID) {
		return // already executing this task (duplicate award)
	}
	defer st.release(aw.TaskID)

	st.addLoad(1)
	defer st.addLoad(-1)

	log.Printf("rover %s: awarded %s, driving to %v", cfg.ID, aw.TaskID, aw.Pos)

	heart := time.NewTicker(hb)
	defer heart.Stop()

	// Heartbeat immediately so the lease is renewed before the first TTL window
	// can lapse, then on every tick throughout the drive and work phases below.
	sendHeartbeat(conn, cfg.ID, aw.TaskID)

	if !drive(ctx, cfg, conn, st, heart, aw) {
		return // ctx cancelled mid-drive
	}
	if !workPhase(ctx, cfg, conn, st, heart, aw) {
		return // ctx cancelled mid-work
	}

	_ = conn.PublishJSON(wire.SubjTaskComplete, wire.Complete{
		TaskID: aw.TaskID,
		Robot:  cfg.ID,
	})
	log.Printf("rover %s: completed %s", cfg.ID, aw.TaskID)
}

// drive interpolates the rover toward aw.Pos, one moveStep of travel per move
// tick, heartbeating on the heart ticker meanwhile. It returns true on arrival,
// false if ctx is cancelled first.
func drive(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart *time.Ticker, aw wire.Award) bool {
	// maxStep is how far the rover may advance per move tick at cruise speed.
	maxStep := roverSpeed * moveStep.Seconds()

	move := time.NewTicker(moveStep)
	defer move.Stop()

	// Snap onto the target immediately if we are already there.
	if st.moveToward(aw.Pos, maxStep) {
		return true
	}
	for {
		select {
		case <-ctx.Done():
			return false
		case <-heart.C:
			sendHeartbeat(conn, cfg.ID, aw.TaskID)
		case <-move.C:
			if st.moveToward(aw.Pos, maxStep) {
				return true
			}
		}
	}
}

// workPhase holds the rover at the worksite for workDuration, draining battery
// over time and heartbeating the lease. It returns true on completion, false if
// ctx is cancelled first.
func workPhase(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart *time.Ticker, aw wire.Award) bool {
	done := time.NewTimer(workDuration)
	defer done.Stop()
	tick := time.NewTicker(moveStep)
	defer tick.Stop()

	for {
		select {
		case <-ctx.Done():
			return false
		case <-heart.C:
			sendHeartbeat(conn, cfg.ID, aw.TaskID)
		case <-tick.C:
			st.drainOverTime(drainPerWorkSec * moveStep.Seconds())
		case <-done.C:
			return true
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
