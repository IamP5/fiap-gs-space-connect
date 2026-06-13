package bus_test

import (
	"context"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/bus/bustest"
	"swarmbuild/internal/wire"
	"testing"
	"time"
)

func dial(t *testing.T) *bus.Conn {
	t.Helper()
	url, shutdown := bustest.RunServer(t)
	t.Cleanup(shutdown)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, err := bus.Connect(ctx, url, bus.ConnectOptions{Name: "test", MaxWait: 5 * time.Second})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(c.Close)
	return c
}

func TestPublishSubscribeJSON_RoundTrip(t *testing.T) {
	c := dial(t)
	got := make(chan wire.Bid, 1)
	unsub, err := bus.SubscribeJSON(c, wire.SubjBidWildcard, func(b wire.Bid) { got <- b })
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer unsub()

	want := wire.Bid{TaskID: "wall-7", Robot: "R5", Cost: 12.5}
	if err := c.PublishJSON(wire.SubjBid(want.TaskID), want); err != nil {
		t.Fatalf("publish: %v", err)
	}
	_ = c.Flush()

	select {
	case b := <-got:
		if b != want {
			t.Fatalf("round-trip mismatch: got %+v want %+v", b, want)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no message received within 2s")
	}
}

func TestConnect_RetriesUntilDeadline(t *testing.T) {
	ctx := context.Background()
	start := time.Now()
	_, err := bus.Connect(ctx, "nats://127.0.0.1:5", bus.ConnectOptions{
		MaxWait: 600 * time.Millisecond,
		Backoff: 100 * time.Millisecond,
	})
	if err == nil {
		t.Fatal("expected connect to fail against a dead address")
	}
	if time.Since(start) < 100*time.Millisecond {
		t.Fatalf("returned too fast (%s) — did it actually retry?", time.Since(start))
	}
}

func sameTaskView(a, b wire.TaskView) bool {
	return a.ID == b.ID && a.Status == b.Status && a.Assignee == b.Assignee && a.Version == b.Version
}

func TestKV_MirrorRoundTrip(t *testing.T) {
	c := dial(t)
	ctx := context.Background()
	kv, err := c.KV(ctx, wire.KVBucketWorld)
	if err != nil {
		t.Fatalf("kv: %v", err)
	}
	rec := wire.TaskView{ID: "wall-7", Type: "wall", Status: "LEASED", Assignee: "R5", Version: 3}
	if err := kv.PutJSON(ctx, string(rec.ID), rec); err != nil {
		t.Fatalf("put: %v", err)
	}

	got, ok, err := bus.GetJSON[wire.TaskView](ctx, kv, string(rec.ID))
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !ok {
		t.Fatal("get: key not found")
	}
	if !sameTaskView(got, rec) {
		t.Fatalf("kv mismatch: got %+v want %+v", got, rec)
	}

	keys, err := kv.Keys(ctx)
	if err != nil {
		t.Fatalf("keys: %v", err)
	}
	if len(keys) != 1 || keys[0] != string(rec.ID) {
		t.Fatalf("keys: got %v want [%s]", keys, rec.ID)
	}

	_, ok, err = bus.GetJSON[wire.TaskView](ctx, kv, "nope")
	if err != nil {
		t.Fatalf("absent key: %v", err)
	}
	if ok {
		t.Fatal("absent key: expected ok=false")
	}
}
