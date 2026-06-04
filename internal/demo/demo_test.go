package demo

import (
	"reflect"
	"strconv"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/core/planner"
	"testing"
	"time"
)

// TestDomeBlueprint_LoadsAsValidDAG proves the scripted demo board is a valid,
// acyclic, fully-connected DAG: planner.Load rejects cycles and dangling deps,
// so a successful Load is the strongest single check that the blueprint is
// buildable. It also pins the shape (4 foundations + 8 walls + dome-cap = 13)
// and that the dome-cap keystone depends on all eight walls.
func TestDomeBlueprint_LoadsAsValidDAG(t *testing.T) {
	bp := DomeBlueprint()

	tasks := make([]domain.Task, len(bp))
	for i, bt := range bp {
		tasks[i] = bt.Task
	}

	if _, err := planner.Load(tasks); err != nil {
		t.Fatalf("planner.Load(DomeBlueprint) = %v, want nil (blueprint must be an acyclic, fully-connected DAG)", err)
	}

	if len(tasks) != 13 {
		t.Fatalf("DomeBlueprint has %d tasks, want 13 (4 foundations + 8 walls + dome-cap)", len(tasks))
	}

	// Count by type.
	var foundations, walls, caps int
	var capTask domain.Task
	for _, tk := range tasks {
		switch tk.Type {
		case "foundation":
			foundations++
		case "wall":
			walls++
		case "dome-cap":
			caps++
			capTask = tk
		default:
			t.Fatalf("unexpected task type %q on task %s", tk.Type, tk.ID)
		}
	}
	if foundations != 4 || walls != 8 || caps != 1 {
		t.Fatalf("blueprint shape = %d foundations, %d walls, %d dome-cap; want 4, 8, 1", foundations, walls, caps)
	}

	// dome-cap must depend on all eight walls.
	if capTask.ID != "dome-cap" {
		t.Fatalf("dome-cap task id = %q, want \"dome-cap\"", capTask.ID)
	}
	depSet := make(map[domain.TaskID]bool, len(capTask.Deps))
	for _, d := range capTask.Deps {
		depSet[d] = true
	}
	for i := 1; i <= 8; i++ {
		wall := domain.TaskID("wall-" + strconv.Itoa(i))
		if !depSet[wall] {
			t.Fatalf("dome-cap deps = %v, missing %s (must depend on all 8 walls)", capTask.Deps, wall)
		}
	}
	if len(capTask.Deps) != 8 {
		t.Fatalf("dome-cap has %d deps, want exactly 8 (the walls)", len(capTask.Deps))
	}
}

// TestDomeScenario_IsDeterministic asserts the scripted board reproduces
// beat-for-beat: two independent assemblies yield identical blueprint task
// order (IDs+Positions+Deps), identical rover order (IDs/positions/batteries),
// and identical scripted kills. Reproducibility is the whole premise of the
// rehearsal — the same rover wins, is killed at the same beat, and the same
// standby heals — so any nondeterminism here would break the show.
func TestDomeScenario_IsDeterministic(t *testing.T) {
	a := DomeScenario("nats://x", Rehearsal())
	b := DomeScenario("nats://x", Rehearsal())

	if !reflect.DeepEqual(a.Blueprint, b.Blueprint) {
		t.Fatalf("blueprint differs between runs:\n a=%+v\n b=%+v", a.Blueprint, b.Blueprint)
	}
	if !reflect.DeepEqual(a.Rovers, b.Rovers) {
		t.Fatalf("rovers differ between runs:\n a=%+v\n b=%+v", a.Rovers, b.Rovers)
	}
	if !reflect.DeepEqual(a.ScriptedKills, b.ScriptedKills) {
		t.Fatalf("scripted kills differ between runs:\n a=%+v\n b=%+v", a.ScriptedKills, b.ScriptedKills)
	}

	// Sanity: the scenario actually carries the scripted kill (so DeepEqual above
	// is meaningfully comparing something).
	if len(a.ScriptedKills) != 1 {
		t.Fatalf("DomeScenario(Rehearsal) has %d scripted kills, want 1", len(a.ScriptedKills))
	}
	if a.ScriptedKills[0].WhenTaskLeased != Rehearsal().KillTarget {
		t.Fatalf("scripted kill targets %q, want KillTarget %q", a.ScriptedKills[0].WhenTaskLeased, Rehearsal().KillTarget)
	}
	if a.ScriptedKills[0].After != Rehearsal().KillAfterLeased {
		t.Fatalf("scripted kill After = %v, want KillAfterLeased %v", a.ScriptedKills[0].After, Rehearsal().KillAfterLeased)
	}
}

// TestRehearsal_KillTargetIsAHealableWall asserts the rehearsal kills a WALL,
// never the dome-cap (no standby can heal the keystone late in the build) and
// never a foundation. It also checks the timing makes the heal legible: the
// kill fires after the target is leased (After > 0), and the lease TTL
// (HeartbeatEvery × TTLFactor) is comfortably larger than that delay, so the
// orphan drain ring is on screen before the re-auction.
func TestRehearsal_KillTargetIsAHealableWall(t *testing.T) {
	cfg := Rehearsal()

	// The target must be a wall present in the blueprint.
	bp := DomeBlueprint()
	var targetType domain.TaskType
	found := false
	for _, bt := range bp {
		if bt.Task.ID == cfg.KillTarget {
			targetType = bt.Task.Type
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("KillTarget %q is not present in the blueprint", cfg.KillTarget)
	}
	if targetType != "wall" {
		t.Fatalf("KillTarget %q has type %q, want \"wall\" (only a wall has standby rovers free to heal it; not a foundation, not the dome-cap)", cfg.KillTarget, targetType)
	}

	if cfg.KillAfterLeased <= 0 {
		t.Fatalf("KillAfterLeased = %v, want > 0 (the kill fires after the target is leased)", cfg.KillAfterLeased)
	}

	ttl := cfg.HeartbeatEvery * time.Duration(cfg.TTLFactor)
	// "Comfortably larger": the drain ring must be clearly visible. Require the
	// TTL to exceed the kill delay by a healthy margin (here ≥ 2×).
	if ttl <= 2*cfg.KillAfterLeased {
		t.Fatalf("lease TTL = %v not comfortably larger than KillAfterLeased = %v (want TTL > 2× the delay so the orphan drain ring is visible)", ttl, cfg.KillAfterLeased)
	}
}

// TestDomeRovers_AllCapableAndDistinct asserts the fixed swarm is six rovers,
// each able to perform every task type (so any standby can heal any wall), with
// distinct IDs and distinct positions (so every auction's winner is
// deterministic and no two rovers overlap).
func TestDomeRovers_AllCapableAndDistinct(t *testing.T) {
	rovers := DomeRovers()
	if len(rovers) != 6 {
		t.Fatalf("DomeRovers has %d rovers, want 6", len(rovers))
	}

	required := []domain.Capability{"foundation", "wall", "dome-cap"}
	seenID := make(map[domain.RobotID]bool, len(rovers))
	seenPos := make(map[domain.Vec2]bool, len(rovers))
	for _, r := range rovers {
		if seenID[r.ID] {
			t.Fatalf("duplicate rover id %q", r.ID)
		}
		seenID[r.ID] = true
		if seenPos[r.Pos] {
			t.Fatalf("duplicate rover position %+v (rover %s)", r.Pos, r.ID)
		}
		seenPos[r.Pos] = true

		capSet := make(map[domain.Capability]bool, len(r.Capabilities))
		for _, c := range r.Capabilities {
			capSet[c] = true
		}
		for _, want := range required {
			if !capSet[want] {
				t.Fatalf("rover %s missing capability %q (caps=%v); every rover must be able to heal any task", r.ID, want, r.Capabilities)
			}
		}
	}
}
