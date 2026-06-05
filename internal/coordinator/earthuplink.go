package coordinator

import (
	"context"
	"swarmbuild/internal/wire"
	"sync/atomic"
	"time"
)

// earthShim is the Earth-uplink latency shim (issue 09). It is the ONLY place in
// the coordinator that applies artificial delay, and it touches ONLY the
// earth.uplink subject — never heartbeats, telemetry, awards, or the tactical
// world.snapshot loop (ADR-0002 / TECHSPEC §8). It runs on its own goroutine,
// reading freshly-published snapshots from in and re-publishing them as a
// wire.EarthUplink after the current latency delay.
//
// The shim never blocks the single writer: the writer's send onto in is
// non-blocking (see publishSnapshot), so a slow shim only drops frames.
type earthShim struct {
	publisher interface {
		PublishJSON(subj string, v any) error
	}
	in <-chan wire.EarthUplink

	// latencyNanos is the artificial Earth-uplink delay, in nanoseconds, read and
	// written atomically. Default 0 ⇒ publish immediately (Earth ≈ live). It is
	// set ONLY by setLatency (off the NATS dispatcher) and read ONLY at enqueue
	// time on the shim goroutine, so a change never reorders already-queued items
	// and never blocks.
	latencyNanos atomic.Int64
}

// newEarthShim builds the shim over the coordinator's hardened bus conn (safe for
// concurrent PublishJSON) and the buffered snapshot channel the single writer
// feeds. Latency defaults to 0.
func newEarthShim(publisher interface {
	PublishJSON(subj string, v any) error
}, in <-chan wire.EarthUplink,
) *earthShim {
	return &earthShim{publisher: publisher, in: in}
}

// setLatency atomically sets the Earth-uplink delay to max(0, value ms). It runs
// on the NATS dispatcher goroutine (the control subscription callback) and does
// NOTHING but an atomic store — it never touches single-writer state and never
// blocks (ADR-0002).
func (s *earthShim) setLatency(valueMs float64) {
	d := max(time.Duration(valueMs)*time.Millisecond, 0)
	s.latencyNanos.Store(int64(d))
}

// latency reads the current delay atomically.
func (s *earthShim) latency() time.Duration {
	return time.Duration(s.latencyNanos.Load())
}

// pending is one snapshot waiting out its delay before it is published onto
// earth.uplink. releaseAt = receiveTime + latency (latency sampled at enqueue),
// so the queue is strictly FIFO and order-preserving: a later latency change
// cannot reorder items already stamped.
type pending struct {
	releaseAt time.Time
	msg       wire.EarthUplink
}

// releaseQueue is an order-preserving FIFO of pending Earth-uplink frames plus a
// single reusable timer armed to the head's releaseAt. It is owned by, and only
// ever touched on, the shim goroutine, so it needs no locking.
type releaseQueue struct {
	items []pending
	timer *time.Timer
	armed bool
}

// newReleaseQueue builds an empty queue with a stopped, drained timer (so the
// first arm starts cleanly and there is no per-frame time.After churn).
func newReleaseQueue() *releaseQueue {
	t := time.NewTimer(time.Hour)
	if !t.Stop() {
		<-t.C
	}
	return &releaseQueue{timer: t}
}

// push appends a frame stamped with releaseAt (FIFO order is preserved because
// releaseAt is monotonic across enqueues at a fixed latency, and a later latency
// change cannot restamp already-queued items).
func (q *releaseQueue) push(p pending) { q.items = append(q.items, p) }

// flushDue publishes every head whose releaseAt has passed, in order.
func (q *releaseQueue) flushDue(publish func(wire.EarthUplink)) {
	now := time.Now()
	i := 0
	for i < len(q.items) && !q.items[i].releaseAt.After(now) {
		publish(q.items[i].msg)
		i++
	}
	if i > 0 {
		q.items = q.items[i:]
	}
}

// arm (re)sets the timer to fire when the current head is due; a no-op when empty.
func (q *releaseQueue) arm() {
	if len(q.items) == 0 {
		return
	}
	d := max(time.Until(q.items[0].releaseAt), 0)
	if q.armed && !q.timer.Stop() {
		select {
		case <-q.timer.C: // drain an already-fired timer before resetting
		default:
		}
	}
	q.timer.Reset(d)
	q.armed = true
}

// run owns the delay + the earth.uplink publish. It maintains an order-preserving
// FIFO of pending snapshots; a single timer fires when the head's releaseAt
// arrives, at which point the head (and any others now due) are published in
// order. At latency 0 a snapshot is published immediately. run returns when ctx
// is cancelled or the input channel closes.
func (s *earthShim) run(ctx context.Context) {
	q := newReleaseQueue()
	defer q.timer.Stop()

	publish := func(m wire.EarthUplink) { _ = s.publisher.PublishJSON(wire.SubjEarthUplink, m) }

	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-s.in:
			if !ok {
				return
			}
			// Sample latency atomically at enqueue; stamp releaseAt so order is
			// preserved regardless of later latency changes. At latency 0 (or a
			// backlog already due) the frame publishes immediately.
			q.push(pending{releaseAt: time.Now().Add(s.latency()), msg: msg})
			q.flushDue(publish)
			q.arm()
		case <-q.timer.C:
			q.armed = false
			q.flushDue(publish)
			q.arm()
		}
	}
}
