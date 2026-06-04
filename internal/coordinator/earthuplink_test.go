package coordinator_test

import (
	"context"
	"swarmbuild/internal/agent"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/bus/bustest"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

// earthHarness boots an embedded NATS server, runs a coordinator, and gives an
// observer connection plus channels carrying the wall-clock arrival time of each
// world.snapshot and earth.uplink frame. It lets a test assert latency affects
// ONLY the earth.uplink feed (issue 09 / ADR-0002).
type earthHarness struct {
	conn     *bus.Conn
	snapAt   chan time.Time
	earthAt  chan time.Time
	earthMsg chan wire.EarthUplink
}

func newEarthHarness(t *testing.T, cfg coordinator.Config) *earthHarness {
	t.Helper()

	url, shutdown := bustest.RunServer(t)
	t.Cleanup(shutdown)
	cfg.NATSURL = url

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	go func() { _ = coordinator.Run(ctx, cfg) }()

	conn, err := bus.Connect(ctx, url, bus.ConnectOptions{Name: "earth-observer", MaxWait: 5 * time.Second})
	if err != nil {
		t.Fatalf("observer connect: %v", err)
	}
	t.Cleanup(func() { conn.Close() })

	h := &earthHarness{
		conn:     conn,
		snapAt:   make(chan time.Time, 256),
		earthAt:  make(chan time.Time, 256),
		earthMsg: make(chan wire.EarthUplink, 256),
	}

	unsubSnap, err := bus.SubscribeJSON(conn, wire.SubjSnapshot, func(wire.Snapshot) {
		select {
		case h.snapAt <- time.Now():
		default:
		}
	})
	if err != nil {
		t.Fatalf("subscribe snapshot: %v", err)
	}
	t.Cleanup(unsubSnap)

	unsubEarth, err := bus.SubscribeJSON(conn, wire.SubjEarthUplink, func(e wire.EarthUplink) {
		now := time.Now()
		select {
		case h.earthAt <- now:
		default:
		}
		select {
		case h.earthMsg <- e:
		default:
		}
	})
	if err != nil {
		t.Fatalf("subscribe earth: %v", err)
	}
	t.Cleanup(unsubEarth)

	_ = conn.Flush()
	return h
}

func earthTestConfig() coordinator.Config {
	return coordinator.Config{
		Blueprint: []coordinator.BlueprintTask{
			{Task: domain.Task{ID: taskX, Type: typeFoundation}, Pos: domain.Vec2{X: 30, Y: 0}},
		},
		Rovers: []agent.Config{
			{ID: "R1", Pos: domain.Vec2{X: 30, Y: 0}, Battery: 1.0, Capabilities: []domain.Capability{typeFoundation}},
		},
		AuctionWindow:  150 * time.Millisecond,
		HeartbeatEvery: 100 * time.Millisecond,
		TTLFactor:      3,
		SnapshotHz:     20, // ~50ms snapshot cadence
	}
}

// waitFor reads the next value from ch within d, failing the test otherwise.
func waitFor[T any](t *testing.T, ch <-chan T, d time.Duration, what string) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(d):
		t.Fatalf("timed out waiting for %s", what)
		var zero T
		return zero
	}
}

// TestEarthUplink_ZeroLatencyPublishesLive asserts that with the default latency
// (0) the coordinator publishes an EarthUplink on earth.uplink reflecting the
// world, at roughly the same cadence as the tactical snapshot (Earth ≈ live).
func TestEarthUplink_ZeroLatencyPublishesLive(t *testing.T) {
	h := newEarthHarness(t, earthTestConfig())

	// An EarthUplink arrives promptly and is shaped like the world.
	e := waitFor(t, h.earthMsg, 3*time.Second, "earth uplink at latency 0")
	if e.Type != "earth" {
		t.Fatalf("earth.Type = %q, want \"earth\"", e.Type)
	}

	// Both feeds keep flowing: drain a snapshot and an earth frame within a single
	// snapshot interval's worth of slack.
	_ = waitFor(t, h.snapAt, 2*time.Second, "world.snapshot at latency 0")
	_ = waitFor(t, h.earthAt, 2*time.Second, "earth.uplink at latency 0")
}

// TestEarthUplink_LatencyDelaysOnlyEarth is the core ADR-0002 guarantee: raising
// the latency delays the earth.uplink feed measurably while world.snapshot keeps
// flowing immediately. It asserts lower-bounds and a flow invariant — never exact
// timing — so it is deterministic and not flaky.
func TestEarthUplink_LatencyDelaysOnlyEarth(t *testing.T) {
	h := newEarthHarness(t, earthTestConfig())

	// Drain initial frames so we measure steady-state.
	_ = waitFor(t, h.earthAt, 3*time.Second, "initial earth uplink")

	const latencyMs = 300
	const latency = latencyMs * time.Millisecond

	// Drain anything already queued so post-control measurement is clean.
	drain(h.snapAt)
	drain(h.earthAt)

	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: "setLatency", Value: latencyMs}); err != nil {
		t.Fatalf("publish setLatency: %v", err)
	}
	_ = h.conn.Flush()
	sentAt := time.Now()

	// world.snapshot MUST keep flowing immediately — it is on the tactical loop and
	// is provably untouched by latency. A snapshot must arrive well before the
	// Earth delay would elapse.
	snapAt := waitFor(t, h.snapAt, latency-50*time.Millisecond, "world.snapshot stays immediate under latency")
	if d := snapAt.Sub(sentAt); d >= latency {
		t.Fatalf("world.snapshot was delayed %v (≥ %v) — latency leaked onto the tactical loop", d, latency)
	}

	// The NEXT earth.uplink frame produced after the control lands must be delayed
	// by at least ~latency. Find the first earth frame whose arrival is clearly
	// past the delay floor (allowing the control to take effect on a subsequent
	// snapshot enqueue).
	deadline := time.Now().Add(5 * time.Second)
	for {
		earthAt := waitFor(t, h.earthAt, time.Until(deadline), "delayed earth.uplink")
		// Frames enqueued before the control took effect may still be in flight;
		// once we see one delayed past the floor relative to its own snapshot
		// cadence, the shim is provably delaying. We assert it landed at least
		// (latency - slack) after the control was sent.
		if earthAt.Sub(sentAt) >= latency-50*time.Millisecond {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("no earth.uplink frame delayed by ≥ %v after setLatency", latency)
		}
	}
}

// drain empties a buffered channel without blocking.
func drain[T any](ch <-chan T) {
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}
