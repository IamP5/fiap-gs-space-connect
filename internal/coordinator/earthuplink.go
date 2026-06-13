package coordinator

import (
	"context"
	"swarmbuild/internal/wire"
	"sync/atomic"
	"time"
)

type earthShim struct {
	publisher interface {
		PublishJSON(subj string, v any) error
	}
	in <-chan wire.EarthUplink

	latencyNanos atomic.Int64
}

func newEarthShim(publisher interface {
	PublishJSON(subj string, v any) error
}, in <-chan wire.EarthUplink,
) *earthShim {
	return &earthShim{publisher: publisher, in: in}
}

func (s *earthShim) setLatency(valueMs float64) {
	d := max(time.Duration(valueMs)*time.Millisecond, 0)
	s.latencyNanos.Store(int64(d))
}

func (s *earthShim) latency() time.Duration {
	return time.Duration(s.latencyNanos.Load())
}

type pending struct {
	releaseAt time.Time
	msg       wire.EarthUplink
}

type releaseQueue struct {
	items []pending
	timer *time.Timer
	armed bool
}

func newReleaseQueue() *releaseQueue {
	t := time.NewTimer(time.Hour)
	if !t.Stop() {
		<-t.C
	}
	return &releaseQueue{timer: t}
}

func (q *releaseQueue) push(p pending) { q.items = append(q.items, p) }

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

func (q *releaseQueue) arm() {
	if len(q.items) == 0 {
		return
	}
	d := max(time.Until(q.items[0].releaseAt), 0)
	if q.armed && !q.timer.Stop() {
		select {
		case <-q.timer.C:
		default:
		}
	}
	q.timer.Reset(d)
	q.armed = true
}

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
