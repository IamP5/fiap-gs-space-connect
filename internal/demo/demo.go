// Package demo is the single, server-authoritative home for the live-show
// pacing: the widened real-engine timing windows that make the kill→heal arc
// legible on screen. The k8s pod-per-rover sandbox is the only scenario: the
// coordinator boots an EMPTY board, spawns no in-process rovers, and waits for
// an operator to drop a Blueprint from the dashboard hotbar.
package demo

import (
	"swarmbuild/internal/coordinator"
	"time"
)

// Config is the ONE place every demo-pacing timing is tuned. These map straight
// onto the coordinator's real auction/lease cadence — there is no separate
// "animation clock" to drift out of sync with the World Model.
type Config struct {
	// AuctionWindow is how long each auction collects bids. Widened (vs the ~400ms
	// production value) so the bid-flash beat is legible.
	AuctionWindow time.Duration
	// HeartbeatEvery × TTLFactor is the lease TTL — and therefore how long the
	// orphaned-task drain ring is visible after a kill before the task re-auctions.
	HeartbeatEvery time.Duration
	TTLFactor      int
	// SnapshotHz is the world-snapshot cadence to the browser.
	SnapshotHz int
}

// External is the pod-per-rover pacing: legible auction/lease windows over an
// EMPTY starting board. The coordinator runs the auction, the Lease Manager, the
// World Model, and snapshots over a fresh map; the rovers join over NATS from
// outside (each its own pod) and idle until an operator drops a Blueprint from
// the dashboard hotbar (placeBlueprint), then build it live and Self-heal a KILL
// over the real bus.
func External() Config {
	return Config{
		AuctionWindow:  900 * time.Millisecond,
		HeartbeatEvery: 700 * time.Millisecond,
		TTLFactor:      6,
		SnapshotHz:     12,
	}
}

// Scenario assembles the coordinator Config for the sandbox: an empty board, no
// in-process rovers, and the legible pacing windows. natsURL is the bus to run
// against.
func Scenario(natsURL string, cfg Config) coordinator.Config {
	return coordinator.Config{
		NATSURL:        natsURL,
		AuctionWindow:  cfg.AuctionWindow,
		HeartbeatEvery: cfg.HeartbeatEvery,
		TTLFactor:      cfg.TTLFactor,
		SnapshotHz:     cfg.SnapshotHz,
	}
}
