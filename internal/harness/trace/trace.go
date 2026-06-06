// Package trace is the SwarmBuild lab-loop trace sidecar (TECHSPEC §4/§5,
// ADR-0008): each bake writes a <spec-key>.trace.json beside the cached spec
// recording the Build contract, every Generator↔Evaluator iteration (ops emitted +
// the Evaluator's layered verdict), and the final outcome (accepted | fallback, a
// quality_flag of ok | low, and a human-readable reason).
//
// It is DECLARATIVE DATA, never executed (ADR-0006), and has NO consumer on the
// headline path — it exists purely so "observed trace gaps" (the population of
// quality_flag:low specs) become inspectable, which is the trigger for the (B)→(C)
// topology decision (ADR-0008). It depends only on wire + the evaluator verdict
// type, so it stays trivially off the hot path.
package trace

import (
	"encoding/json"
	"fmt"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/wire"
)

// Result is the bake outcome for one Task.
type Result string

const (
	// ResultAccepted means a hard-gate-passing spec was frozen to the cache.
	ResultAccepted Result = "accepted"
	// ResultFallback means the loop exhausted its budget without passing the hard
	// gate, so the Task takes the primitive fallback (and still completes).
	ResultFallback Result = "fallback"
)

// QualityFlag is the advisory quality marker on a cached spec (ADR-0008).
type QualityFlag string

const (
	// QualityOK means the spec passed the hard gate and scored at/above the soft
	// threshold.
	QualityOK QualityFlag = "ok"
	// QualityLow means the spec passed the hard gate but scored BELOW the soft
	// threshold — it is cached and FLAGGED for operator review, never withheld.
	QualityLow QualityFlag = "low"
)

// Iteration is one Generator↔Evaluator pass: the ops the Generator emitted and the
// Evaluator's layered verdict on them.
type Iteration struct {
	GenOps  []wire.BuildOp    `json:"gen_ops"`
	Verdict evaluator.Verdict `json:"verdict"`
}

// Outcome is the final disposition of a bake (TECHSPEC §4).
type Outcome struct {
	Result      Result      `json:"result"`
	Cached      bool        `json:"cached"`
	QualityFlag QualityFlag `json:"quality_flag"`
	Reason      string      `json:"reason"`
}

// Trace is the per-Task lab-loop record written beside the cached spec
// (<spec-key>.trace.json). Contract is the Build contract's canonical JSON (kept
// raw so the trace does not couple to the bake.Contract Go type and round-trips
// byte-for-byte). Iterations lists every refine pass in order.
type Trace struct {
	BlueprintID string          `json:"blueprint_id"`
	TaskID      string          `json:"task_id"`
	Model       string          `json:"model"`
	Contract    json.RawMessage `json:"contract"`
	Iterations  []Iteration     `json:"iterations"`
	Outcome     Outcome         `json:"outcome"`
}

// Marshal renders the trace as indented JSON for committing beside the spec
// (stable, reviewable).
func (t Trace) Marshal() ([]byte, error) {
	b, err := json.MarshalIndent(t, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal trace: %w", err)
	}
	return b, nil
}

// Parse decodes a trace sidecar's bytes (the round-trip counterpart of Marshal).
func Parse(data []byte) (Trace, error) {
	var tr Trace
	if err := json.Unmarshal(data, &tr); err != nil {
		return Trace{}, fmt.Errorf("decode trace: %w", err)
	}
	return tr, nil
}

// FellBack reports whether this trace's Task took the primitive fallback (loop
// exhaustion). The operator review unions this with low-quality flags.
func (t Trace) FellBack() bool { return t.Outcome.Result == ResultFallback }

// LowQuality reports whether this trace's cached spec is flagged quality_flag:low.
func (t Trace) LowQuality() bool { return t.Outcome.QualityFlag == QualityLow }
