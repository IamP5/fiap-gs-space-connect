package allocation

import (
	"math"
	"swarmbuild/internal/core/domain"
	"testing"
)

const wall domain.TaskType = "wall"

func rover(id domain.RobotID, pos domain.Vec2, battery float64, load int, caps ...domain.Capability) domain.RoverState {
	return domain.RoverState{
		ID:           id,
		Pos:          pos,
		Battery:      battery,
		Capabilities: caps,
		CurrentLoad:  load,
	}
}

func at(x, y float64) domain.Vec2 { return domain.Vec2{X: x, Y: y} }

func TestCost_IneligibleDoesNotBid(t *testing.T) {
	w := DefaultWeights()
	r := rover("R1", at(0, 0), 1.0, 0, "foundation")

	cost, bids := Cost(w, r, wall, at(0, 0))
	if bids {
		t.Fatalf("ineligible rover bid: got bids=true, cost=%v", cost)
	}
	if !math.IsInf(cost, 1) {
		t.Fatalf("ineligible cost = %v, want +Inf", cost)
	}
}

func TestCost_EligibleBidsFinite(t *testing.T) {
	w := DefaultWeights()
	r := rover("R1", at(3, 4), 0.5, 2, "wall")

	cost, bids := Cost(w, r, wall, at(0, 0))
	if !bids {
		t.Fatal("eligible rover did not bid")
	}
	if cost != 9 {
		t.Fatalf("cost = %v, want 9", cost)
	}
}

func TestCost_GuardsNonPositiveBattery(t *testing.T) {
	w := DefaultWeights()
	for _, bat := range []float64{0, -0.5, math.NaN()} {
		r := rover("R1", at(0, 0), bat, 0, "wall")
		cost, bids := Cost(w, r, wall, at(0, 0))
		if !bids {
			t.Fatalf("battery=%v: rover should still bid", bat)
		}
		if math.IsInf(cost, 0) || math.IsNaN(cost) {
			t.Fatalf("battery=%v: cost = %v, want finite", bat, cost)
		}
	}
}

func TestAward(t *testing.T) {
	w := DefaultWeights()
	task := at(0, 0)

	tests := []struct {
		name       string
		candidates []domain.RoverState
		wantID     domain.RobotID
		wantOK     bool
	}{
		{
			name: "lowest valid cost wins",
			candidates: []domain.RoverState{
				rover("R1", at(10, 0), 1.0, 0, "wall"),
				rover("R2", at(2, 0), 1.0, 0, "wall"),
				rover("R3", at(5, 0), 1.0, 0, "wall"),
			},
			wantID: "R2",
			wantOK: true,
		},
		{
			name: "ineligible rover never wins even when nearest",
			candidates: []domain.RoverState{
				rover("R1", at(0, 0), 1.0, 0, "foundation"),
				rover("R2", at(8, 0), 1.0, 0, "wall"),
			},
			wantID: "R2",
			wantOK: true,
		},
		{
			name: "tie in cost -> lower robot id wins",
			candidates: []domain.RoverState{
				rover("R5", at(3, 0), 1.0, 1, "wall"),
				rover("R2", at(3, 0), 1.0, 1, "wall"),
				rover("R9", at(3, 0), 1.0, 1, "wall"),
			},
			wantID: "R2",
			wantOK: true,
		},
		{
			name: "nearest eligible wins given equal battery and load",
			candidates: []domain.RoverState{
				rover("R1", at(7, 0), 0.8, 1, "wall"),
				rover("R2", at(1, 0), 0.8, 1, "wall"),
				rover("R3", at(4, 0), 0.8, 1, "wall"),
			},
			wantID: "R2",
			wantOK: true,
		},
		{
			name: "most-charged eligible wins given equal distance and load",
			candidates: []domain.RoverState{
				rover("R1", at(5, 0), 0.25, 0, "wall"),
				rover("R2", at(5, 0), 1.00, 0, "wall"),
				rover("R3", at(5, 0), 0.50, 0, "wall"),
			},
			wantID: "R2",
			wantOK: true,
		},
		{
			name: "least-loaded eligible wins given equal distance and battery",
			candidates: []domain.RoverState{
				rover("R1", at(5, 0), 1.0, 4, "wall"),
				rover("R2", at(5, 0), 1.0, 0, "wall"),
				rover("R3", at(5, 0), 1.0, 2, "wall"),
			},
			wantID: "R2",
			wantOK: true,
		},
		{
			name:       "no candidates -> no winner",
			candidates: nil,
			wantID:     "",
			wantOK:     false,
		},
		{
			name: "no eligible candidates -> no winner",
			candidates: []domain.RoverState{
				rover("R1", at(1, 0), 1.0, 0, "foundation"),
				rover("R2", at(2, 0), 1.0, 0, "dome-cap"),
			},
			wantID: "",
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotID, gotOK := Award(w, wall, task, tt.candidates)
			if gotID != tt.wantID || gotOK != tt.wantOK {
				t.Fatalf("Award() = (%q, %v), want (%q, %v)", gotID, gotOK, tt.wantID, tt.wantOK)
			}
		})
	}
}

func TestAward_TieBreakIsOrderIndependent(t *testing.T) {
	w := DefaultWeights()
	a := rover("R2", at(3, 0), 1.0, 1, "wall")
	b := rover("R7", at(3, 0), 1.0, 1, "wall")

	got1, _ := Award(w, wall, at(0, 0), []domain.RoverState{a, b})
	got2, _ := Award(w, wall, at(0, 0), []domain.RoverState{b, a})
	if got1 != "R2" || got2 != "R2" {
		t.Fatalf("tie-break order dependent: got %q and %q, want R2 both", got1, got2)
	}
}

func TestAward_StrictlyWorseRoverNeverChangesWinner(t *testing.T) {
	w := DefaultWeights()
	task := at(0, 0)

	base := []domain.RoverState{
		rover("R1", at(2, 0), 0.9, 0, "wall"),
		rover("R2", at(6, 0), 0.7, 1, "wall"),
	}
	wantID, wantOK := Award(w, wall, task, base)
	if !wantOK || wantID != "R1" {
		t.Fatalf("baseline winner = (%q, %v), want (R1, true)", wantID, wantOK)
	}

	worse := []domain.RoverState{
		rover("R3", at(50, 0), 0.05, 9, "wall"),
		rover("R4", at(100, 0), 0.10, 5, "wall"),
		rover("R5", at(0, 0), 1.0, 0, "foundation"),
	}

	got, ok := Award(w, wall, task, append(append([]domain.RoverState{}, base...), worse...))
	if !ok || got != wantID {
		t.Fatalf("after adding strictly-worse rovers: winner = (%q, %v), want (%q, true)", got, ok, wantID)
	}
}
