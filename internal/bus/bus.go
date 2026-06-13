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

type Conn struct {
	nc *nats.Conn
	js jetstream.JetStream
}

func (c *Conn) Raw() *nats.Conn { return c.nc }

type ConnectOptions struct {
	Name    string
	MaxWait time.Duration
	Backoff time.Duration
}

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
			nats.MaxReconnects(-1),
			nats.ReconnectWait(time.Second),
			nats.RetryOnFailedConnect(false),
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
			return nil, fmt.Errorf("connect %s: %w (last: %w)", url, ctx.Err(), lastErr)
		case <-time.After(backoff):
		}
		if backoff < 2*time.Second {
			backoff *= 2
		}
	}
}

func (c *Conn) Close() {
	if d := c.nc.Drain(); d != nil {
		c.nc.Close()
	}
}

func (c *Conn) Connected() bool { return c.nc.IsConnected() }

func (c *Conn) PublishJSON(subj string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal %s: %w", subj, err)
	}
	return c.nc.Publish(subj, b)
}

func (c *Conn) Subscribe(subj string, handler func(subj string, data []byte)) (func(), error) {
	sub, err := c.nc.Subscribe(subj, func(m *nats.Msg) {
		handler(m.Subject, m.Data)
	})
	if err != nil {
		return nil, fmt.Errorf("subscribe %s: %w", subj, err)
	}
	return func() { _ = sub.Unsubscribe() }, nil
}

func SubscribeJSON[T any](c *Conn, subj string, handler func(T)) (func(), error) {
	return c.Subscribe(subj, func(_ string, data []byte) {
		var v T
		if err := json.Unmarshal(data, &v); err != nil {
			return
		}
		handler(v)
	})
}

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

func (c *Conn) Flush() error { return c.nc.Flush() }

type KV struct {
	kv jetstream.KeyValue
}

func (c *Conn) KV(ctx context.Context, bucket string) (*KV, error) {
	kv, err := c.js.CreateOrUpdateKeyValue(ctx, jetstream.KeyValueConfig{
		Bucket: bucket,
	})
	if err != nil {
		return nil, fmt.Errorf("kv bucket %s: %w", bucket, err)
	}
	return &KV{kv: kv}, nil
}

func (k *KV) PutJSON(ctx context.Context, key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = k.kv.Put(ctx, key, b)
	return err
}

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

func (k *KV) Keys(ctx context.Context) ([]string, error) {
	keys, err := k.kv.Keys(ctx)
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return nil, nil
	}
	return keys, err
}
