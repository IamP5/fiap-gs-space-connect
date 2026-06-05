package agent

import (
	"context"
	"math"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/bus/bustest"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"sync"
	"testing"
	"time"
)

// newRover builds a rover at pos with a full charge for the pure state-method
// tests. These are white-box: they drive moveToward/drainOverTime directly with
// no NATS bus and no real sleeping (ADR-0001: movement is visual interpolation).
func newRover(pos domain.Vec2) *rover {
	return &rover{pos: pos, battery: 1.0, alive: true, down: make(chan struct{})}
}

// isClosed reports whether ch has been closed, without blocking. Used to assert
// that kill() closed the current outage channel.
func isClosed(ch chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

// moveAllTheWay drives the rover toward target one maxStep at a time until it
// reports arrival, returning the number of steps taken. It bounds the loop so a
// non-converging method fails the test instead of hanging.
func moveAllTheWay(t *testing.T, st *rover, target domain.Vec2, maxStep float64) int {
	t.Helper()
	const limit = 100000
	for n := 1; n <= limit; n++ {
		if st.moveToward(target, maxStep) {
			return n
		}
	}
	t.Fatalf("moveToward did not converge within %d steps", limit)
	return 0
}

func TestMoveTowardNeverOvershoots(t *testing.T) {
	target := domain.Vec2{X: 10, Y: 0}
	st := newRover(domain.Vec2{X: 0, Y: 0})
	maxStep := roverSpeed * moveStep.Seconds()

	prev := st.pos.Dist(target)
	for range 1000 {
		arrived := st.moveToward(target, maxStep)
		d := st.pos.Dist(target)
		// Distance to target must be monotonically non-increasing and never
		// negative (no overshoot past the target).
		if d > prev+1e-9 {
			t.Fatalf("overshoot: distance grew from %v to %v", prev, d)
		}
		prev = d
		if arrived {
			if d > 1e-9 {
				t.Fatalf("arrived but not on target: dist=%v", d)
			}
			return
		}
	}
	t.Fatalf("did not arrive within 1000 steps")
}

func TestMoveTowardConvergesAndArrives(t *testing.T) {
	target := domain.Vec2{X: 7, Y: 4}
	st := newRover(domain.Vec2{X: -3, Y: 1})
	maxStep := roverSpeed * moveStep.Seconds()

	steps := moveAllTheWay(t, st, target, maxStep)
	if steps < 1 {
		t.Fatalf("expected at least one step, got %d", steps)
	}
	if st.pos != target {
		t.Fatalf("did not land exactly on target: pos=%v target=%v", st.pos, target)
	}
}

func TestMoveTowardBatteryStrictlyDecreasesWhileMoving(t *testing.T) {
	target := domain.Vec2{X: 20, Y: 0}
	st := newRover(domain.Vec2{X: 0, Y: 0})
	maxStep := roverSpeed * moveStep.Seconds()

	prev := st.battery
	for {
		arrived := st.moveToward(target, maxStep)
		if st.battery >= prev {
			t.Fatalf("battery did not decrease while moving: prev=%v now=%v", prev, st.battery)
		}
		prev = st.battery
		if arrived {
			break
		}
	}
}

func TestMoveTowardAlreadyAtTargetArrivesWithoutDraining(t *testing.T) {
	target := domain.Vec2{X: 5, Y: 5}
	st := newRover(target)
	maxStep := roverSpeed * moveStep.Seconds()

	before := st.battery
	if !st.moveToward(target, maxStep) {
		t.Fatalf("expected immediate arrival when already at target")
	}
	if st.battery != before {
		t.Fatalf("drained while already at target: before=%v after=%v", before, st.battery)
	}
}

func TestMoveTowardWithinEpsilonArrivesWithoutDraining(t *testing.T) {
	target := domain.Vec2{X: 0, Y: 0}
	// Sit just inside the arrival epsilon.
	st := newRover(domain.Vec2{X: arriveEps / 2, Y: 0})
	maxStep := roverSpeed * moveStep.Seconds()

	before := st.battery
	if !st.moveToward(target, maxStep) {
		t.Fatalf("expected arrival within epsilon")
	}
	if st.battery != before {
		t.Fatalf("drained within epsilon: before=%v after=%v", before, st.battery)
	}
	if st.pos != target {
		t.Fatalf("did not snap onto target: pos=%v", st.pos)
	}
}

func TestFullDriveDrainsByDistanceTimesRate(t *testing.T) {
	cases := []struct {
		name   string
		start  domain.Vec2
		target domain.Vec2
	}{
		{"axis", domain.Vec2{X: 0, Y: 0}, domain.Vec2{X: 10, Y: 0}},
		{"diagonal", domain.Vec2{X: 0, Y: 0}, domain.Vec2{X: 3, Y: 4}}, // dist 5
		{"negative", domain.Vec2{X: 5, Y: 5}, domain.Vec2{X: -5, Y: -5}},
	}
	maxStep := roverSpeed * moveStep.Seconds()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st := newRover(c.start)
			d := c.start.Dist(c.target)
			before := st.battery
			moveAllTheWay(t, st, c.target, maxStep)
			drained := before - st.battery
			want := d * drainPerUnit
			if math.Abs(drained-want) > 1e-9 {
				t.Fatalf("drive of dist %v drained %v, want ~%v", d, drained, want)
			}
		})
	}
}

func TestWorkPhaseDrainsByTime(t *testing.T) {
	st := newRover(domain.Vec2{X: 0, Y: 0})
	before := st.battery

	// Simulate the work loop's per-tick drain over the whole work duration.
	ticks := int(workDuration / moveStep)
	perTick := drainPerWorkSec * moveStep.Seconds()
	for range ticks {
		st.drainOverTime(perTick)
	}
	drained := before - st.battery
	want := workDuration.Seconds() * drainPerWorkSec
	if math.Abs(drained-want) > 1e-9 {
		t.Fatalf("work phase drained %v, want ~%v", drained, want)
	}
}

func TestBatteryFlooredAtMinOverLongDrive(t *testing.T) {
	// A drive so long the un-floored drain would push battery far below zero.
	target := domain.Vec2{X: 100000, Y: 0}
	st := newRover(domain.Vec2{X: 0, Y: 0})
	maxStep := roverSpeed * moveStep.Seconds()

	for range 1000000 {
		if st.moveToward(target, maxStep) {
			break
		}
		if st.battery < minBattery {
			t.Fatalf("battery fell below minBattery: %v", st.battery)
		}
	}
	if st.battery != minBattery {
		t.Fatalf("expected battery floored at minBattery=%v, got %v", minBattery, st.battery)
	}
}

func TestDrainOverTimeFloorsAtMin(t *testing.T) {
	st := newRover(domain.Vec2{X: 0, Y: 0})
	st.drainOverTime(10.0) // way more than a full charge
	if st.battery != minBattery {
		t.Fatalf("drainOverTime did not floor at minBattery: got %v", st.battery)
	}
}

func TestClaimDeduplicatesInFlightTasks(t *testing.T) {
	st := newRover(domain.Vec2{X: 0, Y: 0})
	const task domain.TaskID = "t-1"

	if !st.claim(task) {
		t.Fatalf("first claim should succeed")
	}
	if st.claim(task) {
		t.Fatalf("duplicate claim of in-flight task should fail")
	}
	st.release(task)
	if !st.claim(task) {
		t.Fatalf("claim after release should succeed")
	}
}

func TestKillIsRecoverableOutageInPlace(t *testing.T) {
	const pos = 42.0
	st := newRover(domain.Vec2{X: pos, Y: pos})
	// A long window so the auto-revive timer never fires during the assertions;
	// we drive revive() directly below.
	st.recoverAfter = time.Hour
	down := st.down

	if isClosed(down) {
		t.Fatalf("down should be open before kill")
	}
	st.kill()
	if !isClosed(down) {
		t.Fatalf("kill should close the current down channel")
	}
	if _, _, _, alive := st.snapshot(); alive {
		t.Fatalf("kill should clear alive (rover out of service)")
	}

	// A second kill while already down is a harmless no-op: it must not panic by
	// double-closing down and must not reschedule the revive timer.
	st.kill()
	if _, _, _, alive := st.snapshot(); alive {
		t.Fatalf("rover should remain down after a second kill")
	}
	st.stopReviveTimer()

	// Revive brings the rover back IN PLACE: alive again, at the SAME position,
	// with a FRESH (open) down channel so a future kill has its own signal.
	st.revive()
	gotPos, _, _, alive := st.snapshot()
	if !alive {
		t.Fatalf("revive should bring the rover back alive")
	}
	if gotPos.X != pos || gotPos.Y != pos {
		t.Fatalf("revive moved the rover to %+v, want it to stay at its failure spot {%v,%v}", gotPos, pos, pos)
	}
	if st.down == down {
		t.Fatalf("revive should install a fresh down channel, not reuse the closed one")
	}
	if isClosed(st.down) {
		t.Fatalf("the revived rover's down channel should be open (killable again)")
	}

	// And it can be killed again on the fresh channel — the outage is repeatable.
	st.recoverAfter = time.Hour
	fresh := st.down
	st.kill()
	if !isClosed(fresh) {
		t.Fatalf("a second outage should close the fresh down channel")
	}
	st.stopReviveTimer()
}

func TestRefuseRecordsTaskAndPredicate(t *testing.T) {
	st := newRover(domain.Vec2{X: 0, Y: 0})
	const failed domain.TaskID = "t-fail"
	const other domain.TaskID = "t-ok"

	if st.refuses(failed) {
		t.Fatalf("rover should not refuse a task it has not failed")
	}
	st.refuse(failed)
	if !st.refuses(failed) {
		t.Fatalf("rover should refuse a task it has failed")
	}
	if st.refuses(other) {
		t.Fatalf("rover should not refuse an unrelated task")
	}
}

func TestSetFailureProbDefaultsToZeroAndClamps(t *testing.T) {
	st := newRover(domain.Vec2{X: 0, Y: 0})

	// Default (issue 08): injection off, so the roll can never fire.
	if got := st.failureProb(); got != 0 {
		t.Fatalf("default failureProb = %v, want 0", got)
	}

	cases := []struct {
		name string
		set  float64
		want float64
	}{
		{"in range", 0.5, 0.5},
		{"zero", 0, 0},
		{"one", 1, 1},
		{"clamp below zero", -0.3, 0},
		{"clamp above one", 1.7, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st.setFailureProb(c.set)
			if got := st.failureProb(); got != c.want {
				t.Fatalf("setFailureProb(%v) -> failureProb = %v, want %v", c.set, got, c.want)
			}
		})
	}
}

// --- Integration tests (issue 08): the random-failure injector on the bus. ---

const typeFoundation domain.TaskType = "foundation"

// faultHarness boots an embedded NATS server, runs ONE rover via agent.Run, and
// gives the test an observer connection plus collectors for the rover's Complete
// and Telemetry streams. The test drives the rover by publishing Award directly
// (the auction itself is the coordinator's job and is covered elsewhere).
type faultHarness struct {
	conn      *bus.Conn
	roverID   domain.RobotID
	completes func() int
	aliveSeen func() bool
}

func newFaultHarness(t *testing.T, id domain.RobotID) *faultHarness {
	t.Helper()

	url, shutdown := bustest.RunServer(t)
	t.Cleanup(shutdown)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	cfg := Config{
		ID:             id,
		Pos:            domain.Vec2{X: 0, Y: 0},
		Battery:        1.0,
		Capabilities:   []domain.Capability{domain.Capability(typeFoundation)},
		HeartbeatEvery: 100 * time.Millisecond,
	}

	roverConn, err := bus.Connect(ctx, url, bus.ConnectOptions{Name: "rover", MaxWait: 5 * time.Second})
	if err != nil {
		t.Fatalf("rover connect: %v", err)
	}
	t.Cleanup(roverConn.Close)
	go func() { _ = Run(ctx, cfg, roverConn) }()

	obs, err := bus.Connect(ctx, url, bus.ConnectOptions{Name: "observer", MaxWait: 5 * time.Second})
	if err != nil {
		t.Fatalf("observer connect: %v", err)
	}
	t.Cleanup(obs.Close)

	var mu sync.Mutex
	completeCount := 0
	aliveTelemetry := false

	unsubComplete, err := bus.SubscribeJSON(obs, wire.SubjTaskComplete, func(c wire.Complete) {
		if c.Robot != id {
			return
		}
		mu.Lock()
		completeCount++
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("subscribe complete: %v", err)
	}
	t.Cleanup(unsubComplete)

	// Watch this rover's telemetry: note whether we ever see it alive AFTER the
	// fault would have struck (so we can assert it survived the abandonment).
	unsubTelemetry, err := bus.SubscribeJSON(obs, wire.SubjTelemetry(id), func(tm wire.Telemetry) {
		mu.Lock()
		if tm.Alive {
			aliveTelemetry = true
		}
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("subscribe telemetry: %v", err)
	}
	t.Cleanup(unsubTelemetry)

	return &faultHarness{
		conn:    obs,
		roverID: id,
		completes: func() int {
			mu.Lock()
			defer mu.Unlock()
			return completeCount
		},
		aliveSeen: func() bool {
			mu.Lock()
			defer mu.Unlock()
			return aliveTelemetry
		},
	}
}

func (h *faultHarness) setFailureProb(t *testing.T, p float64) {
	t.Helper()
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: "setFailureProb", Value: p}); err != nil {
		t.Fatalf("publish setFailureProb: %v", err)
	}
	_ = h.conn.Flush()
}

func (h *faultHarness) award(t *testing.T, task domain.TaskID, pos domain.Vec2) {
	t.Helper()
	if err := h.conn.PublishJSON(wire.SubjTaskAward, wire.Award{
		TaskID: task,
		Robot:  h.roverID,
		Pos:    pos,
	}); err != nil {
		t.Fatalf("publish award: %v", err)
	}
	_ = h.conn.Flush()
}

// TestRandomFaultAbandonsTaskButKeepsRoverAlive: with failProb=1.0 an awarded
// rover ABANDONS its task — it never publishes Complete — yet stays alive (keeps
// emitting alive=true telemetry) and frees its load so it can bid again. This is
// the silent-fault heal path of issue 08.
func TestRandomFaultAbandonsTaskButKeepsRoverAlive(t *testing.T) {
	h := newFaultHarness(t, "R-fault")

	h.setFailureProb(t, 1.0)
	// Give the broadcast control a beat to land before the award.
	time.Sleep(50 * time.Millisecond)

	// Award a task far enough that the fault ticker (250ms) fires during the
	// drive, well before the rover could ever complete.
	h.award(t, "task-fault", domain.Vec2{X: 40, Y: 0})

	// Within a bounded window the rover must NOT complete the task (it abandons),
	// and it must still report itself alive.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if h.completes() > 0 {
			t.Fatalf("rover completed task-fault despite failProb=1.0 (should abandon)")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !h.aliveSeen() {
		t.Fatalf("rover never reported alive telemetry: a fault must NOT kill the rover")
	}

	// It can bid again: drop the probability and re-award; it now completes.
	h.setFailureProb(t, 0)
	time.Sleep(50 * time.Millisecond)
	h.award(t, "task-heal", domain.Vec2{X: 1, Y: 0})

	completeDeadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(completeDeadline) {
		if h.completes() > 0 {
			return // healed: the same rover completed a task once injection was off
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("rover did not complete task-heal after failProb dropped to 0")
}

// TestNoFaultCompletesNormally: with failProb=0 (the default / slider at zero)
// injection is off, so an awarded rover completes its task normally.
func TestNoFaultCompletesNormally(t *testing.T) {
	h := newFaultHarness(t, "R-clean")

	// Explicitly set 0 to prove the slider-at-zero path; default is already 0.
	h.setFailureProb(t, 0)
	time.Sleep(50 * time.Millisecond)

	h.award(t, "task-clean", domain.Vec2{X: 2, Y: 0})

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if h.completes() > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("rover did not complete task-clean with failProb=0")
}

// TestKillRecoversInPlaceOverBus is the end-to-end proof of the recoverable
// outage: a rover awarded a FAR task is killed mid-drive. It must (1) go
// alive=false, (2) stay STOPPED where it failed — not snap back to its start
// position — and (3) revive at that SAME failure position after the outage
// window, then complete a fresh task. This is the realistic-failure behaviour:
// the rover does not vanish and does not teleport home.
func TestKillRecoversInPlaceOverBus(t *testing.T) {
	url, shutdown := bustest.RunServer(t)
	t.Cleanup(shutdown)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	const id domain.RobotID = "R-recover"
	cfg := Config{
		ID:             id,
		Pos:            domain.Vec2{X: 0, Y: 0},
		Battery:        1.0,
		Capabilities:   []domain.Capability{domain.Capability(typeFoundation)},
		HeartbeatEvery: 100 * time.Millisecond,
		RecoverAfter:   500 * time.Millisecond, // short outage so the test stays fast
	}

	roverConn, err := bus.Connect(ctx, url, bus.ConnectOptions{Name: "rover", MaxWait: 5 * time.Second})
	if err != nil {
		t.Fatalf("rover connect: %v", err)
	}
	t.Cleanup(roverConn.Close)
	go func() { _ = Run(ctx, cfg, roverConn) }()

	obs, err := bus.Connect(ctx, url, bus.ConnectOptions{Name: "observer", MaxWait: 5 * time.Second})
	if err != nil {
		t.Fatalf("observer connect: %v", err)
	}
	t.Cleanup(obs.Close)

	var mu sync.Mutex
	var deadPos domain.Vec2
	sawDead, sawReviveInPlace := false, false
	completes := 0

	unsubTel, err := bus.SubscribeJSON(obs, wire.SubjTelemetry(id), func(tm wire.Telemetry) {
		mu.Lock()
		defer mu.Unlock()
		if !tm.Alive && !sawDead {
			sawDead = true
			deadPos = tm.Pos // the position it went down at
		}
		// A revival counts only if it comes back at the spot it died (not at start).
		if sawDead && tm.Alive && tm.Pos == deadPos {
			sawReviveInPlace = true
		}
	})
	if err != nil {
		t.Fatalf("subscribe telemetry: %v", err)
	}
	t.Cleanup(unsubTel)

	unsubComplete, err := bus.SubscribeJSON(obs, wire.SubjTaskComplete, func(c wire.Complete) {
		if c.Robot != id {
			return
		}
		mu.Lock()
		completes++
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("subscribe complete: %v", err)
	}
	t.Cleanup(unsubComplete)

	// Award a FAR task so the rover is mid-drive (not at origin) when we kill it.
	if err := obs.PublishJSON(wire.SubjTaskAward, wire.Award{TaskID: "task-far", Robot: id, Pos: domain.Vec2{X: 60, Y: 0}}); err != nil {
		t.Fatalf("publish award: %v", err)
	}
	_ = obs.Flush()

	// Let it drive away from the origin, then kill it mid-flight.
	time.Sleep(250 * time.Millisecond)
	if err := obs.PublishJSON(wire.SubjControl, wire.Control{Cmd: "kill", Robot: id}); err != nil {
		t.Fatalf("publish kill: %v", err)
	}
	_ = obs.Flush()

	// It must report down, away from the origin, and never complete the abandoned task.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		ok := sawDead
		mu.Unlock()
		if ok {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	mu.Lock()
	if !sawDead {
		mu.Unlock()
		t.Fatalf("rover never reported alive=false after kill")
	}
	if deadPos.X == 0 && deadPos.Y == 0 {
		mu.Unlock()
		t.Fatalf("rover went down at the origin (%v) — it should have driven away before the kill", deadPos)
	}
	if completes != 0 {
		mu.Unlock()
		t.Fatalf("killed rover completed its abandoned task (should self-heal via TTL, not complete)")
	}
	mu.Unlock()

	// After the outage window it must revive AT THE SAME failure position.
	reviveDeadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(reviveDeadline) {
		mu.Lock()
		ok := sawReviveInPlace
		mu.Unlock()
		if ok {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	mu.Lock()
	revived := sawReviveInPlace
	mu.Unlock()
	if !revived {
		t.Fatalf("rover did not revive at its failure position within the outage window")
	}

	// The revived rover is fully back in service: award a nearby task; it completes.
	if err := obs.PublishJSON(wire.SubjTaskAward, wire.Award{TaskID: "task-after", Robot: id, Pos: deadPos}); err != nil {
		t.Fatalf("publish award after revive: %v", err)
	}
	_ = obs.Flush()
	completeDeadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(completeDeadline) {
		mu.Lock()
		done := completes
		mu.Unlock()
		if done > 0 {
			return // revived rover took and completed a fresh task
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("revived rover did not complete a fresh task")
}
