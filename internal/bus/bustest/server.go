package bustest

import (
	"testing"
	"time"

	natsserver "github.com/nats-io/nats-server/v2/server"
)

func RunServer(tb testing.TB) (url string, shutdown func()) {
	tb.Helper()
	opts := &natsserver.Options{
		Host:      "127.0.0.1",
		Port:      -1,
		JetStream: true,
		StoreDir:  tb.TempDir(),
		NoLog:     true,
		NoSigs:    true,
	}
	srv, err := natsserver.NewServer(opts)
	if err != nil {
		tb.Fatalf("embedded nats: new server: %v", err)
	}
	go srv.Start()
	if !srv.ReadyForConnections(5 * time.Second) {
		srv.Shutdown()
		tb.Fatal("embedded nats: not ready within 5s")
	}
	return srv.ClientURL(), srv.Shutdown
}
