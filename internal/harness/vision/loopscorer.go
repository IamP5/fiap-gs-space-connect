package vision

import (
	"context"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/wire"
)

// LoopScorer adapts the vision pass to the loop's SilhouetteScorer seam: given a
// hard-gate-passing spec, it renders the real Scene3D headless, screenshots it,
// scores the silhouette through the vision model, and returns it as an
// evaluator.Score the loop folds into the verdict's rubric. It is the production
// bridge cmd/bake wires onto loop.Request.Vision.
//
// It carries the contract's Description/Style so each rendered spec is judged
// against the right intent (TaskType is supplied per-call by the loop). A nil
// Model or an unavailable Chrome surfaces as an error the loop treats as
// non-fatal (the silhouette dimension stays unscored — the soft rubric never
// blocks, ADR-0008).
type LoopScorer struct {
	Model       Model
	Render      RenderConfig
	Description string // the contract's done-criteria description
	Style       string // optional style guidance
}

// ScoreSilhouette satisfies loop.SilhouetteScorer. It builds the Intent from the
// per-call task type plus the scorer's contract context, then runs the full
// render-and-score vision pass.
func (s LoopScorer) ScoreSilhouette(ctx context.Context, taskType string, ops []wire.BuildOp) (evaluator.Score, error) {
	intent := Intent{TaskType: taskType, Description: s.Description, Style: s.Style}
	score, err := RenderAndScore(ctx, s.Model, s.Render, intent, ops)
	if err != nil {
		return evaluator.Score{}, err
	}
	return score.AsRubricScore(), nil
}
