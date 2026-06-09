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

func newRover(pos domain.Vec2) *rover {
	return &rover{pos: pos, battery: 1.0, alive: true, down: make(chan struct{})}
}

func isClosed(ch chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

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
		{"diagonal", domain.Vec2{X: 0, Y: 0}, domain.Vec2{X: 3, Y: 4}},
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
	st.drainOverTime(10.0)
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

	st.kill()
	if _, _, _, alive := st.snapshot(); alive {
		t.Fatalf("rover should remain down after a second kill")
	}
	st.stopTimers()

	st.settleAfter = time.Hour
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

	if !st.isRecovering() {
		t.Fatalf("a just-revived rover should be in its settle window (recovering)")
	}
	st.endSettle()
	if st.isRecovering() {
		t.Fatalf("endSettle should clear the settle window so the rover bids again")
	}

	st.recoverAfter = time.Hour
	fresh := st.down
	st.kill()
	if !isClosed(fresh) {
		t.Fatalf("a second outage should close the fresh down channel")
	}
	st.stopTimers()
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

const typeFoundation domain.TaskType = "foundation"

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

func TestRandomFaultAbandonsTaskButKeepsRoverAlive(t *testing.T) {
	h := newFaultHarness(t, "R-fault")

	h.setFailureProb(t, 1.0)
	time.Sleep(50 * time.Millisecond)

	h.award(t, "task-fault", domain.Vec2{X: 40, Y: 0})

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

	h.setFailureProb(t, 0)
	time.Sleep(50 * time.Millisecond)
	h.award(t, "task-heal", domain.Vec2{X: 1, Y: 0})

	completeDeadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(completeDeadline) {
		if h.completes() > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("rover did not complete task-heal after failProb dropped to 0")
}

func TestNoFaultCompletesNormally(t *testing.T) {
	h := newFaultHarness(t, "R-clean")

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

func waitFor(timeout time.Duration, cond func() bool) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}

type recoverHarness struct {
	conn    *bus.Conn
	roverID domain.RobotID

	mu               sync.Mutex
	deadPos          domain.Vec2
	sawDead          bool
	sawReviveInPlace bool
	completeCount    int
}

func newRecoverHarness(t *testing.T, id domain.RobotID) *recoverHarness {
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
		RecoverAfter:   500 * time.Millisecond,
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

	h := &recoverHarness{conn: obs, roverID: id}

	unsubTel, err := bus.SubscribeJSON(obs, wire.SubjTelemetry(id), h.onTelemetry)
	if err != nil {
		t.Fatalf("subscribe telemetry: %v", err)
	}
	t.Cleanup(unsubTel)

	unsubComplete, err := bus.SubscribeJSON(obs, wire.SubjTaskComplete, h.onComplete)
	if err != nil {
		t.Fatalf("subscribe complete: %v", err)
	}
	t.Cleanup(unsubComplete)

	return h
}

func (h *recoverHarness) onTelemetry(tm wire.Telemetry) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !tm.Alive && !h.sawDead {
		h.sawDead = true
		h.deadPos = tm.Pos
	}
	if h.sawDead && tm.Alive && tm.Pos == h.deadPos {
		h.sawReviveInPlace = true
	}
}

func (h *recoverHarness) onComplete(c wire.Complete) {
	if c.Robot != h.roverID {
		return
	}
	h.mu.Lock()
	h.completeCount++
	h.mu.Unlock()
}

func (h *recoverHarness) sawDown() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sawDead
}

func (h *recoverHarness) revivedInPlace() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sawReviveInPlace
}

func (h *recoverHarness) deadPosition() domain.Vec2 {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.deadPos
}

func (h *recoverHarness) completes() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.completeCount
}

func (h *recoverHarness) award(t *testing.T, task domain.TaskID, pos domain.Vec2) {
	t.Helper()
	if err := h.conn.PublishJSON(wire.SubjTaskAward, wire.Award{TaskID: task, Robot: h.roverID, Pos: pos}); err != nil {
		t.Fatalf("publish award: %v", err)
	}
	_ = h.conn.Flush()
}

func (h *recoverHarness) kill(t *testing.T) {
	t.Helper()
	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: "kill", Robot: h.roverID}); err != nil {
		t.Fatalf("publish kill: %v", err)
	}
	_ = h.conn.Flush()
}

func TestKillRecoversInPlaceOverBus(t *testing.T) {
	h := newRecoverHarness(t, "R-recover")

	h.award(t, "task-far", domain.Vec2{X: 60, Y: 0})
	time.Sleep(250 * time.Millisecond)
	h.kill(t)

	if !waitFor(2*time.Second, h.sawDown) {
		t.Fatalf("rover never reported alive=false after kill")
	}
	if dp := h.deadPosition(); dp.X == 0 && dp.Y == 0 {
		t.Fatalf("rover went down at the origin (%v) — it should have driven away before the kill", dp)
	}
	if h.completes() != 0 {
		t.Fatalf("killed rover completed its abandoned task (should self-heal via TTL, not complete)")
	}

	if !waitFor(2*time.Second, h.revivedInPlace) {
		t.Fatalf("rover did not revive at its failure position within the outage window")
	}

	h.award(t, "task-after", h.deadPosition())
	if !waitFor(3*time.Second, func() bool { return h.completes() > 0 }) {
		t.Fatalf("revived rover did not complete a fresh task")
	}
}
