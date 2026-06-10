package coordinator

import (
	"context"
	"fmt"
	"log/slog"
	"swarmbuild/internal/blueprint"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/core/planner"
	"swarmbuild/internal/wire"
)

const overlapPad = 4.0

func (st *state) onPlaceBlueprint(ctx context.Context, ctl wire.Control) {
	bp, ok := st.catalog.Get(ctl.BlueprintID)
	if !ok {
		slog.Warn("placeBlueprint rejected", "blueprint", ctl.BlueprintID, "reason", "unknown blueprint")
		return
	}

	st.placeSeq++
	instance := fmt.Sprintf("bp%d", st.placeSeq)
	placed := bp.Place(instance, ctl.Origin, ctl.Rotation)

	if reason, ok := st.validatePlacement(placed); !ok {
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

func (st *state) validatePlacement(placed []blueprint.PlacedTask) (string, bool) {
	b := st.worldBounds
	for _, p := range placed {
		minX, minY, maxX, maxY := p.Footprint()
		if minX < -b || maxX > b || minY < -b || maxY > b {
			return fmt.Sprintf("task %s out of bounds (footprint [%.1f,%.1f]×[%.1f,%.1f], limit ±%.0f)",
				p.Task.ID, minX, maxX, minY, maxY, b), false
		}
		if !onValidTerrain(p.Pos) {
			return fmt.Sprintf("task %s on invalid terrain at (%.1f,%.1f)", p.Task.ID, p.Pos.X, p.Pos.Y), false
		}
	}

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

type footprint struct{ minX, minY, maxX, maxY float64 }

func (st *state) existingFootprints() []footprint {
	out := make([]footprint, 0, len(st.placedTasks)+len(st.blueprint))
	for _, p := range st.placedTasks {
		minX, minY, maxX, maxY := p.Footprint()
		out = append(out, footprint{minX, minY, maxX, maxY})
	}
	for _, t := range st.blueprint {
		pos, ok := st.pos[t.ID]
		if !ok {
			continue
		}
		const h = 6.0
		out = append(out, footprint{pos.X - h, pos.Y - h, pos.X + h, pos.Y + h})
	}
	return out
}

func (st *state) injectPlacement(ctx context.Context, placed []blueprint.PlacedTask) {
	base := maxVersion(st.model.Snapshot()) + 1

	st.placedTasks = append(st.placedTasks, placed...)
	for _, p := range placed {
		st.pos[p.Task.ID] = p.Pos
		st.taskSite[p.Task.ID] = p.Task.SiteID
	}

	if plan, err := planner.Load(st.allTasks()); err != nil {
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

func (st *state) allTasks() []domain.Task {
	out := make([]domain.Task, 0, len(st.blueprint)+len(st.placedTasks))
	out = append(out, st.blueprint...)
	for _, p := range st.placedTasks {
		out = append(out, p.Task)
	}
	for i, t := range out {
		if cur, ok := st.model.Get(t.ID); ok {
			out[i].Status = cur.Status
		}
	}
	return out
}

func onValidTerrain(_ domain.Vec2) bool { return true }

func aabbOverlap(aMinX, aMinY, aMaxX, aMaxY, bMinX, bMinY, bMaxX, bMaxY, pad float64) bool {
	return aMinX-pad < bMaxX && aMaxX+pad > bMinX &&
		aMinY-pad < bMaxY && aMaxY+pad > bMinY
}
