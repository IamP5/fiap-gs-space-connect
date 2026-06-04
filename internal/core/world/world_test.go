package world

import (
	"math/rand"
	"reflect"
	"testing"
	"testing/quick"

	"swarmbuild/internal/core/domain"
)

// ---------------------------------------------------------------------------
// Equality helper
// ---------------------------------------------------------------------------

// taskEqual reports whether two task records are field-for-field identical,
// including the Deps slice (compared element-wise; nil and empty are treated
// as equal because they describe the same "no dependencies" record).
func taskEqual(a, b domain.Task) bool {
	if a.ID != b.ID ||
		a.Type != b.Type ||
		a.Status != b.Status ||
		a.Assignee != b.Assignee ||
		a.LeaseExpiry != b.LeaseExpiry ||
		a.Version != b.Version {
		return false
	}
	if len(a.Deps) != len(b.Deps) {
		return false
	}
	for i := range a.Deps {
		if a.Deps[i] != b.Deps[i] {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// testing/quick generator
// ---------------------------------------------------------------------------

// genTask is a domain.Task wrapper with a Generate method so testing/quick can
// produce random records. The value space is deliberately small (a handful of
// ids, low versions, a few assignees) so collisions and concurrent claims —
// the interesting cases — actually occur often enough to be exercised.
type genTask struct{ domain.Task }

var (
	sampleIDs       = []domain.TaskID{"wall-1", "wall-2", "dome-cap", "foundation-3"}
	sampleTypes     = []domain.TaskType{"wall", "foundation", "dome-cap"}
	sampleAssignees = []domain.RobotID{"", "R1", "R2", "R3", "R6"}
	sampleStatuses  = []domain.TaskStatus{domain.Unclaimed, domain.Leased, domain.Done}
	sampleDeps      = []domain.TaskID{"foundation-1", "foundation-2", "wall-7"}
)

func (genTask) Generate(rnd *rand.Rand, _ int) reflect.Value {
	t := domain.Task{
		ID:          sampleIDs[rnd.Intn(len(sampleIDs))],
		Type:        sampleTypes[rnd.Intn(len(sampleTypes))],
		Status:      sampleStatuses[rnd.Intn(len(sampleStatuses))],
		Assignee:    sampleAssignees[rnd.Intn(len(sampleAssignees))],
		LeaseExpiry: domain.Tick(rnd.Intn(5)),
		Version:     domain.Lamport(rnd.Intn(4)), // small range → frequent ties
	}
	n := rnd.Intn(len(sampleDeps) + 1)
	if n > 0 {
		t.Deps = make([]domain.TaskID, n)
		for i := range t.Deps {
			t.Deps[i] = sampleDeps[rnd.Intn(len(sampleDeps))]
		}
	}
	return reflect.ValueOf(genTask{t})
}

// sameID forces b to share a's TaskID, so merge-law properties are checked on
// records that genuinely describe the same task (Merge is only meaningful for
// same-id records — ADR-0003).
func sameID(a, b domain.Task) domain.Task {
	b.ID = a.ID
	return b
}

// ---------------------------------------------------------------------------
// Merge property tests (testing/quick) — TECHSPEC §7, issue 10
// ---------------------------------------------------------------------------

func TestMergeCommutative(t *testing.T) {
	f := func(ga, gb genTask) bool {
		a, b := ga.Task, sameID(ga.Task, gb.Task)
		return taskEqual(Merge(a, b), Merge(b, a))
	}
	if err := quick.Check(f, nil); err != nil {
		t.Fatalf("Merge is not commutative: %v", err)
	}
}

func TestMergeIdempotent(t *testing.T) {
	f := func(ga genTask) bool {
		return taskEqual(Merge(ga.Task, ga.Task), ga.Task)
	}
	if err := quick.Check(f, nil); err != nil {
		t.Fatalf("Merge is not idempotent: %v", err)
	}
}

func TestMergeAssociative(t *testing.T) {
	f := func(ga, gb, gc genTask) bool {
		a := ga.Task
		b := sameID(a, gb.Task)
		c := sameID(a, gc.Task)
		left := Merge(Merge(a, b), c)
		right := Merge(a, Merge(b, c))
		return taskEqual(left, right)
	}
	if err := quick.Check(f, nil); err != nil {
		t.Fatalf("Merge is not associative: %v", err)
	}
}

// TestMergeSelectsOneOperand checks the LWW invariant that Merge never
// fabricates a record: its result is always (field-for-field) one of its
// inputs.
func TestMergeReturnsAnOperand(t *testing.T) {
	f := func(ga, gb genTask) bool {
		a, b := ga.Task, sameID(ga.Task, gb.Task)
		m := Merge(a, b)
		return taskEqual(m, a) || taskEqual(m, b)
	}
	if err := quick.Check(f, nil); err != nil {
		t.Fatalf("Merge fabricated a record: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Merge tie-break table tests — TECHSPEC §4, ADR-0003
// ---------------------------------------------------------------------------

func TestMergeTieBreaks(t *testing.T) {
	const id = domain.TaskID("wall-7")

	tests := []struct {
		name string
		a, b domain.Task
		want domain.Task
	}{
		{
			name: "higher version wins regardless of status",
			a:    domain.Task{ID: id, Status: domain.Done, Version: 1},
			b:    domain.Task{ID: id, Status: domain.Unclaimed, Version: 2},
			want: domain.Task{ID: id, Status: domain.Unclaimed, Version: 2},
		},
		{
			name: "equal version: Done beats Leased (terminal not demoted)",
			a:    domain.Task{ID: id, Status: domain.Leased, Assignee: "R1", Version: 5},
			b:    domain.Task{ID: id, Status: domain.Done, Version: 5},
			want: domain.Task{ID: id, Status: domain.Done, Version: 5},
		},
		{
			name: "equal version: Leased beats Unclaimed",
			a:    domain.Task{ID: id, Status: domain.Unclaimed, Version: 5},
			b:    domain.Task{ID: id, Status: domain.Leased, Assignee: "R4", Version: 5},
			want: domain.Task{ID: id, Status: domain.Leased, Assignee: "R4", Version: 5},
		},
		{
			name: "concurrent claim: same version+status, lower rover id wins",
			a:    domain.Task{ID: id, Status: domain.Leased, Assignee: "R5", Version: 7},
			b:    domain.Task{ID: id, Status: domain.Leased, Assignee: "R2", Version: 7},
			want: domain.Task{ID: id, Status: domain.Leased, Assignee: "R2", Version: 7},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := Merge(tc.a, tc.b); !taskEqual(got, tc.want) {
				t.Errorf("Merge(a,b) = %+v, want %+v", got, tc.want)
			}
			// Commutativity must hold for the concrete cases too.
			if got := Merge(tc.b, tc.a); !taskEqual(got, tc.want) {
				t.Errorf("Merge(b,a) = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// TestConcurrentClaimLowerRoverIDWins is the property form of the headline
// CRDT guarantee: for two concurrent claims (equal Version, both Leased,
// different assignees) the lower rover id always wins, in either argument order
// (issue 10 acceptance criterion).
func TestConcurrentClaimLowerRoverIDWins(t *testing.T) {
	f := func(ga, gb genTask) bool {
		a := ga.Task
		a.Status = domain.Leased
		a.Assignee = "R3"
		b := sameID(a, gb.Task)
		b.Status = domain.Leased
		b.Assignee = "R6"
		b.Version = a.Version // force concurrent (equal) versions
		b.LeaseExpiry = a.LeaseExpiry
		b.Type = a.Type
		b.Deps = a.Deps

		wantWinner := domain.RobotID("R3") // lower id
		return Merge(a, b).Assignee == wantWinner &&
			Merge(b, a).Assignee == wantWinner
	}
	if err := quick.Check(f, nil); err != nil {
		t.Fatalf("concurrent claim did not resolve to lower rover id: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Model.Apply property + table tests — TECHSPEC §4, §8
// ---------------------------------------------------------------------------

// TestApplyConsistentWithMerge ties the live guard to the CRDT: after applying
// any sequence of records, every stored record equals the Merge-fold of all
// records seen for that id. This is the order-independence guarantee.
func TestApplyOrderIndependent(t *testing.T) {
	f := func(records []genTask) bool {
		if len(records) == 0 {
			return true
		}
		// Fold every record into the model via Apply.
		m := NewModel()
		for _, g := range records {
			m.Apply(g.Task)
		}
		// Independently compute the expected winner per id by Merge-folding.
		expected := make(map[domain.TaskID]domain.Task)
		for _, g := range records {
			cur, ok := expected[g.Task.ID]
			if !ok {
				expected[g.Task.ID] = g.Task
				continue
			}
			expected[g.Task.ID] = Merge(cur, g.Task)
		}
		for id, want := range expected {
			got, ok := m.Get(id)
			if !ok || !taskEqual(got, want) {
				return false
			}
		}
		return true
	}
	if err := quick.Check(f, nil); err != nil {
		t.Fatalf("Apply disagreed with Merge fold: %v", err)
	}
}

// TestApplyPermutationInvariant checks that applying the same multiset of
// records in two independent random orders yields identical snapshots — the
// "any order yields identical state" criterion of issue 10.
func TestApplyPermutationInvariant(t *testing.T) {
	f := func(records []genTask, seed int64) bool {
		m1 := NewModel()
		for _, g := range records {
			m1.Apply(g.Task)
		}

		shuffled := make([]genTask, len(records))
		copy(shuffled, records)
		rnd := rand.New(rand.NewSource(seed))
		rnd.Shuffle(len(shuffled), func(i, j int) {
			shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
		})
		m2 := NewModel()
		for _, g := range shuffled {
			m2.Apply(g.Task)
		}

		s1, s2 := m1.Snapshot(), m2.Snapshot()
		if len(s1) != len(s2) {
			return false
		}
		for i := range s1 {
			if !taskEqual(s1[i], s2[i]) {
				return false
			}
		}
		return true
	}
	if err := quick.Check(f, nil); err != nil {
		t.Fatalf("Apply is order-dependent: %v", err)
	}
}

func TestApplyMonotonicAndIdempotent(t *testing.T) {
	const id = domain.TaskID("wall-7")
	newer := domain.Task{ID: id, Status: domain.Leased, Assignee: "R5", Version: 2}
	older := domain.Task{ID: id, Status: domain.Unclaimed, Version: 1}

	tests := []struct {
		name      string
		seq       []domain.Task
		wantWon   []bool
		wantFinal domain.Task
	}{
		{
			name:      "fresh id is accepted",
			seq:       []domain.Task{newer},
			wantWon:   []bool{true},
			wantFinal: newer,
		},
		{
			name:      "older after newer is a no-op (monotonic)",
			seq:       []domain.Task{newer, older},
			wantWon:   []bool{true, false},
			wantFinal: newer,
		},
		{
			name:      "newer after older wins (forward progress)",
			seq:       []domain.Task{older, newer},
			wantWon:   []bool{true, true},
			wantFinal: newer,
		},
		{
			name:      "duplicate redelivered record is a no-op (idempotent)",
			seq:       []domain.Task{newer, newer, newer},
			wantWon:   []bool{true, false, false},
			wantFinal: newer,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := NewModel()
			for i, rec := range tc.seq {
				if got := m.Apply(rec); got != tc.wantWon[i] {
					t.Errorf("Apply #%d won = %v, want %v", i, got, tc.wantWon[i])
				}
			}
			got, ok := m.Get(id)
			if !ok {
				t.Fatalf("Get(%q) missing after applies", id)
			}
			if !taskEqual(got, tc.wantFinal) {
				t.Errorf("final = %+v, want %+v", got, tc.wantFinal)
			}
		})
	}
}

// TestApplyDuplicateIsNoOpProperty: re-applying any already-stored record never
// changes state and always reports false.
func TestApplyDuplicateIsNoOpProperty(t *testing.T) {
	f := func(g genTask) bool {
		m := NewModel()
		if !m.Apply(g.Task) {
			return false // first apply of a fresh id must win
		}
		before, _ := m.Get(g.Task.ID)
		won := m.Apply(g.Task)
		after, _ := m.Get(g.Task.ID)
		return !won && taskEqual(before, after)
	}
	if err := quick.Check(f, nil); err != nil {
		t.Fatalf("duplicate apply was not a no-op: %v", err)
	}
}

func TestSnapshotSortedByID(t *testing.T) {
	m := NewModel()
	for _, id := range []domain.TaskID{"wall-2", "dome-cap", "foundation-1", "wall-1"} {
		m.Apply(domain.Task{ID: id, Version: 1})
	}
	snap := m.Snapshot()
	want := []domain.TaskID{"dome-cap", "foundation-1", "wall-1", "wall-2"}
	if len(snap) != len(want) {
		t.Fatalf("snapshot len = %d, want %d", len(snap), len(want))
	}
	for i, w := range want {
		if snap[i].ID != w {
			t.Errorf("snapshot[%d].ID = %q, want %q", i, snap[i].ID, w)
		}
	}
}

func TestGetMissing(t *testing.T) {
	m := NewModel()
	if _, ok := m.Get("nope"); ok {
		t.Errorf("Get on empty model returned ok=true")
	}
}
