package planner

import (
	"fmt"
	"reflect"
	"sort"
	"swarmbuild/internal/core/domain"
	"testing"
)

func domeBlueprint() []domain.Task {
	tasks := []domain.Task{}

	for i := 1; i <= 4; i++ {
		tasks = append(tasks, domain.Task{
			ID:     domain.TaskID(fmt.Sprintf("foundation-%d", i)),
			Type:   "foundation",
			Status: domain.Unclaimed,
		})
	}

	wallIDs := []domain.TaskID{}
	for i := 1; i <= 8; i++ {
		foundation := domain.TaskID(fmt.Sprintf("foundation-%d", (i-1)/2+1))
		id := domain.TaskID(fmt.Sprintf("wall-%d", i))
		wallIDs = append(wallIDs, id)
		tasks = append(tasks, domain.Task{
			ID:     id,
			Type:   "wall",
			Deps:   []domain.TaskID{foundation},
			Status: domain.Unclaimed,
		})
	}

	tasks = append(tasks, domain.Task{
		ID:     "dome-cap",
		Type:   "dome-cap",
		Deps:   wallIDs,
		Status: domain.Unclaimed,
	})

	return tasks
}

func mustLoad(t *testing.T, tasks []domain.Task) *Plan {
	t.Helper()
	p, err := Load(tasks)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	return p
}

func asSet(ids []domain.TaskID) map[domain.TaskID]bool {
	s := make(map[domain.TaskID]bool, len(ids))
	for _, id := range ids {
		s[id] = true
	}
	return s
}

func TestLoad_RejectsBadBlueprints(t *testing.T) {
	tests := []struct {
		name  string
		tasks []domain.Task
	}{
		{
			name: "direct cycle a<->b",
			tasks: []domain.Task{
				{ID: "a", Deps: []domain.TaskID{"b"}},
				{ID: "b", Deps: []domain.TaskID{"a"}},
			},
		},
		{
			name: "three-node cycle",
			tasks: []domain.Task{
				{ID: "a", Deps: []domain.TaskID{"c"}},
				{ID: "b", Deps: []domain.TaskID{"a"}},
				{ID: "c", Deps: []domain.TaskID{"b"}},
			},
		},
		{
			name: "self dependency",
			tasks: []domain.Task{
				{ID: "a", Deps: []domain.TaskID{"a"}},
			},
		},
		{
			name: "dep references unknown task",
			tasks: []domain.Task{
				{ID: "wall-1", Deps: []domain.TaskID{"foundation-1"}},
			},
		},
		{
			name: "duplicate task id",
			tasks: []domain.Task{
				{ID: "a"},
				{ID: "a"},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p, err := Load(tc.tasks)
			if err == nil {
				t.Fatalf("Load() = %v, nil; want error", p)
			}
			if p != nil {
				t.Fatalf("Load() returned non-nil Plan alongside error")
			}
		})
	}
}

func TestLoad_AcceptsDomeBlueprint(t *testing.T) {
	p := mustLoad(t, domeBlueprint())
	if got, want := p.Len(), 4+8+1; got != want {
		t.Fatalf("Len() = %d, want %d", got, want)
	}
}

func TestReady_InitiallyOnlyNoDepTasks(t *testing.T) {
	p := mustLoad(t, domeBlueprint())

	got := asSet(p.Ready())
	want := asSet([]domain.TaskID{
		"foundation-1", "foundation-2", "foundation-3", "foundation-4",
	})

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("initial Ready() = %v, want exactly the four foundations", p.Ready())
	}
}

func TestReady_CompletingDependencyUnblocksDependent(t *testing.T) {
	p := mustLoad(t, domeBlueprint())

	before := asSet(p.Ready())
	if before["wall-1"] || before["wall-2"] {
		t.Fatalf("wall on foundation-1 ready before foundation-1 done: %v", p.Ready())
	}

	if ok := p.MarkDone("foundation-1"); !ok {
		t.Fatalf("MarkDone(foundation-1) = false, want true")
	}

	after := asSet(p.Ready())
	if !after["wall-1"] || !after["wall-2"] {
		t.Fatalf("walls on foundation-1 not ready after it completed: %v", p.Ready())
	}
	if after["foundation-1"] {
		t.Fatalf("DONE foundation-1 still appears in Ready(): %v", p.Ready())
	}
	if after["wall-3"] {
		t.Fatalf("wall-3 (foundation-2) ready though foundation-2 not done: %v", p.Ready())
	}
}

func TestReady_DomeCapNeedsAllWalls(t *testing.T) {
	p := mustLoad(t, domeBlueprint())

	for i := 1; i <= 4; i++ {
		p.MarkDone(domain.TaskID(fmt.Sprintf("foundation-%d", i)))
	}
	for i := 1; i <= 7; i++ {
		p.MarkDone(domain.TaskID(fmt.Sprintf("wall-%d", i)))
	}

	mid := asSet(p.Ready())
	if mid["dome-cap"] {
		t.Fatalf("dome-cap ready before all walls done: %v", p.Ready())
	}
	if !mid["wall-8"] {
		t.Fatalf("wall-8 not ready though foundation-4 done: %v", p.Ready())
	}

	p.MarkDone("wall-8")
	final := p.Ready()
	if !reflect.DeepEqual(final, []domain.TaskID{"dome-cap"}) {
		t.Fatalf("after last wall, Ready() = %v, want [dome-cap]", final)
	}

	p.MarkDone("dome-cap")
	if got := p.Ready(); len(got) != 0 {
		t.Fatalf("Ready() = %v, want empty after everything done", got)
	}
}

func TestMarkDone_UnknownID(t *testing.T) {
	p := mustLoad(t, domeBlueprint())
	if p.MarkDone("nonexistent") {
		t.Fatalf("MarkDone(nonexistent) = true, want false")
	}
}

func TestMarkDone_AlreadyDoneIsNoop(t *testing.T) {
	p := mustLoad(t, domeBlueprint())
	if !p.MarkDone("foundation-1") {
		t.Fatalf("first MarkDone = false")
	}
	if !p.MarkDone("foundation-1") {
		t.Fatalf("repeat MarkDone = false, want idempotent true")
	}
	if st, _ := p.Status("foundation-1"); st != domain.Done {
		t.Fatalf("Status = %v, want DONE", st)
	}
}

func TestTopoOrder_RespectsDependencies(t *testing.T) {
	p := mustLoad(t, domeBlueprint())
	order := p.TopoOrder()

	if len(order) != p.Len() {
		t.Fatalf("TopoOrder() length = %d, want %d", len(order), p.Len())
	}

	seen := map[domain.TaskID]int{}
	pos := map[domain.TaskID]int{}
	for i, id := range order {
		seen[id]++
		pos[id] = i
	}
	for id, n := range seen {
		if n != 1 {
			t.Fatalf("id %q appears %d times in TopoOrder()", id, n)
		}
	}

	for _, task := range domeBlueprint() {
		for _, dep := range task.Deps {
			if pos[dep] >= pos[task.ID] {
				t.Fatalf("dep %q (pos %d) not before dependent %q (pos %d)",
					dep, pos[dep], task.ID, pos[task.ID])
			}
		}
	}
}

func TestDeterminism_StableAcrossRunsAndInputOrder(t *testing.T) {
	base := domeBlueprint()

	reversed := make([]domain.Task, len(base))
	for i, t := range base {
		reversed[len(base)-1-i] = t
	}

	p1 := mustLoad(t, base)
	p2 := mustLoad(t, reversed)

	if !reflect.DeepEqual(p1.TopoOrder(), p2.TopoOrder()) {
		t.Fatalf("TopoOrder differs by input order:\n %v\n %v", p1.TopoOrder(), p2.TopoOrder())
	}
	if !reflect.DeepEqual(p1.Ready(), p2.Ready()) {
		t.Fatalf("Ready differs by input order:\n %v\n %v", p1.Ready(), p2.Ready())
	}

	for i := range 5 {
		if !reflect.DeepEqual(p1.TopoOrder(), p2.TopoOrder()) {
			t.Fatalf("TopoOrder() not stable on call %d", i)
		}
		if !reflect.DeepEqual(p1.Ready(), p2.Ready()) {
			t.Fatalf("Ready() not stable on call %d", i)
		}
	}

	r := p1.Ready()
	if !sort.SliceIsSorted(r, func(i, j int) bool { return r[i] < r[j] }) {
		t.Fatalf("initial Ready() not in deterministic sorted order: %v", r)
	}
}

func TestLoad_PreservesPreexistingDoneStatus(t *testing.T) {
	tasks := domeBlueprint()
	for i := range tasks {
		if tasks[i].ID == "foundation-1" {
			tasks[i].Status = domain.Done
		}
	}
	p := mustLoad(t, tasks)

	ready := asSet(p.Ready())
	if ready["foundation-1"] {
		t.Fatalf("pre-DONE foundation-1 should not be ready: %v", p.Ready())
	}
	if !ready["wall-1"] || !ready["wall-2"] {
		t.Fatalf("walls on pre-DONE foundation-1 should be ready: %v", p.Ready())
	}
}
