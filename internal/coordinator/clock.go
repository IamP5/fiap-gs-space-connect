package coordinator

import (
	"time"

	"swarmbuild/internal/core/domain"
)

// wallClock is the live path's domain.Clock: it maps wall-clock time onto a
// domain.Tick measured in milliseconds. It is monotonic in practice (time only
// moves forward over a demo) and is the single time source the Lease Manager
// reads, so TTL/heartbeat behaviour on the live path uses the same injectable
// clock interface the pure module is tested against (TECHSPEC §7).
type wallClock struct{}

// Now returns the current wall-clock time as a Tick in milliseconds.
func (wallClock) Now() domain.Tick { return domain.Tick(time.Now().UnixMilli()) }
