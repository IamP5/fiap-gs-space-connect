package model

import (
	"context"
	"encoding/json"
	"errors"
)

// FakeModel is a deterministic, NO-NETWORK Model used by the contract test (and
// any offline dry-run). It returns a scripted sequence of raw JSON responses, one
// per Generate call, so a test can stage exactly the provider behaviour it wants:
// a valid spec on the first call, an invalid-then-valid pair to exercise
// validate-and-repair, or invalid-then-invalid to drive the fallback-on-exhaustion
// path. It makes the unit suite hermetic — GenerateSpec's orchestration is proven
// without ever touching api.openai.com (TECHSPEC §8: live calls excluded from
// `go test`).
type FakeModel struct {
	// Responses is the canned raw JSON returned on successive Generate calls. Each
	// call pops the next entry; running past the end returns ErrNoMoreResponses.
	Responses []json.RawMessage
	// Err, if non-nil, is returned by EVERY Generate call instead of a response —
	// to simulate a transport/provider error (e.g. timeout) that GenerateSpec must
	// treat as immediate fallback.
	Err error

	// FailFirst, if > 0, makes the first FailFirst Generate calls return
	// ErrTransient (a TRANSIENT provider error) before the fake reverts to serving
	// Responses. It models a blip that a bounded per-call retry should ride out
	// (bh-08f): a test can stage "fail twice, then succeed" and assert the retry
	// recovered. It composes with Responses (the post-blip calls pop them in order);
	// it is ignored when Err is set (Err fails EVERY call unconditionally).
	FailFirst int

	// calls counts Generate invocations so a test can assert exactly how many times
	// the seam was hit (e.g. that a repairable failure re-asks exactly once).
	calls int
}

// ErrTransient is the canned TRANSIENT provider error the fake returns for the first
// FailFirst calls — a blip the harness's bounded per-call retry (bh-08f) should ride
// out, distinct from the unconditional, every-call Err.
var ErrTransient = errors.New("fakemodel: transient provider error")

// ErrNoMoreResponses is returned when Generate is called more times than the
// FakeModel has scripted responses — a test-author error (the orchestration asked
// for more attempts than were staged).
var ErrNoMoreResponses = errors.New("fakemodel: no more scripted responses")

// Generate returns the next scripted response (or the configured Err). The
// incoming Request is ignored beyond advancing the call counter; the fake proves
// the seam contract, not provider wire behaviour.
func (f *FakeModel) Generate(_ context.Context, _ Request) (json.RawMessage, error) {
	f.calls++
	if f.Err != nil {
		return nil, f.Err
	}
	if f.calls <= f.FailFirst {
		return nil, ErrTransient // a transient blip a bounded retry should ride out (bh-08f)
	}
	// Pop the next scripted response, indexed PAST the transient-failure prefix so the
	// first real response is served on the first non-failing call.
	idx := f.calls - 1 - f.FailFirst
	if idx >= len(f.Responses) {
		return nil, ErrNoMoreResponses
	}
	return f.Responses[idx], nil
}

// Calls reports how many times Generate has been invoked, so a contract test can
// assert the exact attempt count (initial ask, and at most one repair re-ask).
func (f *FakeModel) Calls() int { return f.calls }
