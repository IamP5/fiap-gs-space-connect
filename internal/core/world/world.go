// Package world is the SwarmBuild World Model: the authoritative record of
// every task's status and the conflict-free merge that reconciles divergent
// copies of a task record.
//
// It is a deep module in the sense of TECHSPEC §3: pure data in, authoritative
// state out. It imports only swarmbuild/core/domain and the standard library —
// no NATS, no simulation, no wall clock, no goroutines.
//
// The package has two faces, kept deliberately consistent (ADR-0003):
//
//   - Model is the live path. A single authoritative writer feeds it task
//     records; Apply is version-guarded so a redelivered expiry or a duplicate
//     re-announce across at-least-once delivery can never move a task backwards
//     or double-award it (TECHSPEC §4, §8).
//   - Merge is the tested path. It is a pure, total, LWW-element merge of two
//     records of the same task, proven commutative, idempotent, and associative
//     by the property tests. The headline demo does not exercise multi-master
//     reconciliation, but the merge is real and the partition-tolerance claim is
//     answered by the green test suite rather than improvised on stage
//     (ADR-0003, issue 10).
//
// Model.Apply and Merge share the same total order (see less): a record is
// accepted by Apply exactly when it would win the merge, so the live guard and
// the CRDT can never disagree about which of two records is newer.
package world

import "swarmbuild/internal/core/domain"

// Model holds the authoritative task records, keyed by TaskID, for the live
// single-writer path. The zero value is not ready for use; construct one with
// NewModel. A Model is not safe for concurrent use — in the live path the
// single-writer tick goroutine serialises all access (TECHSPEC §6, §8).
type Model struct {
	tasks map[domain.TaskID]domain.Task
}

// NewModel returns an empty World Model.
func NewModel() *Model {
	return &Model{tasks: make(map[domain.TaskID]domain.Task)}
}

// Apply offers an incoming task record to the model. It is accepted (stored)
// only if it would win the merge against the record currently held for that
// TaskID — i.e. only if it is strictly newer under the total order in less. A
// brand-new TaskID is always accepted.
//
// Apply returns true when the incoming record won and is now stored, false when
// it was rejected as stale or as an exact duplicate of what is already held.
// This is the version guard of TECHSPEC §4: applying an older-version record
// after a newer one, or re-applying an identical record, is a no-op, so apply
// is monotonic and order-independent.
func (m *Model) Apply(t domain.Task) bool {
	cur, ok := m.tasks[t.ID]
	if ok && !less(cur, t) {
		// Incoming does not strictly beat the stored record: stale or a
		// duplicate. Leave the model untouched.
		return false
	}
	m.tasks[t.ID] = t
	return true
}

// Get returns the stored record for id and whether one exists.
func (m *Model) Get(id domain.TaskID) (domain.Task, bool) {
	t, ok := m.tasks[id]
	return t, ok
}

// Snapshot returns all stored records in deterministic order, sorted ascending
// by TaskID. The returned slice is freshly allocated and owned by the caller.
func (m *Model) Snapshot() []domain.Task {
	out := make([]domain.Task, 0, len(m.tasks))
	for _, t := range m.tasks {
		out = append(out, t)
	}
	// Insertion sort by ID keeps the dependency on the stdlib minimal and is
	// trivially deterministic; task counts in the demo are tiny.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].ID < out[j-1].ID; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// Merge is the pure conflict-free (LWW-element) merge of two task records.
//
// Merge is intended for records that describe the same TaskID; it does not
// require that, but merging records of different tasks is meaningless and the
// caller is responsible for only pairing same-id records (the live path never
// calls Merge at all — ADR-0003).
//
// Merge returns whichever of a and b is "newer" under the total order in less.
// Because that order is total and deterministic, Merge is:
//
//   - commutative: Merge(a, b) == Merge(b, a)
//   - idempotent:  Merge(a, a) == a
//   - associative: Merge(Merge(a, b), c) == Merge(a, Merge(b, c))
//
// so any set of divergent copies reconciles to the same record regardless of
// the order in which they are merged (issue 10).
func Merge(a, b domain.Task) domain.Task {
	if less(a, b) {
		return b
	}
	return a
}

// less reports whether task x is strictly older ("loses to") task y under the
// World Model's total order. It is the single source of truth shared by both
// Apply and Merge, so the live version guard and the CRDT can never disagree.
//
// The order is the LWW-element rule of TECHSPEC §4 / ADR-0003, made total so it
// is well defined for ANY two records:
//
//  1. Higher Version (Lamport) wins. This is the primary, monotonic guard:
//     the live writer bumps Version on every change, so the latest write wins.
//  2. Tie on Version → higher Status priority wins (Done > Leased > Unclaimed).
//     Done is terminal, so a concurrent same-version record can never demote a
//     completed task.
//  3. Tie on Status → LOWER Assignee id wins. This is the deterministic
//     concurrent-claim tiebreak the PRD requires: when two rovers claim the
//     same task at the same logical version, the lower rover id keeps it
//     (issue 10, ADR-0003). The empty RobotID (no assignee) sorts lowest, so a
//     concrete claim outranks a no-assignee record only via Status/Version, not
//     here — by the time two records tie on Version and Status they are either
//     both unassigned or both assigned.
//  4. Remaining ties are broken on the descriptive fields so the order is
//     total and Merge stays well defined for genuinely identical-but-for-noise
//     records: lower LeaseExpiry, then lower Type, then by Deps (shorter slice,
//     then element-wise), then lower ID. These rarely differ for a true same-id
//     pair; they exist only to guarantee totality (and thus associativity).
//
// less is a strict weak order: less(x, x) is false, and exactly one of
// less(x, y), less(y, x), or "equal" holds for any pair.
func less(x, y domain.Task) bool {
	if x.Version != y.Version {
		return x.Version < y.Version
	}
	if px, py := statusRank(x.Status), statusRank(y.Status); px != py {
		// Higher rank wins, so x is "less" when its rank is lower.
		return px < py
	}
	if x.Assignee != y.Assignee {
		// Lower assignee id wins, so x is "less" when its id is greater.
		return x.Assignee > y.Assignee
	}
	if x.LeaseExpiry != y.LeaseExpiry {
		return x.LeaseExpiry < y.LeaseExpiry
	}
	if x.Type != y.Type {
		return x.Type < y.Type
	}
	if c := compareDeps(x.Deps, y.Deps); c != 0 {
		return c < 0
	}
	return x.ID < y.ID
}

// statusRank maps a TaskStatus onto its merge priority. Done is terminal and
// must never be overridden by a concurrent same-version record, so it ranks
// highest; Leased outranks Unclaimed so a fresh claim beats a stale release at
// equal version. Unknown statuses rank below all known ones.
func statusRank(s domain.TaskStatus) int {
	switch s {
	case domain.Done:
		return 3
	case domain.Leased:
		return 2
	case domain.Unclaimed:
		return 1
	default:
		return 0
	}
}

// compareDeps returns -1, 0, or 1 ordering two dependency lists: shorter list
// first, then element-wise by ascending TaskID. It exists only to make less a
// total order; two genuine copies of the same task carry identical Deps.
func compareDeps(a, b []domain.TaskID) int {
	if len(a) != len(b) {
		if len(a) < len(b) {
			return -1
		}
		return 1
	}
	for i := range a {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}
