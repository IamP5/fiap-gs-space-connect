// Package evaluator is the SwarmBuild Build-harness Evaluator (TECHSPEC §4/§5,
// ADR-0008): it grades a Generator's Build spec against a Build contract and emits
// a LAYERED verdict — a boolean, blocking HARD GATE (safety invariants) plus an
// advisory SOFT RUBRIC (quality, 0–2 + evidence).
//
// The hard gate is ANALYTIC and DETERMINISTIC pure Go (no model, unit-testable
// without a network): the ops stay within the Task's Build envelope, they do not
// collide with neighbour tasks' accumulated ops, and the contract's done-criteria
// are met. Schema validity is delegated to spec.Validate (the authoritative
// server-side gate, ADR-0006), so the Evaluator never re-implements it.
//
// The soft rubric scores quality (done-coverage %, structural coherence; a
// silhouette slot is reserved for the bh-06 vision pass) but gates NOTHING — a
// hard-gate-passing spec with a low soft score is cached and FLAGGED, never
// withheld (ADR-0008).
//
// This package is on the lab/bake path ONLY. Like the rest of the generation loop
// it must stay OUT of the hot-path import closure (ADR-0005); it depends on wire +
// domain + spec and NOT on the Model seam, so it can be exercised hermetically.
package evaluator

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/spec"
	"swarmbuild/internal/wire"
)

// Envelope is the axis-aligned Build envelope (TECHSPEC §4): the bounds, in the
// Task's local frame, the generated geometry must stay within. Center is normally
// the origin; Size is the FULL extent on each axis. It mirrors bake.Envelope so
// the Evaluator can be driven without importing the bake package (avoiding an
// import cycle: bake imports evaluator, not the reverse).
type Envelope struct {
	Center domain.Vec3 `json:"center"`
	Size   domain.Vec3 `json:"size"`
}

// DoneCriteria is the analytic, measurable "done" the Evaluator checks (the hard
// gate's `done` invariant). It is deliberately structured (not free text) so the
// check is deterministic: a spec is "done" when it has at least MinOps ops AND its
// op AABBs fill at least MinCoverage of the envelope volume. A zero value imposes
// no requirement (any non-empty, schema-valid spec is "done").
type DoneCriteria struct {
	// MinOps is the minimum number of place-ops a complete structure must have
	// (e.g. a plinth is "richer than a single block" ⇒ MinOps ≥ 2).
	MinOps int `json:"min_ops,omitempty"`
	// MinCoverage is the minimum fraction (0..1) of the envelope volume the union
	// of op bounding boxes must cover. Approximated as the clamped sum of per-op
	// volume fractions (cheap, deterministic, monotone in "how much was built").
	MinCoverage float64 `json:"min_coverage,omitempty"`
	// Description is human guidance carried through to the trace/prompt; it does
	// not affect the analytic check.
	Description string `json:"description,omitempty"`
}

// Neighbour is one already-generated neighbour Task's accumulated ops together
// with the world-frame origin its local op coordinates are expressed relative to.
// The Evaluator lifts both the subject and each neighbour into the shared world
// frame to test for collisions, since a Task's own ops are authored in its LOCAL
// envelope frame (TECHSPEC §4).
type Neighbour struct {
	TaskID domain.TaskID
	Origin domain.Vec3 // world position of this neighbour's envelope center
	Ops    []wire.BuildOp
}

// HardGate is the boolean, blocking safety verdict (ADR-0008): each field is true
// iff that invariant holds. It is NEVER averaged into a score. Pass() is true only
// when every invariant holds.
type HardGate struct {
	Envelope  bool `json:"envelope"`  // all ops within the Build envelope
	Collision bool `json:"collision"` // no overlap with neighbour ops
	Done      bool `json:"done"`      // contract done-criteria met
}

// Pass reports whether every hard-gate invariant holds (the spec is cacheable).
func (g HardGate) Pass() bool { return g.Envelope && g.Collision && g.Done }

// Score is one soft-rubric dimension: a 0–2 quality score with a cited evidence
// string (ADR-0008). It is advisory and never blocks.
type Score struct {
	Score    int    `json:"score"` // 0 | 1 | 2
	Evidence string `json:"evidence"`
}

// Rubric is the advisory soft rubric: quality dimensions scored 0–2 with evidence.
type Rubric struct {
	DoneCoverage Score `json:"done_coverage"`
	Coherence    Score `json:"coherence"`
}

// Verdict is the Evaluator's layered output (TECHSPEC §4 / ADR-0008): a blocking
// hard gate plus an advisory rubric. The trace records one per iteration.
type Verdict struct {
	HardGate HardGate `json:"hard_gate"`
	Rubric   Rubric   `json:"rubric"`
}

// Pass is shorthand for HardGate.Pass — the spec is cacheable.
func (v Verdict) Pass() bool { return v.HardGate.Pass() }

// SoftScore is the summed soft-rubric score over ALL scored dimensions
// (done-coverage + coherence). It is the value the caching policy compares
// against a threshold to decide the quality_flag — it NEVER affects
// HardGate.Pass.
func (v Verdict) SoftScore() int {
	return v.Rubric.DoneCoverage.Score + v.Rubric.Coherence.Score
}

// Reasons returns a human-readable list of which hard-gate invariants FAILED, for
// the refine re-ask and the trace reason. Empty when the gate passes.
func (v Verdict) Reasons() []string {
	var rs []string
	if !v.HardGate.Envelope {
		rs = append(rs, "one or more ops fall outside the Build envelope")
	}
	if !v.HardGate.Collision {
		rs = append(rs, "one or more ops collide with a neighbour task's geometry")
	}
	if !v.HardGate.Done {
		rs = append(rs, "the contract's done-criteria are not met")
	}
	return rs
}

// Config is the analytic Evaluator's tunables. SoftScoreThreshold is the summed
// soft score at/above which a hard-gate-passing spec is flagged quality_flag:ok;
// below it the spec is still cached but flagged low (ADR-0008). CollisionEpsilon
// is the world-frame overlap tolerance (touching faces do not count as a
// collision).
type Config struct {
	SoftScoreThreshold int
	CollisionEpsilon   float64
	// EnvelopeMargin is the fraction of each envelope half-extent an op's AABB may
	// legitimately extend past the envelope wall before the `envelope` invariant
	// fails. A real GPT-class spec authors structures that fill — and touch — the
	// envelope, so a flush or marginally-proud face must not trip the safety gate;
	// the margin (well under the ~10× gap to the nearest neighbour in the demo
	// dome) keeps the gate meaningful without rejecting legitimate full-size
	// geometry. Zero ⇒ DefaultConfig's margin.
	EnvelopeMargin float64
}

// DefaultConfig is the analytic Evaluator's default policy: a spec must score at
// least 3 of the available 4 soft points (done-coverage + coherence) to be flagged
// ok; a small epsilon keeps abutting neighbours from reading as a collision; and a
// 12% envelope margin admits structures that fill the envelope to its walls.
func DefaultConfig() Config {
	return Config{SoftScoreThreshold: 3, CollisionEpsilon: 1e-6, EnvelopeMargin: 0.12}
}

// Evaluator grades a Build spec against a contract. It holds only configuration
// (the checks are pure functions of their inputs), so a zero-value Evaluator with
// DefaultConfig is safe to share.
type Evaluator struct {
	cfg Config
}

// New builds an Evaluator with the given config (DefaultConfig if zero-valued).
func New(cfg Config) *Evaluator {
	if cfg.SoftScoreThreshold == 0 {
		cfg.SoftScoreThreshold = DefaultConfig().SoftScoreThreshold
	}
	if cfg.CollisionEpsilon == 0 {
		cfg.CollisionEpsilon = DefaultConfig().CollisionEpsilon
	}
	if cfg.EnvelopeMargin == 0 {
		cfg.EnvelopeMargin = DefaultConfig().EnvelopeMargin
	}
	return &Evaluator{cfg: cfg}
}

// Threshold returns the soft-score threshold below which a passing spec is flagged
// quality_flag:low.
func (e *Evaluator) Threshold() int { return e.cfg.SoftScoreThreshold }

// Evaluate produces the layered verdict for ops authored in the subject's local
// envelope frame, against its envelope/done-criteria and the world-frame
// neighbours. subjectOrigin is the world position of the subject envelope center
// (used only for the collision lift). It does NOT mutate its inputs.
//
// Order of the hard gate: schema validity (via spec.Validate) is a precondition —
// an unparseable/invalid spec fails every analytic check, so the loop should have
// rejected it before here; we still defensively treat invalid ops as a failed
// envelope check.
func (e *Evaluator) Evaluate(ops []wire.BuildOp, env Envelope, done DoneCriteria, subjectOrigin domain.Vec3, neighbours []Neighbour) Verdict {
	schemaOK := spec.Validate(ops) == nil && len(ops) > 0

	// All geometry checks run on the FOLDED result (bh-08a): the patch log's
	// current geometry, not the raw op stream (a move/delete is not a primitive
	// with a meaningful AABB). spec.Validate already proved the log folds when
	// schemaOK; on a fold error schemaOK is false and the geometry checks
	// short-circuit, so we ignore Fold's error here.
	folded, _ := spec.Fold(ops)

	envOK := schemaOK && e.checkEnvelope(folded, env)
	collOK := schemaOK && e.checkCollision(folded, subjectOrigin, neighbours)
	doneOK := schemaOK && e.checkDone(folded, env, done)

	coverage, coverScore, coverEvidence := e.scoreCoverage(folded, env, done)
	cohScore, cohEvidence := e.scoreCoherence(folded, env)

	_ = coverage
	return Verdict{
		HardGate: HardGate{Envelope: envOK, Collision: collOK, Done: doneOK},
		Rubric: Rubric{
			DoneCoverage: Score{Score: coverScore, Evidence: coverEvidence},
			Coherence:    Score{Score: cohScore, Evidence: cohEvidence},
		},
	}
}

// aabb is a world- or local-frame axis-aligned bounding box.
type aabb struct{ min, max domain.Vec3 }

// opAABB is the local-frame AABB of one op: its position ± half its scale on each
// axis. Rotation is ignored for the bound (a conservative over-approximation is
// fine for the envelope/collision invariants and keeps the check deterministic and
// cheap).
func opAABB(op wire.BuildOp) aabb {
	hx, hy, hz := op.Scale.X/2, op.Scale.Y/2, op.Scale.Z/2
	return aabb{
		min: domain.Vec3{X: op.Pos.X - hx, Y: op.Pos.Y - hy, Z: op.Pos.Z - hz},
		max: domain.Vec3{X: op.Pos.X + hx, Y: op.Pos.Y + hy, Z: op.Pos.Z + hz},
	}
}

// translate shifts an AABB by a world origin offset.
func (b aabb) translate(o domain.Vec3) aabb {
	return aabb{
		min: domain.Vec3{X: b.min.X + o.X, Y: b.min.Y + o.Y, Z: b.min.Z + o.Z},
		max: domain.Vec3{X: b.max.X + o.X, Y: b.max.Y + o.Y, Z: b.max.Z + o.Z},
	}
}

// envelopeAABB is the local-frame AABB of a Build envelope (center ± size/2).
func envelopeAABB(env Envelope) aabb {
	hx, hy, hz := env.Size.X/2, env.Size.Y/2, env.Size.Z/2
	return aabb{
		min: domain.Vec3{X: env.Center.X - hx, Y: env.Center.Y - hy, Z: env.Center.Z - hz},
		max: domain.Vec3{X: env.Center.X + hx, Y: env.Center.Y + hy, Z: env.Center.Z + hz},
	}
}

// checkEnvelope is the `envelope` hard-gate invariant: every op's AABB lies within
// the Build envelope, allowing a per-axis MARGIN (a fraction of the envelope's
// half-extent) so a structure that fills the envelope to — or marginally past — its
// walls is in-bounds. The margin is far smaller than the gap to the nearest
// neighbour, so it never compromises the collision invariant.
func (e *Evaluator) checkEnvelope(ops []wire.BuildOp, env Envelope) bool {
	box := envelopeAABB(env)
	mx := math.Abs(env.Size.X) / 2 * e.cfg.EnvelopeMargin
	my := math.Abs(env.Size.Y) / 2 * e.cfg.EnvelopeMargin
	mz := math.Abs(env.Size.Z) / 2 * e.cfg.EnvelopeMargin
	for _, op := range ops {
		b := opAABB(op)
		if b.min.X < box.min.X-mx || b.max.X > box.max.X+mx ||
			b.min.Y < box.min.Y-my || b.max.Y > box.max.Y+my ||
			b.min.Z < box.min.Z-mz || b.max.Z > box.max.Z+mz {
			return false
		}
	}
	return true
}

// checkCollision is the `collision` hard-gate invariant: no subject op AABB
// overlaps any neighbour op AABB once both are lifted into the world frame.
// Touching (shared face) is NOT a collision — the epsilon keeps abutting walls
// legal.
func (e *Evaluator) checkCollision(ops []wire.BuildOp, subjectOrigin domain.Vec3, neighbours []Neighbour) bool {
	subj := make([]aabb, len(ops))
	for i, op := range ops {
		subj[i] = opAABB(op).translate(subjectOrigin)
	}
	for _, n := range neighbours {
		// A neighbour's accumulated spec is itself a patch log; fold it to its
		// current geometry before testing for overlap (bh-08a). A malformed
		// neighbour log folds to nothing rather than failing the subject.
		nops, _ := spec.Fold(n.Ops)
		for _, nop := range nops {
			nb := opAABB(nop).translate(n.Origin)
			for _, sb := range subj {
				if overlaps(sb, nb, e.cfg.CollisionEpsilon) {
					return false
				}
			}
		}
	}
	return true
}

// overlaps reports whether two AABBs intersect with a positive-volume margin
// greater than eps on every axis (so a shared face — zero overlap — is not a
// collision).
func overlaps(a, b aabb, eps float64) bool {
	return a.min.X < b.max.X-eps && a.max.X > b.min.X+eps &&
		a.min.Y < b.max.Y-eps && a.max.Y > b.min.Y+eps &&
		a.min.Z < b.max.Z-eps && a.max.Z > b.min.Z+eps
}

// checkDone is the `done` hard-gate invariant: the spec has at least MinOps ops and
// covers at least MinCoverage of the envelope volume. A zero DoneCriteria requires
// only a non-empty, schema-valid spec.
func (e *Evaluator) checkDone(ops []wire.BuildOp, env Envelope, done DoneCriteria) bool {
	if len(ops) < done.MinOps {
		return false
	}
	if done.MinCoverage > 0 {
		if coverageFraction(ops, env) < done.MinCoverage {
			return false
		}
	}
	return true
}

// coverageFraction approximates how much of the envelope volume the union of op
// AABBs fills: the clamped sum of per-op volume fractions, capped at 1.0. It is an
// over-count where ops overlap, but it is deterministic, cheap, and monotone in
// "how much structure was built", which is all the done-coverage signal needs.
func coverageFraction(ops []wire.BuildOp, env Envelope) float64 {
	envVol := math.Abs(env.Size.X * env.Size.Y * env.Size.Z)
	if envVol == 0 {
		return 0
	}
	var sum float64
	for _, op := range ops {
		sum += math.Abs(op.Scale.X * op.Scale.Y * op.Scale.Z)
	}
	frac := sum / envVol
	if frac > 1 {
		frac = 1
	}
	return frac
}

// scoreCoverage scores the done_coverage rubric dimension 0–2 from the coverage
// fraction relative to the contract's MinCoverage target (or a sensible default
// when none is set), with cited evidence.
func (e *Evaluator) scoreCoverage(ops []wire.BuildOp, env Envelope, done DoneCriteria) (frac float64, score int, evidence string) {
	frac = coverageFraction(ops, env)
	target := done.MinCoverage
	if target <= 0 {
		target = 0.15 // a default "meaningfully filled" bar when the contract is silent
	}
	switch {
	case frac >= target*1.5:
		score = 2
	case frac >= target:
		score = 1
	default:
		score = 0
	}
	evidence = fmt.Sprintf("envelope coverage ≈ %.0f%% over %d ops (target ≥ %.0f%%)", frac*100, len(ops), target*100)
	return frac, score, evidence
}

// scoreCoherence scores the coherence rubric dimension 0–2 with analytic
// heuristics (deterministic, no model): a coherent moon-base structure rises from
// the ground (its lowest op sits near the envelope floor), uses more than one
// shape OR more than one material (variety reads as designed, not a single
// extruded block), and stays inside its envelope. Each property earns a point, up
// to 2. The evidence string cites which properties held.
//
// Using the Model for coherence is permitted by ADR-0008 but MUST be fakeable; we
// keep it analytic here so the unit suite stays deterministic and network-free,
// and leave the model-backed variant for a later slice.
func (e *Evaluator) scoreCoherence(ops []wire.BuildOp, env Envelope) (score int, evidence string) {
	var notes []string

	// Grounded: the lowest op AABB sits near the envelope floor.
	box := envelopeAABB(env)
	lowest := math.Inf(1)
	for _, op := range ops {
		if b := opAABB(op); b.min.Y < lowest {
			lowest = b.min.Y
		}
	}
	floorBand := 0.2 * math.Abs(env.Size.Y) // within the bottom fifth of the envelope
	grounded := len(ops) > 0 && lowest <= box.min.Y+floorBand+e.cfg.CollisionEpsilon
	if grounded {
		notes = append(notes, "grounded")
	}

	// Variety: more than one shape, or more than one material colour.
	shapes := map[wire.BuildShape]bool{}
	colors := map[string]bool{}
	for _, op := range ops {
		shapes[op.Shape] = true
		colors[strings.ToLower(op.Material.Color)] = true
	}
	varied := len(shapes) > 1 || len(colors) > 1
	if varied {
		notes = append(notes, "varied")
	}

	if grounded {
		score++
	}
	if varied {
		score++
	}
	if len(notes) == 0 {
		notes = append(notes, "flat single-shape mass")
	}
	sort.Strings(notes)
	evidence = fmt.Sprintf("%d shape(s), %d colour(s); %s", len(shapes), len(colors), strings.Join(notes, ", "))
	return score, evidence
}
