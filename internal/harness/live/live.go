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

type Generator = loop.Generator

const liveMaxIterations = 30

type Builder struct {
	gen      Generator
	provider string
	modelID  string
}

func NewBuilder(m model.Model, provider, modelID string) *Builder {
	return &Builder{
		gen:      loop.ModelGenerator{M: m},
		provider: provider,
		modelID:  modelID,
	}
}

func NewBuilderWithGenerator(gen Generator, provider, modelID string) *Builder {
	return &Builder{gen: gen, provider: provider, modelID: modelID}
}

type Result struct {
	OK          bool
	ModelFailed bool
}

func (b *Builder) BuildLive(ctx context.Context, task domain.TaskID, taskType domain.TaskType, priorOps []wire.BuildOp, emit func(iterationOps []wire.BuildOp)) bool {
	return b.BuildLiveResult(ctx, task, taskType, priorOps, emit).OK
}

func (b *Builder) BuildLiveFault(ctx context.Context, task domain.TaskID, taskType domain.TaskType, priorOps []wire.BuildOp, emit func(iterationOps []wire.BuildOp)) (ok, modelFailed bool) {
	r := b.BuildLiveResult(ctx, task, taskType, priorOps, emit)
	return r.OK, r.ModelFailed
}

func (b *Builder) BuildLiveResult(ctx context.Context, task domain.TaskID, taskType domain.TaskType, priorOps []wire.BuildOp, emit func(iterationOps []wire.BuildOp)) Result {
	contract, err := bake.DemoContract(task, taskType)
	if err != nil {
		slog.Warn("live build: no contract for task", "task", task, "type", taskType, "error", err)
		return Result{}
	}

	contractJSON, err := contract.JSON()
	if err != nil {
		slog.Warn("live build: contract marshal failed", "task", task, "error", err)
		return Result{}
	}

	priorGeom := foldPrior(task, priorOps)

	world := bake.WorldContext{Note: resumeNote(len(priorGeom))}
	messages, err := bake.BuildPrompt(contract, contractJSON, world)
	if err != nil {
		slog.Warn("live build: prompt build failed", "task", task, "error", err)
		return Result{}
	}
	messages = seedResume(messages, priorGeom)

	stream := &streamer{emit: emit}
	stream.seedPrev(priorGeom)

	eval := evaluator.New(evaluator.Config{})
	out := loop.Run(ctx, b.gen, eval, loop.Request{
		Messages:       messages,
		Envelope:       contract.EvalEnvelope(),
		Done:           contract.EvalDone(),
		SubjectOrigin:  world.SubjectOrigin,
		Neighbours:     world.Neighbours,
		RetriesPerCall: loop.DefaultRetriesPerCall,
		MaxIterations:  liveMaxIterations,
		EmitAccepted:   stream.onIteration,
	})

	if out.Accepted() && len(out.Ops) > 0 {
		stream.reconcile(out.Ops)
	}

	if stream.emitted == 0 {
		slog.Warn("live build produced no ops",
			"task", task, "type", taskType, "reason", out.Reason, "model_failed", out.ModelFailed())
		return Result{ModelFailed: out.ModelFailed()}
	}
	return Result{OK: true}
}

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

func resumeNote(priorPieces int) string {
	if priorPieces == 0 {
		return "live build mode: rover builds inline in the Task envelope frame"
	}
	return fmt.Sprintf("live build mode (RESUME): a prior rover was interrupted mid-build; "+
		"%d piece(s) are already in place (listed below). Continue from the half-built structure, "+
		"extending/refining it into the complete structure — do not restart from scratch.", priorPieces)
}

func seedResume(messages []model.Message, priorGeom []wire.BuildOp) []model.Message {
	if len(priorGeom) == 0 {
		return messages
	}
	priorJSON, err := json.Marshal(struct {
		Ops []wire.BuildOp `json:"ops"`
	}{Ops: priorGeom})
	if err != nil {
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

type streamer struct {
	emit    func(ops []wire.BuildOp)
	prev    []wire.BuildOp
	emitted int
}

func slotID(i int) string { return fmt.Sprintf("p%d", i) }

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

func (s *streamer) onIteration(_ int, ops []wire.BuildOp) {
	patch := s.diff(ops)
	if len(patch) == 0 {
		return
	}
	s.emit(patch)
	s.emitted++
}

func (s *streamer) reconcile(best []wire.BuildOp) {
	patch := s.diff(best)
	if len(patch) == 0 {
		return
	}
	s.emit(patch)
	s.emitted++
}

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
			continue
		}
		if s.prev[i].Shape != op.Shape {
			patch = append(patch, wire.BuildOp{Op: wire.BuildOpDelete, ID: op.ID})
			op.Op = wire.BuildOpPlace
			patch = append(patch, op)
			continue
		}
		if transformEqual(s.prev[i], op) {
			op.Op = wire.BuildOpPlace
			patch = append(patch, op)
			continue
		}
		patch = append(patch, wire.BuildOp{Op: wire.BuildOpMove, ID: op.ID, Pos: op.Pos, Rot: op.Rot, Scale: op.Scale})
		if !materialEqual(s.prev[i].Material, op.Material) {
			op.Op = wire.BuildOpPlace
			patch = append(patch, op)
		}
	}
	for i := len(next); i < len(s.prev); i++ {
		patch = append(patch, wire.BuildOp{Op: wire.BuildOpDelete, ID: slotID(i)})
	}

	prev := make([]wire.BuildOp, len(next))
	for i := range next {
		prev[i] = next[i]
		prev[i].Op = wire.BuildOpPlace
		prev[i].ID = slotID(i)
	}
	s.prev = prev
	return patch
}

func opEqual(a, b wire.BuildOp) bool {
	return a.Shape == b.Shape && transformEqual(a, b) && materialEqual(a.Material, b.Material)
}

func transformEqual(a, b wire.BuildOp) bool {
	return a.Pos == b.Pos && a.Rot == b.Rot && a.Scale == b.Scale
}

func materialEqual(a, b wire.Material) bool {
	return a.Color == b.Color && a.Map == b.Map &&
		a.NormalMap == b.NormalMap && a.RoughnessMap == b.RoughnessMap && a.AOMap == b.AOMap &&
		floatPtrEqual(a.Roughness, b.Roughness) && floatPtrEqual(a.Metalness, b.Metalness)
}

func floatPtrEqual(a, b *float64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
