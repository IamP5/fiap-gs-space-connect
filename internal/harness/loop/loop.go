package loop

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/harness/trace"
	"swarmbuild/internal/wire"
)

const MaxIterations = 3

const DefaultRetriesPerCall = 1

type Generator interface {
	Generate(ctx context.Context, messages []model.Message) ([]wire.BuildOp, error)
}

type ModelGenerator struct{ M model.Model }

func (g ModelGenerator) Generate(ctx context.Context, messages []model.Message) ([]wire.BuildOp, error) {
	return model.GenerateSpec(ctx, g.M, messages)
}

type Request struct {
	Messages      []model.Message
	Envelope      evaluator.Envelope
	Done          evaluator.DoneCriteria
	SubjectOrigin domain.Vec3
	Neighbours    []evaluator.Neighbour

	RetriesPerCall int

	EmitAccepted func(iter int, ops []wire.BuildOp)

	MaxIterations int
}

func (r Request) maxIters() int {
	if r.MaxIterations > 0 {
		return r.MaxIterations
	}
	return MaxIterations
}

type Outcome struct {
	Ops         []wire.BuildOp
	Iterations  []trace.Iteration
	Result      trace.Result
	QualityFlag trace.QualityFlag
	Reason      string

	Err error
}

func (o Outcome) Accepted() bool { return o.Result == trace.ResultAccepted }

func (o Outcome) ModelFailed() bool { return o.Result != trace.ResultAccepted && o.Err != nil }

func Run(ctx context.Context, gen Generator, eval *evaluator.Evaluator, req Request) Outcome {
	convo := make([]model.Message, len(req.Messages))
	copy(convo, req.Messages)

	var (
		iterations []trace.Iteration
		bestOps    []wire.BuildOp
		bestScore  = -1
		bestPass   bool
		lastErr    error
		iter       int
	)

	for range req.maxIters() {
		iter++
		ops, err := generateWithRetry(ctx, gen, convo, req.RetriesPerCall)
		if err != nil {
			lastErr = err
			break
		}

		v := eval.Evaluate(ops, req.Envelope, req.Done, req.SubjectOrigin, req.Neighbours)

		iterations = append(iterations, trace.Iteration{GenOps: cloneOps(ops), Verdict: v})

		if v.Pass() {
			emitAccepted(req.EmitAccepted, iter, ops)
			if v.SoftScore() > bestScore {
				bestScore = v.SoftScore()
				bestOps = cloneOps(ops)
				bestPass = true
			}
			if v.SoftScore() >= eval.Threshold() {
				break
			}
			convo = appendRefine(convo, ops, qualityRefine(v))
			continue
		}

		convo = appendRefine(convo, ops, gateRefine(v))
	}

	if bestPass {
		flag := trace.QualityOK
		reason := fmt.Sprintf("hard gate passed; soft score %d/%d", bestScore, maxSoftPoints)
		if bestScore < eval.Threshold() {
			flag = trace.QualityLow
			reason = fmt.Sprintf("hard gate passed but soft score %d below threshold %d (flagged for operator review)", bestScore, eval.Threshold())
		}
		return Outcome{
			Ops:         bestOps,
			Iterations:  iterations,
			Result:      trace.ResultAccepted,
			QualityFlag: flag,
			Reason:      reason,
		}
	}

	return Outcome{
		Ops:         nil,
		Iterations:  iterations,
		Result:      trace.ResultFallback,
		QualityFlag: trace.QualityOK,
		Reason:      fallbackReason(iterations, lastErr),
		Err:         lastErr,
	}
}

func generateWithRetry(ctx context.Context, gen Generator, convo []model.Message, retries int) ([]wire.BuildOp, error) {
	var lastErr error
	for attempt := 0; attempt <= retries; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		ops, err := gen.Generate(ctx, convo)
		if err == nil {
			return ops, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

const maxSoftPoints = 4

func emitAccepted(emit func(iter int, ops []wire.BuildOp), iter int, ops []wire.BuildOp) {
	if emit == nil {
		return
	}
	emit(iter, cloneOps(ops))
}

func cloneOps(ops []wire.BuildOp) []wire.BuildOp {
	if ops == nil {
		return nil
	}
	out := make([]wire.BuildOp, len(ops))
	copy(out, ops)
	return out
}

func appendRefine(convo []model.Message, rejected []wire.BuildOp, instruction string) []model.Message {
	return append(convo,
		model.Message{Role: "assistant", Content: opsSummary(rejected)},
		model.Message{Role: "user", Content: instruction},
	)
}

func gateRefine(v evaluator.Verdict) string {
	return "The previous Build spec FAILED the Evaluator's hard gate: " +
		strings.Join(v.Reasons(), "; ") + ". " +
		"Return a corrected Build spec as strict JSON {\"ops\":[...]} that keeps every op inside the " +
		"Build envelope, does not overlap neighbouring structures, and satisfies the done-criteria."
}

func qualityRefine(v evaluator.Verdict) string {
	return "The previous Build spec passed the hard gate but scored low on quality (" +
		"done-coverage: " + v.Rubric.DoneCoverage.Evidence + "; coherence: " + v.Rubric.Coherence.Evidence + "). " +
		"Return a RICHER spec as strict JSON {\"ops\":[...]} — more structural detail and a clearer " +
		"silhouette — while keeping every op inside the envelope and clear of neighbours."
}

func opsSummary(ops []wire.BuildOp) string {
	var b strings.Builder
	fmt.Fprintf(&b, "(previous attempt: %d ops:", len(ops))
	for _, op := range ops {
		fmt.Fprintf(&b, " %s@(%.2f,%.2f,%.2f)", op.Shape, op.Pos.X, op.Pos.Y, op.Pos.Z)
	}
	b.WriteString(")")
	return b.String()
}

func fallbackReason(iterations []trace.Iteration, lastErr error) string {
	if lastErr != nil && errors.Is(lastErr, model.ErrFallback) {
		return fmt.Sprintf("generator exhausted (%v); primitive fallback", lastErr)
	}
	if lastErr != nil {
		return fmt.Sprintf("generation error (%v); primitive fallback", lastErr)
	}
	if n := len(iterations); n > 0 {
		return fmt.Sprintf("hard gate never passed in %d iteration(s): %s; primitive fallback",
			n, strings.Join(iterations[n-1].Verdict.Reasons(), ", "))
	}
	return "no spec generated; primitive fallback"
}
