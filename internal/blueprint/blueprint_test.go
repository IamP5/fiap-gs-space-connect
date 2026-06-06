package blueprint_test

import (
	"encoding/json"
	"math"
	"swarmbuild/internal/blueprint"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/core/planner"
	"testing"
)

// TestCatalog_EveryBlueprintHasContractsAndLoads asserts the acceptance
// invariant: every catalog Blueprint has an Architect-authored Build contract for
// EVERY Task, and its DAG loads cleanly into the Planner (no cycles / dangling
// deps), so a placed Blueprint is always a valid, schedulable board.
func TestCatalog_EveryBlueprintHasContractsAndLoads(t *testing.T) {
	cat := blueprint.DefaultCatalog()
	all := cat.All()
	if len(all) < 3 {
		t.Fatalf("catalog has %d blueprints, want >= 3 (dome + 2 new)", len(all))
	}

	for _, bp := range all {
		if len(bp.Tasks) == 0 {
			t.Errorf("blueprint %q has no tasks", bp.ID)
		}
		// Every Task has a Contract whose envelope matches the Task's envelope.
		for _, task := range bp.Tasks {
			c, ok := bp.Contracts[task.ID]
			if !ok {
				t.Errorf("blueprint %q task %q has no Build contract", bp.ID, task.ID)
				continue
			}
			if c.Type != task.Type {
				t.Errorf("blueprint %q task %q contract type=%q, want %q", bp.ID, task.ID, c.Type, task.Type)
			}
			if c.Envelope != task.Envelope {
				t.Errorf("blueprint %q task %q contract envelope mismatch", bp.ID, task.ID)
			}
			if c.Done == "" {
				t.Errorf("blueprint %q task %q contract has empty done criterion", bp.ID, task.ID)
			}
		}
		// The DAG is valid (Place at origin then Load).
		placed := bp.Place("t", domain.Vec2{}, 0, "")
		tasks := make([]domain.Task, len(placed))
		for i, p := range placed {
			tasks[i] = p.Task
		}
		if _, err := planner.Load(tasks); err != nil {
			t.Errorf("blueprint %q DAG does not load: %v", bp.ID, err)
		}
	}
}

// TestCatalog_Get covers the catalog lookup: known ids resolve, unknown ids miss.
func TestCatalog_Get(t *testing.T) {
	cat := blueprint.DefaultCatalog()
	for _, id := range []string{"dome", "solar-array", "comms-mast"} {
		if _, ok := cat.Get(id); !ok {
			t.Errorf("catalog missing expected blueprint %q", id)
		}
	}
	if _, ok := cat.Get("nope"); ok {
		t.Errorf("catalog returned an unknown blueprint")
	}
}

// TestContract_JSONRoundTrip proves the Architect-authored Contract is plain DATA
// that survives a JSON round-trip unchanged (it can ride the bus / be cached).
func TestContract_JSONRoundTrip(t *testing.T) {
	cat := blueprint.DefaultCatalog()
	dome, _ := cat.Get("dome")
	c := dome.Contracts["dome-cap"]

	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("marshal contract: %v", err)
	}
	var back blueprint.Contract
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("unmarshal contract: %v", err)
	}
	if back != c {
		t.Fatalf("contract round-trip mismatch:\n got %+v\nwant %+v", back, c)
	}
}

// TestPlace_TranslatesAndRotates checks the placement transform: a Task's
// relative position is rotated about the origin then translated onto it, ids are
// prefixed by the instance, and deps are remapped to the prefixed ids.
func TestPlace_TranslatesAndRotates(t *testing.T) {
	cat := blueprint.DefaultCatalog()
	mast, _ := cat.Get("comms-mast")

	// 90° rotation about an origin offset. The mast's "antenna" sits at relative
	// (0,0), so it lands exactly on the origin regardless of rotation.
	origin := domain.Vec2{X: 30, Y: -10}
	placed := mast.Place("inst1", origin, math.Pi/2, "")

	byID := make(map[domain.TaskID]blueprint.PlacedTask)
	for _, p := range placed {
		byID[p.Task.ID] = p
	}

	antenna, ok := byID["inst1/antenna"]
	if !ok {
		t.Fatalf("antenna task not found under instance prefix; got %v keys", keys(byID))
	}
	if math.Abs(antenna.Pos.X-origin.X) > 1e-6 || math.Abs(antenna.Pos.Y-origin.Y) > 1e-6 {
		t.Fatalf("antenna at relative (0,0) should land on origin %v, got %v", origin, antenna.Pos)
	}
	// Deps are remapped to prefixed ids.
	if len(antenna.Task.Deps) != 1 || antenna.Task.Deps[0] != "inst1/mast" {
		t.Fatalf("antenna deps = %v, want [inst1/mast]", antenna.Task.Deps)
	}
}

// TestPlace_RotationMovesOffsetTasks checks that a non-origin task actually
// rotates: the solar array's pad-2 sits at relative (16,0); a 90° rotation should
// move it to (origin.X, origin.Y+16) (world +Y), proving rotation is applied.
func TestPlace_RotationMovesOffsetTasks(t *testing.T) {
	cat := blueprint.DefaultCatalog()
	solar, _ := cat.Get("solar-array")
	origin := domain.Vec2{X: 0, Y: 0}
	placed := solar.Place("s", origin, math.Pi/2, "")

	var pad2 blueprint.PlacedTask
	for _, p := range placed {
		if p.Task.ID == "s/pad-2" {
			pad2 = p
		}
	}
	// (16,0) rotated +90° → (0,16).
	if math.Abs(pad2.Pos.X-0) > 1e-6 || math.Abs(pad2.Pos.Y-16) > 1e-6 {
		t.Fatalf("pad-2 after 90° rotation = %v, want ~(0,16)", pad2.Pos)
	}
}

// TestPlace_StampsModeTag checks Place tags every instantiated Task with the
// per-placement build mode (bh-08c): a "live" placement stamps every Task live, an
// empty mode leaves them at the replay default (back-compat).
func TestPlace_StampsModeTag(t *testing.T) {
	cat := blueprint.DefaultCatalog()
	dome, _ := cat.Get("dome")

	live := dome.Place("L", domain.Vec2{}, 0, "live")
	for _, p := range live {
		if p.Task.Mode != "live" {
			t.Fatalf("live placement: task %s mode = %q, want \"live\"", p.Task.ID, p.Task.Mode)
		}
	}

	replay := dome.Place("R", domain.Vec2{}, 0, "")
	for _, p := range replay {
		if p.Task.Mode != "" {
			t.Fatalf("default placement: task %s mode = %q, want \"\" (replay)", p.Task.ID, p.Task.Mode)
		}
	}
}

// TestFootprint_CentersOnPosition checks the footprint half-extents are derived
// from the envelope size centred on the task position (used by no-overlap tests).
func TestFootprint_CentersOnPosition(t *testing.T) {
	p := blueprint.PlacedTask{
		Pos:      domain.Vec2{X: 10, Y: 20},
		Envelope: blueprint.Envelope{Size: domain.Vec3{X: 8, Y: 6, Z: 2}},
	}
	minX, minY, maxX, maxY := p.Footprint()
	if minX != 6 || maxX != 14 || minY != 17 || maxY != 23 {
		t.Fatalf("footprint = [%.1f,%.1f]×[%.1f,%.1f], want [6,14]×[17,23]", minX, maxX, minY, maxY)
	}
}

func keys(m map[domain.TaskID]blueprint.PlacedTask) []domain.TaskID {
	out := make([]domain.TaskID, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
