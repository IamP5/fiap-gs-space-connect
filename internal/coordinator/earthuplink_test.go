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
		SnapshotHz:     20,
	}
}

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

func TestEarthUplink_ZeroLatencyPublishesLive(t *testing.T) {
	h := newEarthHarness(t, earthTestConfig())

	e := waitFor(t, h.earthMsg, 3*time.Second, "earth uplink at latency 0")
	if e.Type != "earth" {
		t.Fatalf("earth.Type = %q, want \"earth\"", e.Type)
	}

	_ = waitFor(t, h.snapAt, 2*time.Second, "world.snapshot at latency 0")
	_ = waitFor(t, h.earthAt, 2*time.Second, "earth.uplink at latency 0")
}

func TestEarthUplink_LatencyDelaysOnlyEarth(t *testing.T) {
	h := newEarthHarness(t, earthTestConfig())

	_ = waitFor(t, h.earthAt, 3*time.Second, "initial earth uplink")

	const latencyMs = 300
	const latency = latencyMs * time.Millisecond

	drain(h.snapAt)
	drain(h.earthAt)

	if err := h.conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: "setLatency", Value: latencyMs}); err != nil {
		t.Fatalf("publish setLatency: %v", err)
	}
	_ = h.conn.Flush()
	sentAt := time.Now()

	snapAt := waitFor(t, h.snapAt, latency-50*time.Millisecond, "world.snapshot stays immediate under latency")
	if d := snapAt.Sub(sentAt); d >= latency {
		t.Fatalf("world.snapshot was delayed %v (≥ %v) — latency leaked onto the tactical loop", d, latency)
	}

	deadline := time.Now().Add(5 * time.Second)
	for {
		earthAt := waitFor(t, h.earthAt, time.Until(deadline), "delayed earth.uplink")
		if earthAt.Sub(sentAt) >= latency-50*time.Millisecond {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("no earth.uplink frame delayed by ≥ %v after setLatency", latency)
		}
	}
}

func drain[T any](ch <-chan T) {
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}
