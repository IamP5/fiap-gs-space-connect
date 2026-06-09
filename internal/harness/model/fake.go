package model

import (
	"context"
	"encoding/json"
	"errors"
)

type FakeModel struct {
	Responses []json.RawMessage
	Err       error

	FailFirst int

	calls int
}

var ErrTransient = errors.New("fakemodel: transient provider error")

var ErrNoMoreResponses = errors.New("fakemodel: no more scripted responses")

func (f *FakeModel) Generate(_ context.Context, _ Request) (json.RawMessage, error) {
	f.calls++
	if f.Err != nil {
		return nil, f.Err
	}
	if f.calls <= f.FailFirst {
		return nil, ErrTransient
	}
	idx := f.calls - 1 - f.FailFirst
	if idx >= len(f.Responses) {
		return nil, ErrNoMoreResponses
	}
	return f.Responses[idx], nil
}

func (f *FakeModel) Calls() int { return f.calls }
