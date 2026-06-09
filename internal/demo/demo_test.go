package demo

import (
	"testing"
	"time"
)

// TestExternal_YieldsEmptyBoardNoRovers proves the pod-per-rover sandbox: the
// scenario carries an EMPTY Blueprint and NO in-process Rovers. The coordinator
// boots a fresh map; rovers join over NATS as their own pods and the operator
// drops a Blueprint from the dashboard for them to build.
func TestExternal_YieldsEmptyBoardNoRovers(t *testing.T) {
	cfg := Scenario("nats://x", External())

	if len(cfg.Blueprint) != 0 {
		t.Fatalf("External scenario seeds %d tasks, want 0 (the sandbox starts empty — the operator places a Blueprint)", len(cfg.Blueprint))
	}
	if cfg.Rovers != nil {
		t.Fatalf("External scenario has %d in-process rovers, want none (pod-per-rover: rovers join over NATS)", len(cfg.Rovers))
	}
	if cfg.NATSURL != "nats://x" {
		t.Fatalf("Scenario NATSURL = %q, want %q", cfg.NATSURL, "nats://x")
	}
}

// TestExternal_PacingIsLegible pins the widened windows: the lease TTL
// (HeartbeatEvery × TTLFactor) must comfortably exceed the auction window so the
// orphan drain ring reads on screen before the re-auction, and the snapshot
// cadence must be high enough for the beats to animate.
func TestExternal_PacingIsLegible(t *testing.T) {
	cfg := External()

	ttl := cfg.HeartbeatEvery * time.Duration(cfg.TTLFactor)
	if ttl <= 2*cfg.AuctionWindow {
		t.Fatalf("lease TTL %v not comfortably larger than the auction window %v", ttl, cfg.AuctionWindow)
	}
	if cfg.SnapshotHz < 10 {
		t.Fatalf("SnapshotHz = %d, want ≥ 10 (the browser needs a live cadence)", cfg.SnapshotHz)
	}

	scenario := Scenario("nats://x", cfg)
	if scenario.AuctionWindow != cfg.AuctionWindow ||
		scenario.HeartbeatEvery != cfg.HeartbeatEvery ||
		scenario.TTLFactor != cfg.TTLFactor ||
		scenario.SnapshotHz != cfg.SnapshotHz {
		t.Fatalf("Scenario dropped pacing fields: %+v vs %+v", scenario, cfg)
	}
}
