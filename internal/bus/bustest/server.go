// Package bustest spins up an in-process NATS server (JetStream enabled) for
// tests, so the integration suite runs without Docker. Production binaries
// never import this package, so nats-server stays out of shipped images.
package bustest

import (
	"testing"
	"time"

	natsserver "github.com/nats-io/nats-server/v2/server"
)

// RunServer starts an embedded NATS server with JetStream on a random port and
// returns its client URL plus a shutdown func. It fails the test if the server
// does not come up promptly.
func RunServer(tb testing.TB) (url string, shutdown func()) {
	tb.Helper()
	opts := &natsserver.Options{
		Host:      "127.0.0.1",
		Port:      -1, // random free port
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
