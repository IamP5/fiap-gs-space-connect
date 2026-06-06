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
// bh-08d evolves this from "emit a single accepted spec once" to STREAMING each
// accepted/revised refine iteration as patch ops: BuildLive takes an emit callback
// that the refine loop drives once per hard-gate-passing pass, and this package
// DIFFS each iteration against the last to produce place/move/delete patches (08a op
// identity) so the world visibly grows and self-corrects between passes. The Rover
// paces the emitted ops onto build.op.<task> by the Choreography cadence. On loop
// exhaustion BuildLive returns ok=false (nothing emitted).
//
// bh-08f routes a MODEL FAILURE through self-heal instead of around it. The refine
// loop now RETRIES a failed/invalid/timed-out model call a bounded number of times
// per call (loop.Request.RetriesPerCall) before treating it as failed. When the loop
// still falls back BECAUSE the model would not produce a spec (a transport error or
// exhausted validate-and-repair, distinct from the Evaluator's gate never passing),
// BuildLiveResult reports ModelFailed=true so the Rover can count it toward its
// per-Rover failure-death threshold and DIE (release its lease / stop heartbeating),
// letting the existing expiry → re-auction path reassign the Task — no primitive
// fallback on this path (the circuit-breaker is 08g). BuildLive keeps its ok-only
// signature; BuildLiveResult is the additive richer surface.
package live

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/bake"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/harness/loop"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/harness/spec"
	"swarmbuild/internal/wire"
)

// Generator is the refine-loop seam the Builder drives. It matches loop.Generator
// so production wires loop.ModelGenerator{M: model.Model} and tests inject a fake
// with no network. Kept as a field so the Builder constructs no provider itself.
type Generator = loop.Generator

// liveMaxIterations is the refine-pass cap for LIVE builds (bh-08): higher than the
// headline/bake default (loop.MaxIterations) so a stubborn generation gets many more
// attempts to land a hard-gate-passing spec — the world keeps visibly self-correcting
// (08d) — before degrading to the primitive fallback. Costs up to this many model
// calls per Task, so it is the live path only; bake/lab keep the lean default.
const liveMaxIterations = 30

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

// Result is the richer outcome of one live build (bh-08f), surfaced by
// BuildLiveResult. OK mirrors BuildLive's boolean (true once at least one iteration
// was emitted). ModelFailed reports that a false OK was caused by the MODEL failing
// to produce a spec — a transport error/timeout or exhausted validate-and-repair,
// surviving the loop's bounded retry — as opposed to an unbuildable contract or the
// Evaluator's gate never passing on otherwise-valid specs. The Rover counts a
// ModelFailed result toward its per-Rover failure-death threshold (an LLM that won't
// cooperate becomes just another dead robot); a non-model fall-back is a quality miss
// it can simply degrade on. ModelFailed is always false when OK is true.
type Result struct {
	OK          bool
	ModelFailed bool
}

// BuildLive runs the Generator↔Evaluator refine loop for one Task and STREAMS each
// accepted/revised iteration to emit as a batch of patch ops, AS the loop produces
// it (bh-08d). emit is called once per hard-gate-passing refine pass with that
// iteration's patch batch — place ops for the first accepted spec, then move/delete/
// place patches that turn the previously-emitted geometry into this pass's geometry
// (08a op identity), so the Rover, pacing them onto build.op.<task>, makes the world
// visibly grow and self-correct between passes. Each batch is a defensive copy emit
// may retain; emit runs ON the loop goroutine, so the Rover's emit hands off promptly.
//
// It returns ok=true once at least one iteration has been emitted, ok=false on loop
// exhaustion (no hard-gate-passing spec), an unbuildable contract (e.g. an unknown
// task type), or an empty accepted spec. It makes a LIVE model call and so must run
// ONLY off the hot path, reached through the injected agent.LiveBuilder seam. It is
// the ok-only facade over BuildLiveResult, kept stable for callers that do not need
// the model-failure signal. priorOps seeds a RESUME (bh-08e): empty on a fresh Task,
// the durable patch log when this Builder continues a Task interrupted mid-build.
func (b *Builder) BuildLive(ctx context.Context, task domain.TaskID, taskType domain.TaskType, priorOps []wire.BuildOp, emit func(iterationOps []wire.BuildOp)) bool {
	return b.BuildLiveResult(ctx, task, taskType, priorOps, emit).OK
}

// BuildLiveFault is the two-boolean facade over BuildLiveResult that the agent's
// optional liveFaultReporter seam matches structurally (bh-08f). It returns the same
// (OK, ModelFailed) as plain booleans so the agent can prefer it WITHOUT importing
// this package's Result type (which would pull the Model seam onto the agent's import
// graph and break the archtest). ok=true ⇒ at least one iteration emitted;
// modelFailed=true ⇒ a false ok was caused by the model failing to produce a spec.
// priorOps seeds a resume (bh-08e), exactly as BuildLive.
func (b *Builder) BuildLiveFault(ctx context.Context, task domain.TaskID, taskType domain.TaskType, priorOps []wire.BuildOp, emit func(iterationOps []wire.BuildOp)) (ok, modelFailed bool) {
	r := b.BuildLiveResult(ctx, task, taskType, priorOps, emit)
	return r.OK, r.ModelFailed
}

// BuildLiveResult is BuildLive plus the bh-08f model-failure signal: it runs the same
// refine loop (now with a bounded per-call retry, loop.DefaultRetriesPerCall) and
// returns a Result whose ModelFailed distinguishes a model fault (route through
// self-heal: the Rover counts it toward its death threshold) from an unbuildable
// contract or a gate exhaustion (degrade). priorOps seeds a RESUME (bh-08e): the
// folded prior geometry seeds both the prompt and the streamer so the loop continues
// the half-built structure. emit/streaming behaviour is identical to BuildLive's.
func (b *Builder) BuildLiveResult(ctx context.Context, task domain.TaskID, taskType domain.TaskType, priorOps []wire.BuildOp, emit func(iterationOps []wire.BuildOp)) Result {
	contract, err := bake.DemoContract(task, taskType)
	if err != nil {
		slog.Warn("live build: no contract for task", "task", task, "type", taskType, "error", err)
		return Result{} // unbuildable contract: not a model fault, just degrade
	}

	contractJSON, err := contract.JSON()
	if err != nil {
		slog.Warn("live build: contract marshal failed", "task", task, "error", err)
		return Result{}
	}

	// RESUME SEED (bh-08e): fold the Task's prior durable patch log to its current
	// geometry. On a re-auction of a Task whose predecessor was killed/expired
	// mid-live-build, this is the half-built structure; the loop continues from it
	// rather than restarting. Empty/nil on a fresh Task. A malformed prior log (it was
	// schema-validated before it was ever appended, so this is defensive) degrades to a
	// clean start rather than aborting the build.
	priorGeom := foldPrior(task, priorOps)

	world := bake.WorldContext{Note: resumeNote(len(priorGeom))}
	messages, err := bake.BuildPrompt(contract, contractJSON, world)
	if err != nil {
		slog.Warn("live build: prompt build failed", "task", task, "error", err)
		return Result{}
	}
	// When resuming, append the folded prior geometry to the prompt so the Generator
	// EXTENDS/REFINES the half-built structure rather than authoring a fresh one.
	messages = seedResume(messages, priorGeom)

	// streamer diffs each accepted iteration against the last and turns it into a
	// patch batch (place/move/delete) on stable per-slot ids, so successive passes
	// move/recolour/remove pieces IN PLACE rather than re-placing the whole world.
	// On a resume it is SEEDED with the prior geometry as its starting `prev`, so the
	// first accepted iteration diffs against the half-built structure and streams only
	// the patches that GROW it onward — the durable prior ops are never re-placed.
	stream := &streamer{emit: emit}
	stream.seedPrev(priorGeom)

	eval := evaluator.New(evaluator.Config{})
	out := loop.Run(ctx, b.gen, eval, loop.Request{
		Messages:       messages,
		Envelope:       contract.EvalEnvelope(),
		Done:           contract.EvalDone(),
		SubjectOrigin:  world.SubjectOrigin,
		Neighbours:     world.Neighbours,
		TaskType:       string(contract.Type),
		RetriesPerCall: loop.DefaultRetriesPerCall, // bh-08f: a transient blip retries before counting as a fault
		MaxIterations:  liveMaxIterations,          // bh-08: many refine attempts before the primitive fallback
		EmitAccepted:   stream.onIteration,
	})

	// The loop keeps the BEST passing spec, which may differ from the LAST emitted
	// iteration (a later pass can score lower). Reconcile the streamed geometry to
	// the accepted Outcome so the durable patch log folds to exactly what the loop
	// chose to cache — the same spec a non-streaming bake would accept.
	if out.Accepted() && len(out.Ops) > 0 {
		stream.reconcile(out.Ops)
	}

	if stream.emitted == 0 {
		// Nothing emitted. A MODEL failure (out.ModelFailed) routes through self-heal —
		// the Rover counts it toward its death threshold (bh-08f); a gate exhaustion or
		// empty spec is a quality miss the Rover degrades on.
		slog.Warn("live build produced no ops",
			"task", task, "type", taskType, "reason", out.Reason, "model_failed", out.ModelFailed())
		return Result{ModelFailed: out.ModelFailed()}
	}
	return Result{OK: true}
}

// foldPrior reduces a Task's prior durable patch log to its current geometry
// (bh-08e resume seed). The log was schema-validated op-by-op before it was ever
// appended (the coordinator validates the folded candidate per op), so a fold error
// here is not expected; it is handled defensively by logging and returning nil, so a
// corrupt/odd log degrades the build to a clean start rather than aborting it. An
// empty/nil log yields nil — a fresh start, byte-identical to the pre-08e path.
func foldPrior(task domain.TaskID, priorOps []wire.BuildOp) []wire.BuildOp {
	if len(priorOps) == 0 {
		return nil
	}
	geom, err := spec.Fold(priorOps)
	if err != nil {
		slog.Warn("live resume: prior patch log did not fold; starting clean",
			"task", task, "ops", len(priorOps), "error", err)
		return nil
	}
	return geom
}

// resumeNote is the world-context note handed to the prompt: a plain inline build
// for a fresh Task, or a RESUME note when there is folded prior geometry, so the log
// records whether this build picked up a half-built structure (bh-08e).
func resumeNote(priorPieces int) string {
	if priorPieces == 0 {
		return "live build mode: rover builds inline in the Task envelope frame"
	}
	return fmt.Sprintf("live build mode (RESUME): a prior rover was interrupted mid-build; "+
		"%d piece(s) are already in place (listed below). Continue from the half-built structure, "+
		"extending/refining it into the complete structure — do not restart from scratch.", priorPieces)
}

// seedResume appends the folded prior geometry to the prompt as an extra user
// message so the Generator EXTENDS the half-built structure rather than authoring a
// fresh one (bh-08e). The streamer still diffs each accepted iteration against the
// seeded prior geometry, so even if the Generator re-emits an identical prior piece
// no redundant op is streamed; the prompt seed simply biases it toward continuation.
// No prior geometry ⇒ the messages are returned unchanged (the fresh-start path).
func seedResume(messages []model.Message, priorGeom []wire.BuildOp) []model.Message {
	if len(priorGeom) == 0 {
		return messages
	}
	priorJSON, err := json.Marshal(struct {
		Ops []wire.BuildOp `json:"ops"`
	}{Ops: priorGeom})
	if err != nil {
		// A marshal failure on already-validated geometry is not expected; fall back to
		// the un-seeded prompt (the streamer's seeded prev still keeps the stream
		// correct — the seed only biases the Generator).
		return messages
	}
	seed := model.Message{
		Role: "user",
		Content: "The structure is ALREADY PARTIALLY BUILT. These pieces exist " +
			"(in the same envelope-relative coordinates you must use); continue the build by " +
			"returning the COMPLETE intended structure that extends/refines them:\n" + string(priorJSON),
	}
	return append(append(make([]model.Message, 0, len(messages)+1), messages...), seed)
}

// streamer turns the refine loop's per-iteration accepted specs into an append-only
// patch log: the FIRST accepted spec is emitted as place ops (stable per-slot ids);
// each later spec is diffed against the previous one into move/delete/place patches,
// so the renderer's fold updates pieces IN PLACE between passes (bh-08d, 08a fold).
// It is not goroutine-safe: the loop drives onIteration serially on its own goroutine.
type streamer struct {
	emit    func(ops []wire.BuildOp)
	prev    []wire.BuildOp // last folded geometry we've streamed, keyed by slot id
	emitted int            // number of iterations streamed (the ok signal)
}

// slotID is the stable key for the i-th piece across iterations. Diffing on slot
// index lets a later pass MOVE/RECOLOUR the same piece instead of re-placing it.
func slotID(i int) string { return fmt.Sprintf("p%d", i) }

// seedPrev primes the streamer's starting geometry from a Task's already-streamed,
// folded patch log so a RESUMING builder (bh-08e) diffs its first accepted iteration
// against the half-built structure and emits only the patches that GROW it onward —
// the durable prior ops are NEVER re-placed. The seeded slots are re-keyed by index
// (slotID(i)) to match exactly what diff emits, which is also what the predecessor's
// streamer streamed: each iteration re-keys every slot by index and only ever
// deletes the tail, so a folded durable log is contiguously keyed p0..p(k-1). That
// index alignment is what keeps the renderer fold updating the right piece in place
// across the kill→replacement handoff. An empty/nil log is a no-op (a fresh start).
func (s *streamer) seedPrev(priorGeom []wire.BuildOp) {
	if len(priorGeom) == 0 {
		return
	}
	prev := make([]wire.BuildOp, len(priorGeom))
	for i := range priorGeom {
		prev[i] = priorGeom[i]
		prev[i].Op = wire.BuildOpPlace
		prev[i].ID = slotID(i)
	}
	s.prev = prev
}

// onIteration streams one accepted iteration. The first becomes place ops; later
// iterations become a diff patch against the previously-streamed geometry.
func (s *streamer) onIteration(_ int, ops []wire.BuildOp) {
	patch := s.diff(ops)
	if len(patch) == 0 {
		return // identical to the last iteration: nothing to stream
	}
	s.emit(patch)
	s.emitted++
}

// reconcile emits a final patch so the streamed geometry matches the loop's chosen
// best spec (which may be an EARLIER iteration than the last). If the last streamed
// iteration already equals it, diff yields no ops and nothing extra is streamed.
func (s *streamer) reconcile(best []wire.BuildOp) {
	patch := s.diff(best)
	if len(patch) == 0 {
		return
	}
	s.emit(patch)
	s.emitted++
}

// diff computes the patch ops that turn the previously-streamed geometry (s.prev)
// into next, on stable per-slot ids, and advances s.prev. The Generator emits
// place-only, transform-bearing ops; we key them by slot index:
//
//   - new slot (next longer than prev): a place.
//   - existing slot with a changed shape: delete + place (a shape change can't be a
//     move; move only carries pos/rot/scale, 08a).
//   - existing slot with same shape but changed transform/material: a place
//     overwrite (last-write-wins on the id) — the simplest patch the fold honours.
//   - dropped slot (prev longer than next): a delete.
//
// A slot identical across iterations yields no op, so an unchanged piece does not
// re-stream. The returned ops carry the slot id so the fold updates in place.
func (s *streamer) diff(next []wire.BuildOp) []wire.BuildOp {
	var patch []wire.BuildOp
	for i := range next {
		op := next[i]
		op.ID = slotID(i)
		if i >= len(s.prev) {
			op.Op = wire.BuildOpPlace
			patch = append(patch, op)
			continue
		}
		if opEqual(s.prev[i], op) {
			continue // unchanged piece: no patch
		}
		if s.prev[i].Shape != op.Shape {
			// A shape change is delete + re-place (move carries only the transform).
			patch = append(patch, wire.BuildOp{Op: wire.BuildOpDelete, ID: op.ID})
			op.Op = wire.BuildOpPlace
			patch = append(patch, op)
			continue
		}
		if transformEqual(s.prev[i], op) {
			// Same shape + transform, only material changed: re-place to recolour.
			op.Op = wire.BuildOpPlace
			patch = append(patch, op)
			continue
		}
		// Same shape, moved (and possibly recoloured): a move updates the transform,
		// then a place overwrites if the material also changed.
		patch = append(patch, wire.BuildOp{Op: wire.BuildOpMove, ID: op.ID, Pos: op.Pos, Rot: op.Rot, Scale: op.Scale})
		if !materialEqual(s.prev[i].Material, op.Material) {
			op.Op = wire.BuildOpPlace
			patch = append(patch, op)
		}
	}
	// Slots that vanished in the new spec are deleted (highest index first so a
	// fold never references a slot that a later delete in the same batch removed).
	for i := len(next); i < len(s.prev); i++ {
		patch = append(patch, wire.BuildOp{Op: wire.BuildOpDelete, ID: slotID(i)})
	}

	// Advance s.prev to the new geometry as place ops (the canonical slot state).
	prev := make([]wire.BuildOp, len(next))
	for i := range next {
		prev[i] = next[i]
		prev[i].Op = wire.BuildOpPlace
		prev[i].ID = slotID(i)
	}
	s.prev = prev
	return patch
}

// opEqual reports whether two ops describe the same rendered piece (shape +
// transform + material). Op/ID are ignored — the slot id is assigned by the differ.
func opEqual(a, b wire.BuildOp) bool {
	return a.Shape == b.Shape && transformEqual(a, b) && materialEqual(a.Material, b.Material)
}

func transformEqual(a, b wire.BuildOp) bool {
	return a.Pos == b.Pos && a.Rot == b.Rot && a.Scale == b.Scale
}

// materialEqual compares two materials including the optional *float64 PBR fields by
// value (nil ⇄ set is a difference; both nil is equal).
func materialEqual(a, b wire.Material) bool {
	return a.Color == b.Color && a.Map == b.Map &&
		floatPtrEqual(a.Roughness, b.Roughness) && floatPtrEqual(a.Metalness, b.Metalness)
}

func floatPtrEqual(a, b *float64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
