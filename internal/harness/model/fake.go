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

	// calls counts Generate invocations so a test can assert exactly how many times
	// the seam was hit (e.g. that a repairable failure re-asks exactly once).
	calls int
}

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
	idx := f.calls - 1
	if idx >= len(f.Responses) {
		return nil, ErrNoMoreResponses
	}
	return f.Responses[idx], nil
}

// Calls reports how many times Generate has been invoked, so a contract test can
// assert the exact attempt count (initial ask, and at most one repair re-ask).
func (f *FakeModel) Calls() int { return f.calls }
