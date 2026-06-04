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

// startGateway brings up an embedded NATS server, a bus connection, and a
// running gateway HTTP server bound to an ephemeral port. It returns the bus
// connection (for publishing/subscribing in tests) and the base http address.
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

func sampleSnapshot() wire.Snapshot {
	return wire.Snapshot{
		Type:      "snapshot",
		Connected: true,
		Rovers: []wire.RoverView{
			{ID: "R1", Pos: domain.Vec2{X: 1, Y: 2}, Battery: 0.9, Alive: true, Load: 1, Task: "T1"},
		},
		Tasks: []wire.TaskView{
			{ID: "T1", Type: "foundation", Pos: domain.Vec2{X: 3, Y: 4}, Status: "LEASED", Assignee: "R1", Version: 7},
		},
		At: 42,
	}
}

// dialWS opens a websocket client to the gateway's /ws endpoint.
func dialWS(t *testing.T, ctx context.Context, addr string) *websocket.Conn {
	t.Helper()
	ws, _, err := websocket.Dial(ctx, fmt.Sprintf("ws://%s/ws", addr), nil)
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	return ws
}

// readSnapshot reads one text frame and unmarshals it as a wire.Snapshot.
func readSnapshot(t *testing.T, ctx context.Context, ws *websocket.Conn) wire.Snapshot {
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

// TestSnapshotRoundTrip publishes a snapshot on NATS and asserts a connected
// websocket client receives it verbatim.
func TestSnapshotRoundTrip(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ws := dialWS(t, ctx, addr)
	defer ws.Close(websocket.StatusNormalClosure, "")

	want := sampleSnapshot()
	// Publish repeatedly until the client receives one: the client may connect
	// a hair after the first publish, so we drive the fan-out deterministically.
	got := publishUntilReceived(t, ctx, conn, ws, want)

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

// publishUntilReceived publishes want every 50ms until ws delivers a matching
// snapshot or ctx expires. Deterministic: no fixed sleeps to "hope" past races.
func publishUntilReceived(t *testing.T, ctx context.Context, conn *bus.Conn, ws *websocket.Conn, want wire.Snapshot) wire.Snapshot {
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

// TestControlRelay asserts a control message sent by the browser is published
// on wire.SubjControl.
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

	ws := dialWS(t, ctx, addr)
	defer ws.Close(websocket.StatusNormalClosure, "")

	want := wire.Control{Cmd: "kill", Robot: "R1"}
	payload, _ := json.Marshal(want)

	// Send repeatedly until the relay lands: client write may race the server's
	// read-loop spin-up.
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

// TestMalformedControlIgnored asserts a garbage inbound frame does not kill the
// connection: a subsequent valid snapshot still flows.
func TestMalformedControlIgnored(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ws := dialWS(t, ctx, addr)
	defer ws.Close(websocket.StatusNormalClosure, "")

	if err := ws.Write(ctx, websocket.MessageText, []byte("{not json")); err != nil {
		t.Fatalf("ws write garbage: %v", err)
	}

	// Connection must survive: a published snapshot still arrives.
	got := publishUntilReceived(t, ctx, conn, ws, sampleSnapshot())
	if got.Type != "snapshot" {
		t.Fatalf("expected snapshot after malformed frame, got %+v", got)
	}
}

// TestSnapshotOnConnect asserts a client that connects after a snapshot was
// published immediately receives the latest cached snapshot, with no further
// publish.
func TestSnapshotOnConnect(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	want := sampleSnapshot()

	// First client primes the gateway's latest-snapshot cache. We wait until it
	// actually receives one, so we know the gateway has cached it.
	primer := dialWS(t, ctx, addr)
	_ = publishUntilReceived(t, ctx, conn, primer, want)
	primer.Close(websocket.StatusNormalClosure, "")

	// Second client connects with no new publish and must get the cached state.
	ws := dialWS(t, ctx, addr)
	defer ws.Close(websocket.StatusNormalClosure, "")

	got := readSnapshot(t, ctx, ws)
	if got.At != want.At {
		t.Fatalf("cached snapshot mismatch: got At=%d want At=%d", got.At, want.At)
	}
}

// TestHealthz asserts /healthz returns 200 and reflects bus connected=true.
func TestHealthz(t *testing.T) {
	_, addr := startGateway(t)

	resp, err := http.Get(fmt.Sprintf("http://%s/healthz", addr))
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()

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

// TestCrossOriginUpgradeSucceeds is the regression guard for the cross-origin
// 403: browsers connect from the dashboard origin (e.g. :5173) to the gateway
// (:8080), which coder/websocket's Accept rejects with HTTP 403 unless
// OriginPatterns is set. A plain Go websocket.Dial sends no Origin header, so
// this test forges a browser Origin to exercise the check, then asserts the
// upgrade completes (101) and a published snapshot is received. Removing the
// OriginPatterns fix in gateway.go makes Dial fail here with status 403.
func TestCrossOriginUpgradeSucceeds(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ws, resp, err := websocket.Dial(ctx, fmt.Sprintf("ws://%s/ws", addr), &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://example.com:5173"}},
	})
	if err != nil {
		got := -1
		if resp != nil {
			got = resp.StatusCode
		}
		t.Fatalf("cross-origin ws dial: %v (status %d)", err, got)
	}
	defer ws.Close(websocket.StatusNormalClosure, "")

	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("upgrade status: got %d want %d (101)", resp.StatusCode, http.StatusSwitchingProtocols)
	}

	got := publishUntilReceived(t, ctx, conn, ws, sampleSnapshot())
	if got.Type != "snapshot" {
		t.Fatalf("expected snapshot over cross-origin connection, got %+v", got)
	}
}

// TestSlowClientDoesNotBlock connects two clients; one never reads (a laggard).
// A fast client must keep receiving snapshots while the laggard is dropped,
// proving the fan-out never blocks on a slow consumer.
func TestSlowClientDoesNotBlock(t *testing.T) {
	conn, addr := startGateway(t)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Laggard: connects but never reads after the initial frame.
	laggard := dialWS(t, ctx, addr)
	defer laggard.Close(websocket.StatusNormalClosure, "")

	// Fast client.
	fast := dialWS(t, ctx, addr)
	defer fast.Close(websocket.StatusNormalClosure, "")

	// Flood snapshots so the laggard's buffer overflows and it is dropped, while
	// the fast client keeps draining. We assert the fast client receives an
	// up-to-date snapshot well after the flood begins.
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

	// The fast client must keep receiving frames; read several and require the
	// stream keeps advancing.
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
