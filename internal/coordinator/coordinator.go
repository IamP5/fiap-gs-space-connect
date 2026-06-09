package coordinator

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/blueprint"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/core/lease"
	"swarmbuild/internal/core/planner"
	"swarmbuild/internal/core/world"
	"swarmbuild/internal/harness/asset"
	"swarmbuild/internal/harness/spec"
	"swarmbuild/internal/wire"
	"time"
)

type BlueprintTask struct {
	Task   domain.Task
	Pos    domain.Vec2
	SiteID string
}

type Config struct {
	NATSURL             string
	Blueprint           []BlueprintTask
	Rovers              []agent.Config
	AuctionWindow       time.Duration
	HeartbeatEvery      time.Duration
	TTLFactor           int
	SnapshotHz          int
	Catalog             *blueprint.Catalog
	AssetCatalog        *asset.Catalog
	WorldBounds         float64
	BuilderDeathBreaker int
	BuildSpecs          map[domain.TaskID][]wire.BuildOp
}

func (cfg Config) withDefaults() Config {
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
		cfg.TTLFactor = 3
	}
	if cfg.Catalog == nil {
		cfg.Catalog = blueprint.DefaultCatalog()
	}
	if cfg.AssetCatalog == nil {
		cfg.AssetCatalog = asset.DefaultCatalog()
	}
	if cfg.WorldBounds <= 0 {
		cfg.WorldBounds = defaultWorldBounds
	}
	if cfg.BuilderDeathBreaker < 1 {
		cfg.BuilderDeathBreaker = defaultBuilderDeathBreaker
	}
	return cfg
}

const tickEvery = 50 * time.Millisecond

const defaultWorldBounds = 150.0

const defaultBuilderDeathBreaker = 3

type (
	evBid            struct{ bid wire.Bid }
	evComplete       struct{ done wire.Complete }
	evFailed         struct{ failed wire.Failed }
	evHeartbeat      struct{ hb wire.Heartbeat }
	evTelemetry      struct{ tel wire.Telemetry }
	evBuildOp        struct{ msg wire.BuildOpMsg }
	evReload         struct{}
	evPlaceBlueprint struct{ ctl wire.Control }
)

type auction struct {
	bids     map[domain.RobotID]float64
	closesAt time.Time
}

type state struct {
	plan     *planner.Plan
	model    *world.Model
	leases   *lease.Manager
	pos      map[domain.TaskID]domain.Vec2
	taskSite map[domain.TaskID]string
	auctions map[domain.TaskID]*auction

	rovers map[domain.RobotID]wire.Telemetry

	pendingEvents []wire.Event

	blueprint []domain.Task

	catalog      *blueprint.Catalog
	worldBounds  float64
	placedTasks  []blueprint.PlacedTask
	placeSeq     int
	assetCatalog *asset.Catalog
	seedSpecs    map[domain.TaskID][]wire.BuildOp

	buildSpecs map[domain.TaskID][]wire.BuildOp

	builderDeaths    map[domain.TaskID]int
	breakerThreshold int

	conn   *bus.Conn
	kv     *bus.KV
	clk    domain.Clock
	ttl    domain.Tick
	window time.Duration

	earthCh chan wire.EarthUplink
}

func Run(ctx context.Context, cfg Config) error {
	cfg = cfg.withDefaults()

	tasks := make([]domain.Task, len(cfg.Blueprint))
	posByTask := make(map[domain.TaskID]domain.Vec2, len(cfg.Blueprint))
	siteByTask := make(map[domain.TaskID]string, len(cfg.Blueprint))
	for i, bt := range cfg.Blueprint {
		bt.Task.SiteID = bt.SiteID
		tasks[i] = bt.Task
		posByTask[bt.Task.ID] = bt.Pos
		siteByTask[bt.Task.ID] = bt.SiteID
	}
	plan, err := planner.Load(tasks)
	if err != nil {
		return fmt.Errorf("coordinator: load blueprint: %w", err)
	}

	model := world.NewModel()
	for _, t := range tasks {
		model.Apply(t)
	}

	conn, kv, err := connectBus(ctx, cfg.NATSURL, tasks)
	if err != nil {
		return err
	}
	defer conn.Close()

	clk := wallClock{}
	ttl := domain.Tick(cfg.HeartbeatEvery.Milliseconds() * int64(cfg.TTLFactor))

	buildSpecs, err := validatedBuildSpecs(cfg.BuildSpecs)
	if err != nil {
		return fmt.Errorf("coordinator: invalid build spec: %w", err)
	}

	st := &state{
		plan:             plan,
		model:            model,
		leases:           lease.NewManager(clk, ttl),
		pos:              posByTask,
		taskSite:         siteByTask,
		auctions:         make(map[domain.TaskID]*auction),
		rovers:           make(map[domain.RobotID]wire.Telemetry),
		conn:             conn,
		kv:               kv,
		clk:              clk,
		ttl:              ttl,
		window:           cfg.AuctionWindow,
		blueprint:        append([]domain.Task(nil), tasks...),
		catalog:          cfg.Catalog,
		worldBounds:      cfg.WorldBounds,
		assetCatalog:     cfg.AssetCatalog,
		earthCh:          make(chan wire.EarthUplink, 64),
		buildSpecs:       buildSpecs,
		seedSpecs:        cloneSpecs(buildSpecs),
		builderDeaths:    make(map[domain.TaskID]int),
		breakerThreshold: cfg.BuilderDeathBreaker,
	}

	st.mirrorAllSpecs(ctx)

	shim := newEarthShim(conn, st.earthCh)

	events := make(chan any, 256)

	unsub, err := subscribe(ctx, conn, events)
	if err != nil {
		return err
	}
	defer unsub()

	unsubCtl, err := subscribeControl(ctx, conn, shim, events)
	if err != nil {
		return err
	}
	defer unsubCtl()

	shimDone := make(chan struct{})
	go func() {
		defer close(shimDone)
		shim.run(ctx)
	}()
	defer func() { <-shimDone }()

	roverCtx, cancelRovers := context.WithCancel(ctx)
	defer cancelRovers()
	if err := spawnRovers(roverCtx, cfg); err != nil {
		return err
	}

	_ = conn.Flush()

	return st.runWriter(ctx, events, cfg)
}

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

func subscribe(ctx context.Context, conn *bus.Conn, events chan<- any) (func(), error) {
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
	unsubBuildOp, err := bus.SubscribeJSON(conn, wire.SubjBuildOpWildcard, func(m wire.BuildOpMsg) {
		enqueue(evBuildOp{msg: m})
	})
	if err = add(unsubBuildOp, err, "build ops"); err != nil {
		return nil, err
	}
	return cleanup, nil
}

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
		case "placeBlueprint":
			select {
			case events <- evPlaceBlueprint{ctl: c}:
			case <-ctx.Done():
			}
		}
	})
	if err != nil {
		return nil, fmt.Errorf("coordinator: subscribe control: %w", err)
	}
	return unsubCtl, nil
}

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
		prev, had := st.rovers[ev.tel.Robot]
		st.rovers[ev.tel.Robot] = ev.tel
		if had && !prev.Alive && ev.tel.Alive {
			st.emit(wire.Event{Kind: wire.EventRevived, Robot: ev.tel.Robot})
		}
	case evBuildOp:
		st.onBuildOp(ctx, ev.msg)
	case evReload:
		st.onReload(ctx)
	case evPlaceBlueprint:
		st.onPlaceBlueprint(ctx, ev.ctl)
	}
}

func (st *state) emit(e wire.Event) {
	e.At = st.clk.Now()
	st.pendingEvents = append(st.pendingEvents, e)
}

func (st *state) onBid(b wire.Bid) {
	a, ok := st.auctions[b.TaskID]
	if !ok {
		return
	}
	a.bids[b.Robot] = b.Cost
	st.emit(wire.Event{Kind: wire.EventBid, TaskID: b.TaskID, Robot: b.Robot, Value: b.Cost})
}

func (st *state) onHeartbeat(h wire.Heartbeat) {
	st.leases.Heartbeat(h.TaskID, h.Robot)
}

func (st *state) onBuildOp(ctx context.Context, m wire.BuildOpMsg) {
	cur, ok := st.model.Get(m.TaskID)
	if !ok || cur.Status != domain.Leased {
		return
	}
	existing := st.buildSpecs[m.TaskID]
	if m.Seq != len(existing) {
		return
	}
	candidate := append(append(make([]wire.BuildOp, 0, len(existing)+1), existing...), m.Op)
	if m.Op.AssetKey != "" {
		entry, ok := st.assetCatalog.Get(m.Op.AssetKey)
		if !ok || !entry.SuitsType(cur.Type) {
			slog.Warn("rejected build op: asset key not in catalog",
				"task", m.TaskID, "seq", m.Seq, "asset_key", m.Op.AssetKey, "task_type", cur.Type)
			return
		}
	}
	if err := spec.Validate(candidate); err != nil {
		slog.Warn("rejected build op", "task", m.TaskID, "seq", m.Seq, "error", err)
		return
	}
	st.buildSpecs[m.TaskID] = candidate
	st.mirrorSpec(ctx, m.TaskID)

	next := cur
	next.Version = cur.Version + 1
	if st.model.Apply(next) {
		st.mirror(ctx, next)
	}
}

func (st *state) onComplete(ctx context.Context, c wire.Complete) {
	if !st.leases.Complete(c.TaskID, c.Robot) {
		return
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

func (st *state) onFailed(ctx context.Context, c wire.Failed) {
	if !st.leases.Release(c.TaskID, c.Robot) {
		return
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

	if c.Reason == wire.ReasonBuilderDied && cur.Mode == string(agent.ModeLive) {
		st.builderDeaths[c.TaskID]++
		deaths := st.builderDeaths[c.TaskID]
		if deaths >= st.breakerThreshold {
			next.Mode = ""
			slog.Warn("live circuit breaker tripped: downgrading task to primitive op-source",
				"task", c.TaskID, "builder_deaths", deaths, "threshold", st.breakerThreshold)
		} else {
			slog.Info("builder death recorded", "task", c.TaskID, "by", c.Robot, "builder_deaths", deaths, "threshold", st.breakerThreshold)
		}
	}

	if st.model.Apply(next) {
		st.mirror(ctx, next)
		slog.Info("failed", "task", c.TaskID, "by", c.Robot, "version", next.Version, "reason", c.Reason, "note", "released for re-auction")
	}
}

func (st *state) tick(ctx context.Context) {
	now := time.Now()

	for _, id := range st.leases.Sweep() {
		st.onExpired(ctx, id)
	}

	st.announceReady()

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

func (st *state) announceReady() {
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
}

func (st *state) busyRovers() map[domain.RobotID]struct{} {
	busy := make(map[domain.RobotID]struct{})
	for _, t := range st.model.Snapshot() {
		if t.Status == domain.Leased && t.Assignee != "" {
			busy[t.Assignee] = struct{}{}
		}
	}
	return busy
}

func (st *state) openAuction(t domain.Task) {
	pos := st.pos[t.ID]
	st.auctions[t.ID] = &auction{
		bids:     make(map[domain.RobotID]float64),
		closesAt: time.Now().Add(st.window),
	}
	ann := wire.Announce{TaskID: t.ID, Type: t.Type, Pos: pos, Mode: t.Mode, SiteID: st.taskSite[t.ID], Version: t.Version}
	_ = st.conn.PublishJSON(wire.SubjTaskAnnounce, ann)
	slog.Info("announce", "task", ann.TaskID, "type", ann.Type, "version", ann.Version)
}

func (st *state) closeAuction(ctx context.Context, id domain.TaskID, a *auction, busy map[domain.RobotID]struct{}) (domain.RobotID, bool) {
	delete(st.auctions, id)

	t, ok := st.model.Get(id)
	if !ok || t.Status != domain.Unclaimed {
		return "", false
	}

	winner, best, ok := pickWinner(a.bids, busy)
	if !ok {
		return "", false
	}
	st.award(ctx, t, winner, best)
	return winner, true
}

func pickWinner(bids map[domain.RobotID]float64, busy map[domain.RobotID]struct{}) (domain.RobotID, float64, bool) {
	ids := make([]domain.RobotID, 0, len(bids))
	for id := range bids {
		if _, isBusy := busy[id]; isBusy {
			continue
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return "", 0, false
	}
	slices.Sort(ids)
	winner := ids[0]
	best := bids[winner]
	for _, id := range ids[1:] {
		if bids[id] < best {
			winner, best = id, bids[id]
		}
	}
	return winner, best, true
}

func (st *state) award(ctx context.Context, t domain.Task, winner domain.RobotID, cost float64) {
	if !st.leases.Grant(t.ID, winner) {
		return
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
		Type:     t.Type,
		Mode:     t.Mode,
		Pos:      st.pos[t.ID],
		LeaseTTL: st.ttl,
		Version:  next.Version,
		PriorOps: append([]wire.BuildOp(nil), st.buildSpecs[t.ID]...),
	})
	st.emit(wire.Event{Kind: wire.EventWon, TaskID: t.ID, Robot: winner})
	slog.Info("award", "task", t.ID, "to", winner, "cost", cost, "version", next.Version)
}

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

func (st *state) onReload(ctx context.Context) {
	base := maxVersion(st.model.Snapshot()) + 1

	if plan, err := planner.Load(st.blueprint); err != nil {
		slog.Error("demo reload: reload planner", "error", err)
	} else {
		st.plan = plan
	}

	st.leases = lease.NewManager(st.clk, st.ttl)

	st.auctions = make(map[domain.TaskID]*auction)
	st.pendingEvents = nil
	st.builderDeaths = make(map[domain.TaskID]int)

	for _, p := range st.placedTasks {
		done := p.Task
		done.Status = domain.Done
		done.Assignee = ""
		done.LeaseExpiry = 0
		done.Version = base
		if st.model.Apply(done) {
			st.mirror(ctx, done)
		}
		delete(st.pos, p.Task.ID)
		delete(st.taskSite, p.Task.ID)
	}
	st.placedTasks = nil

	st.buildSpecs = cloneSpecs(st.seedSpecs)
	for _, t := range st.blueprint {
		st.mirrorSpec(ctx, t.ID)
	}

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

func maxVersion(tasks []domain.Task) domain.Lamport {
	var highest domain.Lamport
	for _, t := range tasks {
		if t.Version > highest {
			highest = t.Version
		}
	}
	return highest
}

func validatedBuildSpecs(in map[domain.TaskID][]wire.BuildOp) (map[domain.TaskID][]wire.BuildOp, error) {
	out := make(map[domain.TaskID][]wire.BuildOp, len(in))
	for id, ops := range in {
		if err := spec.Validate(ops); err != nil {
			return nil, fmt.Errorf("task %s: %w", id, err)
		}
		out[id] = append([]wire.BuildOp(nil), ops...)
	}
	return out, nil
}

func cloneSpecs(in map[domain.TaskID][]wire.BuildOp) map[domain.TaskID][]wire.BuildOp {
	out := make(map[domain.TaskID][]wire.BuildOp, len(in))
	for id, ops := range in {
		out[id] = append([]wire.BuildOp(nil), ops...)
	}
	return out
}

func (st *state) mirror(ctx context.Context, t domain.Task) {
	if err := st.kv.PutJSON(ctx, string(t.ID), t); err != nil {
		slog.Warn("kv mirror failed", "task", t.ID, "error", err)
	}
}

func (st *state) mirrorSpec(ctx context.Context, id domain.TaskID) {
	if err := st.kv.PutJSON(ctx, wire.KVSpecKey(id), st.buildSpecs[id]); err != nil {
		slog.Warn("kv spec mirror failed", "task", id, "error", err)
	}
}

func (st *state) mirrorAllSpecs(ctx context.Context) {
	for id := range st.buildSpecs {
		st.mirrorSpec(ctx, id)
	}
}

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
			Site:        st.taskSite[t.ID],
			BuildSpec:   st.assetCatalog.ResolveSpec(st.buildSpecs[t.ID]),
		})
	}

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
			Site:    tm.Site,
		})
	}

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

	select {
	case st.earthCh <- wire.EarthUplink{Type: "earth", Rovers: roverViews, Tasks: taskViews, At: at}:
	default:
	}
}
