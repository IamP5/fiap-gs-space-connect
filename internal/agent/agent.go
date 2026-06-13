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

type Config struct {
	ID             domain.RobotID
	Pos            domain.Vec2
	Battery        float64
	Capabilities   []domain.Capability
	HeartbeatEvery time.Duration

	OpEvery time.Duration

	SiteID string

	FailTask domain.TaskID

	RecoverAfter time.Duration

	SettleAfterRevive time.Duration

	BuildOps map[domain.TaskType][]wire.BuildOp
}

func (c Config) opEvery() time.Duration {
	if c.OpEvery > 0 {
		return c.OpEvery
	}
	return defaultOpEvery
}

func (c Config) opsFor(task domain.TaskID, t domain.TaskType) []wire.BuildOp {
	if c.BuildOps != nil {
		return c.BuildOps[t]
	}
	return buildOpsFor(task, t)
}

const (
	moveStep = 50 * time.Millisecond

	roverSpeed = 18.0

	arriveEps = 0.05

	drainPerUnit = 0.004

	drainPerWorkSec = 0.05

	workDuration = 600 * time.Millisecond

	defaultOpEvery = 120 * time.Millisecond

	minBattery = 0.02
)

const telemetryEvery = 200 * time.Millisecond

const defaultRecoverAfter = 6 * time.Second

const defaultSettleAfterRevive = 2500 * time.Millisecond

const faultCheckEvery = 250 * time.Millisecond

type rover struct {
	mu      sync.Mutex
	pos     domain.Vec2
	battery float64
	load    int
	alive   bool

	failProb float64

	inFlight map[domain.TaskID]struct{}

	refused map[domain.TaskID]struct{}

	down chan struct{}

	recoverAfter time.Duration
	reviveTimer  *time.Timer

	recovering  bool
	settleAfter time.Duration
	settleTimer *time.Timer
}

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

func (r *rover) failureProb() float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.failProb
}

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

func (r *rover) kill() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.alive {
		return
	}
	r.alive = false
	close(r.down)
	d := r.recoverAfter
	if d <= 0 {
		d = defaultRecoverAfter
	}
	r.reviveTimer = time.AfterFunc(d, r.revive)
}

func (r *rover) revive() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.alive {
		return
	}
	r.down = make(chan struct{})
	r.alive = true
	r.reviveTimer = nil

	r.recovering = true
	d := r.settleAfter
	if d <= 0 {
		d = defaultSettleAfterRevive
	}
	r.settleTimer = time.AfterFunc(d, r.endSettle)
}

func (r *rover) endSettle() {
	r.mu.Lock()
	r.recovering = false
	r.settleTimer = nil
	r.mu.Unlock()
}

func (r *rover) isRecovering() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.recovering
}

func (r *rover) downCh() chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.down
}

func (r *rover) stopTimers() {
	r.mu.Lock()
	if r.reviveTimer != nil {
		r.reviveTimer.Stop()
		r.reviveTimer = nil
	}
	if r.settleTimer != nil {
		r.settleTimer.Stop()
		r.settleTimer = nil
	}
	r.mu.Unlock()
}

func (r *rover) refuse(task domain.TaskID) {
	r.mu.Lock()
	if r.refused == nil {
		r.refused = make(map[domain.TaskID]struct{})
	}
	r.refused[task] = struct{}{}
	r.mu.Unlock()
}

func (r *rover) refuses(task domain.TaskID) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.refused[task]
	return ok
}

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
		r.drainLocked(d * drainPerUnit)
		r.pos = target
		return true
	}
	t := step / d
	r.pos = domain.Vec2{
		X: r.pos.X + (target.X-r.pos.X)*t,
		Y: r.pos.Y + (target.Y-r.pos.Y)*t,
	}
	r.drainLocked(step * drainPerUnit)
	return false
}

func (r *rover) drainOverTime(amount float64) {
	r.mu.Lock()
	r.drainLocked(amount)
	r.mu.Unlock()
}

func (r *rover) drainLocked(amount float64) {
	r.battery -= amount
	if r.battery < minBattery {
		r.battery = minBattery
	}
}

func Run(ctx context.Context, cfg Config, conn *bus.Conn) error {
	hb := cfg.HeartbeatEvery
	if hb <= 0 {
		hb = 500 * time.Millisecond
	}

	st := &rover{
		pos:          cfg.Pos,
		battery:      cfg.Battery,
		alive:        true,
		down:         make(chan struct{}),
		recoverAfter: cfg.RecoverAfter,
		settleAfter:  cfg.SettleAfterRevive,
	}
	defer st.stopTimers()

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

func subscribeAnnounce(conn *bus.Conn, cfg Config, st *rover) (func(), error) {
	weights := allocation.DefaultWeights()
	return bus.SubscribeJSON(conn, wire.SubjTaskAnnounce, func(a wire.Announce) {
		pos, battery, load, alive := st.snapshot()
		if !alive {
			return
		}
		if st.isRecovering() {
			return
		}
		if a.SiteID != "" && a.SiteID != cfg.SiteID {
			return
		}
		if st.refuses(a.TaskID) {
			return
		}
		rs := domain.RoverState{
			ID:           cfg.ID,
			Pos:          pos,
			Battery:      battery,
			Capabilities: cfg.Capabilities,
			CurrentLoad:  load,
			SiteID:       cfg.SiteID,
		}
		cost, bids := allocation.Cost(weights, rs, a.Type, a.Pos)
		if !bids {
			return
		}
		_ = conn.PublishJSON(wire.SubjBid(a.TaskID), wire.Bid{
			TaskID: a.TaskID,
			Robot:  cfg.ID,
			Cost:   cost,
		})
	})
}

func subscribeAward(ctx context.Context, conn *bus.Conn, cfg Config, st *rover, hb time.Duration) (func(), error) {
	return bus.SubscribeJSON(conn, wire.SubjTaskAward, func(aw wire.Award) {
		if aw.Robot != cfg.ID {
			return
		}
		if _, _, _, alive := st.snapshot(); !alive {
			return
		}
		go execute(ctx, cfg, conn, st, hb, aw)
	})
}

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

func telemetryLoop(ctx context.Context, conn *bus.Conn, cfg Config, st *rover) error {
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

func execute(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, hb time.Duration, aw wire.Award) {
	if !st.claim(aw.TaskID) {
		return
	}
	defer st.release(aw.TaskID)

	down := st.downCh()

	st.addLoad(1)
	defer st.addLoad(-1)

	slog.Info("award", "rover", cfg.ID, "task", aw.TaskID, "pos", aw.Pos)

	heart := time.NewTicker(hb)
	defer heart.Stop()

	fault := time.NewTicker(faultCheckEvery)
	defer fault.Stop()

	sendHeartbeat(conn, cfg.ID, aw.TaskID)

	switch drive(ctx, cfg, conn, st, heart, fault, down, aw) {
	case phaseDone:
	case phaseAbort:
		return
	case phaseFault:
		slog.Warn("fault", "rover", cfg.ID, "task", aw.TaskID, "phase", "drive")
		return
	}

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

	switch workPhase(ctx, cfg, conn, st, heart, fault, down, aw) {
	case phaseDone:
	case phaseAbort:
		return
	case phaseFault:
		slog.Warn("fault", "rover", cfg.ID, "task", aw.TaskID, "phase", "work")
		return
	}

	_ = conn.Flush()
	_ = conn.PublishJSON(wire.SubjTaskComplete, wire.Complete{
		TaskID: aw.TaskID,
		Robot:  cfg.ID,
	})
	slog.Info("complete", "rover", cfg.ID, "task", aw.TaskID)
}

type phaseResult int

const (
	phaseDone phaseResult = iota
	phaseAbort
	phaseFault
)

//nolint:gosec // G404: sim fault injection, not security-sensitive; math/rand/v2 is intended.
func rollFault(st *rover) bool {
	return rand.Float64() < st.failureProb()
}

func drive(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart, fault *time.Ticker, down <-chan struct{}, aw wire.Award) phaseResult {
	maxStep := roverSpeed * moveStep.Seconds()

	move := time.NewTicker(moveStep)
	defer move.Stop()

	if st.moveToward(aw.Pos, maxStep) {
		return phaseDone
	}
	for {
		select {
		case <-ctx.Done():
			return phaseAbort
		case <-down:
			return phaseAbort
		case <-fault.C:
			if rollFault(st) {
				return phaseFault
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

func workPhase(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart, fault *time.Ticker, down <-chan struct{}, aw wire.Award) phaseResult {
	ops := cfg.opsFor(aw.TaskID, aw.Type)
	if len(ops) == 0 {
		return workTimer(ctx, cfg, conn, st, heart, fault, down, aw)
	}
	return streamOps(ctx, cfg, conn, st, heart, fault, down, aw, ops)
}

func workTimer(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart, fault *time.Ticker, down <-chan struct{}, aw wire.Award) phaseResult {
	done := time.NewTimer(workDuration)
	defer done.Stop()
	tick := time.NewTicker(moveStep)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return phaseAbort
		case <-down:
			return phaseAbort
		case <-fault.C:
			if rollFault(st) {
				return phaseFault
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

func streamOps(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart, fault *time.Ticker, down <-chan struct{}, aw wire.Award, ops []wire.BuildOp) phaseResult {
	op := time.NewTicker(cfg.opEvery())
	defer op.Stop()
	tick := time.NewTicker(moveStep)
	defer tick.Stop()
	next := 0
	for {
		select {
		case <-ctx.Done():
			return phaseAbort
		case <-down:
			return phaseAbort
		case <-fault.C:
			if rollFault(st) {
				return phaseFault
			}
		case <-heart.C:
			sendHeartbeat(conn, cfg.ID, aw.TaskID)
		case <-tick.C:
			st.drainOverTime(drainPerWorkSec * moveStep.Seconds())
		case <-op.C:
			sendBuildOp(conn, aw.TaskID, next, ops[next])
			next++
			if next >= len(ops) {
				return phaseDone
			}
		}
	}
}

func sendBuildOp(conn *bus.Conn, task domain.TaskID, seq int, b wire.BuildOp) {
	_ = conn.PublishJSON(wire.SubjBuildOp(task), wire.BuildOpMsg{
		TaskID: task,
		Seq:    seq,
		Op:     b,
	})
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
		Site:    cfg.SiteID,
	})
}

func nowTick() domain.Tick {
	return domain.Tick(time.Now().UnixMilli())
}
