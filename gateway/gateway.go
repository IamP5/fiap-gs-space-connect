// Package gateway is the WS Gateway of the SwarmBuild walking skeleton: a dumb
// fan-out. It tails one NATS subject for world snapshots and forwards them to
// browser WebSocket clients, and relays browser control messages back onto
// NATS. The browser never speaks NATS — only the gateway does (TECHSPEC §3/§4).
//
// The gateway is forward-only of the server-authoritative state: it never
// simulates or mutates the world. It keeps the latest snapshot so a freshly
// connected (or reconnecting) client gets the current state immediately.
package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"sync"

	"github.com/coder/websocket"

	"swarmbuild/bus"
	"swarmbuild/wire"
)

// busConn is the slice of *bus.Conn the gateway depends on. Narrowing to an
// interface keeps the fan-out logic honest (publish + connected status) and
// documents exactly what the gateway touches on the bus.
type busConn interface {
	PublishJSON(subj string, v any) error
	Connected() bool
}

// clientSendBuffer bounds how many snapshots may queue for a single client
// before it is treated as a laggard. Snapshots are full-state and
// reconnect-safe, so dropping intermediate frames for a slow client is
// harmless — the next snapshot it does receive is authoritative.
const clientSendBuffer = 8

// client is one connected browser. Each client owns a writer goroutine fed by a
// buffered channel; a slow or dead client only ever stalls its own channel, and
// is dropped once that channel fills, so it can never block the snapshot loop or
// other clients.
type client struct {
	ws   *websocket.Conn
	send chan []byte
	once sync.Once
	done chan struct{}
}

// closeWith shuts the client's WebSocket down with the given status, exactly
// once, and signals its writer to stop.
func (c *client) closeWith(code websocket.StatusCode, reason string) {
	c.once.Do(func() {
		close(c.done)
		_ = c.ws.Close(code, reason)
	})
}

// Gateway fans the latest world snapshot out to every connected browser and
// relays browser control messages back onto NATS.
type Gateway struct {
	bus busConn

	mu      sync.RWMutex
	latest  []byte // last snapshot, marshalled once, served to new clients
	clients map[*client]struct{}
}

// New builds a Gateway over an established bus connection.
func New(b busConn) *Gateway {
	return &Gateway{
		bus:     b,
		clients: make(map[*client]struct{}),
	}
}

// Run subscribes to world snapshots and blocks until ctx is cancelled. On
// return every client is closed and the subscription is torn down. It is the
// gateway's lifecycle: the HTTP handlers may be wired up independently via
// Handler.
func Run(ctx context.Context, b *bus.Conn) (*Gateway, func() error, error) {
	g := New(b)
	unsub, err := bus.SubscribeJSON(b, wire.SubjSnapshot, g.onSnapshot)
	if err != nil {
		return nil, nil, err
	}
	// Returned stop func unsubscribes and closes all clients.
	stop := func() error {
		unsub()
		g.closeAll()
		return nil
	}
	return g, stop, nil
}

// onSnapshot is invoked on the NATS dispatcher goroutine for each new snapshot.
// It stores the latest marshalled snapshot and fans it out to every client
// without blocking: a client whose buffer is full is dropped.
func (g *Gateway) onSnapshot(s wire.Snapshot) {
	b, err := json.Marshal(s)
	if err != nil {
		return // never fatal
	}

	g.mu.Lock()
	g.latest = b
	clients := make([]*client, 0, len(g.clients))
	for c := range g.clients {
		clients = append(clients, c)
	}
	g.mu.Unlock()

	for _, c := range clients {
		select {
		case c.send <- b:
		default:
			// Laggard: its buffer is full. Drop it so it can never wedge the
			// snapshot loop. The client's writer goroutine will tear down the
			// socket and deregister.
			c.closeWith(websocket.StatusPolicyViolation, "client too slow")
		}
	}
}

// Handler returns the HTTP mux exposing /ws and /healthz.
func (g *Gateway) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", g.serveWS)
	mux.HandleFunc("/healthz", g.serveHealthz)
	return mux
}

// healthStatus is the /healthz body: a backend signal for the
// "all systems connected" story and for compose health-checks.
type healthStatus struct {
	Connected bool `json:"connected"`
	Clients   int  `json:"clients"`
}

func (g *Gateway) serveHealthz(w http.ResponseWriter, r *http.Request) {
	g.mu.RLock()
	n := len(g.clients)
	g.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(healthStatus{
		Connected: g.bus.Connected(),
		Clients:   n,
	})
}

// serveWS upgrades to WebSocket, immediately sends the latest snapshot
// (reconnect-safe), then pushes each new snapshot as it arrives. Inbound frames
// are read and relayed onto NATS as wire.Control.
func (g *Gateway) serveWS(w http.ResponseWriter, r *http.Request) {
	// The dashboard is served from a different origin than the gateway (web on
	// :5173/:80, gateway on :8080), so cross-origin upgrades must be allowed —
	// coder/websocket rejects them with 403 by default. This is a local demo
	// bus fan-out with no auth, so any origin is acceptable.
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		return // Accept already wrote the error response
	}

	c := &client{
		ws:   ws,
		send: make(chan []byte, clientSendBuffer),
		done: make(chan struct{}),
	}

	// Seed the client with the current snapshot before registering, so it gets
	// state on connect even if no new snapshot arrives.
	g.mu.Lock()
	if g.latest != nil {
		// Non-blocking by construction: fresh buffered channel.
		c.send <- g.latest
	}
	g.clients[c] = struct{}{}
	g.mu.Unlock()

	// Writer goroutine: drains send into the socket. ctx lives for the
	// connection.
	ctx := r.Context()
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		g.writeLoop(ctx, c)
	}()

	// Reader loop (this goroutine): relays inbound control messages.
	g.readLoop(ctx, c)

	// Reader returned: connection is going away. Tear down and deregister.
	c.closeWith(websocket.StatusNormalClosure, "")
	g.remove(c)
	wg.Wait()
}

// writeLoop pushes queued snapshots to the client until the connection or
// gateway closes.
func (g *Gateway) writeLoop(ctx context.Context, c *client) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.done:
			return
		case b := <-c.send:
			if err := c.ws.Write(ctx, websocket.MessageText, b); err != nil {
				c.closeWith(websocket.StatusInternalError, "write failed")
				return
			}
		}
	}
}

// readLoop reads inbound frames, unmarshals each as a wire.Control and relays it
// onto wire.SubjControl. Malformed frames are ignored — never fatal. It returns
// when the connection closes.
func (g *Gateway) readLoop(ctx context.Context, c *client) {
	for {
		typ, data, err := c.ws.Read(ctx)
		if err != nil {
			return // connection closed / errored
		}
		if typ != websocket.MessageText && typ != websocket.MessageBinary {
			continue
		}
		var ctrl wire.Control
		if err := json.Unmarshal(data, &ctrl); err != nil {
			continue // malformed: ignore
		}
		_ = g.bus.PublishJSON(wire.SubjControl, ctrl)
	}
}

// remove deregisters a client from the fan-out set.
func (g *Gateway) remove(c *client) {
	g.mu.Lock()
	delete(g.clients, c)
	g.mu.Unlock()
}

// closeAll closes every connected client; used on gateway shutdown.
func (g *Gateway) closeAll() {
	g.mu.Lock()
	clients := make([]*client, 0, len(g.clients))
	for c := range g.clients {
		clients = append(clients, c)
	}
	g.clients = make(map[*client]struct{})
	g.mu.Unlock()

	for _, c := range clients {
		c.closeWith(websocket.StatusGoingAway, "gateway shutting down")
	}
}

// Clients reports the number of connected browsers (for tests / introspection).
func (g *Gateway) Clients() int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return len(g.clients)
}

// ListenAndServe is a convenience that binds addr and serves the gateway
// handler until ctx is cancelled, then shuts the HTTP server down gracefully.
// It returns the resolved listen address (useful when addr uses :0).
func (g *Gateway) ListenAndServe(ctx context.Context, addr string) (string, func(context.Context) error, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return "", nil, err
	}
	srv := &http.Server{Handler: g.Handler()}

	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("gateway: http serve: %v", err)
		}
	}()

	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()

	shutdown := func(sctx context.Context) error {
		return srv.Shutdown(sctx)
	}
	return ln.Addr().String(), shutdown, nil
}
