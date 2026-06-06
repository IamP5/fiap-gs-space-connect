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
	"io"
	"log/slog"
	"net"
	"net/http"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/wire"
	"sync"
	"time"

	"github.com/coder/websocket"
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

// LabRunner is the gateway's narrow seam onto the in-app LIVE lab generation
// (bh-07a). It is an INTERFACE so the gateway package never imports the lab — and
// therefore never imports the Model seam / refine loop — keeping the gateway off
// the model's import graph; cmd/gateway injects the real
// internal/harness/lab.Service. Run drives one live Generator↔Evaluator loop and
// streams its events to w, in order, flushing each as Server-Sent Events. The hot
// path never constructs a LabRunner, so the archtest stays green.
//
// reqBody is the raw JSON request body ({"task_id","task_type"}); the runner
// decodes it. w is the already-prepared SSE response writer (headers set). It
// returns when the run finishes or the request context is cancelled.
type LabRunner interface {
	Run(ctx context.Context, reqBody []byte, w SSEWriter) error
	// CatalogJSON returns the JSON list of selectable Task types for the Lab
	// panel's dropdown, so the gateway can serve it without importing the lab.
	CatalogJSON() []byte
}

// SSEWriter is the minimal sink a LabRunner streams one run's events into: each
// Event is a self-contained JSON object written as one `data:` line and flushed,
// so the browser's EventSource sees each refine pass live. Kept tiny so the lab
// package depends only on this, not on net/http internals.
type SSEWriter interface {
	// Send writes one event payload (raw JSON bytes) as an SSE `data:` frame and
	// flushes it. Returns an error if the client has gone away.
	Send(payload []byte) error
}

// Gateway fans the latest world snapshot out to every connected browser and
// relays browser control messages back onto NATS.
type Gateway struct {
	bus busConn
	lab LabRunner // optional in-app live lab (bh-07a); nil ⇒ the /lab route 503s

	mu          sync.RWMutex
	latest      []byte // last snapshot, marshalled once, served to new clients
	latestEarth []byte // last earth.uplink frame, marshalled once, served to new clients
	clients     map[*client]struct{}
}

// New builds a Gateway over an established bus connection.
func New(b busConn) *Gateway {
	return &Gateway{
		bus:     b,
		clients: make(map[*client]struct{}),
	}
}

// WithLab attaches the in-app live lab runner (bh-07a), enabling the /lab/generate
// SSE endpoint. Injected by cmd/gateway from internal/harness/lab so the gateway
// package itself never imports the Model seam (ADR-0005). nil ⇒ the lab route
// returns 503 (the headline still runs; the lab is an opt-in extra).
func (g *Gateway) WithLab(lab LabRunner) *Gateway {
	g.lab = lab
	return g
}

// Run subscribes to world snapshots and blocks until ctx is cancelled. On
// return every client is closed and the subscription is torn down. It is the
// gateway's lifecycle: the HTTP handlers may be wired up independently via
// Handler.
func Run(_ context.Context, b *bus.Conn) (*Gateway, func() error, error) {
	g := New(b)
	unsub, err := bus.SubscribeJSON(b, wire.SubjSnapshot, g.onSnapshot)
	if err != nil {
		return nil, nil, err
	}
	// Second subscription: the delayed Earth-uplink feed (issue 09). The gateway
	// is a DUMB forwarder — the coordinator already applied the latency, so the
	// gateway adds NO delay and never mutates the feed; it fans each frame out
	// over the SAME per-client send path as a snapshot.
	unsubEarth, err := bus.SubscribeJSON(b, wire.SubjEarthUplink, g.onEarthUplink)
	if err != nil {
		unsub()
		return nil, nil, err
	}
	// Returned stop func unsubscribes both feeds and closes all clients.
	stop := func() error {
		unsub()
		unsubEarth()
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
	g.mu.Unlock()

	g.fanout(b)
}

// onEarthUplink is invoked on the NATS dispatcher goroutine for each delayed
// Earth-uplink frame (issue 09). The gateway adds NO further delay — the
// coordinator already lagged it — and never mutates it: it caches the last frame
// (so a reconnecting client sees it) and fans it out over the same drop-safe
// per-client path as a snapshot.
func (g *Gateway) onEarthUplink(e wire.EarthUplink) {
	b, err := json.Marshal(e)
	if err != nil {
		return // never fatal
	}

	g.mu.Lock()
	g.latestEarth = b
	g.mu.Unlock()

	g.fanout(b)
}

// fanout pushes a pre-marshalled frame to every connected client without
// blocking: a client whose buffer is full is dropped (laggard). Shared by the
// snapshot and Earth-uplink feeds.
func (g *Gateway) fanout(b []byte) {
	g.mu.RLock()
	clients := make([]*client, 0, len(g.clients))
	for c := range g.clients {
		clients = append(clients, c)
	}
	g.mu.RUnlock()

	for _, c := range clients {
		select {
		case c.send <- b:
		default:
			// Laggard: its buffer is full. Drop it so it can never wedge the
			// fan-out. The client's writer goroutine will tear down the socket and
			// deregister.
			c.closeWith(websocket.StatusPolicyViolation, "client too slow")
		}
	}
}

// Handler returns the HTTP mux exposing /ws, /healthz, and the in-app live-lab
// endpoints (/lab/generate SSE + /lab/catalog). The lab routes are always mounted;
// when no LabRunner was injected they answer 503, so the headline path is
// unaffected by the lab's presence.
func (g *Gateway) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", g.serveWS)
	mux.HandleFunc("/healthz", g.serveHealthz)
	mux.HandleFunc("/lab/generate", g.serveLabGenerate)
	mux.HandleFunc("/lab/catalog", g.serveLabCatalog)
	return mux
}

// healthStatus is the /healthz body: a backend signal for the
// "all systems connected" story and for compose health-checks.
type healthStatus struct {
	Connected bool `json:"connected"`
	Clients   int  `json:"clients"`
}

func (g *Gateway) serveHealthz(w http.ResponseWriter, _ *http.Request) {
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

// labCORS sets permissive CORS headers so the browser dashboard (served from a
// different origin/port than the gateway — e.g. :5173 vs :8080 under a k8s
// port-forward or docker-compose) can call the lab endpoints, and answers the
// preflight. The lab client POSTs application/json, a non-simple request, so the
// browser sends an OPTIONS preflight first; returning true means the request was
// a preflight that has been fully handled here.
func labCORS(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

// serveLabCatalog returns the Lab panel's selectable Task-type list as JSON. It
// 503s when no lab runner is wired (e.g. the key was absent at startup), so the
// dashboard can show the lab as unavailable rather than guess inputs.
func (g *Gateway) serveLabCatalog(w http.ResponseWriter, r *http.Request) {
	if labCORS(w, r) {
		return
	}
	if g.lab == nil {
		http.Error(w, `{"error":"live lab not enabled (no API key at startup)"}`, http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(g.lab.CatalogJSON())
}

// sseWriter adapts an http.ResponseWriter into the LabRunner's SSEWriter sink:
// each Send writes one `data:` frame and flushes it, so the browser's EventSource
// renders each refine pass live. A write failure (client gone) is returned so the
// run aborts promptly.
type sseWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

func (s *sseWriter) Send(payload []byte) error {
	if _, err := s.w.Write([]byte("data: ")); err != nil {
		return err
	}
	if _, err := s.w.Write(payload); err != nil {
		return err
	}
	if _, err := s.w.Write([]byte("\n\n")); err != nil {
		return err
	}
	s.flusher.Flush()
	return nil
}

// serveLabGenerate runs one LIVE lab generation and streams its events back as
// Server-Sent Events (bh-07a). This is the "watch it think" surface: the real
// Generator↔Evaluator loop runs (a live model call) and every emitted spec +
// verdict is flushed to the browser as it happens. It is strictly OFF the headline
// path — the snapshot fan-out above never touches this handler, and the World
// Model is never mutated here. 503s when no lab runner was injected.
func (g *Gateway) serveLabGenerate(w http.ResponseWriter, r *http.Request) {
	if labCORS(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if g.lab == nil {
		http.Error(w, `{"error":"live lab not enabled (no API key at startup)"}`, http.StatusServiceUnavailable)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	// Bound the request body so a hostile client can't stream an unbounded payload.
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<10))
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	sink := &sseWriter{w: w, flusher: flusher}
	if err := g.lab.Run(r.Context(), body, sink); err != nil {
		// The client likely disconnected mid-stream; nothing more to write.
		slog.Debug("lab run ended", "error", err)
	}
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
	if g.latestEarth != nil {
		// Seed the last Earth-uplink frame too (issue 09), so a reconnect sees the
		// current lagging Earth view. Still non-blocking: buffer ≥ 2 frames.
		c.send <- g.latestEarth
	}
	g.clients[c] = struct{}{}
	g.mu.Unlock()

	// Writer goroutine: drains send into the socket. ctx lives for the
	// connection.
	ctx := r.Context()
	var wg sync.WaitGroup
	wg.Go(func() {
		g.writeLoop(ctx, c)
	})

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
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", addr)
	if err != nil {
		return "", nil, err
	}
	// ReadHeaderTimeout bounds how long a client may dribble request headers,
	// closing the Slowloris hole (gosec G112). The remaining timeouts keep a
	// stuck or hostile peer from pinning a connection indefinitely; the WS
	// upgrade hijacks the conn before WriteTimeout would bite long-lived streams.
	srv := &http.Server{
		Handler:           g.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("gateway http serve failed", "error", err)
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
