package lease

import (
	"swarmbuild/internal/core/domain"
	"testing"
)

// fakeClock is a manually-advanced logical clock implementing domain.Clock.
// Tests advance it by hand so lease behaviour is deterministic and needs no
// real sleeping (TECHSPEC §7).
type fakeClock struct{ now domain.Tick }

func (c *fakeClock) Now() domain.Tick      { return c.now }
func (c *fakeClock) advance(d domain.Tick) { c.now += d }
func (c *fakeClock) set(t domain.Tick)     { c.now = t }

const ttl = domain.Tick(30) // ≥ 3× a heartbeat interval of 10

// wall7 is the task id exercised throughout these tests, extracted so every
// case names the same task with one spelling.
const wall7 = domain.TaskID("wall-7")

func newFixture(start domain.Tick) (*fakeClock, *Manager) {
	clk := &fakeClock{now: start}
	return clk, NewManager(clk, ttl)
}

// --- Grant / Status -------------------------------------------------------

func TestGrant(t *testing.T) {
	tests := []struct {
		name      string
		setup     func(m *Manager)
		task      domain.TaskID
		rover     domain.RobotID
		wantOK    bool
		wantState domain.TaskStatus
	}{
		{
			name:      "grant on unclaimed succeeds and sets LEASED",
			task:      wall7,
			rover:     "R3",
			wantOK:    true,
			wantState: domain.Leased,
		},
		{
			name:      "grant on already-leased task is rejected",
			setup:     func(m *Manager) { m.Grant(wall7, "R3") },
			task:      wall7,
			rover:     "R5",
			wantOK:    false,
			wantState: domain.Leased, // still held by original rover
		},
		{
			name: "grant on done task is rejected",
			setup: func(m *Manager) {
				m.Grant(wall7, "R3")
				m.Complete(wall7, "R3")
			},
			task:      wall7,
			rover:     "R5",
			wantOK:    false,
			wantState: domain.Done,
		},
		{
			name: "re-grant after release succeeds",
			setup: func(m *Manager) {
				m.Grant(wall7, "R3")
				m.Release(wall7, "R3")
			},
			task:      wall7,
			rover:     "R5",
			wantOK:    true,
			wantState: domain.Leased,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, m := newFixture(100)
			if tc.setup != nil {
				tc.setup(m)
			}
			if got := m.Grant(tc.task, tc.rover); got != tc.wantOK {
				t.Fatalf("Grant ok = %v, want %v", got, tc.wantOK)
			}
			if got := m.Status(tc.task); got != tc.wantState {
				t.Fatalf("Status = %v, want %v", got, tc.wantState)
			}
		})
	}
}

func TestStatusOfUnknownTaskIsUnclaimed(t *testing.T) {
	_, m := newFixture(0)
	if got := m.Status("never-seen"); got != domain.Unclaimed {
		t.Fatalf("Status of unknown task = %v, want UNCLAIMED", got)
	}
}

// --- TTL on grant ---------------------------------------------------------

func TestTTLSetOnGrant_LiveBeforeExpiry(t *testing.T) {
	clk, m := newFixture(100)
	if !m.Grant(wall7, "R3") {
		t.Fatal("Grant failed")
	}
	// Just before expiry (100 + 30 = 130): a sweep must not expire it.
	clk.set(129)
	if released := m.Sweep(); released != nil {
		t.Fatalf("Sweep before expiry released %v, want none", released)
	}
	if got := m.Status(wall7); got != domain.Leased {
		t.Fatalf("Status before expiry = %v, want LEASED", got)
	}
}

// --- Heartbeat extends the lease -----------------------------------------

func TestHeartbeatBeforeExpiryExtendsLease(t *testing.T) {
	clk, m := newFixture(100) // expiry = 130
	m.Grant(wall7, "R3")

	// Heartbeat at t=120 resets expiry to 120 + 30 = 150.
	clk.set(120)
	if !m.Heartbeat(wall7, "R3") {
		t.Fatal("Heartbeat by holder rejected")
	}

	// Advance PAST the original expiry (130) but before the new one (150).
	clk.set(140)
	if released := m.Sweep(); released != nil {
		t.Fatalf("Sweep after heartbeat-renewal released %v, want none", released)
	}
	if got := m.Status(wall7); got != domain.Leased {
		t.Fatalf("Status = %v, want LEASED after heartbeat renewal", got)
	}

	// Past the renewed expiry it finally expires.
	clk.set(150)
	if released := m.Sweep(); len(released) != 1 || released[0] != wall7 {
		t.Fatalf("Sweep past renewed expiry = %v, want [wall-7]", released)
	}
}

func TestHeartbeatFromNonHolderRejected(t *testing.T) {
	clk, m := newFixture(100)
	m.Grant(wall7, "R3")

	if m.Heartbeat(wall7, "R5") {
		t.Fatal("Heartbeat from non-holder R5 accepted, want rejected")
	}
	// The legitimate lease must be untouched (expiry still 130).
	clk.set(130)
	if released := m.Sweep(); len(released) != 1 {
		t.Fatalf("expected wall-7 to expire on its original TTL, got %v", released)
	}
}

func TestHeartbeatRejectedForUnclaimedAndDone(t *testing.T) {
	_, m := newFixture(0)
	if m.Heartbeat("nope", "R1") {
		t.Fatal("Heartbeat on unknown task accepted")
	}
	m.Grant(wall7, "R3")
	m.Complete(wall7, "R3")
	if m.Heartbeat(wall7, "R3") {
		t.Fatal("Heartbeat on DONE task accepted")
	}
}

// --- Silence beyond TTL expires exactly once -----------------------------

func TestSilenceBeyondTTLExpires(t *testing.T) {
	clk, m := newFixture(100) // expiry = 130
	m.Grant(wall7, "R3")

	clk.set(130) // now >= expiry
	released := m.Sweep()
	if len(released) != 1 || released[0] != wall7 {
		t.Fatalf("Sweep at expiry = %v, want [wall-7]", released)
	}
	if got := m.Status(wall7); got != domain.Unclaimed {
		t.Fatalf("Status after expiry = %v, want UNCLAIMED", got)
	}
}

// TestExactlyOnce_SweepTwiceReleasesOnce is THE critical property: calling
// Sweep twice after a single expiry returns the task only on the first call.
func TestExactlyOnce_SweepTwiceReleasesOnce(t *testing.T) {
	clk, m := newFixture(100) // expiry = 130
	m.Grant(wall7, "R3")
	clk.set(200) // well past expiry

	first := m.Sweep()
	if len(first) != 1 || first[0] != wall7 {
		t.Fatalf("first Sweep = %v, want [wall-7]", first)
	}

	// Subsequent sweeps — even repeated, even with the clock further advanced —
	// must never release the same task again.
	for i := range 3 {
		clk.advance(50)
		if again := m.Sweep(); again != nil {
			t.Fatalf("Sweep #%d after release returned %v, want none (exactly-once)", i+2, again)
		}
	}
}

// TestExactlyOnce_ReleaseIsIdempotent: releasing an already-released or DONE
// task is a no-op (returns false) and never double-releases.
func TestExactlyOnce_ReleaseIsIdempotent(t *testing.T) {
	_, m := newFixture(100)
	m.Grant(wall7, "R3")

	if !m.Release(wall7, "R3") {
		t.Fatal("first Release returned false, want true")
	}
	// Duplicate / redelivered "rover lost" events.
	for i := range 3 {
		if m.Release(wall7, "R3") {
			t.Fatalf("duplicate Release #%d returned true, want false (idempotent)", i+2)
		}
	}
	// Releasing a task the Manager never saw is also a no-op.
	if m.Release("never-seen", "R3") {
		t.Fatal("Release of unknown task returned true, want false")
	}
}

// TestReleaseScopedToHolder_StaleEventDoesNotReleaseSuccessor codifies the
// adversarial repro: a stale/redelivered "rover lost" event for a prior holder
// (R1) must NOT release the fresh lease of the successor (R2) granted after
// re-auction. Under at-least-once delivery (TECHSPEC §4/§8) this would
// otherwise be a real double-release.
func TestReleaseScopedToHolder_StaleEventDoesNotReleaseSuccessor(t *testing.T) {
	clk, m := newFixture(100)

	// R1 wins, then goes silent and its lease expires via Sweep.
	m.Grant("t", "R1")
	clk.set(200)
	if released := m.Sweep(); len(released) != 1 || released[0] != "t" {
		t.Fatalf("Sweep = %v, want [t]", released)
	}

	// Re-auction: R2 picks up the task with a fresh lease.
	if !m.Grant("t", "R2") {
		t.Fatal("re-grant to R2 failed")
	}

	// A redelivered R1-lost event arrives. It must be a no-op.
	if m.Release("t", "R1") {
		t.Fatal("stale Release(t, R1) returned true, want false (wrong holder)")
	}
	if got := m.Status("t"); got != domain.Leased {
		t.Fatalf("Status after stale release = %v, want LEASED (R2's lease intact)", got)
	}
	// R2's heartbeat still works, proving R2 still genuinely holds the lease.
	if !m.Heartbeat("t", "R2") {
		t.Fatal("R2 lost its lease to the stale R1-lost event")
	}
	// And the legitimate holder R2 can still release its own lease.
	if !m.Release("t", "R2") {
		t.Fatal("holder R2 could not release its own lease")
	}
	if got := m.Status("t"); got != domain.Unclaimed {
		t.Fatalf("Status after R2 release = %v, want UNCLAIMED", got)
	}
}

// --- Complete is terminal -------------------------------------------------

func TestComplete(t *testing.T) {
	tests := []struct {
		name   string
		setup  func(m *Manager)
		rover  domain.RobotID
		wantOK bool
	}{
		{
			name:   "holder completes a live lease",
			setup:  func(m *Manager) { m.Grant(wall7, "R3") },
			rover:  "R3",
			wantOK: true,
		},
		{
			name:   "non-holder cannot complete",
			setup:  func(m *Manager) { m.Grant(wall7, "R3") },
			rover:  "R5",
			wantOK: false,
		},
		{
			name:   "cannot complete an unclaimed task",
			rover:  "R3",
			wantOK: false,
		},
		{
			name: "cannot complete an already-released task",
			setup: func(m *Manager) {
				m.Grant(wall7, "R3")
				m.Release(wall7, "R3")
			},
			rover:  "R3",
			wantOK: false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, m := newFixture(100)
			if tc.setup != nil {
				tc.setup(m)
			}
			if got := m.Complete(wall7, tc.rover); got != tc.wantOK {
				t.Fatalf("Complete ok = %v, want %v", got, tc.wantOK)
			}
		})
	}
}

// TestDoneIsTerminal_SweepNeverReReleasesDone proves a completed task is never
// re-released by a later Sweep, however far the clock advances.
func TestDoneIsTerminal_SweepNeverReReleasesDone(t *testing.T) {
	clk, m := newFixture(100)
	m.Grant(wall7, "R3")
	if !m.Complete(wall7, "R3") {
		t.Fatal("Complete failed")
	}
	if got := m.Status(wall7); got != domain.Done {
		t.Fatalf("Status = %v, want DONE", got)
	}

	// Push the clock far past any plausible expiry; DONE must stay DONE and
	// never appear in a sweep.
	clk.set(10_000)
	for i := range 3 {
		if released := m.Sweep(); released != nil {
			t.Fatalf("Sweep #%d re-released DONE task: %v", i+1, released)
		}
		clk.advance(1000)
	}
	if got := m.Status(wall7); got != domain.Done {
		t.Fatalf("Status after sweeps = %v, want DONE (terminal)", got)
	}
}

// --- Sweep over a mixed set of tasks --------------------------------------

func TestSweepReleasesOnlyExpiredLeasedTasks(t *testing.T) {
	clk, m := newFixture(100)
	m.Grant("expired-1", "R1") // expiry 130
	m.Grant("expired-2", "R2") // expiry 130
	m.Grant("renewed", "R3")   // will be heartbeat-renewed
	m.Grant("done", "R4")      // will be completed

	m.Complete("done", "R4")

	clk.set(125)
	m.Heartbeat("renewed", "R3") // expiry -> 155

	clk.set(140) // past 130, before 155
	released := m.Sweep()

	got := map[domain.TaskID]bool{}
	for _, id := range released {
		got[id] = true
	}
	if len(released) != 2 || !got["expired-1"] || !got["expired-2"] {
		t.Fatalf("Sweep released %v, want exactly {expired-1, expired-2}", released)
	}
	if m.Status("renewed") != domain.Leased {
		t.Fatalf("renewed = %v, want LEASED", m.Status("renewed"))
	}
	if m.Status("done") != domain.Done {
		t.Fatalf("done = %v, want DONE", m.Status("done"))
	}
	if m.Status("expired-1") != domain.Unclaimed {
		t.Fatalf("expired-1 = %v, want UNCLAIMED", m.Status("expired-1"))
	}
}
