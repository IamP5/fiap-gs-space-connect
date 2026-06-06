package trace

import (
	"encoding/json"
	"reflect"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/wire"
	"testing"
)

func sampleOp(color string) wire.BuildOp {
	return wire.BuildOp{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeBox,
		Pos:      domain.Vec3{X: 0, Y: -0.7, Z: 0},
		Rot:      domain.Vec3{},
		Scale:    domain.Vec3{X: 1, Y: 0.2, Z: 1},
		Material: wire.Material{Color: color},
	}
}

// TestTrace_RoundTrips: a Trace marshals and unmarshals byte-stably and lists every
// iteration's verdict + the outcome (the ADR-0008 audit invariant).
func TestTrace_RoundTrips(t *testing.T) {
	orig := Trace{
		BlueprintID: "dome",
		TaskID:      "foundation-1",
		Model:       "gpt-4o",
		Contract:    json.RawMessage(`{"task_id":"foundation-1","type":"foundation"}`),
		Iterations: []Iteration{
			{
				GenOps: []wire.BuildOp{sampleOp("#111")},
				Verdict: evaluator.Verdict{
					HardGate: evaluator.HardGate{Envelope: true, Collision: true, Done: false},
					Rubric: evaluator.Rubric{
						DoneCoverage: evaluator.Score{Score: 1, Evidence: "coverage 10%"},
						Coherence:    evaluator.Score{Score: 1, Evidence: "grounded"},
					},
				},
			},
			{
				GenOps: []wire.BuildOp{sampleOp("#111"), sampleOp("#222")},
				Verdict: evaluator.Verdict{
					HardGate: evaluator.HardGate{Envelope: true, Collision: true, Done: true},
					Rubric: evaluator.Rubric{
						DoneCoverage: evaluator.Score{Score: 2, Evidence: "coverage 20%"},
						Coherence:    evaluator.Score{Score: 2, Evidence: "grounded, varied"},
					},
				},
			},
		},
		Outcome: Outcome{
			Result:      ResultAccepted,
			Cached:      true,
			QualityFlag: QualityOK,
			Reason:      "hard gate passed; soft score 4/4",
		},
	}

	data, err := orig.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, err := Parse(data)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	// The Contract is carried as raw JSON; MarshalIndent re-indents it, so compare it
	// semantically (compacted) and the rest structurally.
	if !jsonEqual(t, orig.Contract, got.Contract) {
		t.Fatalf("contract did not round-trip semantically:\n orig=%s\n got =%s", orig.Contract, got.Contract)
	}
	origNoContract, gotNoContract := orig, got
	origNoContract.Contract, gotNoContract.Contract = nil, nil
	if !reflect.DeepEqual(origNoContract, gotNoContract) {
		t.Fatalf("trace did not round-trip:\n orig=%+v\n got =%+v", origNoContract, gotNoContract)
	}

	// The trace lists every iteration's verdict and the final outcome.
	if len(got.Iterations) != 2 {
		t.Fatalf("want 2 iterations recorded, got %d", len(got.Iterations))
	}
	if got.Iterations[0].Verdict.HardGate.Done {
		t.Fatal("first iteration's verdict should record done=false")
	}
	if !got.Iterations[1].Verdict.Pass() {
		t.Fatal("second iteration's verdict should record a passing hard gate")
	}
	if got.Outcome.Result != ResultAccepted || !got.Outcome.Cached {
		t.Fatalf("outcome must record accepted+cached, got %+v", got.Outcome)
	}

	// Re-marshalling the parsed trace yields identical bytes (stable on disk): the
	// parsed trace's contract is already indented, so a second round is a fixpoint.
	got2, err := Parse(data)
	if err != nil {
		t.Fatalf("re-parse: %v", err)
	}
	dataA, _ := got.Marshal()
	dataB, _ := got2.Marshal()
	if string(dataA) != string(dataB) {
		t.Fatal("trace bytes are not stable across a parse/marshal/parse/marshal cycle")
	}
}

// jsonEqual reports whether two raw JSON values are semantically equal (key order /
// whitespace insensitive).
func jsonEqual(t *testing.T, a, b json.RawMessage) bool {
	t.Helper()
	var av, bv any
	if err := json.Unmarshal(a, &av); err != nil {
		t.Fatalf("unmarshal a: %v", err)
	}
	if err := json.Unmarshal(b, &bv); err != nil {
		t.Fatalf("unmarshal b: %v", err)
	}
	return reflect.DeepEqual(av, bv)
}

// TestTrace_FellBackAndLowQuality: the convenience predicates the operator review
// reads off a trace.
func TestTrace_FellBackAndLowQuality(t *testing.T) {
	fb := Trace{Outcome: Outcome{Result: ResultFallback, QualityFlag: QualityOK}}
	if !fb.FellBack() || fb.LowQuality() {
		t.Fatalf("fallback trace: FellBack=%v LowQuality=%v, want true,false", fb.FellBack(), fb.LowQuality())
	}
	low := Trace{Outcome: Outcome{Result: ResultAccepted, Cached: true, QualityFlag: QualityLow}}
	if low.FellBack() || !low.LowQuality() {
		t.Fatalf("low-quality trace: FellBack=%v LowQuality=%v, want false,true", low.FellBack(), low.LowQuality())
	}
}
