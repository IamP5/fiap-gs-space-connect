// Package allocation is the SwarmBuild Allocation Engine: a pure Contract Net
// auction. Given a task and a set of candidate rover states, it scores each
// eligible rover with a weighted cost function and returns the winner.
//
// It is a deep module in the sense of TECHSPEC §3: pure data in, a decision
// out. It imports only swarmbuild/core/domain and the standard library — no
// NATS, no simulation, no wall clock, no goroutines. Every result is
// deterministic and auditable, including tie-breaks (TECHSPEC §4, §7).
package allocation

import (
	"math"
	"swarmbuild/internal/core/domain"
)

// Weights tunes the relative influence of each term in the cost function
// (TECHSPEC §4):
//
//	cost = Dist·dist_to_task + Battery·(1/battery) + Capability·cap_penalty + Load·current_load
//
// Capability scales the capability penalty, but an ineligible rover (one that
// cannot perform the task) does not bid at all rather than incurring a finite
// penalty — the penalty is conceptually ∞ (TECHSPEC §4).
type Weights struct {
	Dist       float64
	Battery    float64
	Capability float64
	Load       float64
}

// DefaultWeights returns the demo's baseline weighting. Distance dominates so
// the visibly-nearest eligible rover tends to win; battery and load break
// near-ties so a fresher, less-busy rover edges out a tired one. Capability is
// unused for scoring (ineligible rovers are excluded outright) but is kept
// non-zero for completeness.
func DefaultWeights() Weights {
	return Weights{
		Dist:       1.0,
		Battery:    1.0,
		Capability: 1.0,
		Load:       1.0,
	}
}

// minBattery is the floor applied to a rover's battery before it enters the
// 1/battery term. A rover reporting zero, negative, or NaN charge is treated as
// effectively flat: it still bids (it is a valid candidate) but its cost is
// heavily penalised rather than producing +Inf or NaN, which would corrupt the
// deterministic ordering. domain.RoverState documents Battery as (0,1], so this
// only guards against malformed telemetry.
const minBattery = 1e-9

// Cost returns the bid cost for a rover on a task and whether the rover bids at
// all. bids is false exactly when the rover is ineligible — i.e. it cannot
// perform taskType (domain.RoverState.CanPerform is false), modelling the
// capability penalty of ∞ in TECHSPEC §4. When bids is false the returned cost
// is +Inf and must not be used.
func Cost(w Weights, r domain.RoverState, taskType domain.TaskType, taskPos domain.Vec2) (cost float64, bids bool) {
	if !r.CanPerform(taskType) {
		return math.Inf(1), false
	}

	battery := r.Battery
	if !(battery > minBattery) { // also catches NaN
		battery = minBattery
	}

	dist := r.Pos.Dist(taskPos)

	cost = w.Dist*dist +
		w.Battery*(1.0/battery) +
		w.Load*float64(r.CurrentLoad)

	return cost, true
}

// Award runs the auction for one task over candidates and returns the winning
// rover and true, or ("", false) if no candidate is eligible to bid.
//
// The winner is the eligible rover of lowest cost. Ties are broken strictly by
// lower RobotID under ordinary string comparison, so the outcome is fully
// determined by the inputs regardless of candidate order — the auditable
// tie-break of TECHSPEC §4.
func Award(w Weights, taskType domain.TaskType, taskPos domain.Vec2, candidates []domain.RoverState) (domain.RobotID, bool) {
	var (
		winner   domain.RobotID
		best     float64
		haveBest bool
	)

	for _, r := range candidates {
		cost, bids := Cost(w, r, taskType, taskPos)
		if !bids {
			continue
		}
		if !haveBest || cost < best || (cost == best && r.ID < winner) {
			winner = r.ID
			best = cost
			haveBest = true
		}
	}

	return winner, haveBest
}
