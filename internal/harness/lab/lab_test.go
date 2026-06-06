package lab

import (
	"context"
	"encoding/json"
	"errors"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/harness/trace"
	"testing"
)

// captureSink records every streamed event in order, so a test can assert the
// shape of the "watch it think" feed without a network or a browser.
type captureSink struct {
	events []Event
	// failAt, when > 0, makes the failAt-th Send return an error (simulating a
	// client disconnecting mid-stream), so a test can prove the run aborts.
	failAt int
	calls  int
}

func (c *captureSink) Send(e Event) error {
	c.calls++
	if c.failAt > 0 && c.calls == c.failAt {
		return errors.New("client gone")
	}
	c.events = append(c.events, e)
	return nil
}

func (c *captureSink) kinds() []EventKind {
	out := make([]EventKind, len(c.events))
	for i, e := range c.events {
		out[i] = e.Kind
	}
	return out
}

// validFoundationSpec is a strict-output envelope a FakeModel returns: a 4-op
// plinth (multi-shape, grounded, in the foundation envelope) that passes the hard
// gate and clears the soft threshold, so the loop accepts it on the first pass.
const validFoundationSpec = `{"ops":[
  {"op":"place","shape":"box","pos":{"X":0,"Y":-1.0,"Z":0},"rot":{"X":0,"Y":0,"Z":0},"scale":{"X":2.4,"Y":0.3,"Z":2.4},"material":{"color":"#cfcfd6"}},
  {"op":"place","shape":"cylinder","pos":{"X":-0.7,"Y":-0.2,"Z":0},"rot":{"X":0,"Y":0,"Z":0},"scale":{"X":0.3,"Y":1.0,"Z":0.3},"material":{"color":"#c0c0c0"}},
  {"op":"place","shape":"cylinder","pos":{"X":0.7,"Y":-0.2,"Z":0},"rot":{"X":0,"Y":0,"Z":0},"scale":{"X":0.3,"Y":1.0,"Z":0.3},"material":{"color":"#c0c0c0"}},
  {"op":"place","shape":"sphere","pos":{"X":0,"Y":0.7,"Z":0},"rot":{"X":0,"Y":0,"Z":0},"scale":{"X":0.5,"Y":0.4,"Z":0.5},"material":{"color":"#808080"}}
]}`

// runFoundation drives one accepted foundation generation and returns the sink.
func runFoundation(t *testing.T) *captureSink {
	t.Helper()
	svc := NewService(&model.FakeModel{Responses: []json.RawMessage{json.RawMessage(validFoundationSpec)}}, "fake", "fake-model")
	sink := &captureSink{}
	if err := svc.Run(context.Background(), Request{TaskType: typeFoundation}, sink); err != nil {
		t.Fatalf("Run: unexpected error: %v", err)
	}
	return sink
}

func TestService_Run_StreamsInOrder(t *testing.T) {
	sink := runFoundation(t)
	got := sink.kinds()
	want := []EventKind{EventStarted, EventOps, EventVerdict, EventDone}
	if len(got) != len(want) {
		t.Fatalf("event kinds = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("event[%d] = %q, want %q (full: %v)", i, got[i], want[i], got)
		}
	}
}

func TestService_Run_StartedAndOpsFrames(t *testing.T) {
	sink := runFoundation(t)
	started := sink.events[0]
	if started.TaskType != typeFoundation || started.Provider != "fake" || started.Model != "fake-model" {
		t.Fatalf("started event mismatch: %+v", started)
	}
	ops := sink.events[1]
	if len(ops.Ops) != 4 {
		t.Fatalf("ops event carried %d ops, want 4", len(ops.Ops))
	}
	if ops.Iter != 1 {
		t.Fatalf("ops iter = %d, want 1", ops.Iter)
	}
}

func TestService_Run_VerdictAndDoneFrames(t *testing.T) {
	sink := runFoundation(t)
	verdict := sink.events[2]
	if verdict.Verdict == nil {
		t.Fatal("verdict event has nil verdict")
	}
	if !verdict.Pass {
		t.Fatalf("expected a passing verdict, got reasons %v", verdict.Reasons)
	}
	if verdict.Soft != verdict.Verdict.SoftScore() {
		t.Fatalf("verdict soft convenience %d != verdict.SoftScore() %d", verdict.Soft, verdict.Verdict.SoftScore())
	}
	done := sink.events[3]
	if done.Result != trace.ResultAccepted {
		t.Fatalf("done result = %q, want %q", done.Result, trace.ResultAccepted)
	}
	if done.QualityFlag != trace.QualityOK {
		t.Fatalf("done quality = %q, want %q (reason: %s)", done.QualityFlag, trace.QualityOK, done.Reason)
	}
}

func TestService_Run_UnknownTaskTypeStreamsError(t *testing.T) {
	svc := NewService(&model.FakeModel{}, "fake", "fake-model")
	sink := &captureSink{}

	if err := svc.Run(context.Background(), Request{TaskType: "nonsense"}, sink); err != nil {
		t.Fatalf("Run: unexpected transport error: %v", err)
	}
	if got := sink.kinds(); len(got) != 1 || got[0] != EventError {
		t.Fatalf("event kinds = %v, want a single error event", got)
	}
}

func TestService_Run_FallbackOnExhaustionIsADoneEvent(t *testing.T) {
	// A provider transport error on every call drives loop exhaustion → fallback;
	// the lab reports it as a DONE event (result=fallback), not a hard error.
	svc := NewService(&model.FakeModel{Err: errors.New("provider down")}, "fake", "fake-model")
	sink := &captureSink{}

	if err := svc.Run(context.Background(), Request{TaskType: typeWall}, sink); err != nil {
		t.Fatalf("Run: unexpected transport error: %v", err)
	}
	// started → done(fallback); no ops/verdict because generation never succeeded.
	got := sink.kinds()
	if len(got) != 2 || got[0] != EventStarted || got[1] != EventDone {
		t.Fatalf("event kinds = %v, want [started done]", got)
	}
	if sink.events[1].Result != trace.ResultFallback {
		t.Fatalf("done result = %q, want %q", sink.events[1].Result, trace.ResultFallback)
	}
}

func TestService_Run_AbortsWhenSinkFails(t *testing.T) {
	svc := NewService(&model.FakeModel{Responses: []json.RawMessage{json.RawMessage(validFoundationSpec)}}, "fake", "fake-model")
	// Fail on the very first Send (the started frame): the run must surface the error.
	sink := &captureSink{failAt: 1}

	if err := svc.Run(context.Background(), Request{TaskType: typeFoundation}, sink); err == nil {
		t.Fatal("expected a sink error to propagate, got nil")
	}
}

func TestCatalog_CoversDomeTypes(t *testing.T) {
	got := map[string]bool{}
	for _, c := range Catalog() {
		got[c.Type] = true
	}
	for _, want := range []string{typeFoundation, typeWall, typeDomeCap} {
		if !got[want] {
			t.Fatalf("catalog missing %q (have %v)", want, got)
		}
	}
}
