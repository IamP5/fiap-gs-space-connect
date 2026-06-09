package demo

import (
	"swarmbuild/internal/coordinator"
	"time"
)

type Config struct {
	AuctionWindow  time.Duration
	HeartbeatEvery time.Duration
	TTLFactor      int
	SnapshotHz     int
}

func External() Config {
	return Config{
		AuctionWindow:  900 * time.Millisecond,
		HeartbeatEvery: 700 * time.Millisecond,
		TTLFactor:      6,
		SnapshotHz:     12,
	}
}

func Scenario(natsURL string, cfg Config) coordinator.Config {
	return coordinator.Config{
		NATSURL:        natsURL,
		AuctionWindow:  cfg.AuctionWindow,
		HeartbeatEvery: cfg.HeartbeatEvery,
		TTLFactor:      cfg.TTLFactor,
		SnapshotHz:     cfg.SnapshotHz,
	}
}
