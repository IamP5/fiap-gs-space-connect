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
	"swarmbuild/internal/blueprint"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/cache"
	"time"
)

// Task-type names of the dome blueprint. These exact string values are part of
// the blueprint contract (rovers advertise them as capabilities and the auction
// matches on them), so they MUST NOT change.
const (
	taskFoundation domain.TaskType = "foundation"
	taskWall       domain.TaskType = "wall"
	taskDomeCap    domain.TaskType = "dome-cap"
)

// The two worksites of the live lunar surface (epic 04). Each builds its OWN copy
// of the habitat dome with its OWN six-rover swarm; the auction is gated by site
// (wire.Announce.SiteID vs the agent's Config.SiteID) so the two never bid across
// the map. SiteLunar sits at the world origin; SiteShackleton is offset far away
// in world coords (the frontend recenters each site to the scene origin).
const (
	SiteLunar      = "lunar"
	SiteShackleton = "shackleton"
)

// shackletonOrigin is where the Shackleton dome is placed in world coords (epic
// 04): far from the lunar dome at the origin so the two sites never collide in
// world space. The frontend's per-site framing recenters each to the scene origin,
// so the large offset is invisible on screen and only keeps the boards disjoint.
var shackletonOrigin = domain.Vec2{X: 400, Y: 0}

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
	// NoInProcRovers selects the pod-per-rover mode: the coordinator spawns NO
	// in-process rovers and arms NO scripted kills. Rovers instead join over NATS
	// from outside (each its own container/pod), and the dashboard's KILL becomes a
	// real pod delete (handled by the killer sidecar's kubectl backend), so a
	// scripted in-proc kill would be wrong here. The default (false) is the
	// in-process swarm that the docker-compose demo runs, byte-for-byte unchanged.
	NoInProcRovers bool

	// EmptyBoard starts the world with NO seeded structures: DomeScenario produces an
	// empty Blueprint instead of the two pre-built domes. The coordinator still runs
	// the auction, the Lease Manager, the World Model, and snapshots — there is simply
	// nothing to build until an operator drops a Blueprint from the dashboard hotbar
	// (placeBlueprint), at which point the swarm builds it live. It is the pod-per-rover
	// k8s "sandbox" default (set by External): a fresh map you place onto and watch the
	// Rover Pods build, rather than a board that arrives mid-build. The default (false)
	// keeps the scripted two-dome board the headline/cinematic demos rely on.
	EmptyBoard bool

	// HeldTask is the Epic 07 hero wall held un-leasable until an operator cueKill
	// control arrives (ADR-0011): the dome builds everything it can EXCEPT this wall
	// (and its dependents) so the climax target is always available when the operator
	// fires the cue — no race. The cinematic sets it to the lunar hero wall; every
	// other pacing leaves it empty (nothing held). DomeScenario folds it onto the
	// coordinator Config.
	HeldTask domain.TaskID
	// CueKillAfter is how long after the released HeldTask is leased the cinematic
	// fires the in-process kill on its holder (ADR-0011). Only consulted when
	// HeldTask is set; the cueKill control arms it on the Coordinator.
	CueKillAfter time.Duration
}

// Rehearsal is the default demo pacing: a kill→heal arc that reads in ~12–20 s.
func Rehearsal() Config {
	return Config{
		AuctionWindow:   900 * time.Millisecond,
		HeartbeatEvery:  700 * time.Millisecond,
		TTLFactor:       6, // TTL = 4.2 s: a long, legible drain ring over the orphan
		SnapshotHz:      12,
		KillAfterLeased: 900 * time.Millisecond,
		// Retarget the rehearsal kill to the LUNAR site's wall (the prefixed id from
		// Place, epic 04): a same-site standby heals it, so no rover drives 400 units
		// across the map to the other site — more correct, and the site gate is what
		// keeps the heal local.
		KillTarget: SiteLunar + "/wall-1",
	}
}

// External is the pod-per-rover pacing: the same legible auction/lease windows as
// Rehearsal, but with NO in-process rovers, NO scripted kill, and — the headline of
// this mode — an EMPTY starting board. The coordinator runs the auction, the Lease
// Manager, the World Model, and snapshots over a fresh map with nothing seeded on it;
// the rovers join over NATS from outside (each its own container/pod) and idle until
// an operator drops a Blueprint from the dashboard hotbar (placeBlueprint), then build
// it live and Self-heal a real pod-delete KILL over the real bus. EmptyBoard is what
// makes the k8s default deploy a place-it-yourself sandbox rather than a board that
// arrives mid-build; the dragged placement is untagged, so the site gate falls through
// and the siteless Rover Pods bid on it. KillTarget is empty so DomeScenario produces
// no ScriptedKills (a scripted in-proc kill has nothing to kill here).
func External() Config {
	cfg := Rehearsal()
	cfg.NoInProcRovers = true
	cfg.EmptyBoard = true // fresh map: place a Blueprint and watch the Pods build it
	cfg.KillTarget = ""   // no scripted kill: kills are real pod deletes from outside
	return cfg
}

// heroWall is the Epic 07 climax target: the lunar dome's first wall, held
// un-leasable by the cinematic until the operator's cueKill cue (ADR-0011). It is
// a WALL (a same-site standby can heal it), and the FIRST wall, so it becomes
// ready early in the build and would otherwise be leased + DONE long before the
// 1:36 climax mark.
const heroWall = SiteLunar + "/wall-1"

// Cinematic is the Epic 07 demo pacing (ADR-0011, supersedes ADR-0011's original):
// a Rehearsal() copy that DISARMS the early scripted auto-kill (KillTarget="", the
// exact suppression External() uses) but KEEPS the in-process six-rover swarm per
// site (unlike External, it does NOT set NoInProcRovers). The demo therefore stops
// self-killing — the operator owns the Kill.
//
// On top of the rehearsal it HOLDS the hero wall (lunar/wall-1) un-leasable until a
// cueKill control arrives: the dome builds everything else first, then the operator
// fires the cue at the climax — the Coordinator releases the hold, a Rover leases +
// drives to the wall, and the Coordinator fires the in-process kill on it (the real
// Self-heal — Expiry → Re-auction → a surviving Rover seals the dome). All the
// widened windows (AuctionWindow 900ms, TTL 4.2s) carry over so the operator-fired
// kill still heals in the legible arc. Selected behind COORDINATOR_ROVERS=cinematic.
func Cinematic() Config {
	cfg := Rehearsal()
	cfg.KillTarget = "" // no EARLY auto-kill: the operator owns the Kill via cueKill
	// Hold the hero wall un-leasable until the cueKill cue, so the climax target is
	// always there (no race). The kill fires shortly after the released wall is
	// leased — the rover has just started driving, so the orphan-and-heal is
	// unmistakable. The widened TTL (4.2s) then drains a legible drain ring before
	// the Re-auction seals the dome.
	cfg.HeldTask = heroWall
	cfg.CueKillAfter = cfg.KillAfterLeased
	return cfg
}

// DomeScenario assembles the full scripted board for the rehearsal: TWO live
// worksites (epic 04) — a lunar habitat dome at the world origin and a Shackleton
// dome offset far away — each with its OWN fixed six-rover swarm, plus the single
// scripted kill on the lunar site. Both sites and both swarms ride ONE coordinator
// and ONE snapshot (a SiteID tag, not two coordinators), so the whole frontend +
// ADR-0004's single-snapshot contract are untouched. The auction is gated by site,
// so a rover only ever bids on its own site's tasks. Because both boards
// (positions, batteries, blueprints) are fixed and the tie-breaks deterministic,
// the run reproduces beat-for-beat: the same lunar rover wins lunar/wall-1, is
// killed at the same beat, and the same LUNAR standby heals it — every time.
//
// When cfg.NoInProcRovers is set (the External pod-per-rover mode), the returned
// Config carries NO Rovers and NO ScriptedKills: the coordinator builds both domes
// but the rovers join over NATS from outside and kills are real pod deletes.
//
// natsURL is the bus to run against. Pass cfg from Rehearsal (or a tuned copy).
func DomeScenario(natsURL string, cfg Config) coordinator.Config {
	// Two domes: lunar at the origin, Shackleton offset far in world coords. Each
	// task is tagged with its SiteID so the auction is site-gated. Place id-prefixes
	// every task with its site ("lunar/wall-1", "shackleton/wall-1"), so the two
	// boards never share ids. When EmptyBoard is set (the External pod-per-rover
	// sandbox) NOTHING is seeded: the coordinator boots a fresh map and the operator
	// drops a Blueprint from the dashboard hotbar for the Pods to build.
	var bp []coordinator.BlueprintTask
	if !cfg.EmptyBoard {
		bp = siteDome(SiteLunar, domain.Vec2{X: 0, Y: 0})
		bp = append(bp, siteDome(SiteShackleton, shackletonOrigin)...)
	}

	// In pod-per-rover mode the coordinator runs ZERO in-process rovers (they join
	// over NATS from outside) and arms NO scripted kill (kills are real pod deletes
	// from the dashboard). Otherwise it spawns BOTH fixed six-rover swarms (one per
	// site) and the single reproducible rehearsal kill on the lunar site, exactly as
	// the docker-compose demo does.
	var rovers []agent.Config
	scripted := []coordinator.ScriptedKill(nil)
	if !cfg.NoInProcRovers {
		rovers = siteRovers(SiteLunar, domain.Vec2{X: 0, Y: -70})
		rovers = append(rovers, siteRovers(SiteShackleton, domain.Vec2{X: shackletonOrigin.X, Y: -70})...)
		if cfg.KillTarget != "" {
			scripted = []coordinator.ScriptedKill{
				{WhenTaskLeased: cfg.KillTarget, After: cfg.KillAfterLeased},
			}
		}
	}

	return coordinator.Config{
		NATSURL:        natsURL,
		Blueprint:      bp,
		Rovers:         rovers,
		AuctionWindow:  cfg.AuctionWindow,
		HeartbeatEvery: cfg.HeartbeatEvery,
		TTLFactor:      cfg.TTLFactor,
		SnapshotHz:     cfg.SnapshotHz,
		ScriptedKills:  scripted,
		// Epic 07 cinematic (ADR-0011): hold the hero wall un-leasable until a cueKill
		// control releases it, then fire the in-process kill on its holder CueKillAfter
		// later. Empty HeldTask (every non-cinematic pacing) ⇒ nothing held, the
		// coordinator behaves exactly as before.
		HeldTask:     cfg.HeldTask,
		CueKillAfter: cfg.CueKillAfter,
		// No static BuildSpecs (bh-02): the structure now rises op-by-op as each
		// winning Rover STREAMS its deterministic build-op sequence on
		// build.op.<task> (internal/agent/opsource.go stands in for the LLM). The
		// coordinator appends and mirrors those ops, so the spec accumulates live and
		// — the headline — survives a kill: the replacement Rover resumes appending
		// from the partial structure (ADR-0007).
	}
}

// siteDome instantiates the habitat dome for one worksite (epic 04): it Places the
// catalog dome at the site's world origin under the site id as the instance prefix
// (so every task id is "<site>/<localid>", e.g. "lunar/wall-1") and offsets each
// position to the origin, then stamps SiteID onto every BlueprintTask so the
// coordinator gates the auction by site. The dome DAG is identical per site — the
// same four-foundation, eight-wall, one-cap structure — so each site builds the
// same shape with its own swarm. The catalog dome reuses the demo dome's task
// shapes, so the rovers' capabilities and the embedded baked-spec cache still match.
func siteDome(siteID string, origin domain.Vec2) []coordinator.BlueprintTask {
	dome, ok := blueprint.DefaultCatalog().Get("dome")
	if !ok {
		// The default catalog always carries the dome; a missing entry is a programmer
		// error, not a runtime condition. Panic loudly rather than ship an empty board.
		panic("demo: default blueprint catalog missing the \"dome\" entry")
	}
	placed := dome.Place(siteID, origin, 0, "")
	bp := make([]coordinator.BlueprintTask, 0, len(placed))
	for _, p := range placed {
		bp = append(bp, coordinator.BlueprintTask{
			Task:   p.Task,
			Pos:    p.Pos,
			SiteID: siteID, // gate this task's auction to its site (epic 04)
		})
	}
	return bp
}

// siteRovers is the fixed six-rover swarm stationed at one worksite (epic 04),
// parked below the site's worksite origin. Each rover is capable of every task type
// (so any standby can heal any wall) and carries the site's SiteID, so it only bids
// on its OWN site's announces — the two swarms never bid across the map. Ids are
// prefixed by the site so the two swarms have distinct, deterministic ids
// ("lunar-R1".."lunar-R6", "shackleton-R1".."shackleton-R6"); fixed positions and
// staggered batteries make every auction's winner deterministic per site.
//
// Every rover carries the demo BlueprintID, so while working a Task it consults the
// embedded baked-spec cache (bh-03, ADR-0007): a HIT replays the committed generated
// spec deterministically (no model call); a MISS falls back to the deterministic
// primitive op stream, riding the same build.op.<task> path so resume-on-kill is
// unchanged.
func siteRovers(siteID string, base domain.Vec2) []agent.Config {
	caps := []domain.Capability{
		domain.Capability(taskFoundation),
		domain.Capability(taskWall),
		domain.Capability(taskDomeCap),
	}
	rovers := make([]agent.Config, 0, 6)
	for i := range 6 {
		rovers = append(rovers, agent.Config{
			ID:           domain.RobotID(fmt.Sprintf("%s-R%d", siteID, i+1)),
			Pos:          domain.Vec2{X: base.X + float64(-50+i*20), Y: base.Y},
			Battery:      1.0 - float64(i)*0.05,
			Capabilities: caps,
			BlueprintID:  cache.DemoBlueprintID,
			SiteID:       siteID, // gate bidding to this site (epic 04)
		})
	}
	return rovers
}

// DomeBlueprint is the lunar habitat dome as a positioned, SINGLE-SITE blueprint
// (TECHSPEC §5): four foundations (no deps) on an inner ring, eight walls on an
// outer octagon (wall-i needs foundation-((i-1)/2+1)), and a dome-cap keystone at
// the centre that needs all eight walls. The geometry is a top-down dome footprint
// so the structure visibly rises as the swarm builds it. It carries no SiteID
// (single default site) and is kept for the single-site tooling/tests; the live
// two-site demo board is assembled by DomeScenario via siteDome.
func DomeBlueprint() []coordinator.BlueprintTask {
	wallPos := ring(8, 46, 90)       // outer octagon, wall-1 at 12 o'clock
	foundationPos := ring(4, 24, 68) // inner ring, offset to sit under each wall pair

	var bp []coordinator.BlueprintTask
	for i := 1; i <= 4; i++ {
		bp = append(bp, coordinator.BlueprintTask{
			Task: domain.Task{ID: domain.TaskID(fmt.Sprintf("foundation-%d", i)), Type: taskFoundation},
			Pos:  foundationPos[i-1],
		})
	}
	wallIDs := make([]domain.TaskID, 0, 8)
	for i := 1; i <= 8; i++ {
		id := domain.TaskID(fmt.Sprintf("wall-%d", i))
		wallIDs = append(wallIDs, id)
		foundation := domain.TaskID(fmt.Sprintf("foundation-%d", (i-1)/2+1))
		bp = append(bp, coordinator.BlueprintTask{
			Task: domain.Task{ID: id, Type: taskWall, Deps: []domain.TaskID{foundation}},
			Pos:  wallPos[i-1],
		})
	}
	bp = append(bp, coordinator.BlueprintTask{
		Task: domain.Task{ID: domain.TaskID(taskDomeCap), Type: taskDomeCap, Deps: wallIDs},
		Pos:  domain.Vec2{X: 0, Y: 0},
	})
	return bp
}

// DomeRovers is the fixed six-rover swarm parked below the worksite, each
// capable of every task type so any standby can heal any wall. Fixed positions
// and staggered batteries make every auction's winner deterministic.
//
// Every rover carries the demo BlueprintID, so while working a Task it consults
// the embedded baked-spec cache (bh-03, ADR-0007): a HIT replays the committed,
// generated spec deterministically (no model call); a MISS falls back to the
// deterministic primitive op stream. The replay rides the exact same
// build.op.<task> path as the primitive stream, so resume-on-kill is unchanged.
func DomeRovers() []agent.Config {
	caps := []domain.Capability{
		domain.Capability(taskFoundation),
		domain.Capability(taskWall),
		domain.Capability(taskDomeCap),
	}
	rovers := make([]agent.Config, 0, 6)
	for i := range 6 {
		rovers = append(rovers, agent.Config{
			ID:           domain.RobotID(fmt.Sprintf("R%d", i+1)),
			Pos:          domain.Vec2{X: float64(-50 + i*20), Y: -70},
			Battery:      1.0 - float64(i)*0.05,
			Capabilities: caps,
			BlueprintID:  cache.DemoBlueprintID,
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
