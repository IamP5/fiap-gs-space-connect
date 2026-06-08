package coordinator

import (
	"context"
	"fmt"
	"log/slog"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/blueprint"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/core/planner"
	"swarmbuild/internal/wire"
)

// overlapPad is the worksite-unit margin added around every placed task's
// envelope footprint when testing no-overlap, so two structures that merely
// touch (or that an AABB rotation would graze) are still rejected. It also makes
// the rotation-safe AABB cover conservative — a rotated box can grow its
// axis-aligned extent by up to (√2−1)/2 of its size, which this padding absorbs
// for the catalog's footprints.
const overlapPad = 4.0

// onPlaceBlueprint validates and injects a dragged-in catalog Blueprint
// (placeBlueprint control, bh-05). It runs ONLY on the single writer, so it
// freely rebuilds the Planner and mutates the World Model / positions without
// further synchronisation (TECHSPEC §8). The flow is: resolve the catalog entry,
// instantiate it at the requested origin+rotation, VALIDATE placement (world
// bounds, terrain, no-overlap with existing tasks) BEFORE anything goes live, and
// only on success inject the pre-baked DAG so the Auction feeds on it exactly as
// today. An invalid placement injects nothing and is logged for the UI; the
// allocation hot loop is never touched (validation+injection are plain state
// edits on this writer, like reloadDemo).
func (st *state) onPlaceBlueprint(ctx context.Context, ctl wire.Control) {
	bp, ok := st.catalog.Get(ctl.BlueprintID)
	if !ok {
		slog.Warn("placeBlueprint rejected", "blueprint", ctl.BlueprintID, "reason", "unknown blueprint")
		return
	}

	// Unique instance prefix per placement so repeated copies never share task ids.
	st.placeSeq++
	instance := fmt.Sprintf("bp%d", st.placeSeq)
	// Per-placement build mode (bh-08c): tag every injected Task with the operator's
	// chosen mode so a winning Rover honours it per-Task. normalizeMode collapses an
	// empty/unknown value to the replay default, so an omitted mode = replay
	// (back-compat) and a replay dome and a live dome coexist in one world.
	placed := bp.Place(instance, ctl.Origin, ctl.Rotation, normalizeMode(ctl.Mode))

	if reason, ok := st.validatePlacement(placed); !ok {
		// Roll the counter back so a rejected attempt does not burn an instance id
		// (keeps ids dense and the next valid placement deterministic).
		st.placeSeq--
		slog.Warn("placeBlueprint rejected",
			"blueprint", ctl.BlueprintID, "instance", instance,
			"origin_x", ctl.Origin.X, "origin_y", ctl.Origin.Y, "reason", reason)
		return
	}

	st.injectPlacement(ctx, placed)
	slog.Info("placeBlueprint accepted",
		"blueprint", ctl.BlueprintID, "instance", instance,
		"tasks", len(placed), "origin_x", ctl.Origin.X, "origin_y", ctl.Origin.Y)
}

// validatePlacement checks a candidate placement BEFORE its tasks go live: every
// task's envelope footprint must lie within the legal build square (bounds), on
// valid terrain, and must not overlap any existing structure's footprint
// (already-placed tasks + the startup blueprint's tasks). It returns a short
// human-readable reason and false on the first failure, so an invalid placement
// is rejected with feedback and nothing is injected.
func (st *state) validatePlacement(placed []blueprint.PlacedTask) (string, bool) {
	b := st.worldBounds
	for _, p := range placed {
		minX, minY, maxX, maxY := p.Footprint()
		// Bounds: the whole footprint must sit inside [-b, +b] on both axes.
		if minX < -b || maxX > b || minY < -b || maxY > b {
			return fmt.Sprintf("task %s out of bounds (footprint [%.1f,%.1f]×[%.1f,%.1f], limit ±%.0f)",
				p.Task.ID, minX, maxX, minY, maxY, b), false
		}
		// Terrain: the worksite is a flat lunar plane (ADR-0001), so terrain is
		// valid everywhere inside the bounds. The check is a real gate (not a
		// no-op): onValidTerrain is the seam a future heightmap/keep-out map plugs
		// into, and rejecting here proves the validation path before tasks go live.
		if !onValidTerrain(p.Pos) {
			return fmt.Sprintf("task %s on invalid terrain at (%.1f,%.1f)", p.Task.ID, p.Pos.X, p.Pos.Y), false
		}
	}

	// No-overlap: no candidate footprint may intersect an existing structure's
	// footprint (other placed blueprints + the startup board). Padded so touching
	// structures are rejected too.
	existing := st.existingFootprints()
	for _, p := range placed {
		cminX, cminY, cmaxX, cmaxY := p.Footprint()
		for _, e := range existing {
			if aabbOverlap(cminX, cminY, cmaxX, cmaxY, e.minX, e.minY, e.maxX, e.maxY, overlapPad) {
				return fmt.Sprintf("task %s overlaps existing structure", p.Task.ID), false
			}
		}
	}
	return "", true
}

// footprint is an absolute axis-aligned XY box used for overlap tests.
type footprint struct{ minX, minY, maxX, maxY float64 }

// existingFootprints is the footprint of every structure already on the board:
// the already-placed blueprint tasks (with their real envelopes) plus the startup
// blueprint's tasks (given a small default footprint at their worksite position,
// since the startup DAG has no per-task envelope). Used for no-overlap validation
// so a placed Blueprint never collides with what is already being built.
func (st *state) existingFootprints() []footprint {
	out := make([]footprint, 0, len(st.placedTasks)+len(st.blueprint))
	for _, p := range st.placedTasks {
		minX, minY, maxX, maxY := p.Footprint()
		out = append(out, footprint{minX, minY, maxX, maxY})
	}
	// Startup blueprint tasks: no envelope, so use a small square at their position
	// (st.pos) so a placed Blueprint dropped on the demo dome is rejected.
	for _, t := range st.blueprint {
		pos, ok := st.pos[t.ID]
		if !ok {
			continue
		}
		const h = 6.0 // half-extent of a startup task's assumed footprint
		out = append(out, footprint{pos.X - h, pos.Y - h, pos.X + h, pos.Y + h})
	}
	return out
}

// injectPlacement admits a validated placement into the live world: it appends
// the placed tasks' positions, rebuilds the Planner from the startup blueprint +
// every placed task so the new DAG's dependencies are tracked, and applies each
// new task record to the World Model at a winning version (so the monotonic guard
// accepts it) before mirroring to KV. The next tick then announces the now-ready
// injected tasks and the Auction picks them up exactly as it does the startup
// board.
func (st *state) injectPlacement(ctx context.Context, placed []blueprint.PlacedTask) {
	// A version that strictly beats every record currently held, so a brand-new
	// task id is accepted and (defensively) a reused id could never move backwards.
	base := maxVersion(st.model.Snapshot()) + 1

	st.placedTasks = append(st.placedTasks, placed...)
	for _, p := range placed {
		st.pos[p.Task.ID] = p.Pos
		// Track the placed task's site (two-site lunar surface, epic 04) so its
		// auction announces it and its TaskView is tagged, exactly like a startup
		// task. A dragged placement carries no site today (empty ⇒ default site).
		st.taskSite[p.Task.ID] = p.Task.SiteID
	}

	// Rebuild the Planner over the full task set (startup blueprint + all placed
	// tasks) so the injected DAG's deps are honoured alongside the original board.
	if plan, err := planner.Load(st.allTasks()); err != nil {
		// The catalog DAGs are validated by construction, so a load failure here is
		// unexpected; log and keep the prior plan rather than crash the writer. The
		// already-applied records below still mirror, but their deps won't schedule
		// until a clean reload — acceptable for an internal invariant violation.
		slog.Error("placeBlueprint: reload planner", "error", err)
	} else {
		st.plan = plan
	}

	for _, p := range placed {
		t := p.Task
		t.Version = base
		if st.model.Apply(t) {
			st.mirror(ctx, t)
		}
	}
}

// allTasks is the full live task set the Planner is loaded from after a
// placement: a copy of the startup blueprint plus every placed task (their
// pristine UNCLAIMED shapes; live status lives in the World Model). The Planner
// only needs ids/types/deps, and a freshly-loaded plan recomputes ready/done from
// the records the writer marks done as completions arrive.
func (st *state) allTasks() []domain.Task {
	out := make([]domain.Task, 0, len(st.blueprint)+len(st.placedTasks))
	out = append(out, st.blueprint...)
	for _, p := range st.placedTasks {
		out = append(out, p.Task)
	}
	// Honour any DONE status already recorded in the World Model so a reload after
	// partial progress does not re-auction finished tasks.
	for i, t := range out {
		if cur, ok := st.model.Get(t.ID); ok {
			out[i].Status = cur.Status
		}
	}
	return out
}

// normalizeMode collapses an operator-supplied placeBlueprint mode to the canonical
// per-Task tag (bh-08c). Only the explicit live mode is honoured; an empty, unknown,
// or "replay" value falls back to the replay default, so an omitted mode = replay
// (back-compat) and a malformed mode can never silently opt a placement into live
// model calls. It uses the agent's Mode string values as the single source of truth
// WITHOUT importing the Model seam — the coordinator stays model-free (ADR-0005,
// archtest): agent.Mode is a plain string the coordinator already depends on.
func normalizeMode(mode string) string {
	if mode == string(agent.ModeLive) {
		return string(agent.ModeLive)
	}
	return string(agent.ModeReplay)
}

// onValidTerrain reports whether a worksite position sits on buildable terrain.
// The worksite is a flat lunar plane (ADR-0001), so every position inside the
// world bounds is valid today; this is the single seam a future heightmap or
// keep-out region plugs into without touching the placement flow.
func onValidTerrain(_ domain.Vec2) bool { return true }

// aabbOverlap reports whether two axis-aligned boxes intersect when each is grown
// by pad on every side (so touching or near-touching boxes count as overlapping).
func aabbOverlap(aMinX, aMinY, aMaxX, aMaxY, bMinX, bMinY, bMaxX, bMaxY, pad float64) bool {
	return aMinX-pad < bMaxX && aMaxX+pad > bMinX &&
		aMinY-pad < bMaxY && aMaxY+pad > bMinY
}
