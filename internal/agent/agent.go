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
	"log/slog"
	"math/rand/v2"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/core/allocation"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"sync"
	"time"
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

	// FailTask, if non-empty, makes this rover abandon that task instead of
	// completing it: on award it drives to the task, then reports execution
	// failure via wire.Failed rather than wire.Complete, and never bids on that
	// task again (it has "lost the capability" for it). Deterministic fault
	// injection for the slice-03 self-heal demo/test.
	FailTask domain.TaskID
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

// faultCheckEvery is the cadence of the random-fault roll while a rover is
// executing a task (throughout the drive and work phases). On each tick the
// rover rolls rand.Float64() < failProb; a HIT abandons the in-flight task
// silently (see execute). This is the swarm-under-stress knob (issue 08): the
// per-interval probability of inducing a failure on the currently-executing
// task. failProb=0 ⇒ the roll never fires, so no induced failures ever.
const faultCheckEvery = 250 * time.Millisecond

// rover is the mutable self-state a Robot Agent owns. It is guarded by its own
// small mutex because the NATS dispatcher goroutine (announce/award callbacks)
// and the telemetry ticker goroutine both read and write it.
type rover struct {
	mu      sync.Mutex
	pos     domain.Vec2
	battery float64
	load    int // tasks currently held
	alive   bool

	// failProb is this rover's probability, PER faultCheckEvery interval, of
	// spontaneously abandoning the task it is currently executing (issue 08 —
	// swarm under stress). It is set live by the broadcast "setFailureProb"
	// control and clamped to [0,1]. 0 (the default) means no induced failures.
	failProb float64

	// inFlight is the set of tasks currently being executed by this rover. It
	// guards against a redelivered/duplicate wire.Award spawning a second
	// execute goroutine for the same task. Guarded by mu.
	inFlight map[domain.TaskID]struct{}

	// refused is the set of tasks this rover has cooperatively failed and will
	// never bid on again (it has "lost the capability" for them). Guarded by mu.
	refused map[domain.TaskID]struct{}

	// dead is closed exactly once by kill() when the rover suffers a silent
	// death (the "kill" control command). The drive, work and telemetry loops
	// select on it to abandon their work without completing or heartbeating, so
	// the coordinator self-heals the lease by TTL expiry.
	dead     chan struct{}
	killOnce sync.Once
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

// failureProb returns this rover's current per-interval failure probability.
func (r *rover) failureProb() float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.failProb
}

// setFailureProb sets this rover's per-interval failure probability, clamping p
// to [0,1]. Driven by the broadcast "setFailureProb" control (issue 08).
func (r *rover) setFailureProb(p float64) {
	if p < 0 {
		p = 0
	}
	if p > 1 {
		p = 1
	}
	r.mu.Lock()
	r.failProb = p
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

// kill marks the rover silently dead: it clears alive (so the bid-on-announce
// path stops bidding) and closes the dead channel exactly once, which the drive,
// work and telemetry loops select on to stop heartbeating, abandon any in-flight
// execution WITHOUT completing it, and go silent on the bus. A dead rover is
// dead for its lifetime; a second kill is a harmless no-op (idempotent via
// sync.Once, so dead is never double-closed).
func (r *rover) kill() {
	r.killOnce.Do(func() {
		r.mu.Lock()
		r.alive = false
		r.mu.Unlock()
		close(r.dead)
	})
}

// refuse records task in the refused set so the rover never bids on it again.
func (r *rover) refuse(task domain.TaskID) {
	r.mu.Lock()
	if r.refused == nil {
		r.refused = make(map[domain.TaskID]struct{})
	}
	r.refused[task] = struct{}{}
	r.mu.Unlock()
}

// refuses reports whether the rover has cooperatively failed task and will not
// bid on it again. Read under the rover mutex.
func (r *rover) refuses(task domain.TaskID) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.refused[task]
	return ok
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
		dead:    make(chan struct{}),
	}

	unsubAnnounce, err := subscribeAnnounce(conn, cfg, st)
	if err != nil {
		return err
	}
	defer unsubAnnounce()

	unsubAward, err := subscribeAward(ctx, conn, cfg, st, hb)
	if err != nil {
		return err
	}
	defer unsubAward()

	unsubControl, err := subscribeControl(conn, cfg, st)
	if err != nil {
		return err
	}
	defer unsubControl()

	return telemetryLoop(ctx, conn, cfg, st)
}

// subscribeAnnounce makes the rover bid on every announced task it is eligible
// for. The callback runs on the NATS dispatcher goroutine; it only reads rover
// state (under the rover mutex) and publishes — it mutates no shared coordinator
// state.
func subscribeAnnounce(conn *bus.Conn, cfg Config, st *rover) (func(), error) {
	weights := allocation.DefaultWeights()
	return bus.SubscribeJSON(conn, wire.SubjTaskAnnounce, func(a wire.Announce) {
		pos, battery, load, alive := st.snapshot()
		if !alive {
			return
		}
		if st.refuses(a.TaskID) {
			return // cooperatively failed this task: never bid on it again
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
}

// subscribeAward executes any task awarded to THIS rover. The award callback
// hands work off to its own goroutine so the short execute beat never blocks the
// NATS dispatcher.
func subscribeAward(ctx context.Context, conn *bus.Conn, cfg Config, st *rover, hb time.Duration) (func(), error) {
	return bus.SubscribeJSON(conn, wire.SubjTaskAward, func(aw wire.Award) {
		if aw.Robot != cfg.ID {
			return // not ours
		}
		if _, _, _, alive := st.snapshot(); !alive {
			return // dead: drop awards arriving after death (no execution)
		}
		go execute(ctx, cfg, conn, st, hb, aw)
	})
}

// subscribeControl wires control commands from the dashboard/coordinator.
//
//   - A "kill" naming THIS rover triggers a silent death: it stops bidding,
//     heartbeating, executing and telemetering so the coordinator self-heals the
//     lease by TTL expiry. Kills for other robots are ignored; a repeated kill is
//     a no-op (kill is idempotent).
//   - A "setFailureProb" is BROADCAST (no Robot target): every rover sets its OWN
//     per-interval random-failure probability (issue 08 — swarm under stress).
//     The value is clamped to [0,1]; 0 disables induced failures.
func subscribeControl(conn *bus.Conn, cfg Config, st *rover) (func(), error) {
	return bus.SubscribeJSON(conn, wire.SubjControl, func(c wire.Control) {
		switch c.Cmd {
		case "kill":
			if c.Robot == cfg.ID {
				st.kill()
			}
		case "setFailureProb":
			st.setFailureProb(c.Value)
		}
	})
}

// telemetryLoop runs the rover's self-report stream until ctx is cancelled or
// the rover suffers a silent death. On death it emits one final alive=false
// telemetry so the dashboard shows the rover down, then goes silent on the bus
// (a dead rover is silent); kill() has already cleared alive.
func telemetryLoop(ctx context.Context, conn *bus.Conn, cfg Config, st *rover) error {
	ticker := time.NewTicker(telemetryEvery)
	defer ticker.Stop()

	publishTelemetry(conn, cfg, st)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-st.dead:
			publishTelemetry(conn, cfg, st)
			return nil
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

	slog.Info("award", "rover", cfg.ID, "task", aw.TaskID, "pos", aw.Pos)

	heart := time.NewTicker(hb)
	defer heart.Stop()

	// fault is the random-failure roll, ticking throughout the drive and work
	// phases (issue 08). On a HIT the rover silently ABANDONS the task — it
	// returns without completing, failing or refusing — so it stops heartbeating
	// this lease and the coordinator self-heals it by TTL expiry (the exact same
	// heal path as a kill, but the rover stays ALIVE and immediately frees its
	// load/inFlight via the defers above, so it can bid again at once).
	fault := time.NewTicker(faultCheckEvery)
	defer fault.Stop()

	// Heartbeat immediately so the lease is renewed before the first TTL window
	// can lapse, then on every tick throughout the drive and work phases below.
	sendHeartbeat(conn, cfg.ID, aw.TaskID)

	switch drive(ctx, cfg, conn, st, heart, fault, aw) {
	case phaseDone:
		// arrived at the worksite: fall through to the work phase below
	case phaseAbort:
		return // ctx cancelled or rover killed mid-drive: no completion
	case phaseFault:
		slog.Warn("fault", "rover", cfg.ID, "task", aw.TaskID, "phase", "drive")
		return // random fault mid-drive: silently abandon, lease TTL-expires
	}

	// Cooperative failure: this rover is configured to FAIL this task. It has
	// driven to the worksite (visible) but instead of working it reports an
	// execution failure on wire.SubjTaskFailed and stops heartbeating, so the
	// coordinator releases the lease PROMPTLY (no need to wait out the work
	// phase). It records the task as refused so it never bids on it again and a
	// different rover wins the re-auction.
	if cfg.FailTask != "" && aw.TaskID == cfg.FailTask {
		st.refuse(aw.TaskID)
		_ = conn.PublishJSON(wire.SubjTaskFailed, wire.Failed{
			TaskID: aw.TaskID,
			Robot:  cfg.ID,
			Reason: "execution failure",
		})
		slog.Warn("failed", "rover", cfg.ID, "task", aw.TaskID, "reason", "execution failure")
		return
	}

	switch workPhase(ctx, cfg, conn, st, heart, fault, aw) {
	case phaseDone:
		// worked the task to completion: fall through to report Complete below
	case phaseAbort:
		return // ctx cancelled or rover killed mid-work: no completion
	case phaseFault:
		slog.Warn("fault", "rover", cfg.ID, "task", aw.TaskID, "phase", "work")
		return // random fault mid-work: silently abandon, lease TTL-expires
	}

	_ = conn.PublishJSON(wire.SubjTaskComplete, wire.Complete{
		TaskID: aw.TaskID,
		Robot:  cfg.ID,
	})
	slog.Info("complete", "rover", cfg.ID, "task", aw.TaskID)
}

// phaseResult is the outcome of a drive or work phase, telling execute whether
// to proceed, silently abandon (no completion), or silently abandon on a random
// fault (issue 08).
type phaseResult int

const (
	phaseDone  phaseResult = iota // phase finished normally (arrived / worked)
	phaseAbort                    // ctx cancelled or rover killed: go silent, no completion
	phaseFault                    // random fault hit: silently abandon, lease TTL-expires
)

// rollFault reports whether the random-failure roll fires this interval: a hit
// with probability st.failProb (issue 08). At failProb=0 it can never fire.
// math/rand/v2 is the correct, goroutine-safe choice here: this is sim fault
// injection (a swarm-stress knob), not a security-sensitive draw.
//
//nolint:gosec // G404: sim fault injection, not security-sensitive; math/rand/v2 is intended.
func rollFault(st *rover) bool {
	return rand.Float64() < st.failureProb()
}

// drive interpolates the rover toward aw.Pos, one moveStep of travel per move
// tick, heartbeating on the heart ticker meanwhile. It returns phaseDone on
// arrival, phaseAbort if ctx is cancelled or the rover is killed first, and
// phaseFault if the random-failure roll fires (issue 08). On anything but
// phaseDone the caller must NOT complete the task — the rover goes silent and
// the coordinator self-heals the lease.
func drive(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart, fault *time.Ticker, aw wire.Award) phaseResult {
	// maxStep is how far the rover may advance per move tick at cruise speed.
	maxStep := roverSpeed * moveStep.Seconds()

	move := time.NewTicker(moveStep)
	defer move.Stop()

	// Snap onto the target immediately if we are already there.
	if st.moveToward(aw.Pos, maxStep) {
		return phaseDone
	}
	for {
		select {
		case <-ctx.Done():
			return phaseAbort
		case <-st.dead:
			return phaseAbort // killed mid-drive: abandon without heartbeating or completing
		case <-fault.C:
			if rollFault(st) {
				return phaseFault // random fault mid-drive: silently abandon
			}
		case <-heart.C:
			sendHeartbeat(conn, cfg.ID, aw.TaskID)
		case <-move.C:
			if st.moveToward(aw.Pos, maxStep) {
				return phaseDone
			}
		}
	}
}

// workPhase holds the rover at the worksite for workDuration, draining battery
// over time and heartbeating the lease. It returns phaseDone on completion,
// phaseAbort if ctx is cancelled or the rover is killed first, and phaseFault
// if the random-failure roll fires (issue 08). On anything but phaseDone the
// caller must NOT complete the task — the rover goes silent and the coordinator
// self-heals the lease.
func workPhase(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart, fault *time.Ticker, aw wire.Award) phaseResult {
	done := time.NewTimer(workDuration)
	defer done.Stop()
	tick := time.NewTicker(moveStep)
	defer tick.Stop()

	for {
		select {
		case <-ctx.Done():
			return phaseAbort
		case <-st.dead:
			return phaseAbort // killed mid-work: abandon without heartbeating or completing
		case <-fault.C:
			if rollFault(st) {
				return phaseFault // random fault mid-work: silently abandon
			}
		case <-heart.C:
			sendHeartbeat(conn, cfg.ID, aw.TaskID)
		case <-tick.C:
			st.drainOverTime(drainPerWorkSec * moveStep.Seconds())
		case <-done.C:
			return phaseDone
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
