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

type Envelope struct {
	Center domain.Vec3 `json:"center"`
	Size   domain.Vec3 `json:"size"`
}

type DoneCriteria struct {
	MinOps      int     `json:"min_ops,omitempty"`
	MinCoverage float64 `json:"min_coverage,omitempty"`
	Description string  `json:"description,omitempty"`
}

type Neighbour struct {
	TaskID domain.TaskID
	Origin domain.Vec3
	Ops    []wire.BuildOp
}

type HardGate struct {
	Envelope  bool `json:"envelope"`
	Collision bool `json:"collision"`
	Done      bool `json:"done"`
}

func (g HardGate) Pass() bool { return g.Envelope && g.Collision && g.Done }

type Score struct {
	Score    int    `json:"score"`
	Evidence string `json:"evidence"`
}

type Rubric struct {
	DoneCoverage Score `json:"done_coverage"`
	Coherence    Score `json:"coherence"`
}

type Verdict struct {
	HardGate HardGate `json:"hard_gate"`
	Rubric   Rubric   `json:"rubric"`
}

func (v Verdict) Pass() bool { return v.HardGate.Pass() }

func (v Verdict) SoftScore() int {
	return v.Rubric.DoneCoverage.Score + v.Rubric.Coherence.Score
}

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

type Config struct {
	SoftScoreThreshold int
	CollisionEpsilon   float64
	EnvelopeMargin     float64
}

func DefaultConfig() Config {
	return Config{SoftScoreThreshold: 3, CollisionEpsilon: 1e-6, EnvelopeMargin: 0.12}
}

type Evaluator struct {
	cfg Config
}

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

func (e *Evaluator) Threshold() int { return e.cfg.SoftScoreThreshold }

func (e *Evaluator) Evaluate(ops []wire.BuildOp, env Envelope, done DoneCriteria, subjectOrigin domain.Vec3, neighbours []Neighbour) Verdict {
	schemaOK := spec.Validate(ops) == nil && len(ops) > 0

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

type aabb struct{ min, max domain.Vec3 }

func opAABB(op wire.BuildOp) aabb {
	hx, hy, hz := op.Scale.X/2, op.Scale.Y/2, op.Scale.Z/2
	return aabb{
		min: domain.Vec3{X: op.Pos.X - hx, Y: op.Pos.Y - hy, Z: op.Pos.Z - hz},
		max: domain.Vec3{X: op.Pos.X + hx, Y: op.Pos.Y + hy, Z: op.Pos.Z + hz},
	}
}

func (b aabb) translate(o domain.Vec3) aabb {
	return aabb{
		min: domain.Vec3{X: b.min.X + o.X, Y: b.min.Y + o.Y, Z: b.min.Z + o.Z},
		max: domain.Vec3{X: b.max.X + o.X, Y: b.max.Y + o.Y, Z: b.max.Z + o.Z},
	}
}

func envelopeAABB(env Envelope) aabb {
	hx, hy, hz := env.Size.X/2, env.Size.Y/2, env.Size.Z/2
	return aabb{
		min: domain.Vec3{X: env.Center.X - hx, Y: env.Center.Y - hy, Z: env.Center.Z - hz},
		max: domain.Vec3{X: env.Center.X + hx, Y: env.Center.Y + hy, Z: env.Center.Z + hz},
	}
}

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

func (e *Evaluator) checkCollision(ops []wire.BuildOp, subjectOrigin domain.Vec3, neighbours []Neighbour) bool {
	subj := make([]aabb, len(ops))
	for i, op := range ops {
		subj[i] = opAABB(op).translate(subjectOrigin)
	}
	for _, n := range neighbours {
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

func overlaps(a, b aabb, eps float64) bool {
	return a.min.X < b.max.X-eps && a.max.X > b.min.X+eps &&
		a.min.Y < b.max.Y-eps && a.max.Y > b.min.Y+eps &&
		a.min.Z < b.max.Z-eps && a.max.Z > b.min.Z+eps
}

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

func (e *Evaluator) scoreCoverage(ops []wire.BuildOp, env Envelope, done DoneCriteria) (frac float64, score int, evidence string) {
	frac = coverageFraction(ops, env)
	target := done.MinCoverage
	if target <= 0 {
		target = 0.15
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

func (e *Evaluator) scoreCoherence(ops []wire.BuildOp, env Envelope) (score int, evidence string) {
	var notes []string

	box := envelopeAABB(env)
	lowest := math.Inf(1)
	for _, op := range ops {
		if b := opAABB(op); b.min.Y < lowest {
			lowest = b.min.Y
		}
	}
	floorBand := 0.2 * math.Abs(env.Size.Y)
	grounded := len(ops) > 0 && lowest <= box.min.Y+floorBand+e.cfg.CollisionEpsilon
	if grounded {
		notes = append(notes, "grounded")
	}

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
