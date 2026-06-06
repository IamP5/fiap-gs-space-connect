package coordinator_test

import (
	"fmt"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

// domeBlueprint builds the lunar habitat dome DAG (TECHSPEC §5) as a positioned
// blueprint: four foundations (no deps), eight walls (each on its foundation,
// walls 1,2→foundation-1, 3,4→foundation-2, 5,6→foundation-3, 7,8→foundation-4),
// and one dome-cap that needs ALL eight walls. Positions are spread out —
// foundations on a small inner ring, walls on an outer ring, dome-cap at the
// origin — so every drive takes real wall-clock time and the parallelism is real,
// not an artifact of zero-distance instant work.
func domeBlueprint() []coordinator.BlueprintTask {
	bp := []coordinator.BlueprintTask{}

	// Four foundations on a small inner ring (radius ~20), no deps.
	foundationPos := []domain.Vec2{
		{X: 20, Y: 0}, {X: 0, Y: 20}, {X: -20, Y: 0}, {X: 0, Y: -20},
	}
	for i := 1; i <= 4; i++ {
		bp = append(bp, coordinator.BlueprintTask{
			Task: domain.Task{
				ID:     domain.TaskID(fmt.Sprintf("foundation-%d", i)),
				Type:   typeFoundation,
				Status: domain.Unclaimed,
			},
			Pos: foundationPos[i-1],
		})
	}

	// Eight walls on an outer ring (radius ~40), each depending on its foundation.
	wallIDs := []domain.TaskID{}
	wallPos := []domain.Vec2{
		{X: 40, Y: 10},
		{X: 40, Y: -10},
		{X: 10, Y: 40},
		{X: -10, Y: 40},
		{X: -40, Y: 10},
		{X: -40, Y: -10},
		{X: 10, Y: -40},
		{X: -10, Y: -40},
	}
	for i := 1; i <= 8; i++ {
		foundation := domain.TaskID(fmt.Sprintf("foundation-%d", (i-1)/2+1))
		id := domain.TaskID(fmt.Sprintf("wall-%d", i))
		wallIDs = append(wallIDs, id)
		bp = append(bp, coordinator.BlueprintTask{
			Task: domain.Task{
				ID:     id,
				Type:   "wall",
				Deps:   []domain.TaskID{foundation},
				Status: domain.Unclaimed,
			},
			Pos: wallPos[i-1],
		})
	}

	// dome-cap at the origin, needs all eight walls.
	bp = append(bp, coordinator.BlueprintTask{
		Task: domain.Task{
			ID:     "dome-cap",
			Type:   "dome-cap",
			Deps:   wallIDs,
			Status: domain.Unclaimed,
		},
		Pos: domain.Vec2{X: 0, Y: 0},
	})

	return bp
}

// domeTaskIDs is the full set of 15 task ids in the dome blueprint, in a stable
// order (foundations, walls, dome-cap).
func domeTaskIDs() []domain.TaskID {
	ids := []domain.TaskID{}
	for i := 1; i <= 4; i++ {
		ids = append(ids, domain.TaskID(fmt.Sprintf("foundation-%d", i)))
	}
	for i := 1; i <= 8; i++ {
		ids = append(ids, domain.TaskID(fmt.Sprintf("wall-%d", i)))
	}
	ids = append(ids, "dome-cap")
	return ids
}

// domeRovers spawns six rovers, all fully capable of every dome task, parked at
// distinct positions below the worksite (Y:-70, X spread -50..50) with staggered
// batteries so bids are not all identical.
func domeRovers() []agent.Config {
	caps := []domain.Capability{typeFoundation, "wall", "dome-cap"}
	xs := []float64{-50, -30, -10, 10, 30, 50}
	batteries := []float64{1.0, 0.95, 0.9, 0.85, 0.8, 0.75}
	rovers := make([]agent.Config, 6)
	for i := range 6 {
		rovers[i] = agent.Config{
			ID:           domain.RobotID(fmt.Sprintf("R%d", i+1)),
			Pos:          domain.Vec2{X: xs[i], Y: -70},
			Battery:      batteries[i],
			Capabilities: caps,
		}
	}
	return rovers
}

// domeConfig is the shared coordinator config for the parallel-build tests.
func domeConfig() coordinator.Config {
	return coordinator.Config{
		Blueprint:      domeBlueprint(),
		Rovers:         domeRovers(),
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20,
	}
}

// TestDome_ParallelBuildOneTaskPerRover boots the dome with six rovers and proves
// three things at once: (a) the swarm genuinely builds in PARALLEL (at least two
// distinct rovers hold leased tasks simultaneously at some point), (b) the
// one-task-per-rover invariant is NEVER violated (no rover ever holds two leased
// tasks at the same time), and (c) the dome fully closes (all 15 tasks reach DONE
// with no lingering assignees).
//
//nolint:gocyclo // end-to-end parallel-build test: one polling loop interleaves the invariant check, parallelism witness, and completion detection; splitting would break the single observation window.
func TestDome_ParallelBuildOneTaskPerRover(t *testing.T) {
	ids := domeTaskIDs()
	h := newSelfHealHarness(t, domeConfig(), ids...)

	// allTasks reads the authoritative KV-mirrored World Model for every dome task
	// and returns the records that exist.
	allTasks := func() []domain.Task {
		out := make([]domain.Task, 0, len(ids))
		for _, id := range ids {
			if tk, ok := h.getTask(id); ok {
				out = append(out, tk)
			}
		}
		return out
	}

	// invariantOK enforces one-task-per-rover: no rover may appear as the Assignee
	// of more than one LEASED task at the same instant.
	invariantOK := func() (bool, string) {
		holding := make(map[domain.RobotID]domain.TaskID)
		for _, tk := range allTasks() {
			if tk.Status != domain.Leased || tk.Assignee == "" {
				continue
			}
			if other, dup := holding[tk.Assignee]; dup {
				return false, fmt.Sprintf("rover %s holds two LEASED tasks at once: %s and %s",
					tk.Assignee, other, tk.ID)
			}
			holding[tk.Assignee] = tk.ID
		}
		return true, ""
	}

	// A single polling loop with a generous deadline: it continuously checks the
	// invariant, tracks the peak number of distinct simultaneous builders, and
	// detects completion. h.poll's internal 20s deadline is not enough for a full
	// dome under -race, so we run our own 90s loop.
	deadline := time.Now().Add(90 * time.Second)
	maxConcurrent := 0
	completed := false
	for time.Now().Before(deadline) {
		// 1) Headline invariant: fail loudly the instant it is violated.
		if ok, detail := invariantOK(); !ok {
			t.Fatalf("one-task-per-rover invariant VIOLATED: %s", detail)
		}

		// 2) Count distinct rovers simultaneously holding a LEASED task; keep the
		//    running max as the parallelism witness.
		concurrent := make(map[domain.RobotID]struct{})
		for _, tk := range allTasks() {
			if tk.Status == domain.Leased && tk.Assignee != "" {
				concurrent[tk.Assignee] = struct{}{}
			}
		}
		if len(concurrent) > maxConcurrent {
			maxConcurrent = len(concurrent)
		}

		// 3) dome-cap DONE means the whole DAG closed: success path.
		if dc, ok := h.getTask("dome-cap"); ok && dc.Status == domain.Done {
			completed = true
			break
		}

		time.Sleep(10 * time.Millisecond)
	}

	if !completed {
		for _, id := range ids {
			tk, _ := h.getTask(id)
			t.Logf("task=%s status=%s v=%d assignee=%s", id, tk.Status, tk.Version, tk.Assignee)
		}
		t.Fatalf("timed out after 90s waiting for dome-cap DONE (maxConcurrent builders observed=%d)", maxConcurrent)
	}

	// (a) Real parallelism: at minimum two rovers built simultaneously (e.g. two
	// foundations at once). Anything less would mean the swarm serialized.
	if maxConcurrent < 2 {
		t.Fatalf("no real parallelism observed: peak distinct concurrent builders = %d, want >= 2", maxConcurrent)
	}

	// (c) The dome fully closed: every one of the 15 tasks is DONE with no
	// lingering assignee.
	for _, id := range ids {
		tk, ok := h.getTask(id)
		if !ok {
			t.Fatalf("task %s missing from World Model after build", id)
		}
		if tk.Status != domain.Done {
			t.Fatalf("task %s final status = %s, want DONE", id, tk.Status)
		}
		if tk.Assignee != "" {
			t.Fatalf("done task %s assignee = %q, want empty", id, tk.Assignee)
		}
	}
}

// TestDome_KillMidWallStillCloses boots the same dome+six rovers, waits for a wall
// to be actively LEASED to some rover, kills that rover over the dashboard control
// path, and asserts the dome STILL fully closes: the killed wall's lease TTL-
// expires, the task is re-auctioned, another rover finishes it, and the build
// completes end-to-end. Killing a builder mid-wall does not stop the dome.
//
//nolint:gocyclo // end-to-end kill-mid-wall test: sequential poll → kill → re-heal stages over real timing read as one narrative; splitting would obscure it.
func TestDome_KillMidWallStillCloses(t *testing.T) {
	ids := domeTaskIDs()
	h := newSelfHealHarness(t, domeConfig(), ids...)

	// Wait until some wall is LEASED to a concrete rover, and capture that rover.
	var victim domain.RobotID
	h.poll("a wall LEASED to some rover", func() bool {
		for i := 1; i <= 8; i++ {
			id := domain.TaskID(fmt.Sprintf("wall-%d", i))
			tk, ok := h.getTask(id)
			if ok && tk.Status == domain.Leased && tk.Assignee != "" {
				victim = tk.Assignee
				return true
			}
		}
		return false
	})

	// Kill the wall-builder via the dashboard control path: it stops heartbeating,
	// so its lease TTL-expires and the wall self-heals to another rover.
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdKill, Robot: victim}); err != nil {
		t.Fatalf("publish kill %s: %v", victim, err)
	}
	_ = h.conn.Flush()

	// Our own 90s loop (h.poll's 20s is not enough for a full dome under -race).
	deadline := time.Now().Add(90 * time.Second)
	completed := false
	for time.Now().Before(deadline) {
		if dc, ok := h.getTask("dome-cap"); ok && dc.Status == domain.Done {
			completed = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if !completed {
		for _, id := range ids {
			tk, _ := h.getTask(id)
			t.Logf("task=%s status=%s v=%d assignee=%s", id, tk.Status, tk.Version, tk.Assignee)
		}
		t.Fatalf("timed out after 90s: dome-cap never reached DONE after killing %s mid-wall", victim)
	}

	// The dome fully closed despite the mid-wall kill: all 15 tasks DONE.
	for _, id := range ids {
		tk, ok := h.getTask(id)
		if !ok {
			t.Fatalf("task %s missing from World Model after build", id)
		}
		if tk.Status != domain.Done {
			t.Fatalf("task %s final status = %s, want DONE (killed builder was %s)", id, tk.Status, victim)
		}
	}
}
