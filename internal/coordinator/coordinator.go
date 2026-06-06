// Package coordinator is the SwarmBuild brain: the edge node (a lander) that
// loads a blueprint, runs the auction over NATS, tracks the World Model, and
// grants/expires leases.
//
// THE load-bearing design constraint (TECHSPEC §8, ADR-0003): a single-writer
// goroutine owns ALL mutable state — the Task Planner, the World Model, the
// Lease Manager, and the open auctions. Every state change flows through ONE
// channel of inbound events, so an award and an expiry can never interleave and
// no task is ever double-assigned. NATS subscription callbacks run on the NATS
// dispatcher goroutine and NEVER touch state directly: they only enqueue events
// onto the single-writer channel.
//
// This package wires the four pure deep modules through the bus. The deep
// modules stay pure (no NATS/wall-clock imports); coordinator is the only place
// they meet the live world.
package coordinator

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/core/lease"
	"swarmbuild/internal/core/planner"
	"swarmbuild/internal/core/world"
	"swarmbuild/internal/harness/spec"
	"swarmbuild/internal/wire"
	"time"
)

// BlueprintTask pairs a domain.Task with its worksite position. domain.Task has
// no position field (the deep modules do not care where a task is); the
// coordinator keeps the geometry here so it can announce a task's Pos for
// distance-based bidding without polluting the pure domain.
type BlueprintTask struct {
	Task domain.Task
	Pos  domain.Vec2
}

// Config configures one coordinator run: where NATS lives, the blueprint to
// build, the rovers to spawn in-process, and the auction/lease timing.
type Config struct {
	// NATSURL is the bus to connect to; empty means nats.DefaultURL.
	NATSURL string
	// Blueprint is the tasks to build, with their worksite positions.
	Blueprint []BlueprintTask
	// Rovers are the in-process rovers to spawn (ADR-0001). Each becomes an
	// independent NATS client.
	Rovers []agent.Config
	// AuctionWindow is how long an open auction collects bids before it closes
	// and a winner is picked (e.g. 400ms).
	AuctionWindow time.Duration
	// HeartbeatEvery is the rover heartbeat cadence the lease TTL is sized
	// against. If a rover Config leaves HeartbeatEvery zero it is defaulted to
	// this.
	HeartbeatEvery time.Duration
	// TTLFactor multiplies HeartbeatEvery to get the lease TTL; must be ≥ 3 so a
	// slow tick cannot false-expire a healthy rover (TECHSPEC §8). Values < 3
	// are bumped to 3.
	TTLFactor int
	// SnapshotHz is how many world snapshots per second to publish (~10).
	SnapshotHz int
	// ScriptedKills are deterministic, event-triggered kills for the demo
	// rehearsal (slice 06): when WhenTaskLeased is granted to a rover, that rover
	// is killed After the delay, over the SAME wire.Control path as a dashboard
	// KILL — so the heal that follows is entirely genuine. This reproduces the
	// kill→heal money shot at the same beat every run. Empty in production.
	ScriptedKills []ScriptedKill
	// BuildSpecs is an OPTIONAL per-Task Build spec (TECHSPEC §4, ADR-0006):
	// declarative geometry the renderer interprets instead of the primitive
	// fallback. In bh-01 this carries a single hardcoded SAMPLE spec to prove the
	// wire seam end-to-end; a later slice replaces it with generated/cached specs
	// streamed over NATS. It is validated once at Run (off the hot path) and then
	// attached to the matching TaskView in each snapshot — pure additive data, so
	// a Task without an entry renders exactly as before.
	BuildSpecs map[domain.TaskID][]wire.BuildOp
}

// ScriptedKill schedules one reproducible demo kill: once WhenTaskLeased is
// leased, its holder is killed After the delay. It is the only "pacing" the
// coordinator does, and it fakes nothing — it drives the real control path.
type ScriptedKill struct {
	WhenTaskLeased domain.TaskID
	After          time.Duration
	fired          bool // set once armed, so a kill triggers at most once
}

// armedKill is a scripted kill whose trigger task has been leased and which is
// now counting down to its fire time.
type armedKill struct {
	robot  domain.RobotID
	fireAt time.Time
}

// tickEvery is the single-writer loop's cadence: announce ready tasks, close
// due auctions, sweep expired leases. Kept brisk so an auction window closes
// promptly after it opens.
const tickEvery = 50 * time.Millisecond

// inbound events fed to the single-writer goroutine. Each is a closure-free
// value type so the channel carries plain data; the writer interprets them.
type (
	evBid       struct{ bid wire.Bid }
	evComplete  struct{ done wire.Complete }
	evFailed    struct{ failed wire.Failed }
	evHeartbeat struct{ hb wire.Heartbeat }
	evTelemetry struct{ tel wire.Telemetry }
	// evReload resets the demo board IN-PROCESS so the swarm rebuilds the dome
	// from scratch (reloadDemo control). It MUTATES owned state, so — like every
	// other event — it flows through the single-writer channel and is never
	// handled on the NATS dispatcher (TECHSPEC §8).
	evReload struct{}
)

// auction is one open auction: the bids received so far for a task during its
// window (keyed by task in state.auctions), and the wall-clock time the window
// closes.
type auction struct {
	bids     map[domain.RobotID]float64
	closesAt time.Time
}

// state is everything the single writer owns. Nothing here is touched outside
// the writer goroutine (TECHSPEC §8).
type state struct {
	plan     *planner.Plan
	model    *world.Model
	leases   *lease.Manager
	pos      map[domain.TaskID]domain.Vec2 // worksite geometry per task
	auctions map[domain.TaskID]*auction    // open auctions, keyed by task

	rovers map[domain.RobotID]wire.Telemetry // latest telemetry per rover

	// pendingEvents accumulates choreography beats (slice 06) emitted by real
	// engine events since the last snapshot; publishSnapshot drains them.
	pendingEvents []wire.Event
	scriptedKills []ScriptedKill // demo rehearsal kills (config copy)
	armedKills    []armedKill    // scripted kills counting down to fire

	// blueprint and cfgKills are pristine originals captured at Run, used ONLY by
	// onReload to rebuild the board from scratch (reloadDemo). blueprint is the
	// initial UNCLAIMED task set; cfgKills is an untouched copy of the configured
	// scripted kills (scriptedKills above has its fired flags mutated, so onReload
	// re-arms from this pristine copy instead).
	blueprint []domain.Task
	cfgKills  []ScriptedKill

	// buildSpecs holds pre-validated, optional per-Task Build specs (TECHSPEC §4,
	// ADR-0006). publishSnapshot attaches the matching spec to a TaskView so it
	// rides the real WS snapshot; a Task with no entry renders the primitive
	// fallback unchanged. Read-only after Run (validated once, off the hot path).
	buildSpecs map[domain.TaskID][]wire.BuildOp

	conn   *bus.Conn
	kv     *bus.KV
	clk    domain.Clock
	ttl    domain.Tick
	window time.Duration

	// earthCh hands a copy of each freshly-published tactical snapshot to the
	// Earth-uplink shim (runEarthUplink) over a buffered channel. publishSnapshot
	// sends NON-BLOCKING (drop on full), so the single writer never blocks on the
	// shim and the tactical loop is provably untouched by latency (ADR-0002):
	// snapshots are full-state and drop-safe, so a slow shim just loses frames.
	earthCh chan wire.EarthUplink
}

// Run loads the blueprint, spawns the in-process rovers, and runs the
// single-writer coordinator until ctx is cancelled. It returns the first fatal
// error (or ctx.Err() on shutdown).
func Run(ctx context.Context, cfg Config) error {
	if cfg.SnapshotHz <= 0 {
		cfg.SnapshotHz = 10
	}
	if cfg.AuctionWindow <= 0 {
		cfg.AuctionWindow = 400 * time.Millisecond
	}
	if cfg.HeartbeatEvery <= 0 {
		cfg.HeartbeatEvery = 500 * time.Millisecond
	}
	if cfg.TTLFactor < 3 {
		cfg.TTLFactor = 3 // TECHSPEC §8: TTL ≥ 3× heartbeat
	}

	// --- Load the blueprint into the Planner and seed the World Model. ---
	tasks := make([]domain.Task, len(cfg.Blueprint))
	posByTask := make(map[domain.TaskID]domain.Vec2, len(cfg.Blueprint))
	for i, bt := range cfg.Blueprint {
		tasks[i] = bt.Task
		posByTask[bt.Task.ID] = bt.Pos
	}
	plan, err := planner.Load(tasks)
	if err != nil {
		return fmt.Errorf("coordinator: load blueprint: %w", err)
	}

	model := world.NewModel()
	for _, t := range tasks {
		model.Apply(t) // seed each record at its initial (UNCLAIMED) version
	}

	// --- Connect the coordinator's own bus handle and seed the KV mirror. ---
	conn, kv, err := connectBus(ctx, cfg.NATSURL, tasks)
	if err != nil {
		return err
	}
	defer conn.Close()

	clk := wallClock{}
	ttl := domain.Tick(cfg.HeartbeatEvery.Milliseconds() * int64(cfg.TTLFactor))

	// --- Validate any optional Build specs ONCE, off the hot path (ADR-0006: a
	// malformed spec must never reach a snapshot). A rejected spec fails Run loudly
	// rather than silently shipping bad geometry to the browser. ---
	buildSpecs, err := validatedBuildSpecs(cfg.BuildSpecs)
	if err != nil {
		return fmt.Errorf("coordinator: invalid build spec: %w", err)
	}

	st := &state{
		plan:     plan,
		model:    model,
		leases:   lease.NewManager(clk, ttl),
		pos:      posByTask,
		auctions: make(map[domain.TaskID]*auction),
		rovers:   make(map[domain.RobotID]wire.Telemetry),
		conn:     conn,
		kv:       kv,
		clk:      clk,
		ttl:      ttl,
		window:   cfg.AuctionWindow,
		// Copy the scripted kills so arming them (setting fired) never mutates the
		// caller's Config slice.
		scriptedKills: append([]ScriptedKill(nil), cfg.ScriptedKills...),
		// Pristine originals for onReload (reloadDemo): the initial UNCLAIMED task
		// set and an untouched copy of the scripted kills to re-arm from.
		blueprint: append([]domain.Task(nil), tasks...),
		cfgKills:  append([]ScriptedKill(nil), cfg.ScriptedKills...),
		// Buffered so publishSnapshot's non-blocking send rarely drops; the shim
		// owns the channel's receive side.
		earthCh: make(chan wire.EarthUplink, 64),
		// Optional, pre-validated per-Task Build specs (bh-01: a hardcoded sample).
		buildSpecs: buildSpecs,
	}

	// --- Earth-uplink shim (issue 09): a SEPARATE goroutine owns the artificial
	// delay and the earth.uplink publish. It NEVER touches single-writer state,
	// heartbeats, telemetry, awards, or world.snapshot — only the new earth.uplink
	// feed is delayed (ADR-0002 / TECHSPEC §8). Latency is read atomically. ---
	shim := newEarthShim(conn, st.earthCh)

	// --- Inbound event channel: the ONLY way state is mutated. ---
	events := make(chan any, 256)

	// Subscriptions: callbacks run on the NATS dispatcher and only enqueue.
	unsub, err := subscribe(ctx, conn, events)
	if err != nil {
		return err
	}
	defer unsub()

	// Control subscription: runs on the NATS dispatcher.
	unsubCtl, err := subscribeControl(ctx, conn, shim, events)
	if err != nil {
		return err
	}
	defer unsubCtl()

	// Start the shim goroutine; its lifecycle is tied to ctx.
	shimDone := make(chan struct{})
	go func() {
		defer close(shimDone)
		shim.run(ctx)
	}()
	defer func() { <-shimDone }()

	// --- Spawn in-process rovers, each its own independent NATS client. ---
	roverCtx, cancelRovers := context.WithCancel(ctx)
	defer cancelRovers()
	if err := spawnRovers(roverCtx, cfg); err != nil {
		return err
	}

	// Flush so subscriptions are registered on the server before the first
	// announce goes out (deterministic test start).
	_ = conn.Flush()

	return st.runWriter(ctx, events, cfg)
}

// connectBus opens the coordinator's own hardened bus handle, binds the World
// Model KV bucket, and mirrors the seed world so a reader sees the initial board
// immediately. The caller owns conn and must Close it.
func connectBus(ctx context.Context, natsURL string, tasks []domain.Task) (*bus.Conn, *bus.KV, error) {
	conn, err := bus.Connect(ctx, natsURL, bus.ConnectOptions{
		Name:    "coordinator",
		MaxWait: 30 * time.Second,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("coordinator: connect: %w", err)
	}

	kv, err := conn.KV(ctx, wire.KVBucketWorld)
	if err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("coordinator: kv bucket: %w", err)
	}
	for _, t := range tasks {
		if perr := kv.PutJSON(ctx, string(t.ID), t); perr != nil {
			conn.Close()
			return nil, nil, fmt.Errorf("coordinator: kv seed %s: %w", t.ID, perr)
		}
	}
	return conn, kv, nil
}

// subscribe registers all coordinator subscriptions. Each callback runs on the
// NATS dispatcher goroutine and only enqueues an event onto the single-writer
// channel — it never touches state (TECHSPEC §8). It returns a single cleanup
// func that unsubscribes every subscription.
func subscribe(ctx context.Context, conn *bus.Conn, events chan<- any) (func(), error) {
	// enqueue hands an event to the single writer, dropping it only if ctx ends.
	enqueue := func(e any) {
		select {
		case events <- e:
		case <-ctx.Done():
		}
	}

	var unsubs []func()
	cleanup := func() {
		for _, u := range unsubs {
			u()
		}
	}
	add := func(unsub func(), err error, what string) error {
		if err != nil {
			cleanup()
			return fmt.Errorf("coordinator: subscribe %s: %w", what, err)
		}
		unsubs = append(unsubs, unsub)
		return nil
	}

	unsubBid, err := bus.SubscribeJSON(conn, wire.SubjBidWildcard, func(b wire.Bid) {
		enqueue(evBid{bid: b})
	})
	if err = add(unsubBid, err, "bids"); err != nil {
		return nil, err
	}
	unsubComplete, err := bus.SubscribeJSON(conn, wire.SubjTaskComplete, func(c wire.Complete) {
		enqueue(evComplete{done: c})
	})
	if err = add(unsubComplete, err, "complete"); err != nil {
		return nil, err
	}
	unsubFailed, err := bus.SubscribeJSON(conn, wire.SubjTaskFailed, func(f wire.Failed) {
		enqueue(evFailed{failed: f})
	})
	if err = add(unsubFailed, err, "failed"); err != nil {
		return nil, err
	}
	unsubHeartbeat, err := bus.SubscribeJSON(conn, wire.SubjHeartbeatWildcard, func(h wire.Heartbeat) {
		enqueue(evHeartbeat{hb: h})
	})
	if err = add(unsubHeartbeat, err, "heartbeat"); err != nil {
		return nil, err
	}
	unsubTelemetry, err := bus.SubscribeJSON(conn, wire.SubjTelemetryWildcard, func(tm wire.Telemetry) {
		enqueue(evTelemetry{tel: tm})
	})
	if err = add(unsubTelemetry, err, "telemetry"); err != nil {
		return nil, err
	}
	return cleanup, nil
}

// subscribeControl registers the dashboard control subscription, which runs on
// the NATS dispatcher goroutine. The two commands it handles take deliberately
// different paths (TECHSPEC §8):
//
//   - "setLatency" ONLY does an atomic store on the Earth-uplink shim. It does
//     NOT enqueue onto the single-writer events channel, so changing latency
//     cannot perturb auctions/leases/snapshots (ADR-0002).
//   - "reloadDemo" MUTATES owned state (Planner, World Model, leases, auctions),
//     so it must run on the single writer: the dispatcher only enqueues evReload.
//
// "kill" / "killContainer" / "setFailureProb" are handled by the agents and the
// killer sidecar, not here.
func subscribeControl(ctx context.Context, conn *bus.Conn, shim *earthShim, events chan<- any) (func(), error) {
	unsubCtl, err := bus.SubscribeJSON(conn, wire.SubjControl, func(c wire.Control) {
		switch c.Cmd {
		case "setLatency":
			shim.setLatency(c.Value)
		case "reloadDemo":
			select {
			case events <- evReload{}:
			case <-ctx.Done():
			}
		}
	})
	if err != nil {
		return nil, fmt.Errorf("coordinator: subscribe control: %w", err)
	}
	return unsubCtl, nil
}

// spawnRovers starts each in-process rover as its own independent NATS client
// (ADR-0001), inheriting the coordinator's heartbeat cadence when unset. Each
// rover runs in its own goroutine and closes its connection on exit; roverCtx
// cancellation stops them all.
func spawnRovers(roverCtx context.Context, cfg Config) error {
	for _, rc := range cfg.Rovers {
		if rc.HeartbeatEvery <= 0 {
			rc.HeartbeatEvery = cfg.HeartbeatEvery
		}
		rconn, cerr := bus.Connect(roverCtx, cfg.NATSURL, bus.ConnectOptions{
			Name:    "rover-" + string(rc.ID),
			MaxWait: 30 * time.Second,
		})
		if cerr != nil {
			return fmt.Errorf("coordinator: connect rover %s: %w", rc.ID, cerr)
		}
		go func(c agent.Config, rc *bus.Conn) {
			defer rc.Close()
			if rerr := agent.Run(roverCtx, c, rc); rerr != nil && roverCtx.Err() == nil {
				slog.Error("rover exited", "rover", c.ID, "error", rerr)
			}
		}(rc, rconn)
	}
	return nil
}

// runWriter is the single-writer goroutine. It is the only code that mutates
// planner/world/lease/auction state. It drains inbound events and ticks the
// auction/lease loop, and publishes snapshots.
func (st *state) runWriter(ctx context.Context, events <-chan any, cfg Config) error {
	tick := time.NewTicker(tickEvery)
	defer tick.Stop()

	snapEvery := time.Second / time.Duration(cfg.SnapshotHz)
	snap := time.NewTicker(snapEvery)
	defer snap.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case e := <-events:
			st.handle(ctx, e)
		case <-tick.C:
			st.tick(ctx)
		case <-snap.C:
			st.publishSnapshot()
		}
	}
}

// handle applies one inbound event to the owned state.
func (st *state) handle(ctx context.Context, e any) {
	switch ev := e.(type) {
	case evBid:
		st.onBid(ev.bid)
	case evComplete:
		st.onComplete(ctx, ev.done)
	case evFailed:
		st.onFailed(ctx, ev.failed)
	case evHeartbeat:
		st.onHeartbeat(ev.hb)
	case evTelemetry:
		// A downed rover coming back (alive false→true) is a real engine event:
		// emit a "revived" beat so the dashboard can pulse the in-place comeback at
		// the rover's recovery spot. The browser looks up the position by Robot id.
		prev, had := st.rovers[ev.tel.Robot]
		st.rovers[ev.tel.Robot] = ev.tel
		if had && !prev.Alive && ev.tel.Alive {
			st.emit(wire.Event{Kind: wire.EventRevived, Robot: ev.tel.Robot})
		}
	case evReload:
		st.onReload(ctx)
	}
}

// emit buffers a choreography beat (slice 06), stamped with the current clock,
// to be drained into the next snapshot. Every beat reflects a real engine event
// that just happened; the browser only decorates the authoritative world with
// it (see wire Event kinds).
func (st *state) emit(e wire.Event) {
	e.At = st.clk.Now()
	st.pendingEvents = append(st.pendingEvents, e)
}

// onBid records a bid against its open auction. Bids for an auction that has
// already closed (or never opened) are dropped.
func (st *state) onBid(b wire.Bid) {
	a, ok := st.auctions[b.TaskID]
	if !ok {
		return
	}
	a.bids[b.Robot] = b.Cost
	st.emit(wire.Event{Kind: wire.EventBid, TaskID: b.TaskID, Robot: b.Robot, Value: b.Cost})
}

// onHeartbeat renews the lease TTL for the holder.
func (st *state) onHeartbeat(h wire.Heartbeat) {
	st.leases.Heartbeat(h.TaskID, h.Robot)
}

// onComplete handles a rover reporting its leased task finished: complete the
// lease, move the task to DONE in the World Model (version bumped), unblock its
// dependents in the Planner, and mirror to KV.
func (st *state) onComplete(ctx context.Context, c wire.Complete) {
	if !st.leases.Complete(c.TaskID, c.Robot) {
		return // not the holder, or already terminal: idempotent no-op
	}
	cur, ok := st.model.Get(c.TaskID)
	if !ok {
		return
	}
	next := cur
	next.Status = domain.Done
	next.Assignee = ""
	next.LeaseExpiry = 0
	next.Version = cur.Version + 1
	if st.model.Apply(next) {
		st.plan.MarkDone(c.TaskID)
		st.mirror(ctx, next)
		st.emit(wire.Event{Kind: wire.EventSolidify, TaskID: c.TaskID, Robot: c.Robot})
		slog.Info("complete", "task", c.TaskID, "by", c.Robot, "version", next.Version)
	}
}

// onFailed handles a rover cooperatively abandoning a leased task it cannot
// finish (wire.Failed): release the lease PROMPTLY — scoped to the named holder
// — and return the task to UNCLAIMED so the next tick re-auctions it, rather
// than waiting for the TTL to expire (slice 03, the cooperative counterpart to
// silent death by heartbeat timeout). The Release scoping is load-bearing: a
// stale/redelivered failure from a PRIOR holder is rejected and must not release
// a successor's fresh lease.
func (st *state) onFailed(ctx context.Context, c wire.Failed) {
	if !st.leases.Release(c.TaskID, c.Robot) {
		return // not the holder, already terminal, or stale failure: idempotent no-op
	}
	cur, ok := st.model.Get(c.TaskID)
	if !ok || cur.Status != domain.Leased {
		return
	}
	next := cur
	next.Status = domain.Unclaimed
	next.Assignee = ""
	next.LeaseExpiry = 0
	next.Version = cur.Version + 1
	if st.model.Apply(next) {
		st.mirror(ctx, next)
		slog.Info("failed", "task", c.TaskID, "by", c.Robot, "version", next.Version, "note", "released for re-auction")
	}
}

// tick runs the periodic auction/lease work: announce newly-ready unclaimed
// tasks, close due auctions and award winners, and sweep expired leases.
func (st *state) tick(ctx context.Context) {
	now := time.Now()

	// Fire any scripted demo kill whose delay has elapsed (slice 06). The kill
	// goes out on the real control path, so the heal that follows is genuine.
	if len(st.armedKills) > 0 {
		kept := st.armedKills[:0]
		for _, k := range st.armedKills {
			if now.Before(k.fireAt) {
				kept = append(kept, k)
				continue
			}
			_ = st.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: "kill", Robot: k.robot})
			st.emit(wire.Event{Kind: wire.EventKilled, Robot: k.robot})
			slog.Info("scripted kill", "rover", k.robot)
		}
		st.armedKills = kept
	}

	// Sweep expired leases first (slice 03 re-auction wiring; harmless now since
	// heartbeats keep healthy leases alive). A swept task returns to UNCLAIMED.
	for _, id := range st.leases.Sweep() {
		st.onExpired(ctx, id)
	}

	// Announce ready + unclaimed tasks that have no open auction yet.
	for _, id := range st.plan.Ready() {
		if _, open := st.auctions[id]; open {
			continue
		}
		t, ok := st.model.Get(id)
		if !ok || t.Status != domain.Unclaimed {
			continue
		}
		st.openAuction(t)
	}

	// Close any auction whose window has elapsed. Process due auctions in a
	// single deterministic (id-ordered) pass, tracking the rovers already awarded
	// so no rover wins two concurrent tasks — one-task-per-rover. This guard is
	// load-bearing for parallel building (slice 05): the dome releases several
	// ready tasks at once (e.g. all four foundations), every rover bids on all of
	// them BEFORE any award, so a single rover can be the top bidder on multiple
	// simultaneous auctions. Awarding it two tasks would make its two in-process
	// execute goroutines fight over one shared position. It lives at the single
	// writer because only the writer sees the whole award pass atomically.
	due := make([]domain.TaskID, 0, len(st.auctions))
	for id, a := range st.auctions {
		if !now.Before(a.closesAt) {
			due = append(due, id)
		}
	}
	slices.Sort(due)

	busy := st.busyRovers()
	for _, id := range due {
		if winner, ok := st.closeAuction(ctx, id, st.auctions[id], busy); ok {
			busy[winner] = struct{}{}
		}
	}
}

// busyRovers is the set of rovers currently holding a live lease, read from the
// authoritative World Model. A busy rover is excluded from winning a further
// concurrent auction (see tick): it is already driving/building one task.
func (st *state) busyRovers() map[domain.RobotID]struct{} {
	busy := make(map[domain.RobotID]struct{})
	for _, t := range st.model.Snapshot() {
		if t.Status == domain.Leased && t.Assignee != "" {
			busy[t.Assignee] = struct{}{}
		}
	}
	return busy
}

// openAuction announces a task for bidding and opens its collection window.
func (st *state) openAuction(t domain.Task) {
	pos := st.pos[t.ID]
	st.auctions[t.ID] = &auction{
		bids:     make(map[domain.RobotID]float64),
		closesAt: time.Now().Add(st.window),
	}
	ann := wire.Announce{TaskID: t.ID, Type: t.Type, Pos: pos, Version: t.Version}
	_ = st.conn.PublishJSON(wire.SubjTaskAnnounce, ann)
	slog.Info("announce", "task", ann.TaskID, "type", ann.Type, "version", ann.Version)
}

// closeAuction picks the winner from the bids actually received and awards,
// skipping any rover already busy this pass (one-task-per-rover). It returns the
// winning rover and true if an award was made; ("", false) if the task is no
// longer auctionable or every bidder is already busy (in which case the task is
// re-announced next tick, once a rover frees up).
func (st *state) closeAuction(ctx context.Context, id domain.TaskID, a *auction, busy map[domain.RobotID]struct{}) (domain.RobotID, bool) {
	delete(st.auctions, id)

	// A task may have changed status (completed/leased) while the window was
	// open; only award if it is still UNCLAIMED.
	t, ok := st.model.Get(id)
	if !ok || t.Status != domain.Unclaimed {
		return "", false
	}

	winner, best, ok := pickWinner(a.bids, busy)
	if !ok {
		return "", false // no eligible (non-busy) bids; re-announced next tick
	}
	st.award(ctx, t, winner, best)
	return winner, true
}

// pickWinner selects the lowest-cost bid among rovers not already busy this
// pass; ties break by lower RobotID. It reports ok=false when no eligible bid
// remains. The live winner is chosen from the actual bids received
// (allocation.Award is the pure cross-check, not the live source of truth —
// TECHSPEC §4).
func pickWinner(bids map[domain.RobotID]float64, busy map[domain.RobotID]struct{}) (domain.RobotID, float64, bool) {
	ids := make([]domain.RobotID, 0, len(bids))
	for id := range bids {
		if _, isBusy := busy[id]; isBusy {
			continue // already holds/just won a task: enforce one-task-per-rover
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return "", 0, false
	}
	slices.Sort(ids) // deterministic tie-break
	winner := ids[0]
	best := bids[winner]
	for _, id := range ids[1:] {
		if bids[id] < best {
			winner, best = id, bids[id]
		}
	}
	return winner, best, true
}

// award grants the winning rover a lease, moves the task to LEASED (version
// bumped), publishes the award, and mirrors to KV.
func (st *state) award(ctx context.Context, t domain.Task, winner domain.RobotID, cost float64) {
	if !st.leases.Grant(t.ID, winner) {
		return // already leased/done: single-writer guard, should not happen here
	}
	expiry := st.clk.Now() + st.ttl
	next := t
	next.Status = domain.Leased
	next.Assignee = winner
	next.LeaseExpiry = expiry
	next.Version = t.Version + 1
	if !st.model.Apply(next) {
		return
	}
	st.mirror(ctx, next)
	_ = st.conn.PublishJSON(wire.SubjTaskAward, wire.Award{
		TaskID:   t.ID,
		Robot:    winner,
		Pos:      st.pos[t.ID], // where the winner must drive to (slice 02)
		LeaseTTL: st.ttl,
		Version:  next.Version,
	})
	st.emit(wire.Event{Kind: wire.EventWon, TaskID: t.ID, Robot: winner})
	st.armScriptedKills(t.ID, winner)
	slog.Info("award", "task", t.ID, "to", winner, "cost", cost, "version", next.Version)
}

// armScriptedKills arms any scripted kill whose trigger task was just leased,
// capturing the holder and starting its countdown (tick fires it). Each scripted
// kill arms at most once (slice 06).
func (st *state) armScriptedKills(task domain.TaskID, holder domain.RobotID) {
	for i := range st.scriptedKills {
		sk := &st.scriptedKills[i]
		if sk.fired || sk.WhenTaskLeased != task {
			continue
		}
		sk.fired = true
		st.armedKills = append(st.armedKills, armedKill{robot: holder, fireAt: time.Now().Add(sk.After)})
		slog.Info("scripted kill armed", "rover", holder, "task", task, "after", sk.After)
	}
}

// onExpired returns a swept (lease-expired) task to UNCLAIMED in the World Model
// so it can be re-auctioned. Full re-auction choreography is slice 03; the state
// transition is wired now and is harmless (Sweep returns nothing while rovers
// heartbeat).
func (st *state) onExpired(ctx context.Context, id domain.TaskID) {
	cur, ok := st.model.Get(id)
	if !ok || cur.Status != domain.Leased {
		return
	}
	next := cur
	next.Status = domain.Unclaimed
	next.Assignee = ""
	next.LeaseExpiry = 0
	next.Version = cur.Version + 1
	if st.model.Apply(next) {
		st.mirror(ctx, next)
		st.emit(wire.Event{Kind: wire.EventExpired, TaskID: id})
		slog.Info("expiry", "task", id, "version", next.Version, "note", "returned to UNCLAIMED")
	}
}

// onReload resets the demo board IN-PROCESS (reloadDemo control) so the swarm
// rebuilds the dome from scratch — no pod/process restart. It runs on the single
// writer, so it may freely touch the Planner, World Model, Lease Manager, and
// open auctions without further synchronisation (TECHSPEC §8); it spawns no
// goroutines.
//
// The crux is version monotonicity. world.Model.Apply is a strict version guard:
// a record is accepted only if it beats the stored one. After a build, tasks sit
// at a Version ≥ 2, so resetting them to Version 0 would be REJECTED and nothing
// would change. So we stamp every reset record with base = (max stored Version) +
// 1, which is strictly greater than every record currently held and therefore
// always wins. The next tick then announces the now-UNCLAIMED ready tasks and the
// swarm rebuilds.
func (st *state) onReload(ctx context.Context) {
	base := maxVersion(st.model.Snapshot()) + 1

	// Rebuild the Planner fresh from the original blueprint so done/ready reset.
	// The blueprint loaded cleanly once already, so a failure here is unexpected;
	// log it and keep the prior plan rather than crash the writer.
	if plan, err := planner.Load(st.blueprint); err != nil {
		slog.Error("demo reload: reload planner", "error", err)
	} else {
		st.plan = plan
	}

	// Drop all live Leases by swapping in a fresh Manager. Stale Completes and
	// Heartbeats from the prior epoch then find no live lease and become no-ops.
	st.leases = lease.NewManager(st.clk, st.ttl)

	// Clear open auctions and any armed/pending demo choreography from the prior
	// epoch so the rebuild starts clean.
	st.auctions = make(map[domain.TaskID]*auction)
	st.armedKills = nil
	st.pendingEvents = nil

	// Re-arm the scripted kills from the pristine config copy (fired=false) so the
	// kill→heal money shot replays in inproc mode. In external/k8s mode cfgKills is
	// empty, so this is a harmless no-op.
	st.scriptedKills = append([]ScriptedKill(nil), st.cfgKills...)

	// Return every blueprint task to UNCLAIMED at the winning version and mirror it
	// to KV so an independent observer sees the reset board immediately.
	for _, t := range st.blueprint {
		it := t
		it.Status = domain.Unclaimed
		it.Assignee = ""
		it.LeaseExpiry = 0
		it.Version = base
		if st.model.Apply(it) {
			st.mirror(ctx, it)
		}
	}

	slog.Info("demo reloaded", "tasks", len(st.blueprint), "base_version", base)
}

// maxVersion returns the highest Version across the given task records, or 0 for
// an empty set. onReload uses (maxVersion + 1) so every reset record strictly
// beats the record currently held and is accepted by the monotonic World Model.
func maxVersion(tasks []domain.Task) domain.Lamport {
	var highest domain.Lamport
	for _, t := range tasks {
		if t.Version > highest {
			highest = t.Version
		}
	}
	return highest
}

// validatedBuildSpecs copies and validates the optional per-Task Build specs
// against the Build-spec schema (ADR-0006), returning the first rejection so Run
// fails loudly rather than shipping malformed geometry to the browser. Runs once
// at startup, never on the hot path. A nil/empty input yields a nil map.
func validatedBuildSpecs(in map[domain.TaskID][]wire.BuildOp) (map[domain.TaskID][]wire.BuildOp, error) {
	if len(in) == 0 {
		return nil, nil
	}
	out := make(map[domain.TaskID][]wire.BuildOp, len(in))
	for id, ops := range in {
		if err := spec.Validate(ops); err != nil {
			return nil, fmt.Errorf("task %s: %w", id, err)
		}
		// Defensive copy so a caller mutating its slice can't alter what snapshots ship.
		out[id] = append([]wire.BuildOp(nil), ops...)
	}
	return out, nil
}

// mirror writes the authoritative task record to NATS KV (the World Model
// mirror, TECHSPEC §3 / ADR-0002).
func (st *state) mirror(ctx context.Context, t domain.Task) {
	if err := st.kv.PutJSON(ctx, string(t.ID), t); err != nil {
		slog.Warn("kv mirror failed", "task", t.ID, "error", err)
	}
}

// publishSnapshot pushes the full server-authoritative world snapshot
// (~SnapshotHz) for the WS gateway/browser.
func (st *state) publishSnapshot() {
	tasks := st.model.Snapshot()
	taskViews := make([]wire.TaskView, 0, len(tasks))
	for _, t := range tasks {
		taskViews = append(taskViews, wire.TaskView{
			ID:          t.ID,
			Type:        t.Type,
			Pos:         st.pos[t.ID],
			Status:      t.Status.String(),
			Assignee:    t.Assignee,
			LeaseExpiry: t.LeaseExpiry,
			Version:     t.Version,
			Deps:        t.Deps,
			// Attach the Task's pre-validated Build spec, if any. Absent ⇒ the field
			// stays nil and the renderer uses the deterministic primitive fallback.
			BuildSpec: st.buildSpecs[t.ID],
		})
	}

	// rover → the task it currently holds (from the World Model assignees).
	heldBy := make(map[domain.RobotID]domain.TaskID)
	for _, t := range tasks {
		if t.Status == domain.Leased && t.Assignee != "" {
			heldBy[t.Assignee] = t.ID
		}
	}

	roverViews := make([]wire.RoverView, 0, len(st.rovers))
	ids := make([]domain.RobotID, 0, len(st.rovers))
	for id := range st.rovers {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		tm := st.rovers[id]
		roverViews = append(roverViews, wire.RoverView{
			ID:      tm.Robot,
			Pos:     tm.Pos,
			Battery: tm.Battery,
			Alive:   tm.Alive,
			Load:    tm.Load,
			Task:    heldBy[id],
		})
	}

	// Drain the choreography beats accumulated since the last snapshot. They are
	// transient: a reconnecting browser simply misses past beats and re-renders
	// durable state from Rovers/Tasks (ADR-0004).
	events := st.pendingEvents
	st.pendingEvents = nil

	at := st.clk.Now()
	_ = st.conn.PublishJSON(wire.SubjSnapshot, wire.Snapshot{
		Type:      "snapshot",
		Connected: st.conn.Connected(),
		Rovers:    roverViews,
		Tasks:     taskViews,
		Events:    events,
		At:        at,
	})

	// AFTER the tactical snapshot is on the wire, hand a copy to the Earth-uplink
	// shim with a NON-BLOCKING send: the single writer must never block, so a slow
	// shim simply drops this frame (snapshots are full-state, drop-safe). No
	// network or delay work happens on this writer goroutine — the shim owns it.
	// This is the ONLY thing latency affects; world.snapshot above already went
	// out undelayed (ADR-0002 / TECHSPEC §8).
	select {
	case st.earthCh <- wire.EarthUplink{Type: "earth", Rovers: roverViews, Tasks: taskViews, At: at}:
	default:
	}
}
