package trace

import (
	"encoding/json"
	"fmt"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/wire"
)

type Result string

const (
	ResultAccepted Result = "accepted"
	ResultFallback Result = "fallback"
)

type QualityFlag string

const (
	QualityOK  QualityFlag = "ok"
	QualityLow QualityFlag = "low"
)

type Iteration struct {
	GenOps  []wire.BuildOp    `json:"gen_ops"`
	Verdict evaluator.Verdict `json:"verdict"`
}

type Outcome struct {
	Result      Result      `json:"result"`
	Cached      bool        `json:"cached"`
	QualityFlag QualityFlag `json:"quality_flag"`
	Reason      string      `json:"reason"`
}

type Trace struct {
	BlueprintID string          `json:"blueprint_id"`
	TaskID      string          `json:"task_id"`
	Model       string          `json:"model"`
	Contract    json.RawMessage `json:"contract"`
	Iterations  []Iteration     `json:"iterations"`
	Outcome     Outcome         `json:"outcome"`
}

func (t Trace) Marshal() ([]byte, error) {
	b, err := json.MarshalIndent(t, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal trace: %w", err)
	}
	return b, nil
}

func Parse(data []byte) (Trace, error) {
	var tr Trace
	if err := json.Unmarshal(data, &tr); err != nil {
		return Trace{}, fmt.Errorf("decode trace: %w", err)
	}
	return tr, nil
}

func (t Trace) FellBack() bool { return t.Outcome.Result == ResultFallback }

func (t Trace) LowQuality() bool { return t.Outcome.QualityFlag == QualityLow }
