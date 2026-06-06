// Package lab is the SwarmBuild in-app LIVE generation surface (bh-07a): the
// "watch it think" demo. On an explicit operator request it runs the REAL
// Generator↔Evaluator refine loop (the Model seam, a live API call) for one
// catalog Task and STREAMS every emitted Build spec and per-iteration Evaluator
// verdict to a sink as they happen — the agent-console feed the dashboard renders.
//
// LOAD-BEARING ARCHITECTURE INVARIANT (ADR-0005): this package is on the LAB path,
// NOT the headline. It imports the Model seam + the refine loop, so — exactly like
// internal/harness/{loop,bake,vision} — it MUST stay OUT of the hot-path import
// closure (allocation/lease/world/planner/single-writer tick). The archtest
// enforces this mechanically: the lab is reached only through the gateway's
// injected LabRunner seam, which the hot path never constructs. The headline
// replay still makes ZERO live model calls (it reads the embedded cache); a lab
// run is a separate, opt-in goroutine that never touches the World Model.
package lab

import (
	"context"
	"fmt"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/bake"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/harness/loop"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/harness/trace"
	"swarmbuild/internal/wire"
	"sync"
)

// EventKind tags a streamed lab event so the console can route it.
type EventKind string

const (
	// EventStarted is emitted once when a run begins (carries the resolved contract
	// summary so the console can show what is being built).
	EventStarted EventKind = "started"
	// EventOps is one Generator pass: the ops it emitted this iteration.
	EventOps EventKind = "ops"
	// EventVerdict is the Evaluator's layered verdict for the same iteration (hard
	// gate + soft rubric + evidence), emitted right after its ops.
	EventVerdict EventKind = "verdict"
	// EventDone is the terminal event: the final disposition (accepted | fallback),
	// quality flag, and reason. Exactly one EventDone or EventError ends a stream.
	EventDone EventKind = "done"
	// EventError is the terminal event on a setup/transport failure that is not a
	// normal fallback (e.g. an unknown task type, a missing key). Ends the stream.
	EventError EventKind = "error"
)

// Event is one streamed lab-console frame. Only the fields relevant to Kind are
// populated; the rest stay zero. It is declarative JSON the browser renders — it
// is NEVER world state and never rides the snapshot path.
type Event struct {
	Kind EventKind `json:"kind"`
	Iter int       `json:"iter,omitempty"` // 1-based refine pass (ops/verdict)

	// Started fields.
	TaskID   string `json:"task_id,omitempty"`
	TaskType string `json:"task_type,omitempty"`
	Provider string `json:"provider,omitempty"`
	Model    string `json:"model,omitempty"`

	// Ops fields.
	Ops []wire.BuildOp `json:"ops,omitempty"`

	// Verdict fields.
	Verdict *evaluator.Verdict `json:"verdict,omitempty"`
	Pass    bool               `json:"pass,omitempty"`    // verdict hard-gate pass (convenience)
	Reasons []string           `json:"reasons,omitempty"` // failing hard-gate invariants
	Soft    int                `json:"soft_score,omitempty"`

	// Done fields.
	Result      trace.Result      `json:"result,omitempty"`
	QualityFlag trace.QualityFlag `json:"quality_flag,omitempty"`

	// Done/Error reason.
	Reason string `json:"reason,omitempty"`
}

// Sink receives streamed events for one run, in order. The Service calls Send on
// its own goroutine; a transport sink (SSE/WS writer) should not block long. A
// Send error (e.g. the client disconnected) aborts the run via ctx — see Run.
type Sink interface {
	Send(Event) error
}

// Request names a catalog Task to generate live. Only the type drives the demo
// contract/envelope/done; TaskID is a label for the cache key/trace.
type Request struct {
	TaskID   string `json:"task_id"`
	TaskType string `json:"task_type"`
}

// Service runs live lab generations against a constructed Model seam. It is
// stateless beyond its config; one Service handles many concurrent runs (each on
// its own goroutine driven by Run).
type Service struct {
	m        model.Model
	provider string
	modelID  string
}

// NewService builds a lab Service over an already-constructed Model seam (the
// caller — cmd/gateway — reads the API key from .env and constructs the adapter,
// so the key never reaches this package's callers or the browser). provider/
// modelID are advisory labels surfaced in the stream.
func NewService(m model.Model, provider, modelID string) *Service {
	return &Service{m: m, provider: provider, modelID: modelID}
}

// CatalogType is one selectable Task type the Lab panel offers. The web dropdown
// mirrors this list; the contract is the same DemoContract the bake path uses.
type CatalogType struct {
	Type  string `json:"type"`
	Label string `json:"label"`
}

// The dome blueprint's three Task-type names — the selectable catalog. They match
// internal/demo's blueprint contract (rovers advertise these as capabilities), so
// the same DemoContract drives a lab run and a baked headline spec.
const (
	typeFoundation = "foundation"
	typeWall       = "wall"
	typeDomeCap    = "dome-cap"
)

// Catalog is the fixed set of demo Task types a lab run can target (the dome
// blueprint's three kinds). It is data the gateway serves to the Lab panel so the
// dropdown and the backend agree on valid inputs.
func Catalog() []CatalogType {
	return []CatalogType{
		{Type: typeFoundation, Label: "Foundation (plinth)"},
		{Type: typeWall, Label: "Wall segment"},
		{Type: typeDomeCap, Label: "Dome cap (keystone)"},
	}
}

// streamObserver adapts the loop's per-iteration Observer hook into ops + verdict
// events on the sink. It records the first send error so Run can surface it.
type streamObserver struct {
	sink Sink
	mu   sync.Mutex
	err  error
}

func (o *streamObserver) OnIteration(iter int, ops []wire.BuildOp, v evaluator.Verdict) {
	if e := o.sink.Send(Event{Kind: EventOps, Iter: iter, Ops: ops}); e != nil {
		o.record(e)
		return
	}
	vv := v
	if e := o.sink.Send(Event{
		Kind:    EventVerdict,
		Iter:    iter,
		Verdict: &vv,
		Pass:    v.Pass(),
		Reasons: v.Reasons(),
		Soft:    v.SoftScore(),
	}); e != nil {
		o.record(e)
	}
}

func (o *streamObserver) record(e error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.err == nil {
		o.err = e
	}
}

func (o *streamObserver) sendErr() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.err
}

// Run executes ONE live generation for req and streams its events to sink, in
// order: a single EventStarted, then per refine pass an EventOps + EventVerdict,
// then a terminal EventDone (accepted | fallback) — or a single EventError if the
// contract could not even be built. It returns when the run finishes or ctx is
// cancelled (e.g. the client disconnected); the returned error is non-nil only on
// a sink/transport failure, NOT on a normal fallback (a fallback is a successful
// EventDone). It makes a LIVE model call and so must only be reached off the hot
// path (ADR-0005).
func (s *Service) Run(ctx context.Context, req Request, sink Sink) error {
	taskType := domain.TaskType(req.TaskType)
	taskID := req.TaskID
	if taskID == "" {
		taskID = req.TaskType + "-lab"
	}

	contract, err := bake.DemoContract(domain.TaskID(taskID), taskType)
	if err != nil {
		return sink.Send(Event{Kind: EventError, Reason: fmt.Sprintf("unknown task type %q", req.TaskType)})
	}

	if e := sink.Send(Event{
		Kind:     EventStarted,
		TaskID:   taskID,
		TaskType: req.TaskType,
		Provider: s.provider,
		Model:    s.modelID,
	}); e != nil {
		return e
	}

	contractJSON, err := contract.JSON()
	if err != nil {
		return sink.Send(Event{Kind: EventError, Reason: err.Error()})
	}
	world := bake.WorldContext{Note: "live lab generation: build in the Task envelope frame"}
	messages, err := bake.BuildPrompt(contract, contractJSON, world)
	if err != nil {
		return sink.Send(Event{Kind: EventError, Reason: err.Error()})
	}

	obs := &streamObserver{sink: sink}
	eval := evaluator.New(evaluator.Config{})
	out := loop.Run(ctx, loop.ModelGenerator{M: s.m}, eval, loop.Request{
		Messages:      messages,
		Envelope:      contract.EvalEnvelope(),
		Done:          contract.EvalDone(),
		SubjectOrigin: world.SubjectOrigin,
		Neighbours:    world.Neighbours,
		TaskType:      string(contract.Type),
		Observer:      obs,
	})

	// A sink error during streaming (client gone) is terminal — don't try to write
	// the done frame onto a dead transport.
	if e := obs.sendErr(); e != nil {
		return e
	}

	return sink.Send(Event{
		Kind:        EventDone,
		Result:      out.Result,
		QualityFlag: out.QualityFlag,
		Reason:      out.Reason,
	})
}
