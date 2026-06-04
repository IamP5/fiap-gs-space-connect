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
	"log"
	"sort"
	"time"

	"swarmbuild/internal/agent"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/core/lease"
	"swarmbuild/internal/core/planner"
	"swarmbuild/internal/core/world"
	"swarmbuild/internal/wire"
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
type evBid struct{ bid wire.Bid }
type evComplete struct{ done wire.Complete }
type evFailed struct{ failed wire.Failed }
type evHeartbeat struct{ hb wire.Heartbeat }
type evTelemetry struct{ tel wire.Telemetry }

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

	conn   *bus.Conn
	kv     *bus.KV
	clk    domain.Clock
	ttl    domain.Tick
	window time.Duration
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

	// --- Connect the coordinator's own bus handle (hardened). ---
	conn, err := bus.Connect(ctx, cfg.NATSURL, bus.ConnectOptions{
		Name:    "coordinator",
		MaxWait: 30 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("coordinator: connect: %w", err)
	}
	defer conn.Close()

	kv, err := conn.KV(ctx, wire.KVBucketWorld)
	if err != nil {
		return fmt.Errorf("coordinator: kv bucket: %w", err)
	}
	// Mirror the seed world to KV so a reader sees the initial board immediately.
	for _, t := range tasks {
		if perr := kv.PutJSON(ctx, string(t.ID), t); perr != nil {
			return fmt.Errorf("coordinator: kv seed %s: %w", t.ID, perr)
		}
	}

	clk := wallClock{}
	ttl := domain.Tick(cfg.HeartbeatEvery.Milliseconds() * int64(cfg.TTLFactor))

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
	}

	// --- Inbound event channel: the ONLY way state is mutated. ---
	events := make(chan any, 256)

	// Subscriptions: callbacks run on the NATS dispatcher and only enqueue.
	enqueue := func(e any) {
		select {
		case events <- e:
		case <-ctx.Done():
		}
	}
	unsubBid, err := bus.SubscribeJSON(conn, wire.SubjBidWildcard, func(b wire.Bid) {
		enqueue(evBid{bid: b})
	})
	if err != nil {
		return fmt.Errorf("coordinator: subscribe bids: %w", err)
	}
	defer unsubBid()

	unsubComplete, err := bus.SubscribeJSON(conn, wire.SubjTaskComplete, func(c wire.Complete) {
		enqueue(evComplete{done: c})
	})
	if err != nil {
		return fmt.Errorf("coordinator: subscribe complete: %w", err)
	}
	defer unsubComplete()

	unsubFailed, err := bus.SubscribeJSON(conn, wire.SubjTaskFailed, func(f wire.Failed) {
		enqueue(evFailed{failed: f})
	})
	if err != nil {
		return fmt.Errorf("coordinator: subscribe failed: %w", err)
	}
	defer unsubFailed()

	unsubHeartbeat, err := bus.SubscribeJSON(conn, wire.SubjHeartbeatWildcard, func(h wire.Heartbeat) {
		enqueue(evHeartbeat{hb: h})
	})
	if err != nil {
		return fmt.Errorf("coordinator: subscribe heartbeat: %w", err)
	}
	defer unsubHeartbeat()

	unsubTelemetry, err := bus.SubscribeJSON(conn, wire.SubjTelemetryWildcard, func(tm wire.Telemetry) {
		enqueue(evTelemetry{tel: tm})
	})
	if err != nil {
		return fmt.Errorf("coordinator: subscribe telemetry: %w", err)
	}
	defer unsubTelemetry()

	// --- Spawn in-process rovers, each its own independent NATS client. ---
	roverCtx, cancelRovers := context.WithCancel(ctx)
	defer cancelRovers()
	for _, rc := range cfg.Rovers {
		rc := rc
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
				log.Printf("coordinator: rover %s exited: %v", c.ID, rerr)
			}
		}(rc, rconn)
	}

	// Flush so subscriptions are registered on the server before the first
	// announce goes out (deterministic test start).
	_ = conn.Flush()

	return st.runWriter(ctx, events, cfg)
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
		st.rovers[ev.tel.Robot] = ev.tel
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
		log.Printf("coordinator: complete task=%s by=%s v=%d", c.TaskID, c.Robot, next.Version)
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
		log.Printf("coordinator: failed task=%s by=%s v=%d (released for re-auction)", c.TaskID, c.Robot, next.Version)
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
			log.Printf("coordinator: scripted kill rover=%s", k.robot)
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
	sort.Slice(due, func(i, j int) bool { return due[i] < due[j] })

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
	log.Printf("coordinator: %s", ann.String())
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
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] }) // deterministic tie-break
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
	log.Printf("coordinator: award task=%s to=%s cost=%.3f v=%d", t.ID, winner, cost, next.Version)
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
		log.Printf("coordinator: scripted kill armed: rover=%s holds %s, firing in %s", holder, task, sk.After)
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
		log.Printf("coordinator: expiry task=%s v=%d (returned to UNCLAIMED)", id, next.Version)
	}
}

// mirror writes the authoritative task record to NATS KV (the World Model
// mirror, TECHSPEC §3 / ADR-0002).
func (st *state) mirror(ctx context.Context, t domain.Task) {
	if err := st.kv.PutJSON(ctx, string(t.ID), t); err != nil {
		log.Printf("coordinator: kv mirror %s: %v", t.ID, err)
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
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
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

	_ = st.conn.PublishJSON(wire.SubjSnapshot, wire.Snapshot{
		Type:      "snapshot",
		Connected: st.conn.Connected(),
		Rovers:    roverViews,
		Tasks:     taskViews,
		Events:    events,
		At:        st.clk.Now(),
	})
}
