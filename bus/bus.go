// Package bus is a thin wrapper over the NATS client: JSON pub/sub,
// request-reply, and a JetStream KV mirror, plus a hardened connect with
// retry/backoff. It is the only place the rest of the system touches NATS
// (TECHSPEC §3 "Bus Transport"). The browser never speaks NATS — only the
// gateway and the Go services do, through this package.
package bus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

// Conn is a live connection to NATS with a JetStream context for KV.
type Conn struct {
	nc *nats.Conn
	js jetstream.JetStream
}

// Raw exposes the underlying handle for advanced callers (tests); kept small.
func (c *Conn) Raw() *nats.Conn { return c.nc }

// ConnectOptions tunes the hardened connect loop.
type ConnectOptions struct {
	// Name labels the connection in NATS monitoring.
	Name string
	// MaxWait bounds the total time Connect will spend retrying before giving
	// up. Zero means retry until the context is cancelled.
	MaxWait time.Duration
	// Backoff is the initial delay between attempts; it doubles up to 2s.
	Backoff time.Duration
}

// Connect dials NATS, retrying with exponential backoff until it succeeds, the
// context is cancelled, or MaxWait elapses. This is the hardened bootstrap the
// ADRs require: a JetStream/KV bootstrap race must not hang the first auction
// (ADR-0002, TECHSPEC §8).
func Connect(ctx context.Context, url string, opts ConnectOptions) (*Conn, error) {
	if url == "" {
		url = nats.DefaultURL
	}
	if opts.Backoff <= 0 {
		opts.Backoff = 200 * time.Millisecond
	}
	name := opts.Name
	if name == "" {
		name = "swarmbuild"
	}

	var deadline time.Time
	if opts.MaxWait > 0 {
		deadline = time.Now().Add(opts.MaxWait)
	}

	backoff := opts.Backoff
	var lastErr error
	for {
		nc, err := nats.Connect(url,
			nats.Name(name),
			nats.MaxReconnects(-1), // reconnect forever once first connected
			nats.ReconnectWait(time.Second),
			nats.RetryOnFailedConnect(false), // we own the retry loop here
		)
		if err == nil {
			js, jerr := jetstream.New(nc)
			if jerr == nil {
				return &Conn{nc: nc, js: js}, nil
			}
			nc.Close()
			err = fmt.Errorf("jetstream init: %w", jerr)
		}
		lastErr = err

		if !deadline.IsZero() && time.Now().After(deadline) {
			return nil, fmt.Errorf("connect %s: gave up after %s: %w", url, opts.MaxWait, lastErr)
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("connect %s: %w (last: %v)", url, ctx.Err(), lastErr)
		case <-time.After(backoff):
		}
		if backoff < 2*time.Second {
			backoff *= 2
		}
	}
}

// Close drains and closes the connection.
func (c *Conn) Close() {
	if d := c.nc.Drain(); d != nil {
		c.nc.Close()
	}
}

// Connected reports whether the underlying connection is currently up.
func (c *Conn) Connected() bool { return c.nc.IsConnected() }

// PublishJSON marshals v and publishes it on subj.
func (c *Conn) PublishJSON(subj string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal %s: %w", subj, err)
	}
	return c.nc.Publish(subj, b)
}

// Subscribe registers handler for every message on subj (NATS wildcards
// allowed). The returned function unsubscribes. Handlers run on the NATS
// dispatcher goroutine; keep them short or hand off.
func (c *Conn) Subscribe(subj string, handler func(subj string, data []byte)) (func(), error) {
	sub, err := c.nc.Subscribe(subj, func(m *nats.Msg) {
		handler(m.Subject, m.Data)
	})
	if err != nil {
		return nil, fmt.Errorf("subscribe %s: %w", subj, err)
	}
	return func() { _ = sub.Unsubscribe() }, nil
}

// SubscribeJSON is Subscribe with the payload unmarshalled into a fresh T per
// message. Malformed payloads are dropped silently (a hostile/garbled frame on
// the bus must not crash a service).
func SubscribeJSON[T any](c *Conn, subj string, handler func(T)) (func(), error) {
	return c.Subscribe(subj, func(_ string, data []byte) {
		var v T
		if err := json.Unmarshal(data, &v); err != nil {
			return
		}
		handler(v)
	})
}

// RequestJSON sends v on subj and waits up to timeout for a reply.
func (c *Conn) RequestJSON(subj string, v any, timeout time.Duration) ([]byte, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal %s: %w", subj, err)
	}
	msg, err := c.nc.Request(subj, b, timeout)
	if err != nil {
		return nil, fmt.Errorf("request %s: %w", subj, err)
	}
	return msg.Data, nil
}

// Flush forces buffered publishes out to the server. Useful in tests to ensure
// ordering before asserting.
func (c *Conn) Flush() error { return c.nc.Flush() }

// --- KV (JetStream) ---

// KV is a handle to a JetStream key/value bucket, used to mirror the World
// Model (TECHSPEC §3, ADR-0002).
type KV struct {
	kv jetstream.KeyValue
}

// KV creates (or opens) a KV bucket by name. Idempotent: an existing bucket is
// reused, so repeated coordinator restarts don't race on bucket creation.
func (c *Conn) KV(ctx context.Context, bucket string) (*KV, error) {
	kv, err := c.js.CreateOrUpdateKeyValue(ctx, jetstream.KeyValueConfig{
		Bucket: bucket,
	})
	if err != nil {
		return nil, fmt.Errorf("kv bucket %s: %w", bucket, err)
	}
	return &KV{kv: kv}, nil
}

// PutJSON marshals v and writes it under key.
func (k *KV) PutJSON(ctx context.Context, key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = k.kv.Put(ctx, key, b)
	return err
}

// GetJSON reads key into a fresh T. Returns (zero, false, nil) if the key is
// absent.
func GetJSON[T any](ctx context.Context, k *KV, key string) (T, bool, error) {
	var v T
	entry, err := k.kv.Get(ctx, key)
	if errors.Is(err, jetstream.ErrKeyNotFound) {
		return v, false, nil
	}
	if err != nil {
		return v, false, err
	}
	if err := json.Unmarshal(entry.Value(), &v); err != nil {
		return v, false, err
	}
	return v, true, nil
}

// Keys lists every key currently in the bucket.
func (k *KV) Keys(ctx context.Context) ([]string, error) {
	keys, err := k.kv.Keys(ctx)
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return nil, nil
	}
	return keys, err
}
