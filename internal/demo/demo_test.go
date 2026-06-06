package demo

import (
	"encoding/json"
	"reflect"
	"strconv"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/core/planner"
	"swarmbuild/internal/harness/cache"
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

	foundations, walls, caps, capTask := countByType(t, tasks)
	if foundations != 4 || walls != 8 || caps != 1 {
		t.Fatalf("blueprint shape = %d foundations, %d walls, %d dome-cap; want 4, 8, 1", foundations, walls, caps)
	}

	assertCapDependsOnAllWalls(t, capTask)
}

// countByType tallies the blueprint tasks by type, failing on any unexpected
// type, and returns the dome-cap keystone task for further inspection.
func countByType(t *testing.T, tasks []domain.Task) (foundations, walls, caps int, capTask domain.Task) {
	t.Helper()
	for _, tk := range tasks {
		switch tk.Type {
		case taskFoundation:
			foundations++
		case taskWall:
			walls++
		case taskDomeCap:
			caps++
			capTask = tk
		default:
			t.Fatalf("unexpected task type %q on task %s", tk.Type, tk.ID)
		}
	}
	return foundations, walls, caps, capTask
}

// assertCapDependsOnAllWalls checks the dome-cap keystone depends on exactly the
// eight walls.
func assertCapDependsOnAllWalls(t *testing.T, capTask domain.Task) {
	t.Helper()
	if capTask.ID != domain.TaskID(taskDomeCap) {
		t.Fatalf("dome-cap task id = %q, want %q", capTask.ID, taskDomeCap)
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

// TestEmbeddedCache_ReplaysFullDomeDeterministically is the bh-04 headline proof:
// EVERY demo Blueprint Task has a committed baked spec, and the whole dome replays
// from the embedded cache deterministically (two lookups byte-identical, no model
// call). It is SKIPPED until the dome has been baked (the live bake-all), so the
// suite stays green before and after — but once baked, it guards the load-bearing
// "headline runs entirely from cache" invariant for the full structure, not just
// one Task.
func TestEmbeddedCache_ReplaysFullDomeDeterministically(t *testing.T) {
	c, err := cache.Embedded()
	if err != nil {
		t.Fatalf("embedded cache failed to load: %v", err)
	}

	bp := DomeBlueprint()
	missing := make([]domain.TaskID, 0, len(bp))
	for _, bt := range bp {
		if _, ok := c.Lookup(cache.DemoBlueprintID, string(bt.Task.ID)); !ok {
			missing = append(missing, bt.Task.ID)
		}
	}
	if len(missing) == len(bp) {
		t.Skipf("no dome specs committed yet (run the live bake-all); %d tasks unbaked", len(bp))
	}
	if len(missing) != 0 {
		t.Fatalf("the full dome must replay from cache, but %d task(s) have no baked spec: %v", len(missing), missing)
	}

	// Deterministic: each task's two lookups are byte-identical.
	for _, bt := range bp {
		a, _ := c.Lookup(cache.DemoBlueprintID, string(bt.Task.ID))
		b, _ := c.Lookup(cache.DemoBlueprintID, string(bt.Task.ID))
		if len(a) == 0 {
			t.Fatalf("task %s replayed zero ops", bt.Task.ID)
		}
		aj, _ := json.Marshal(a)
		bj, _ := json.Marshal(b)
		if string(aj) != string(bj) {
			t.Fatalf("task %s replay is not deterministic", bt.Task.ID)
		}
	}
	t.Logf("full dome replays deterministically: %d/%d tasks from the embedded cache", len(bp), len(bp))
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

// TestExternal_YieldsNoRoversAndNoScriptedKills proves the pod-per-rover mode:
// demo.External() (and any Config with NoInProcRovers) makes DomeScenario produce a
// coordinator.Config with NO Rovers and NO ScriptedKills, so the coordinator spawns
// nothing in-process and arms no scripted kill (rovers join over NATS and kills are
// real pod deletes). The same dome blueprint is still built. The inproc default is
// cross-checked alongside so the backward-compatible path is pinned: it DOES carry
// the six-rover swarm and the single rehearsal kill.
func TestExternal_YieldsNoRoversAndNoScriptedKills(t *testing.T) {
	ext := DomeScenario("nats://x", External())

	if ext.Rovers != nil {
		t.Fatalf("External scenario has %d in-process rovers, want none (pod-per-rover: rovers join over NATS)", len(ext.Rovers))
	}
	if ext.ScriptedKills != nil {
		t.Fatalf("External scenario has %d scripted kills, want none (kills are real pod deletes)", len(ext.ScriptedKills))
	}
	// The dome is still built; only the hosting of rovers and kills changes.
	if !reflect.DeepEqual(ext.Blueprint, DomeScenario("nats://x", Rehearsal()).Blueprint) {
		t.Fatal("External scenario builds a different blueprint than the rehearsal; only rover hosting and kills should change")
	}

	// Backward-compatibility cross-check: the inproc default still carries the
	// six-rover swarm and exactly one scripted kill.
	inproc := DomeScenario("nats://x", Rehearsal())
	if len(inproc.Rovers) != 6 {
		t.Fatalf("inproc scenario has %d rovers, want 6 (the docker-compose demo swarm)", len(inproc.Rovers))
	}
	if len(inproc.ScriptedKills) != 1 {
		t.Fatalf("inproc scenario has %d scripted kills, want 1 (the rehearsal kill)", len(inproc.ScriptedKills))
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
	if targetType != taskWall {
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

	required := []domain.Capability{
		domain.Capability(taskFoundation),
		domain.Capability(taskWall),
		domain.Capability(taskDomeCap),
	}
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
