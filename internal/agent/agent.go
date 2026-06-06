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
	"swarmbuild/internal/harness/cache"
	"swarmbuild/internal/wire"
	"sync"
	"time"
)

// Mode selects how a rover sources the Build-op stream it emits while working a
// Task (bh-08). ModeReplay (the default) is byte-for-byte the pre-08 behaviour:
// the cache/primitive op stream with ZERO model calls. ModeLive opts the rover
// into running the Build harness (the Generator↔Evaluator loop) inline on the
// Model seam during its work phase — the deliberate, scoped break of ADR-0005,
// LIVE MODE ONLY.
type Mode string

const (
	// ModeReplay is the deterministic default: the rover replays the committed
	// cache or the primitive op stream and never reaches the Model seam.
	ModeReplay Mode = "replay"
	// ModeLive opts the rover into inline generation: in its work phase it runs
	// the Build harness via the injected LiveBuilder seam (a live model call) and
	// streams the accepted spec on build.op.<task>. The harness RETRIES a transient
	// model fault (bounded, per call); a non-model fall-back (gate exhaustion / no
	// contract) degrades to the replay/primitive stream so the Task still completes.
	// A MODEL failure routes through self-heal (bh-08f): once the rover's failure
	// count crosses LiveFailureThreshold the rover DIES (releases its lease / stops
	// heartbeating) and the existing expiry → re-auction path reassigns the Task — an
	// LLM that won't cooperate becomes just another dead robot.
	ModeLive Mode = "live"
)

// effectiveMode resolves the mode for ONE awarded Task (bh-08c): the per-Task mode
// tag the coordinator stamped onto the Award (from a placeBlueprint) WINS, so the
// operator's per-placement choice is honoured even on a rover whose Config.Mode is
// the replay default. When the Task carries no mode (the empty default — every
// pre-08c award, the whole startup board), the rover falls back to its Config.Mode,
// so `cmd/agent --build-mode=live` still drives a whole rover live. Any value other
// than the explicit ModeLive (incl. "replay" and the empty fallback) is replay, so
// a malformed tag can never silently start live model calls.
func effectiveMode(taskMode string, cfgMode Mode) Mode {
	if taskMode == string(ModeLive) {
		return ModeLive
	}
	if taskMode == "" && cfgMode == ModeLive {
		return ModeLive
	}
	return ModeReplay
}

// LiveBuilder is the agent's INJECTED seam onto the Build harness (bh-08, live
// mode). BuildLive runs the Generator↔Evaluator refine loop for one Task via the
// Model seam and STREAMS each accepted/revised refine iteration as a batch of patch
// ops through emit, AS the loop produces it (bh-08d): the first accepted spec is
// place ops, later iterations are move/delete/place patches that self-correct the
// world in place. It returns ok=true once at least one iteration was emitted, or
// ok=false on exhaustion/error (nothing emitted) so the rover degrades to its
// deterministic replay/primitive stream and the Task still completes.
//
// emit is called on the builder's goroutine, once per accepted iteration; the rover
// hands the batch off promptly (a buffered channel) and paces the ops onto
// build.op.<task> by the Choreography cadence, so a whole iteration never lands in
// one tick and the rover keeps heartbeating throughout the (possibly slow) model
// call. emit must not be called after BuildLive returns.
//
// It is an INTERFACE held on Config — the agent package never imports
// internal/harness/{model,loop} itself, so the coordinator (which imports agent)
// keeps the Model seam OUT of its hot-path import closure (ADR-0005, enforced by
// the archtest). The composition root (cmd/agent) constructs the model-backed
// implementation and injects it here, exactly as the gateway injects its
// LabRunner. A nil LiveBuilder in live mode degrades to the replay stream.
type LiveBuilder interface {
	BuildLive(ctx context.Context, task domain.TaskID, taskType domain.TaskType, emit func(iterationOps []wire.BuildOp)) (ok bool)
}

// liveFaultReporter is the OPTIONAL richer seam the live work phase prefers when a
// LiveBuilder implements it (bh-08f): BuildLiveFault returns whether the build
// succeeded (ok) AND — when it did not — whether the cause was a MODEL FAILURE (the
// model would not produce a spec after the harness's bounded retries, modelFailed=
// true) as opposed to a gate exhaustion / unbuildable contract (modelFailed=false).
// The rover counts a model failure toward its death threshold (route through
// self-heal) but merely degrades on a non-model fall-back. It returns two plain
// booleans (no shared struct) so the agent matches it structurally WITHOUT importing
// the live package — which would pull the Model seam onto the agent's import graph and
// break the archtest. It is a SEPARATE optional interface so the LiveBuilder contract
// stays byte-stable: a builder that does not implement it is never routed through the
// death path (every failure degrades, the pre-08f behaviour).
type liveFaultReporter interface {
	BuildLiveFault(ctx context.Context, task domain.TaskID, taskType domain.TaskType, emit func(iterationOps []wire.BuildOp)) (ok, modelFailed bool)
}

// Config is the static identity and starting state of one rover. HeartbeatEvery
// is how often the rover renews a lease it holds (and is the cadence the
// coordinator's TTL is sized against, TTL ≥ 3× this).
type Config struct {
	ID             domain.RobotID
	Pos            domain.Vec2
	Battery        float64
	Capabilities   []domain.Capability
	HeartbeatEvery time.Duration // e.g. 500ms

	// Mode selects how the work phase sources its Build-op stream (bh-08). Empty or
	// ModeReplay ⇒ the deterministic cache/primitive stream with ZERO model calls
	// (the untouched default). ModeLive ⇒ the rover runs the Build harness inline
	// via LiveBuilder during its work phase (the scoped ADR-0005 break, live only).
	Mode Mode

	// LiveBuilder is the injected Build-harness seam used ONLY in ModeLive: the
	// work phase calls it to generate the Task's ops via the Model seam. nil (or
	// any non-live Mode) ⇒ the rover never reaches it and uses the replay/primitive
	// stream. Injected by the composition root so the agent package itself never
	// imports the Model seam (ADR-0005 / archtest).
	LiveBuilder LiveBuilder

	// LiveFailureThreshold is the per-Rover MODEL-failure budget in live mode
	// (bh-08f): the number of times the live build may fail because the model would
	// not cooperate (after the harness's own bounded per-call retries) before the
	// rover DIES — it stops heartbeating / releases its lease so the existing
	// expiry → re-auction path reassigns the Task to a healthy rover. No special
	// supervisory logic: a model that won't build is just another dead robot. A
	// non-model fall-back (gate exhaustion / unbuildable contract) never counts
	// toward this and degrades to the replay/primitive stream instead. Zero ⇒
	// defaultLiveFailureThreshold; a value < 1 is treated as 1 (one failure kills).
	LiveFailureThreshold int

	// FailTask, if non-empty, makes this rover abandon that task instead of
	// completing it: on award it drives to the task, then reports execution
	// failure via wire.Failed rather than wire.Complete, and never bids on that
	// task again (it has "lost the capability" for it). Deterministic fault
	// injection for the slice-03 self-heal demo/test.
	FailTask domain.TaskID

	// RecoverAfter is how long a killed rover stays OUT OF SERVICE before it
	// revives IN PLACE — at the exact position where it went down. The dashboard
	// "kill" is a recoverable outage, not a permanent death: we simulate a real
	// failure. The swarm self-heals the downed rover's task while it is dark, then
	// the SAME rover rejoins the swarm after this delay, at its failure spot.
	// Zero means defaultRecoverAfter.
	RecoverAfter time.Duration

	// SettleAfterRevive is the post-revival grace window: once a rover comes back
	// it is alive and visible at its recovery spot but HOLDS STATION — it does not
	// bid for new work — for this long, so the in-place comeback is legible before
	// it rejoins the swarm and drives off to the next task. Zero means
	// defaultSettleAfterRevive.
	SettleAfterRevive time.Duration

	// BuildOps OVERRIDES the deterministic per-task-type op stream (opsource.go)
	// this rover emits while working a Task (bh-02). nil ⇒ use the cache-or-primitive
	// path, the normal path. A non-nil EMPTY slice forces the rover to emit ZERO ops,
	// which the invariant test uses to prove that with no Build spec the Task
	// completion + self-heal behaviour is byte-for-byte the pre-harness path
	// (the work phase falls back to the fixed work timer). Keyed by task type so
	// one swarm config can drive a mixed blueprint deterministically.
	BuildOps map[domain.TaskType][]wire.BuildOp

	// BlueprintID names the blueprint this rover builds for, used to look up a
	// baked Build spec in the replay cache (keyed {blueprintId, taskId}) before the
	// rover falls back to the deterministic primitive stream (bh-03, ADR-0007). Empty
	// ⇒ the rover never consults the cache and always uses the primitive stream, so
	// the cache-replay path is purely additive and opt-in per swarm config.
	BlueprintID string

	// ReplaySpec, when set, OVERRIDES the embedded cache lookup with an explicit
	// (blueprintId, taskId) → ops resolver. nil ⇒ the rover consults the committed
	// embedded cache (cache.Embedded). This seam lets a test inject a deterministic
	// cache (hit or forced miss) with no embedded-file dependency, and keeps the
	// agent importing only declarative cache DATA — never the Model seam (ADR-0005).
	ReplaySpec func(blueprintID, taskID domain.TaskID) ([]wire.BuildOp, bool)
}

// liveEnabled reports whether this rover should source its work-phase ops from the
// injected Build harness for the EFFECTIVE mode of the awarded Task (bh-08c): live
// mode with a builder wired AND no explicit Config.BuildOps override (which — incl.
// a forced-empty slice — is the tests/invariant path and beats every source in both
// modes, keeping that suite model-free regardless of Mode). mode is
// effectiveMode(aw.Mode, cfg.Mode): the per-Task tag wins, falling back to
// Config.Mode, so one rover replays a replay-tagged Task and builds live for a
// live-tagged Task in the same world rather than the mode being fixed per-rover.
func (c Config) liveEnabled(mode Mode) bool {
	return mode == ModeLive && c.LiveBuilder != nil && c.BuildOps == nil
}

// liveFailureThreshold is the per-Rover model-failure budget for live mode (bh-08f):
// Config.LiveFailureThreshold when positive, else defaultLiveFailureThreshold; a
// value of exactly 1 is honoured (one model failure kills). Clamped to ≥ 1 so a
// misconfigured non-positive value never disables the death path silently.
func (c Config) liveFailureThreshold() int {
	if c.LiveFailureThreshold > 0 {
		return c.LiveFailureThreshold
	}
	return defaultLiveFailureThreshold
}

// opsFor resolves the ordered op stream this rover emits while working task (of
// type t), in strict precedence:
//
//  1. Config.BuildOps override (incl. a forced-empty slice) — tests/invariant path.
//  2. A baked spec in the replay cache for (BlueprintID, task) — the HEADLINE
//     deterministic replay (bh-03): a cache HIT replays the committed spec.
//  3. buildOpsFor(t) — the deterministic primitive stream (the cache-MISS fallback,
//     bh-02). An unknown type yields nil, so the work phase runs the fixed timer.
//
// A nil result means "no ops": the work phase runs the fixed work timer exactly as
// the pre-harness rover did.
func (c Config) opsFor(task domain.TaskID, t domain.TaskType) []wire.BuildOp {
	if c.BuildOps != nil {
		return c.BuildOps[t] // may be nil/empty: caller forced no ops for this type
	}
	if ops, ok := c.replayOps(task); ok {
		return ops // cache hit: replay the committed baked spec deterministically
	}
	return buildOpsFor(t) // cache miss (or no blueprint): primitive fallback stream
}

// replayOps looks up a baked spec for (BlueprintID, task) via the configured
// resolver (or the committed embedded cache by default). It returns ok=false —
// the primitive fallback — when there is no blueprint, no resolver/cache, or no
// baked entry for the task. It NEVER reaches the Model seam: replay is pure data.
func (c Config) replayOps(task domain.TaskID) ([]wire.BuildOp, bool) {
	if c.BlueprintID == "" {
		return nil, false // not configured for cache replay: always primitive
	}
	if c.ReplaySpec != nil {
		return c.ReplaySpec(domain.TaskID(c.BlueprintID), task)
	}
	ec, err := cache.Embedded()
	if err != nil || ec == nil {
		return nil, false // a bad/empty embedded cache degrades to primitive, never panics
	}
	return ec.Lookup(c.BlueprintID, string(task))
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

	// workDuration is how long the rover "works" the task after arriving, before
	// reporting completion, WHEN it has no build ops to emit (the pre-harness
	// fallback and the forced-empty-ops invariant path). When the rover does emit
	// ops, the work phase instead lasts until every op has been streamed.
	workDuration = 600 * time.Millisecond

	// opEvery is the build-op pacing: the rover emits at most one op per interval
	// so the structure rises at a watchable speed rather than all ops landing in a
	// single tick (ADR-0007 — paced by the Choreography cadence, derived from real
	// emission). It is brisk enough that a handful of ops still completes inside a
	// test budget. A heartbeat still goes out on its own cadence throughout.
	opEvery = 120 * time.Millisecond

	// minBattery floors the charge so 1/battery (used by the cost function for
	// bidding) stays finite — the rover never bricks itself in the demo.
	minBattery = 0.02
)

// telemetryEvery is how often a rover self-reports position/battery/health/load.
const telemetryEvery = 200 * time.Millisecond

// defaultLiveFailureThreshold is the per-Rover MODEL-failure budget in live mode when
// Config.LiveFailureThreshold is left zero (bh-08f): after this many model failures
// (each already past the harness's bounded per-call retries) the rover dies and its
// Task re-auctions. Small so an uncooperative model is shed quickly, > 1 so a single
// transient blip that slips past the per-call retry does not instantly kill an
// otherwise-healthy rover.
const defaultLiveFailureThreshold = 3

// defaultRecoverAfter is how long a killed rover stays dark before it revives in
// place when Config.RecoverAfter is left zero. Long enough to clearly watch the
// rover go down and the swarm re-auction its task to a neighbour, short enough to
// keep the demo moving — the downed rover then rejoins at its failure position.
const defaultRecoverAfter = 6 * time.Second

// defaultSettleAfterRevive is the post-revival hold window when
// Config.SettleAfterRevive is left zero: a freshly revived rover sits at its
// recovery spot (alive, but not bidding) this long so the in-place comeback is
// visible before it picks up new work and drives away.
const defaultSettleAfterRevive = 2500 * time.Millisecond

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

	// liveFailures counts live-mode MODEL failures across this rover's lifetime
	// (bh-08f): each live build that fell back because the model would not produce a
	// spec (past the harness's bounded per-call retries) bumps it; once it reaches
	// the configured threshold the rover dies (kill) so the swarm self-heals its Task
	// via expiry → re-auction. Guarded by mu.
	liveFailures int

	// down is the recoverable-outage signal. kill() closes the CURRENT down
	// channel to abort any in-flight execution (the drive/work loops select on
	// the channel captured at the start of their run) and clears alive, so the
	// rover stops bidding and heartbeating and the coordinator self-heals its
	// lease by TTL expiry. The rover stays put at its failure position. After
	// recoverAfter, revive() installs a FRESH open down channel and sets alive
	// again, so the same rover rejoins the swarm in place. Guarded by mu.
	down chan struct{}

	// recoverAfter is this rover's outage window (Config.RecoverAfter, or
	// defaultRecoverAfter when zero); reviveTimer fires revive() that long after a
	// kill. The timer is held so Run can stop it on shutdown. Guarded by mu.
	recoverAfter time.Duration
	reviveTimer  *time.Timer

	// recovering is the post-revival settle state: true from revive() until the
	// settle window elapses. While recovering the rover is alive (visible at its
	// recovery spot) but does NOT bid, so it holds station before rejoining the
	// swarm. settleAfter is the window (Config.SettleAfterRevive, or
	// defaultSettleAfterRevive when zero); settleTimer clears recovering. Both
	// guarded by mu.
	recovering  bool
	settleAfter time.Duration
	settleTimer *time.Timer
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

// kill takes the rover OUT OF SERVICE as a recoverable outage (a simulated real
// failure), NOT a permanent death. It clears alive (so the bid-on-announce path
// stops bidding and awards are dropped) and closes the CURRENT down channel,
// which the drive and work loops select on to stop heartbeating and abandon any
// in-flight execution WITHOUT completing it — so the coordinator self-heals the
// lease by TTL expiry. The rover stays put at its failure position and keeps
// emitting alive=false telemetry. It then schedules revive() after recoverAfter,
// so the SAME rover rejoins the swarm in place. A kill while already down is a
// harmless no-op (it neither double-closes down nor restarts the timer).
func (r *rover) kill() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.alive {
		return // already down: idempotent
	}
	r.alive = false
	close(r.down)
	d := r.recoverAfter
	if d <= 0 {
		d = defaultRecoverAfter
	}
	r.reviveTimer = time.AfterFunc(d, r.revive)
}

// revive brings a downed rover back into service at its CURRENT position once
// the outage window elapses. It installs a fresh open down channel (so a future
// kill gets its own signal) and sets alive, so the rover comes back from wherever
// it went down — never from its start position. It then enters the SETTLE window
// (recovering=true): the rover is alive and visible at its recovery spot but does
// NOT bid for new work until the settle timer clears it, so the in-place comeback
// is legible before it drives off. A no-op if the rover is already alive (e.g. a
// revival that raced shutdown or a redundant call).
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

// endSettle ends the post-revival hold: the rover stops holding station and may
// bid for new work again. Fired by the settle timer settleAfter a revive.
func (r *rover) endSettle() {
	r.mu.Lock()
	r.recovering = false
	r.settleTimer = nil
	r.mu.Unlock()
}

// isRecovering reports whether the rover is in its post-revival settle window
// (alive but holding station, not yet bidding). Read under the rover mutex.
func (r *rover) isRecovering() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.recovering
}

// downCh returns the rover's CURRENT outage channel. An execute goroutine reads
// it once at the start of its run, so a kill during that run aborts it via the
// channel it captured, while a run that starts after a later revival selects on
// the fresh channel that revival installed.
func (r *rover) downCh() chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.down
}

// stopTimers halts any pending revival or settle timer so a shutdown rover does
// not flip itself back alive (or clear its settle state) after Run returns. Safe
// to call when no timer is pending.
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

// recordLiveFailure bumps the lifetime live-mode model-failure count and reports the
// new total, so the live work phase can compare it against the rover's death
// threshold (bh-08f). Guarded by the rover mutex.
func (r *rover) recordLiveFailure() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.liveFailures++
	return r.liveFailures
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
		pos:          cfg.Pos,
		battery:      cfg.Battery,
		alive:        true,
		down:         make(chan struct{}),
		recoverAfter: cfg.RecoverAfter,
		settleAfter:  cfg.SettleAfterRevive,
	}
	// Stop any pending revival/settle timers on shutdown so a killed rover never
	// flips itself back alive (or clears its settle state) after Run has returned.
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
		if st.isRecovering() {
			return // post-revival settle: back in place but holding station, not bidding yet
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
//   - A "kill" naming THIS rover triggers a recoverable outage: it stops bidding,
//     heartbeating and executing so the coordinator self-heals the lease by TTL
//     expiry, stays dark at its failure position, then revives in place after the
//     outage window. Kills for other robots are ignored; a repeated kill while
//     already down is a no-op (kill is idempotent).
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

// telemetryLoop runs the rover's self-report stream until ctx is cancelled. It
// runs CONTINUOUSLY across a kill: while the rover is down it keeps emitting
// alive=false telemetry at its (unchanging) failure position, so the dashboard
// shows the rover stopped exactly where it failed rather than vanishing; once it
// revives it resumes alive=true telemetry from that same spot. The kill itself
// is reflected within one tick (alive flips in kill()).
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

	// Capture THIS run's outage signal once: a kill during the run closes it and
	// the drive/work loops abort; a kill+revive that already happened means this
	// run selects on the fresh channel revival installed (it only runs while alive).
	down := st.downCh()

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

	switch drive(ctx, cfg, conn, st, heart, fault, down, aw) {
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

	switch workPhase(ctx, cfg, conn, st, heart, fault, down, aw) {
	case phaseDone:
		// worked the task to completion: fall through to report Complete below
	case phaseAbort:
		return // ctx cancelled or rover killed mid-work: no completion
	case phaseFault:
		slog.Warn("fault", "rover", cfg.ID, "task", aw.TaskID, "phase", "work")
		return // random fault mid-work: silently abandon, lease TTL-expires
	}

	// Flush the build-op stream to the server BEFORE reporting completion so the
	// final op is durably appended ahead of the Complete (bh-02). Complete and
	// build.op ride different subjects; without this, a Complete could overtake the
	// last op on a loaded bus and the coordinator would drop that op as arriving
	// for an already-DONE task — losing the keystone of the structure.
	_ = conn.Flush()
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
func drive(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart, fault *time.Ticker, down <-chan struct{}, aw wire.Award) phaseResult {
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
		case <-down:
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

// workPhase holds the rover at the worksite while it WORKS the task, draining
// battery over time and heartbeating the lease. Its duration is now driven by
// the Task's build-op stream (bh-02): the rover emits one op per opEvery tick on
// wire.SubjBuildOp(task) — the structure rising op-by-op IS the work — and
// completes once the whole stream has been streamed. When the rover has no ops
// to emit (the pre-harness fallback, or the forced-empty-ops invariant path) it
// instead holds for the fixed workDuration, byte-for-byte the old behaviour.
//
// Op emission is idempotent by Seq: the rover always emits from Seq 0, and the
// coordinator appends an op only when its Seq is the next expected slot, so a
// replacement Rover resuming a partially-built Task re-confirms the ops already
// appended (deduped) and continues from where its predecessor stopped. The op
// stream is a pure function of the Task, so the final op-set converges whether
// or not a kill interrupted the build.
//
// It returns phaseDone on completion, phaseAbort if ctx is cancelled or the
// rover is killed first, and phaseFault if the random-failure roll fires (issue
// 08). On anything but phaseDone the caller must NOT complete the task — the
// rover goes silent, its partial ops stay durable, and the coordinator
// self-heals the lease.
func workPhase(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart, fault *time.Ticker, down <-chan struct{}, aw wire.Award) phaseResult {
	// LIVE mode (bh-08d/08f): stream each refine iteration's patch ops as the Build
	// harness produces them, pacing emission by the Choreography cadence while
	// heartbeating. A non-model fall-back (gate exhaustion / no contract) degrades to
	// the deterministic replay/primitive stream — that path never crashes the swarm.
	// A MODEL failure routes through self-heal (bh-08f): once the rover's failure count
	// crosses its threshold the rover DIES so the Task re-auctions. The live/replay
	// decision uses the EFFECTIVE mode for THIS Task (bh-08c): the awarded Task's
	// per-Task tag wins, falling back to Config.Mode when the Task carries none.
	mode := effectiveMode(aw.Mode, cfg.Mode)
	if cfg.liveEnabled(mode) {
		res, outcome := streamLiveOps(ctx, cfg, conn, st, heart, fault, down, aw)
		if res != phaseDone {
			return res // ctx cancelled / killed / faulted mid-stream: no completion
		}
		switch outcome {
		case liveEmitted:
			return phaseDone // the live harness streamed at least one iteration
		case liveModelDied:
			// The rover crossed its model-failure threshold and killed itself: stop
			// heartbeating and abandon the Task WITHOUT completing it, so the
			// coordinator self-heals the lease by TTL expiry and re-auctions it to a
			// healthy rover (bh-08f). No primitive fallback on this path.
			slog.Warn("live build: rover died past model-failure threshold; abandoning task for re-auction",
				"rover", cfg.ID, "task", aw.TaskID)
			return phaseAbort
		case liveDegrade:
			// fall through: a non-model fall-back, degrade to replay/primitive.
		}
	}

	// Replay/fallback: resolve the deterministic op stream (a map/cache lookup, no
	// model call) and pace it, byte-for-byte the pre-08 behaviour.
	ops := cfg.opsFor(aw.TaskID, aw.Type)
	if len(ops) == 0 {
		// No ops to stream: hold for the fixed work timer (pre-harness fallback) —
		// the path the forced-empty-ops invariant test exercises.
		return workTimer(ctx, cfg, conn, st, heart, fault, down, aw)
	}
	return streamOps(ctx, cfg, conn, st, heart, fault, down, aw, ops)
}

// liveOutcome is how a completed (phaseDone) live build dispositions the Task: it
// streamed ops, it should degrade to replay/primitive, or the rover died past its
// model-failure threshold and the Task must re-auction (bh-08f).
type liveOutcome int

const (
	liveEmitted   liveOutcome = iota // the harness streamed at least one iteration
	liveDegrade                      // a non-model fall-back: degrade to replay/primitive
	liveModelDied                    // a model failure crossed the death threshold: rover killed
)

// streamLiveOps runs the injected Build harness on a background goroutine and PACES
// each refine iteration's patch batch onto build.op.<task> as it arrives, while this
// loop keeps heartbeating (the model call can take SECONDS — far longer than the
// lease TTL ≥ 3× heartbeat — so without a heartbeat throughout the lease would
// false-expire and the coordinator would re-auction the Task out from under the
// rover). Successive iterations carry move/delete/place patches (08a op identity) so
// the world visibly grows and self-corrects between passes, folded by the renderer.
//
// Pacing reuses the opEvery cadence: ops are buffered as they stream in and emitted
// at most one per opEvery tick, so a whole iteration never lands in one ~100ms tick.
// Each op's Seq is its monotonic slot in the Task's accumulating patch log (the
// coordinator appends only at the next expected Seq), continuing ACROSS iterations.
//
// The model call is bound to a context cancelled on kill/ctx-done, so a killed rover
// does not keep an LLM call in flight for a Task it has abandoned. It returns the
// phase result and, on phaseDone, the liveOutcome: streamed (complete), degrade
// (non-model fall-back), or died (a model failure crossed the rover's threshold so
// the rover killed itself and the Task must re-auction, bh-08f).
func streamLiveOps(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart, fault *time.Ticker, down <-chan struct{}, aw wire.Award) (phaseResult, liveOutcome) {
	genCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	build := startLiveBuilder(genCtx, cfg, aw)

	op := time.NewTicker(opEvery)
	defer op.Stop()
	tick := time.NewTicker(moveStep)
	defer tick.Stop()

	var (
		pending []wire.BuildOp // ops received but not yet paced out
		next    int            // monotonic Seq across all iterations
		genDone bool
	)
	for {
		// Once generation is done AND every buffered op has been streamed, the live
		// build is complete: streamed something, or produced nothing and we decide
		// between degrade and death based on whether the model failed (bh-08f).
		if genDone && len(pending) == 0 {
			return finishLiveBuild(ctx, cfg, st, down, aw, build, next)
		}
		select {
		case <-ctx.Done():
			cancel()
			return phaseAbort, liveEmitted
		case <-down:
			cancel() // killed mid-stream: stop the in-flight model call; partial ops stay durable
			return phaseAbort, liveEmitted
		case <-fault.C:
			if rollFault(st) {
				cancel()
				return phaseFault, liveEmitted
			}
		case <-heart.C:
			sendHeartbeat(conn, cfg.ID, aw.TaskID)
		case <-tick.C:
			st.drainOverTime(drainPerWorkSec * moveStep.Seconds())
		case b, ok := <-build.batches:
			genDone = genDone || !ok // closed channel ⇒ builder finished; drain remaining, then complete
			pending = append(pending, b...)
		case <-op.C:
			// Pace one buffered op out; nothing buffered yet just waits (still heartbeating).
			pending, next = paceOp(conn, aw.TaskID, pending, next)
		}
	}
}

// finishLiveBuild dispositions a completed live build (generation done, buffer
// drained): it streamed something (liveEmitted/phaseDone), or produced nothing —
// in which case a teardown (ctx/down) is an abort, otherwise dispositionNoOps decides
// degrade vs. death from the model-failure flag (bh-08f).
func finishLiveBuild(ctx context.Context, cfg Config, st *rover, down <-chan struct{}, aw wire.Award, build liveBuild, next int) (phaseResult, liveOutcome) {
	if next > 0 {
		return phaseDone, liveEmitted
	}
	// A build that finished only because the rover is shutting down or was killed
	// (ctx/down) reports modelFailed via the cancelled loop — but that is NOT a model
	// fault, so abort without recording a failure or self-killing.
	if isDone(ctx, down) {
		return phaseAbort, liveEmitted
	}
	return phaseDone, dispositionNoOps(cfg, st, aw, build.modelFailed())
}

// isDone reports whether the rover's run is being torn down — the execute context is
// cancelled (shutdown) or the rover's outage channel is closed (kill) — so a live
// build that finished only because it was cancelled is treated as an abort, not a
// model fault (bh-08f).
func isDone(ctx context.Context, down <-chan struct{}) bool {
	select {
	case <-ctx.Done():
		return true
	case <-down:
		return true
	default:
		return false
	}
}

// dispositionNoOps decides what a live build that emitted ZERO ops means for the Task
// (bh-08f). A non-model fall-back (gate exhaustion / unbuildable contract) degrades
// to the replay/primitive stream. A MODEL failure bumps the rover's lifetime failure
// count: under the threshold it still degrades (one transient blip should not orphan
// the Task), but once it crosses the threshold the rover KILLS itself (releases its
// lease / stops heartbeating) so the existing expiry → re-auction path reassigns the
// Task to a healthy rover — no special supervisory logic, no primitive on this path.
func dispositionNoOps(cfg Config, st *rover, aw wire.Award, modelFailed bool) liveOutcome {
	if !modelFailed {
		return liveDegrade
	}
	failures := st.recordLiveFailure()
	if failures < cfg.liveFailureThreshold() {
		slog.Warn("live build: model failure under threshold; degrading to replay/primitive",
			"rover", cfg.ID, "task", aw.TaskID, "failures", failures, "threshold", cfg.liveFailureThreshold())
		return liveDegrade
	}
	st.kill() // an LLM that won't cooperate is just another dead robot (bh-08f)
	return liveModelDied
}

// paceOp emits the head of pending (if any) on build.op.<task> at its monotonic Seq
// and returns the advanced buffer + next Seq, so the live pacer streams at most one
// op per opEvery tick (Choreography cadence) and a whole iteration never lands in
// one tick. An empty buffer is a no-op (the rover keeps heartbeating, waiting).
func paceOp(conn *bus.Conn, task domain.TaskID, pending []wire.BuildOp, next int) ([]wire.BuildOp, int) {
	if len(pending) == 0 {
		return pending, next
	}
	sendBuildOp(conn, task, next, pending[0])
	return pending[1:], next + 1
}

// liveBuild is the handle the pacer holds onto the background Build harness goroutine
// (bh-08f): batches carries each accepted iteration's patch batch and is closed when
// generation finishes; modelFailed reports — AFTER the channel has closed (the pacer
// only consults it once it has observed genDone) — whether the build fell back
// because the MODEL failed to produce a spec, distinct from a gate exhaustion / no
// contract. The bool is written before close(batches), so a reader that has seen the
// close has a happy-before edge to it without extra synchronisation.
type liveBuild struct {
	batches      <-chan []wire.BuildOp
	modelFailedP *bool
}

// modelFailed reports whether the finished build's empty result was caused by a model
// failure. Only valid once the batches channel has closed (the pacer's contract);
// before that it reads the zero value.
func (b liveBuild) modelFailed() bool { return *b.modelFailedP }

// startLiveBuilder runs the injected Build harness on its own goroutine and returns a
// liveBuild handle: the channel each accepted iteration's patch batch arrives on plus
// the post-completion model-failure flag (bh-08f). The channel is buffered (the
// builder's emit runs on the loop goroutine, never blocking on the pacer) and closed
// when generation finishes, so the pacer drains the remainder and completes. A
// killed/cancelled genCtx stops the builder feeding a dead pacer.
//
// When the LiveBuilder implements the optional liveFaultReporter seam, the goroutine
// captures whether the fall-back was a model failure so the pacer can route it
// through self-heal; a builder that does not implement it always reports false, so
// every fall-back simply degrades (the pre-08f behaviour).
func startLiveBuilder(genCtx context.Context, cfg Config, aw wire.Award) liveBuild {
	batches := make(chan []wire.BuildOp, 8)
	modelFailed := new(bool)
	emit := func(iterationOps []wire.BuildOp) {
		select {
		case batches <- iterationOps:
		case <-genCtx.Done(): // killed/cancelled: stop feeding a dead pacer
		}
	}
	go func() {
		defer close(batches)
		if fr, ok := cfg.LiveBuilder.(liveFaultReporter); ok {
			_, mf := fr.BuildLiveFault(genCtx, aw.TaskID, aw.Type, emit)
			*modelFailed = mf
			return
		}
		cfg.LiveBuilder.BuildLive(genCtx, aw.TaskID, aw.Type, emit)
	}()
	return liveBuild{batches: batches, modelFailedP: modelFailed}
}

// workTimer is the pre-harness work phase: hold at the worksite for the fixed
// workDuration, draining battery and heartbeating, with no build ops emitted.
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

// streamOps is the build-harness work phase: emit one op per opEvery tick on
// wire.SubjBuildOp(task) until the whole stream is out, draining battery and
// heartbeating meanwhile. Op emission starts at Seq 0 every time, so a
// replacement Rover resuming a partial Task re-confirms appended ops (deduped by
// the coordinator) and continues from where its predecessor stopped.
func streamOps(ctx context.Context, cfg Config, conn *bus.Conn, st *rover, heart, fault *time.Ticker, down <-chan struct{}, aw wire.Award, ops []wire.BuildOp) phaseResult {
	op := time.NewTicker(opEvery)
	defer op.Stop()
	tick := time.NewTicker(moveStep)
	defer tick.Stop()
	next := 0
	for {
		select {
		case <-ctx.Done():
			return phaseAbort
		case <-down:
			return phaseAbort // killed mid-work: abandon; the partial ops stay durable
		case <-fault.C:
			if rollFault(st) {
				return phaseFault // random fault mid-work: silently abandon
			}
		case <-heart.C:
			sendHeartbeat(conn, cfg.ID, aw.TaskID)
		case <-tick.C:
			st.drainOverTime(drainPerWorkSec * moveStep.Seconds())
		case <-op.C:
			sendBuildOp(conn, aw.TaskID, next, ops[next])
			next++
			if next >= len(ops) {
				return phaseDone // whole op stream emitted: the structure is complete
			}
		}
	}
}

// sendBuildOp publishes one streamed build op on wire.SubjBuildOp(task). Seq is
// the op's zero-based slot; the coordinator appends it only when Seq is the next
// expected position, so re-emitted ops dedupe (bh-02).
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
	})
}

// nowTick maps the wall clock to a domain.Tick in milliseconds, matching the
// coordinator's wall clock so heartbeat timestamps are comparable.
func nowTick() domain.Tick {
	return domain.Tick(time.Now().UnixMilli())
}
