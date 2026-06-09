package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/wire"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type busConn interface {
	PublishJSON(subj string, v any) error
	Connected() bool
}

const clientSendBuffer = 8

type client struct {
	ws   *websocket.Conn
	send chan []byte
	once sync.Once
	done chan struct{}
}

func (c *client) closeWith(code websocket.StatusCode, reason string) {
	c.once.Do(func() {
		close(c.done)
		_ = c.ws.Close(code, reason)
	})
}

type Gateway struct {
	bus busConn

	mu          sync.RWMutex
	latest      []byte
	latestEarth []byte
	clients     map[*client]struct{}
}

func New(b busConn) *Gateway {
	return &Gateway{
		bus:     b,
		clients: make(map[*client]struct{}),
	}
}

func Run(_ context.Context, b *bus.Conn) (*Gateway, func() error, error) {
	g := New(b)
	unsub, err := bus.SubscribeJSON(b, wire.SubjSnapshot, g.onSnapshot)
	if err != nil {
		return nil, nil, err
	}
	unsubEarth, err := bus.SubscribeJSON(b, wire.SubjEarthUplink, g.onEarthUplink)
	if err != nil {
		unsub()
		return nil, nil, err
	}
	stop := func() error {
		unsub()
		unsubEarth()
		g.closeAll()
		return nil
	}
	return g, stop, nil
}

func (g *Gateway) onSnapshot(s wire.Snapshot) {
	b, err := json.Marshal(s)
	if err != nil {
		return
	}

	g.mu.Lock()
	g.latest = b
	g.mu.Unlock()

	g.fanout(b)
}

func (g *Gateway) onEarthUplink(e wire.EarthUplink) {
	b, err := json.Marshal(e)
	if err != nil {
		return
	}

	g.mu.Lock()
	g.latestEarth = b
	g.mu.Unlock()

	g.fanout(b)
}

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
			c.closeWith(websocket.StatusPolicyViolation, "client too slow")
		}
	}
}

func (g *Gateway) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", g.serveWS)
	mux.HandleFunc("/healthz", g.serveHealthz)
	return mux
}

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

func (g *Gateway) serveWS(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		return
	}

	c := &client{
		ws:   ws,
		send: make(chan []byte, clientSendBuffer),
		done: make(chan struct{}),
	}

	g.mu.Lock()
	if g.latest != nil {
		c.send <- g.latest
	}
	if g.latestEarth != nil {
		c.send <- g.latestEarth
	}
	g.clients[c] = struct{}{}
	g.mu.Unlock()

	ctx := r.Context()
	var wg sync.WaitGroup
	wg.Go(func() {
		g.writeLoop(ctx, c)
	})

	g.readLoop(ctx, c)

	c.closeWith(websocket.StatusNormalClosure, "")
	g.remove(c)
	wg.Wait()
}

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

func (g *Gateway) readLoop(ctx context.Context, c *client) {
	for {
		typ, data, err := c.ws.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageText && typ != websocket.MessageBinary {
			continue
		}
		var ctrl wire.Control
		if err := json.Unmarshal(data, &ctrl); err != nil {
			continue
		}
		_ = g.bus.PublishJSON(wire.SubjControl, ctrl)
	}
}

func (g *Gateway) remove(c *client) {
	g.mu.Lock()
	delete(g.clients, c)
	g.mu.Unlock()
}

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

func (g *Gateway) Clients() int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return len(g.clients)
}

func (g *Gateway) ListenAndServe(ctx context.Context, addr string) (string, func(context.Context) error, error) {
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", addr)
	if err != nil {
		return "", nil, err
	}
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
