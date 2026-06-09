package gateway_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/bus/bustest"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/gateway"
	"swarmbuild/internal/wire"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func startGateway(t *testing.T) (*bus.Conn, string) {
	t.Helper()

	url, shutdown := bustest.RunServer(t)
	t.Cleanup(shutdown)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	conn, err := bus.Connect(ctx, url, bus.ConnectOptions{
		Name:    "gateway-test",
		MaxWait: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect bus: %v", err)
	}
	t.Cleanup(conn.Close)

	g, stopFanout, err := gateway.Run(ctx, conn)
	if err != nil {
		t.Fatalf("gateway run: %v", err)
	}
	t.Cleanup(func() { _ = stopFanout() })

	addr, shutdownHTTP, err := g.ListenAndServe(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() {
		sctx, c := context.WithTimeout(context.Background(), 2*time.Second)
		defer c()
		_ = shutdownHTTP(sctx)
	})

	return conn, addr
}

const statusLeased = "LEASED"

func sampleSnapshot() wire.Snapshot {
	return wire.Snapshot{
		Type:      "snapshot",
		Connected: true,
		Rovers: []wire.RoverView{
			{ID: "R1", Pos: domain.Vec2{X: 1, Y: 2}, Battery: 0.9, Alive: true, Load: 1, Task: "T1"},
		},
		Tasks: []wire.TaskView{
			{ID: "T1", Type: "foundation", Pos: domain.Vec2{X: 3, Y: 4}, Status: statusLeased, Assignee: "R1", Version: 7},
		},
		At: 42,
	}
}

func closeWS(ws *websocket.Conn) {
	_ = ws.Close(websocket.StatusNormalClosure, "")
}

func dialWS(ctx context.Context, t *testing.T, addr string) *websocket.Conn {
	t.Helper()
	ws, resp, err := websocket.Dial(ctx, fmt.Sprintf("ws://%s/ws", addr), nil)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	return ws
}

func readSnapshot(ctx context.Context, t *testing.T, ws *websocket.Conn) wire.Snapshot {
	t.Helper()
	typ, data, err := ws.Read(ctx)
	if err != nil {
		t.Fatalf("ws read: %v", err)
	}
	if typ != websocket.MessageText {
		t.Fatalf("ws read: got message type %v, want text", typ)
	}
	var snap wire.Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		t.Fatalf("unmarshal snapshot: %v (raw: %s)", err, data)
	}
	return snap
}

func TestSnapshotRoundTrip(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ws := dialWS(ctx, t, addr)
	defer closeWS(ws)

	want := sampleSnapshot()
	got := publishUntilReceived(ctx, t, conn, ws, want)

	if got.Type != want.Type || got.At != want.At || got.Connected != want.Connected {
		t.Fatalf("snapshot mismatch: got %+v want %+v", got, want)
	}
	if len(got.Rovers) != 1 || got.Rovers[0].ID != "R1" {
		t.Fatalf("rovers mismatch: %+v", got.Rovers)
	}
	if len(got.Tasks) != 1 || got.Tasks[0].Status != "LEASED" {
		t.Fatalf("tasks mismatch: %+v", got.Tasks)
	}
}

func publishUntilReceived(ctx context.Context, t *testing.T, conn *bus.Conn, ws *websocket.Conn, want wire.Snapshot) wire.Snapshot {
	t.Helper()

	type result struct {
		snap wire.Snapshot
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			ch <- result{err: err}
			return
		}
		var snap wire.Snapshot
		if err := json.Unmarshal(data, &snap); err != nil {
			ch <- result{err: err}
			return
		}
		_ = typ
		ch <- result{snap: snap}
	}()

	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	if err := conn.PublishJSON(wire.SubjSnapshot, want); err != nil {
		t.Fatalf("publish: %v", err)
	}
	for {
		select {
		case r := <-ch:
			if r.err != nil {
				t.Fatalf("ws read: %v", r.err)
			}
			return r.snap
		case <-ticker.C:
			if err := conn.PublishJSON(wire.SubjSnapshot, want); err != nil {
				t.Fatalf("publish: %v", err)
			}
		case <-ctx.Done():
			t.Fatalf("timed out waiting for snapshot: %v", ctx.Err())
		}
	}
}

func TestControlRelay(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	received := make(chan wire.Control, 4)
	unsub, err := bus.SubscribeJSON(conn, wire.SubjControl, func(c wire.Control) {
		received <- c
	})
	if err != nil {
		t.Fatalf("subscribe control: %v", err)
	}
	defer unsub()
	if err := conn.Flush(); err != nil {
		t.Fatalf("flush: %v", err)
	}

	ws := dialWS(ctx, t, addr)
	defer closeWS(ws)

	want := wire.Control{Cmd: "kill", Robot: "R1"}
	payload, _ := json.Marshal(want)

	deadline := time.After(5 * time.Second)
	send := time.NewTicker(50 * time.Millisecond)
	defer send.Stop()
	if err := ws.Write(ctx, websocket.MessageText, payload); err != nil {
		t.Fatalf("ws write: %v", err)
	}
	for {
		select {
		case got := <-received:
			if got.Cmd != want.Cmd || got.Robot != want.Robot {
				t.Fatalf("control mismatch: got %+v want %+v", got, want)
			}
			return
		case <-send.C:
			if err := ws.Write(ctx, websocket.MessageText, payload); err != nil {
				t.Fatalf("ws write: %v", err)
			}
		case <-deadline:
			t.Fatal("timed out waiting for relayed control message")
		}
	}
}

func TestMalformedControlIgnored(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ws := dialWS(ctx, t, addr)
	defer closeWS(ws)

	if err := ws.Write(ctx, websocket.MessageText, []byte("{not json")); err != nil {
		t.Fatalf("ws write garbage: %v", err)
	}

	got := publishUntilReceived(ctx, t, conn, ws, sampleSnapshot())
	if got.Type != "snapshot" {
		t.Fatalf("expected snapshot after malformed frame, got %+v", got)
	}
}

func TestSnapshotOnConnect(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	want := sampleSnapshot()

	primer := dialWS(ctx, t, addr)
	_ = publishUntilReceived(ctx, t, conn, primer, want)
	closeWS(primer)

	ws := dialWS(ctx, t, addr)
	defer closeWS(ws)

	got := readSnapshot(ctx, t, ws)
	if got.At != want.At {
		t.Fatalf("cached snapshot mismatch: got At=%d want At=%d", got.At, want.At)
	}
}

func TestHealthz(t *testing.T) {
	_, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://%s/healthz", addr), nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d want 200", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	var h struct {
		Connected bool `json:"connected"`
		Clients   int  `json:"clients"`
	}
	if err := json.Unmarshal(body, &h); err != nil {
		t.Fatalf("unmarshal health: %v (raw: %s)", err, body)
	}
	if !h.Connected {
		t.Fatalf("expected connected=true, got %s", body)
	}
}

func TestCrossOriginUpgradeSucceeds(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ws, resp, err := websocket.Dial(ctx, fmt.Sprintf("ws://%s/ws", addr), &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://example.com:5173"}},
	})
	if resp != nil && resp.Body != nil {
		defer func() { _ = resp.Body.Close() }()
	}
	if err != nil {
		got := -1
		if resp != nil {
			got = resp.StatusCode
		}
		t.Fatalf("cross-origin ws dial: %v (status %d)", err, got)
	}
	defer closeWS(ws)

	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("upgrade status: got %d want %d (101)", resp.StatusCode, http.StatusSwitchingProtocols)
	}

	got := publishUntilReceived(ctx, t, conn, ws, sampleSnapshot())
	if got.Type != "snapshot" {
		t.Fatalf("expected snapshot over cross-origin connection, got %+v", got)
	}
}

func TestSlowClientDoesNotBlock(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	laggard := dialWS(ctx, t, addr)
	defer closeWS(laggard)

	fast := dialWS(ctx, t, addr)
	defer closeWS(fast)

	stop := make(chan struct{})
	defer close(stop)
	go func() {
		i := domain.Tick(0)
		ticker := time.NewTicker(2 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				s := sampleSnapshot()
				s.At = i
				i++
				_ = conn.PublishJSON(wire.SubjSnapshot, s)
			}
		}
	}()

	var last domain.Tick = -1
	advanced := 0
	for advanced < 5 {
		typ, data, err := fast.Read(ctx)
		if err != nil {
			t.Fatalf("fast client read: %v", err)
		}
		if typ != websocket.MessageText {
			continue
		}
		var snap wire.Snapshot
		if err := json.Unmarshal(data, &snap); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if snap.At > last {
			advanced++
			last = snap.At
		}
	}
}
