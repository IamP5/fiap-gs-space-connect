// Package loop is the SwarmBuild Generator↔Evaluator refine loop (TECHSPEC §4/§5,
// ADR-0008): the agentic core of the Build harness on the lab/bake path. A
// GENERATOR sub-agent emits Build spec ops (through the Model seam, given the Build
// contract + a world snapshot that includes neighbour ops near its envelope); an
// EVALUATOR sub-agent grades them into a layered verdict. The loop refines up to a
// HARD iteration cap, and on exhaustion accepts the primitive fallback and flags it
// — the Task still completes.
//
// The Generator/Evaluator split is the quality lever: a single agent grading its
// own work praises it, so generation and judgement are kept in separate seams. The
// loop is the ONLY thing that wires the Model seam to the Evaluator; it lives on
// the bake path and stays out of the hot-path import closure (ADR-0005).
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

// MaxIterations is the HARD cap on refine passes (TECHSPEC §5: 1–3). The loop never
// exceeds it; on exhaustion the Task falls back to the primitive.
const MaxIterations = 3

// DefaultRetriesPerCall is the bounded retry the LIVE path uses on a single model
// call (bh-08f): a failed/invalid/timed-out Generate is re-attempted this many EXTRA
// times before the loop treats the call as failed. A transient provider blip
// therefore self-corrects inside one iteration rather than burning a refine pass or
// — on the live path — immediately counting toward the Rover's failure-death
// threshold. It is OPT-IN via Request.RetriesPerCall; a zero value keeps the legacy
// no-retry behaviour, so the bake/lab callers are byte-for-byte unchanged.
const DefaultRetriesPerCall = 1

// Generator is the generation sub-agent seam. Generate emits a Build spec for the
// given prompt messages, returning schema-valid ops or model.ErrFallback on
// exhaustion (the Model seam's own validate-and-repair runs inside it). It is an
// interface so the loop can be driven by the real model-backed generator OR a fake
// in tests, with no network.
type Generator interface {
	Generate(ctx context.Context, messages []model.Message) ([]wire.BuildOp, error)
}

// ModelGenerator is the production Generator: it forwards to model.GenerateSpec,
// which performs the strict-schema generation + single validate-and-repair re-ask.
type ModelGenerator struct{ M model.Model }

// Generate runs one model-backed generation (with the seam's internal repair).
func (g ModelGenerator) Generate(ctx context.Context, messages []model.Message) ([]wire.BuildOp, error) {
	return model.GenerateSpec(ctx, g.M, messages)
}

// SilhouetteScorer is the bake-time VISION PASS seam (bh-06, issue 06): given a
// hard-gate-passing Build spec, it renders the real Scene3D headless, screenshots
// it, and scores how well the rendered structure reads as the intended thing,
// returning a 0–2 silhouette Score with evidence. It is OPTIONAL on Request.Vision;
// when nil the loop behaves exactly as bh-04 (analytic-only, no vision call).
//
// It is an interface so the loop stays dependency-light — the production
// implementation (internal/harness/vision) pulls in chromedp + the model adapter,
// but the loop only needs this one method, and tests drive it with a fake (no
// browser, no network). It runs ONLY here on the bake path; the headline never
// constructs a scorer (ADR-0005).
type SilhouetteScorer interface {
	ScoreSilhouette(ctx context.Context, taskType string, ops []wire.BuildOp) (evaluator.Score, error)
}

// Request is one refine-loop run for a single Task. It carries everything the
// Generator and Evaluator need: the prompt seed (system + user messages built by
// the caller from the contract + world snapshot), the analytic envelope/done the
// Evaluator checks, the subject's world origin, and the neighbour world.
type Request struct {
	// Messages is the initial prompt (system + user) from the contract + world
	// snapshot. The loop appends a refine instruction on each failed iteration.
	Messages []model.Message
	// Envelope/Done/SubjectOrigin/Neighbours feed the analytic Evaluator.
	Envelope      evaluator.Envelope
	Done          evaluator.DoneCriteria
	SubjectOrigin domain.Vec3
	Neighbours    []evaluator.Neighbour

	// Vision is the OPTIONAL bake-time vision pass (bh-06). When non-nil, the loop
	// scores the silhouette of each hard-gate-passing spec through it and folds the
	// score into the verdict's rubric, so a low silhouette (a spec that passes the
	// analytic gate but "looks wrong") triggers another Generator iteration within
	// budget and, on exhaustion, flags the cached spec quality_flag:low (never
	// withheld — ADR-0008). When nil the loop is analytic-only (bh-04 behaviour).
	Vision SilhouetteScorer
	// TaskType is passed to the vision pass so the rendered structure is judged
	// against the right intent (foundation | wall | dome-cap). Unused when Vision is
	// nil.
	TaskType string

	// Observer is an OPTIONAL live hook (bh-07a, the in-app lab): when non-nil it is
	// called once per refine pass with the ops the Generator emitted and the
	// Evaluator's verdict on them, AS THEY HAPPEN, so a lab UI can stream the
	// "watch it think" surface. It is purely observational — it never affects the
	// loop's decision or the cached result, runs on the loop's own goroutine, and
	// is nil on every bake/headline path (so behaviour there is byte-identical).
	Observer Observer

	// RetriesPerCall is the OPTIONAL bounded retry on a single Generate call (bh-08f):
	// when > 0, a failed/invalid/timed-out generation is re-attempted up to this many
	// EXTRA times (total attempts = 1 + RetriesPerCall) before the loop treats the
	// call as failed and stops. A retry re-asks with the SAME conversation (a transport
	// blip is not refinable by a gate message), so a transient fault self-corrects
	// inside one iteration. Zero (the default) keeps the legacy no-retry behaviour, so
	// every bake/lab/headline caller is byte-for-byte unchanged; only the live path
	// (which routes model failure through self-heal) sets it. A context cancellation is
	// never retried — the loop honours ctx.Done immediately.
	RetriesPerCall int

	// EmitAccepted is an OPTIONAL per-iteration streaming hook (bh-08d, Live Build
	// Mode): when non-nil it is called with the Generator's ops EACH TIME a refine
	// pass produces a hard-gate-passing (renderable) spec, AS IT HAPPENS — so the
	// live work phase can stream each accepted/revised iteration onto build.op.<task>
	// and the world visibly grows and self-corrects between passes, rather than
	// receiving one terminal blob. It is fed a defensive copy it may retain. Like
	// Observer it is purely observational — it never affects the loop's decision or
	// the final Outcome (which still carries the single best spec) — and runs on the
	// loop's own goroutine, so a streaming sink must hand off promptly. It is nil on
	// every bake/headline/lab path, keeping behaviour there byte-identical.
	EmitAccepted func(iter int, ops []wire.BuildOp)
}

// Observer receives a copy of each refine pass's Generator output and Evaluator
// verdict as the loop runs (bh-07a). Iter is the 1-based pass number. It must not
// block for long (it runs inline on the loop goroutine); a streaming sink should
// hand off to a channel/SSE writer and return promptly. Implementations get a
// defensive copy of ops, so they may retain it.
type Observer interface {
	OnIteration(iter int, ops []wire.BuildOp, v evaluator.Verdict)
}

// Outcome is the loop's result for one Task: the accepted ops (nil on fallback),
// the per-iteration trace, the final disposition, and the chosen quality flag.
type Outcome struct {
	Ops         []wire.BuildOp
	Iterations  []trace.Iteration
	Result      trace.Result
	QualityFlag trace.QualityFlag
	Reason      string

	// Err is the last Generate transport/exhaustion error when the loop fell back
	// because the MODEL would not produce a spec (after RetriesPerCall retries) —
	// distinct from a fallback caused by the Evaluator's hard gate never passing
	// (Err == nil). The live path (bh-08f) routes a model failure through self-heal
	// (the Rover dies past its threshold), so it needs to tell the two apart; every
	// other caller can ignore it. Always nil on an Accepted outcome.
	Err error
}

// Accepted reports whether the loop produced a hard-gate-passing spec to cache.
func (o Outcome) Accepted() bool { return o.Result == trace.ResultAccepted }

// ModelFailed reports whether this (non-accepted) outcome fell back because the
// Model seam failed to produce a spec — a transport error/timeout or exhausted
// validate-and-repair (model.ErrFallback), surviving RetriesPerCall retries — as
// opposed to the Evaluator's hard gate never passing on otherwise-valid specs. The
// live path treats a model failure as a Rover fault (bh-08f); a gate exhaustion is
// a quality miss, not a fault. False on an Accepted outcome.
func (o Outcome) ModelFailed() bool { return o.Result != trace.ResultAccepted && o.Err != nil }

// Run drives the bounded Generator↔Evaluator refine loop for one Task.
//
// Each iteration: the Generator emits ops; the Evaluator grades them. If the hard
// gate passes the spec is cacheable — the loop keeps the BEST passing spec (highest
// soft score) and stops early once a passing spec also clears the soft threshold,
// otherwise it spends remaining budget trying to improve quality. If the hard gate
// fails, the loop re-asks the Generator with the failing reasons appended. On
// exhaustion with no passing spec it returns a FALLBACK outcome (the Task takes the
// primitive). A Generator transport error (ErrFallback) on the FIRST iteration also
// yields fallback; on a later iteration a previously-found passing spec is kept.
func Run(ctx context.Context, gen Generator, eval *evaluator.Evaluator, req Request) Outcome {
	convo := make([]model.Message, len(req.Messages))
	copy(convo, req.Messages)

	var (
		iterations  []trace.Iteration
		bestOps     []wire.BuildOp
		bestScore   = -1
		bestVerdict evaluator.Verdict
		bestVision  bool // whether the best spec's silhouette was vision-scored
		bestPass    bool
		lastErr     error
		iter        int
	)

	for range MaxIterations {
		iter++
		ops, err := generateWithRetry(ctx, gen, convo, req.RetriesPerCall)
		if err != nil {
			lastErr = err
			// A generation failure is not refinable by re-asking with a gate reason;
			// stop and keep whatever passing spec we already have (if any). The bounded
			// per-call retry above already gave a transient blip its chances (bh-08f).
			break
		}

		v := eval.Evaluate(ops, req.Envelope, req.Done, req.SubjectOrigin, req.Neighbours)

		// VISION PASS (bh-06): only a hard-gate-passing spec is worth rendering. When a
		// vision scorer is configured, score the silhouette and fold it into the verdict
		// BEFORE the trace records the iteration. A vision failure is non-fatal (the soft
		// rubric never blocks); see scoreVision.
		visionScored := scoreVision(ctx, req, ops, &v)

		// LAB OBSERVER (bh-07a): stream this pass's ops + verdict live, before the trace
		// records it. Purely observational — nil on the bake/headline path.
		notifyObserver(req.Observer, iter, ops, v)

		// Record a defensive copy of the ops so later mutation of the slice cannot
		// rewrite the trace history.
		iterations = append(iterations, trace.Iteration{GenOps: cloneOps(ops), Verdict: v})

		if v.Pass() {
			// STREAM this accepted/revised iteration (bh-08d): every hard-gate-passing
			// pass is renderable, so the live work phase can emit it as patches and the
			// world grows/self-corrects between passes. Purely observational — it does
			// not change which spec the loop ultimately caches below.
			emitAccepted(req.EmitAccepted, iter, ops)
			if v.SoftScore() > bestScore {
				bestScore = v.SoftScore()
				bestOps = cloneOps(ops)
				bestVerdict = v
				bestVision = visionScored
				bestPass = true
			}
			// Good enough on quality too ⇒ stop early (don't burn budget). When the
			// vision pass scored this spec, "good enough" ALSO requires the silhouette
			// to clear its own bar — a high analytic score with a low silhouette (passes
			// the gate but "looks wrong") keeps refining within budget.
			if v.SoftScore() >= eval.Threshold() && silhouetteOK(v, visionScored, eval.SilhouetteThreshold()) {
				break
			}
			// Passing but low quality (analytic OR silhouette): spend remaining budget
			// asking for a richer pass, but we already have a cacheable spec.
			convo = appendRefine(convo, ops, qualityRefine(v))
			continue
		}

		// Hard-gate failure ⇒ re-ask with the exact failing invariants.
		convo = appendRefine(convo, ops, gateRefine(v))
	}

	if bestPass {
		flag := trace.QualityOK
		maxPoints := maxSoftPoints
		if bestVision {
			maxPoints = maxSoftPointsWithVision
		}
		reason := fmt.Sprintf("hard gate passed; soft score %d/%d", bestScore, maxPoints)
		// Flag low if the summed soft score is below threshold OR — when the vision
		// pass scored it — the silhouette itself is below its bar (a spec that passes
		// the analytic gate but "looks wrong"; the (B)→(C) signal, ADR-0008).
		lowSilhouette := bestVision && bestVerdict.Rubric.Silhouette.Score < eval.SilhouetteThreshold()
		if bestScore < eval.Threshold() || lowSilhouette {
			flag = trace.QualityLow
			switch {
			case lowSilhouette:
				reason = fmt.Sprintf("hard gate passed but vision silhouette %d below threshold %d (passes analytic, looks wrong) — flagged for operator review (evidence: %s)",
					bestVerdict.Rubric.Silhouette.Score, eval.SilhouetteThreshold(), bestVerdict.Rubric.Silhouette.Evidence)
			default:
				reason = fmt.Sprintf("hard gate passed but soft score %d below threshold %d (flagged for operator review)", bestScore, eval.Threshold())
			}
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
		QualityFlag: trace.QualityOK, // a fallback Task is not "low quality"; it is simply primitive
		Reason:      fallbackReason(iterations, lastErr),
		Err:         lastErr, // non-nil ⇒ the MODEL failed (ModelFailed); nil ⇒ gate never passed
	}
}

// generateWithRetry runs one Generator call with a bounded retry (bh-08f): on a
// non-context error it re-asks with the SAME conversation up to retries EXTRA times
// (a transport blip is not refinable by a gate message), so a transient fault
// self-corrects inside one iteration. A context cancellation is returned at once and
// never retried. retries <= 0 is the legacy single-attempt behaviour.
func generateWithRetry(ctx context.Context, gen Generator, convo []model.Message, retries int) ([]wire.BuildOp, error) {
	var lastErr error
	for attempt := 0; attempt <= retries; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err // cancelled/expired: do not retry, surface immediately
		}
		ops, err := gen.Generate(ctx, convo)
		if err == nil {
			return ops, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

// maxSoftPoints is the maximum summed soft score WITHOUT the vision pass
// (done-coverage 0–2 + coherence 0–2). maxSoftPointsWithVision adds the silhouette
// dimension (0–2) when the bh-06 vision pass has scored the spec.
const (
	maxSoftPoints           = 4
	maxSoftPointsWithVision = 6
)

// notifyObserver streams one refine pass's ops + verdict to the optional lab
// Observer (bh-07a), handing it a defensive copy of the ops so it may retain them.
// A nil observer (every bake/headline run) is a no-op, keeping Run's behaviour
// there byte-identical.
func notifyObserver(o Observer, iter int, ops []wire.BuildOp, v evaluator.Verdict) {
	if o == nil {
		return
	}
	o.OnIteration(iter, cloneOps(ops), v)
}

// emitAccepted streams one hard-gate-passing pass's ops to the optional bh-08d
// per-iteration sink, handing it a defensive copy so it may retain them. A nil
// sink (every bake/headline/lab run) is a no-op, keeping Run byte-identical there.
func emitAccepted(emit func(iter int, ops []wire.BuildOp), iter int, ops []wire.BuildOp) {
	if emit == nil {
		return
	}
	emit(iter, cloneOps(ops))
}

// scoreVision runs the optional bake-time vision pass on a hard-gate-passing spec
// and folds the silhouette score into v's rubric (so the trace carries it and the
// quality decision accounts for it). It returns whether a real score was obtained:
// false when no scorer is configured, the spec failed the hard gate (nothing worth
// rendering), or the pass errored — in the error case the silhouette dimension
// records WHY it is unscored. A vision failure never blocks caching (ADR-0008).
func scoreVision(ctx context.Context, req Request, ops []wire.BuildOp, v *evaluator.Verdict) bool {
	if req.Vision == nil || !v.Pass() {
		return false
	}
	s, err := req.Vision.ScoreSilhouette(ctx, req.TaskType, ops)
	if err != nil {
		v.Rubric.Silhouette = evaluator.Score{
			Score:    0,
			Evidence: fmt.Sprintf("vision pass unavailable: %v", err),
		}
		return false
	}
	v.Rubric.Silhouette = s
	return true
}

// silhouetteOK reports whether a passing spec's silhouette clears its bar. When the
// vision pass did NOT score this spec (visionScored=false), there is no silhouette
// signal to gate on, so it returns true (the analytic soft-score check stands
// alone). When it DID, the silhouette must reach the threshold for an early stop.
func silhouetteOK(v evaluator.Verdict, visionScored bool, threshold int) bool {
	if !visionScored {
		return true
	}
	return v.Rubric.Silhouette.Score >= threshold
}

// cloneOps returns a defensive copy of an op slice (wire.BuildOp's *float64
// material fields are shared, but the loop never mutates them, so a shallow element
// copy is sufficient and keeps trace history stable against slice reuse).
func cloneOps(ops []wire.BuildOp) []wire.BuildOp {
	if ops == nil {
		return nil
	}
	out := make([]wire.BuildOp, len(ops))
	copy(out, ops)
	return out
}

// appendRefine appends the Generator's rejected output and a refine instruction to
// the conversation so the next pass corrects the named defect.
func appendRefine(convo []model.Message, rejected []wire.BuildOp, instruction string) []model.Message {
	return append(convo,
		model.Message{Role: "assistant", Content: opsSummary(rejected)},
		model.Message{Role: "user", Content: instruction},
	)
}

// gateRefine is the re-ask instruction after a HARD-gate failure: it names the
// exact failing invariants so the Generator fixes those specifically.
func gateRefine(v evaluator.Verdict) string {
	return "The previous Build spec FAILED the Evaluator's hard gate: " +
		strings.Join(v.Reasons(), "; ") + ". " +
		"Return a corrected Build spec as strict JSON {\"ops\":[...]} that keeps every op inside the " +
		"Build envelope, does not overlap neighbouring structures, and satisfies the done-criteria."
}

// qualityRefine is the re-ask instruction after a PASSING but low-quality verdict:
// it asks for a richer structure without relaxing the (already-met) hard gate.
func qualityRefine(v evaluator.Verdict) string {
	return "The previous Build spec passed the hard gate but scored low on quality (" +
		"done-coverage: " + v.Rubric.DoneCoverage.Evidence + "; coherence: " + v.Rubric.Coherence.Evidence + "). " +
		"Return a RICHER spec as strict JSON {\"ops\":[...]} — more structural detail and a clearer " +
		"silhouette — while keeping every op inside the envelope and clear of neighbours."
}

// opsSummary renders a terse textual summary of an op set for the assistant turn in
// the refine conversation (the Generator does not need its own raw JSON echoed
// verbatim, only enough context to correct course).
func opsSummary(ops []wire.BuildOp) string {
	var b strings.Builder
	fmt.Fprintf(&b, "(previous attempt: %d ops:", len(ops))
	for _, op := range ops {
		fmt.Fprintf(&b, " %s@(%.2f,%.2f,%.2f)", op.Shape, op.Pos.X, op.Pos.Y, op.Pos.Z)
	}
	b.WriteString(")")
	return b.String()
}

// fallbackReason builds the human-readable trace reason for an exhausted loop: the
// transport error if generation failed, otherwise the last verdict's failing
// invariants.
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
