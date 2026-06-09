package allocation

import (
	"math"
	"swarmbuild/internal/core/domain"
)

type Weights struct {
	Dist       float64
	Battery    float64
	Capability float64
	Load       float64
}

func DefaultWeights() Weights {
	return Weights{
		Dist:       1.0,
		Battery:    1.0,
		Capability: 1.0,
		Load:       1.0,
	}
}

const minBattery = 1e-9

func Cost(w Weights, r domain.RoverState, taskType domain.TaskType, taskPos domain.Vec2) (cost float64, bids bool) {
	if !r.CanPerform(taskType) {
		return math.Inf(1), false
	}

	battery := r.Battery
	if !(battery > minBattery) {
		battery = minBattery
	}

	dist := r.Pos.Dist(taskPos)

	cost = w.Dist*dist +
		w.Battery*(1.0/battery) +
		w.Load*float64(r.CurrentLoad)

	return cost, true
}

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
