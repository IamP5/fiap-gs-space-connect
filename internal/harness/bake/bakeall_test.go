package bake

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/cache"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/wire"
	"sync"
	"testing"
)

// recordingModel returns a fixed, hard-gate-passing spec on every call and records
// the user prompt of each call in order, so a test can assert generation ORDER and
// that a Task's prompt carried its neighbour world. It is deterministic and makes no
// network call.
type recordingModel struct {
	mu      sync.Mutex
	prompts []string
	spec    json.RawMessage
}

func (m *recordingModel) Generate(_ context.Context, req model.Request) (json.RawMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	// The last user message carries the contract + world context (incl. neighbours).
	var last string
	for _, msg := range req.Messages {
		if msg.Role == "user" {
			last = msg.Content
		}
	}
	m.prompts = append(m.prompts, last)
	return m.spec, nil
}

// genericSpec is a multi-shape plinth that fits EVERY demo envelope simultaneously
// (X half ≤ 1.0, Y half ≤ 0.8 for the foundation, Z half ≤ 0.6 for the wall) and
// clears every demo done-criteria (incl. the wall's 0.08 coverage) + the soft
// threshold (3 shapes, grounded slab).
func genericSpec(t *testing.T) json.RawMessage {
	t.Helper()
	ops := []wire.BuildOp{
		{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: domain.Vec3{X: 0, Y: -0.65, Z: 0}, Scale: domain.Vec3{X: 1.8, Y: 0.3, Z: 1.0}, Material: wire.Material{Color: "#cfcfd6"}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: -0.6, Y: 0, Z: 0}, Scale: domain.Vec3{X: 0.3, Y: 1.4, Z: 0.3}, Material: wire.Material{Color: colorSilver}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: 0.6, Y: 0, Z: 0}, Scale: domain.Vec3{X: 0.3, Y: 1.4, Z: 0.3}, Material: wire.Material{Color: colorSilver}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeSphere, Pos: domain.Vec3{X: 0, Y: 0.5, Z: 0}, Scale: domain.Vec3{X: 0.5, Y: 0.5, Z: 0.5}, Material: wire.Material{Color: "#808080"}},
	}
	b, err := json.Marshal(struct {
		Ops []wire.BuildOp `json:"ops"`
	}{ops})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

// demoTasks is the demo dome's task DAG in the bake.PlanTask shape (4 foundations,
// 8 walls, dome-cap) — a self-contained mirror of demo.DomeBlueprint so the bake
// package's test doesn't import the coordinator/agent graph.
func demoTasks() []PlanTask {
	var tasks []PlanTask
	for i := 1; i <= 4; i++ {
		tasks = append(tasks, PlanTask{ID: domain.TaskID(itoa("foundation-", i)), Type: typeFoundation, Pos: domain.Vec2{X: float64(i) * 10, Y: 0}})
	}
	var walls []domain.TaskID
	for i := 1; i <= 8; i++ {
		id := domain.TaskID(itoa("wall-", i))
		walls = append(walls, id)
		foundation := domain.TaskID(itoa("foundation-", (i-1)/2+1))
		tasks = append(tasks, PlanTask{ID: id, Type: "wall", Deps: []domain.TaskID{foundation}, Pos: domain.Vec2{X: float64(i) * 12, Y: 50}})
	}
	tasks = append(tasks, PlanTask{ID: idDomeCap, Type: typeDomeCap, Deps: walls, Pos: domain.Vec2{X: 50, Y: 25}})
	return tasks
}

func itoa(prefix string, n int) string {
	return prefix + strconv.Itoa(n)
}

// TestBakeAll_BakesEveryTaskInTopologicalOrder is the headline proof for bake-all:
// every demo Task is cached, the whole dome replays deterministically, and
// generation proceeds in dependency order (each foundation before the walls that
// depend on it, all walls before the dome-cap).
func TestBakeAll_BakesEveryTaskInTopologicalOrder(t *testing.T) {
	store, err := cache.NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	m := &recordingModel{spec: genericSpec(t)}
	tasks := demoTasks()

	results, review, err := All(context.Background(), m, store, tasks, DemoContract, "openai", "gpt-4o")
	if err != nil {
		t.Fatalf("BakeAll: %v", err)
	}
	if len(results) != len(tasks) {
		t.Fatalf("want a result per task (%d), got %d", len(tasks), len(results))
	}
	if review.Cached != len(tasks) {
		t.Fatalf("every task must be cached, got %d/%d (fellback=%v low=%v)", review.Cached, len(tasks), review.FellBack, review.LowQual)
	}
	if len(review.FellBack) != 0 {
		t.Fatalf("no task should fall back with a valid model, got %v", review.FellBack)
	}

	// Dependency order: a foundation appears before each wall that depends on it, and
	// every wall appears before the dome-cap. The recordingModel saw prompts in bake
	// order.
	order := bakeOrder(m)
	assertBefore(t, order, "foundation-1", "wall-1")
	assertBefore(t, order, "foundation-1", "wall-2")
	for i := 1; i <= 8; i++ {
		assertBefore(t, order, itoa("wall-", i), idDomeCap)
	}

	// Neighbour world: the dome-cap's prompt (generated last, after all walls)
	// mentions neighbouring structures, proving a worker's snapshot includes
	// neighbour ops within/near its envelope.
	capPrompt := promptFor(t, m, idDomeCap)
	if !strings.Contains(capPrompt, "Neighbouring structures already exist") {
		t.Fatal("dome-cap prompt must carry its neighbour world (accumulated neighbour ops)")
	}

	// Full-dome deterministic replay: rebuild a cache from the written files and
	// confirm every task replays.
	replay := loadStoreCache(t, store, tasks)
	for _, tk := range tasks {
		ops, ok := replay.Lookup(DemoBlueprintID, string(tk.ID))
		if !ok || len(ops) == 0 {
			t.Fatalf("task %s must replay from the baked cache (ok=%v ops=%d)", tk.ID, ok, len(ops))
		}
	}
}

// bakeOrder returns the task ids in the order BakeAll generated them, recovered
// from the recordingModel's prompts (each prompt embeds its contract's task_id).
func bakeOrder(m *recordingModel) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var ids []string
	for _, p := range m.prompts {
		ids = append(ids, taskIDFromPrompt(p))
	}
	return ids
}

func promptFor(t *testing.T, m *recordingModel, id string) string {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range m.prompts {
		if taskIDFromPrompt(p) == id {
			return p
		}
	}
	t.Fatalf("no prompt recorded for task %s", id)
	return ""
}

// taskIDFromPrompt extracts the "task_id":"..." value embedded in a bake prompt's
// contract JSON.
func taskIDFromPrompt(prompt string) string {
	const key = `"task_id":"`
	_, rest, found := strings.Cut(prompt, key)
	if !found {
		return ""
	}
	id, _, _ := strings.Cut(rest, `"`)
	return id
}

func assertBefore(t *testing.T, order []string, a, b string) {
	t.Helper()
	ia, ib := -1, -1
	for i, id := range order {
		if id == a {
			ia = i
		}
		if id == b {
			ib = i
		}
	}
	if ia < 0 || ib < 0 {
		t.Fatalf("order missing %q (%d) or %q (%d): %v", a, ia, b, ib, order)
	}
	if ia >= ib {
		t.Fatalf("dependency order violated: %q (pos %d) must be baked before %q (pos %d)\norder=%v", a, ia, b, ib, order)
	}
}

// loadStoreCache rebuilds a replay cache from the spec files a Store wrote for the
// given tasks (skipping trace sidecars).
func loadStoreCache(t *testing.T, store *cache.Store, tasks []PlanTask) *cache.Cache {
	t.Helper()
	files := make(map[string][]byte)
	for _, tk := range tasks {
		c, err := DemoContract(tk.ID, tk.Type)
		if err != nil {
			t.Fatalf("contract %s: %v", tk.ID, err)
		}
		cj, _ := c.JSON()
		key := cache.Key{BlueprintID: DemoBlueprintID, TaskID: string(tk.ID), ContractHash: cache.ContractHash(cj), Model: "gpt-4o"}
		data, err := readFile(t, store.Path(key))
		if err != nil {
			t.Fatalf("read spec for %s: %v", tk.ID, err)
		}
		files[key.Filename()] = data
	}
	c, err := cache.New(files)
	if err != nil {
		t.Fatalf("rebuild cache: %v", err)
	}
	return c
}

// TestBakeAll_LowQualityCachedNotWithheld: when the model emits a passing-but-low
// spec, BakeAll caches it AND lists it in the operator review as low-quality — the
// quality surface the operator inspects (ADR-0008).
func TestBakeAll_LowQualityCachedNotWithheld(t *testing.T) {
	store, err := cache.NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	// A flat single-shape, single-colour mass that passes the hard gate but scores
	// below the soft threshold for a foundation.
	const grey = "#cccccc"
	flat := []wire.BuildOp{
		{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: domain.Vec3{X: -0.5, Y: -1.0, Z: 0}, Scale: domain.Vec3{X: 0.5, Y: 0.2, Z: 1.6}, Material: wire.Material{Color: grey}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: domain.Vec3{X: 0, Y: -1.0, Z: 0}, Scale: domain.Vec3{X: 0.5, Y: 0.2, Z: 1.6}, Material: wire.Material{Color: grey}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: domain.Vec3{X: 0.5, Y: -1.0, Z: 0}, Scale: domain.Vec3{X: 0.5, Y: 0.2, Z: 1.6}, Material: wire.Material{Color: grey}},
	}
	flatJSON, _ := json.Marshal(struct {
		Ops []wire.BuildOp `json:"ops"`
	}{flat})
	m := &recordingModel{spec: flatJSON}

	tasks := []PlanTask{{ID: "foundation-1", Type: typeFoundation, Pos: domain.Vec2{}}}
	_, review, err := All(context.Background(), m, store, tasks, DemoContract, "openai", "gpt-4o")
	if err != nil {
		t.Fatalf("BakeAll: %v", err)
	}
	if review.Cached != 1 {
		t.Fatalf("the low-quality spec must STILL be cached, got cached=%d", review.Cached)
	}
	if len(review.LowQual) != 1 || review.LowQual[0] != "foundation-1" {
		t.Fatalf("operator review must list the low-quality task, got %v", review.LowQual)
	}
	if strings.Contains(review.Summary(), "FALLBACK") {
		t.Fatal("a low-quality (but cached) task is not a fallback")
	}
	if !strings.Contains(review.Summary(), "low-quality") {
		t.Fatal("the review summary must surface the low-quality task")
	}
}
