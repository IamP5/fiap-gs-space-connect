package gateway_test

import (
	"context"
	"encoding/json"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func sampleEarthUplink() wire.EarthUplink {
	return wire.EarthUplink{
		Type: "earth",
		Rovers: []wire.RoverView{
			{ID: "R1", Pos: domain.Vec2{X: 1, Y: 2}, Battery: 0.9, Alive: true, Load: 1, Task: "T1"},
		},
		Tasks: []wire.TaskView{
			{ID: "T1", Type: "foundation", Pos: domain.Vec2{X: 3, Y: 4}, Status: statusLeased, Assignee: "R1", Version: 7},
		},
		At: 99,
	}
}

func TestEarthUplinkRoundTrip(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ws := dialWS(ctx, t, addr)
	defer closeWS(ws)

	want := sampleEarthUplink()
	got := readEarthUntilReceived(ctx, t, conn, ws, want)

	if got.Type != "earth" {
		t.Fatalf("type = %q, want \"earth\"", got.Type)
	}
	if got.At != want.At {
		t.Fatalf("At = %d, want %d", got.At, want.At)
	}
	if len(got.Rovers) != 1 || got.Rovers[0].ID != "R1" {
		t.Fatalf("rovers mismatch: %+v", got.Rovers)
	}
	if len(got.Tasks) != 1 || got.Tasks[0].Status != statusLeased {
		t.Fatalf("tasks mismatch: %+v", got.Tasks)
	}
}

func readEarthUntilReceived(ctx context.Context, t *testing.T, conn *bus.Conn, ws *websocket.Conn, want wire.EarthUplink) wire.EarthUplink {
	t.Helper()

	type result struct {
		earth wire.EarthUplink
		err   error
	}
	ch := make(chan result, 1)
	go func() {
		for {
			_, data, err := ws.Read(ctx)
			if err != nil {
				ch <- result{err: err}
				return
			}
			var probe struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(data, &probe) != nil || probe.Type != "earth" {
				continue
			}
			var e wire.EarthUplink
			if err := json.Unmarshal(data, &e); err != nil {
				ch <- result{err: err}
				return
			}
			ch <- result{earth: e}
			return
		}
	}()

	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	if err := conn.PublishJSON(wire.SubjEarthUplink, want); err != nil {
		t.Fatalf("publish earth: %v", err)
	}
	for {
		select {
		case r := <-ch:
			if r.err != nil {
				t.Fatalf("ws read: %v", r.err)
			}
			return r.earth
		case <-ticker.C:
			if err := conn.PublishJSON(wire.SubjEarthUplink, want); err != nil {
				t.Fatalf("publish earth: %v", err)
			}
		case <-ctx.Done():
			t.Fatalf("timed out waiting for earth uplink: %v", ctx.Err())
		}
	}
}
