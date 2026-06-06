// Package live is the SwarmBuild Live Build Mode harness adapter (bh-08): the
// model-backed implementation of agent.LiveBuilder. On a Rover's work phase (in
// live mode only) it builds the Build contract + world snapshot for the Task,
// runs the REAL Generator↔Evaluator refine loop via the Model seam, and returns
// the accepted Build spec ops for the Rover to stream on build.op.<task>.
//
// LOAD-BEARING ARCHITECTURE INVARIANT (ADR-0005, scoped break in live mode): this
// package imports the Model seam + the refine loop, so — like
// internal/harness/{loop,bake,vision,lab} — it MUST stay OUT of the hot-path
// import closure (allocation/lease/world/planner/single-writer tick AND the
// coordinator). The Rover reaches it ONLY through the injected agent.LiveBuilder
// seam, which the agent package itself never constructs and never imports — so the
// coordinator (which imports agent) keeps the Model seam off its import graph. The
// composition root (cmd/agent) constructs this Builder and injects it. The
// archtest enforces the boundary mechanically.
//
// First cut (bh-08b) emits a single accepted spec (place-only ops). Per-iteration
// patch streaming is a later slice (08d); failure-heal/retry is 08f. On loop
// exhaustion BuildLive returns ok=false so the Rover degrades to its deterministic
// replay/primitive stream — a model fault never crashes the swarm.
package live

import (
	"context"
	"log/slog"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/bake"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/harness/loop"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/wire"
)

// Generator is the refine-loop seam the Builder drives. It matches loop.Generator
// so production wires loop.ModelGenerator{M: model.Model} and tests inject a fake
// with no network. Kept as a field so the Builder constructs no provider itself.
type Generator = loop.Generator

// Builder is the model-backed agent.LiveBuilder: it runs the Build harness inline
// for a Rover's Task. It is stateless beyond its generator + labels; one Builder
// serves every Task a Rover works in live mode.
type Builder struct {
	gen      Generator
	provider string
	modelID  string
}

// NewBuilder wraps an already-constructed Model seam in a live Builder. The caller
// (cmd/agent) reads the API key from the environment and constructs the adapter,
// so the key never reaches this package's callers or the browser. provider/modelID
// are advisory labels for logs.
func NewBuilder(m model.Model, provider, modelID string) *Builder {
	return &Builder{
		gen:      loop.ModelGenerator{M: m},
		provider: provider,
		modelID:  modelID,
	}
}

// NewBuilderWithGenerator builds a Builder over an explicit Generator seam, so the
// contract test can drive the real loop+evaluator with a fake Model (no network).
func NewBuilderWithGenerator(gen Generator, provider, modelID string) *Builder {
	return &Builder{gen: gen, provider: provider, modelID: modelID}
}

// BuildLive runs the Generator↔Evaluator refine loop for one Task and returns the
// accepted Build spec ops (ok=true) — the inline-generation work phase. It returns
// ok=false on loop exhaustion (no hard-gate-passing spec), an unbuildable contract
// (e.g. an unknown task type), or an empty accepted spec, so the Rover degrades to
// its deterministic replay/primitive stream and the Task still completes (ADR-0005
// fallback; failure-heal is slice 08f). It makes a LIVE model call and so must run
// ONLY off the hot path, reached through the injected agent.LiveBuilder seam.
func (b *Builder) BuildLive(ctx context.Context, task domain.TaskID, taskType domain.TaskType) ([]wire.BuildOp, bool) {
	contract, err := bake.DemoContract(task, taskType)
	if err != nil {
		slog.Warn("live build: no contract for task", "task", task, "type", taskType, "error", err)
		return nil, false
	}

	contractJSON, err := contract.JSON()
	if err != nil {
		slog.Warn("live build: contract marshal failed", "task", task, "error", err)
		return nil, false
	}

	world := bake.WorldContext{Note: "live build mode: rover builds inline in the Task envelope frame"}
	messages, err := bake.BuildPrompt(contract, contractJSON, world)
	if err != nil {
		slog.Warn("live build: prompt build failed", "task", task, "error", err)
		return nil, false
	}

	eval := evaluator.New(evaluator.Config{})
	out := loop.Run(ctx, b.gen, eval, loop.Request{
		Messages:      messages,
		Envelope:      contract.EvalEnvelope(),
		Done:          contract.EvalDone(),
		SubjectOrigin: world.SubjectOrigin,
		Neighbours:    world.Neighbours,
		TaskType:      string(contract.Type),
	})

	if !out.Accepted() || len(out.Ops) == 0 {
		slog.Warn("live build exhausted: degrading to replay/primitive",
			"task", task, "type", taskType, "reason", out.Reason)
		return nil, false
	}
	return out.Ops, true
}
