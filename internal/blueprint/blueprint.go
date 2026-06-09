// Package blueprint is the catalog of pre-authored SwarmBuild Blueprints and the
// Architect-authored Build contracts that go with them (bh-05).
//
// A Blueprint is a reusable, named structure the dashboard can drag into the
// world: a small DAG of Tasks (ids, types, deps, positions RELATIVE to the
// blueprint origin) plus, per Task, a Build Envelope and an Architect-authored
// Build Contract. The contracts are pre-baked DATA here — not generated live
// (live decomposition is a later lab slice, ADR-0005). Each Task's Envelope and
// Contract describe WHAT a finished Task occupies and what "done" means; the
// coordinator uses the envelopes for no-overlap placement validation, and the
// renderer still draws via the snapshot's build_spec-or-tierOf fallback, so this
// slice needs no LLM.
//
// Envelope and Contract are defined HERE (not in internal/harness) on purpose:
// bh-05 runs in parallel with the harness slices, so the authoring-side types
// live in their own package to keep the merge clean; a later slice may unify the
// Contract shape with the harness's BuildContract.
//
// Placement: Place(origin, rotation) instantiates a catalog Blueprint into
// absolute, prefixed Tasks at a worksite anchor, rotating each relative position
// about the origin. The coordinator injects the returned tasks into its Planner +
// World Model so the Auction feeds on them exactly as it does the startup
// blueprint.
package blueprint

import (
	"fmt"
	"math"
	"sort"
	"swarmbuild/internal/core/domain"
)

// Task-type names shared with the demo dome blueprint (internal/demo). The dome
// catalog entry reuses these EXACT strings so a placed dome injects the same task
// shapes the rovers already advertise capabilities for.
const (
	TypeFoundation domain.TaskType = "foundation"
	TypeWall       domain.TaskType = "wall"
	TypeDomeCap    domain.TaskType = "dome-cap"
	TypePanel      domain.TaskType = "panel"
	TypeMast       domain.TaskType = "mast"
)

// Envelope is a Task's Build envelope (TECHSPEC §4): the axis-aligned box, in
// worksite units, that the Task's finished geometry must stay within. center is
// relative to the Task's worksite position (the footprint is centered on the
// task); size is the full extent (width, depth, height). The coordinator
// projects the footprint (size X/Y) at the task position to test no-overlap.
type Envelope struct {
	Center domain.Vec3 `json:"center"`
	Size   domain.Vec3 `json:"size"`
}

// Contract is an Architect-authored Build contract (TECHSPEC §4), carried as
// pre-baked DATA. It ties a Task to its Envelope and a measurable Done criterion;
// Style is optional aesthetic guidance. In this slice the contract is descriptive
// metadata (the renderer uses the fallback geometry), but every catalog Blueprint
// has one for every Task, so the authoring path is complete end-to-end.
type Contract struct {
	TaskID   domain.TaskID   `json:"task_id"`
	Type     domain.TaskType `json:"type"`
	Envelope Envelope        `json:"envelope"`
	Done     string          `json:"done"`            // measurable done criterion, e.g. "footprint covered"
	Style    string          `json:"style,omitempty"` // optional aesthetic guidance
}

// Task is one node of a Blueprint's DAG: a domain Task shape with a position
// RELATIVE to the blueprint origin and its Build envelope. The id is the local id
// (e.g. "foundation-1"); Place prefixes it with a per-placement instance id so
// two placed copies never collide in the World Model.
type Task struct {
	ID       domain.TaskID
	Type     domain.TaskType
	Deps     []domain.TaskID // local ids (same blueprint), prefixed on Place
	Pos      domain.Vec2     // relative to the blueprint origin
	Envelope Envelope
}

// Blueprint is a named, reusable structure: a DAG of Tasks plus the
// Architect-authored Build contracts (one per Task). Contracts is keyed by local
// task id.
type Blueprint struct {
	ID          string
	Name        string
	Description string
	Tasks       []Task
	Contracts   map[domain.TaskID]Contract
}

// PlacedTask is one instantiated Task: an absolute domain.Task (prefixed id,
// remapped deps) paired with its absolute worksite position and footprint
// envelope, ready for the coordinator to inject and for placement validation.
type PlacedTask struct {
	Task     domain.Task
	Pos      domain.Vec2
	Envelope Envelope
}

// Place instantiates the Blueprint at the given worksite origin and rotation
// (radians, about the origin), under a unique instance prefix so repeated
// placements never share task ids. Each relative position is rotated then
// translated to the origin; deps are remapped to the prefixed ids. The returned
// tasks are UNCLAIMED at version 0 — the coordinator stamps the injection version
// when it admits them, like the startup blueprint. instance must be non-empty and
// unique per placement (the coordinator derives it from a monotonic counter).
//
// mode tags every instantiated Task's build mode (bh-08c): "live" ⇒ a winning
// Rover runs the Build harness inline; empty/"replay" ⇒ the deterministic replay
// stream. It is a plain string carried on domain.Task.Mode, so the blueprint
// package stays model-free. An empty mode leaves every Task at the replay default,
// so existing callers that pass "" are byte-for-byte unchanged.
func (b Blueprint) Place(instance string, origin domain.Vec2, rotation float64, mode string) []PlacedTask {
	sin, cos := math.Sin(rotation), math.Cos(rotation)
	prefix := func(id domain.TaskID) domain.TaskID {
		return domain.TaskID(instance + "/" + string(id))
	}

	out := make([]PlacedTask, 0, len(b.Tasks))
	for _, t := range b.Tasks {
		// Rotate the relative position about the origin, then translate to it.
		rx := t.Pos.X*cos - t.Pos.Y*sin
		ry := t.Pos.X*sin + t.Pos.Y*cos
		abs := domain.Vec2{
			X: math.Round((origin.X+rx)*100) / 100,
			Y: math.Round((origin.Y+ry)*100) / 100,
		}

		deps := make([]domain.TaskID, 0, len(t.Deps))
		for _, d := range t.Deps {
			deps = append(deps, prefix(d))
		}

		out = append(out, PlacedTask{
			Task: domain.Task{
				ID:     prefix(t.ID),
				Type:   t.Type,
				Deps:   deps,
				Status: domain.Unclaimed,
				Mode:   mode, // per-placement build mode tag (bh-08c); "" ⇒ replay default
			},
			Pos:      abs,
			Envelope: t.Envelope,
		})
	}
	return out
}

// Footprint returns the absolute axis-aligned XY half-extents of a placed task's
// envelope footprint, centered on its worksite position. Used by the coordinator
// to test no-overlap between two placed structures. The envelope footprint is
// orientation-independent here (axis-aligned box), a conservative bound that is
// rotation-safe: rotating an AABB can only grow its axis-aligned cover, and the
// coordinator pads overlap tests, so two placements that visibly touch are
// rejected.
func (p PlacedTask) Footprint() (minX, minY, maxX, maxY float64) {
	hx := math.Abs(p.Envelope.Size.X) / 2
	hy := math.Abs(p.Envelope.Size.Y) / 2
	cx := p.Pos.X + p.Envelope.Center.X
	cy := p.Pos.Y + p.Envelope.Center.Y
	return cx - hx, cy - hy, cx + hx, cy + hy
}

// Catalog is the registry of pre-authored Blueprints, keyed by id. Get returns a
// Blueprint and whether it exists; All lists them in a stable, id-sorted order so
// the palette and tests are deterministic.
type Catalog struct {
	byID map[string]Blueprint
}

// DefaultCatalog is the pre-authored Blueprint catalog shipped with the demo: the
// habitat dome (matching internal/demo's dome task shapes) plus two new
// structures — a solar array and a comms mast.
func DefaultCatalog() *Catalog {
	c := &Catalog{byID: make(map[string]Blueprint)}
	for _, b := range []Blueprint{domeBlueprint(), solarArrayBlueprint(), commsMastBlueprint()} {
		c.byID[b.ID] = b
	}
	return c
}

// Get returns the Blueprint with the given id and whether it exists.
func (c *Catalog) Get(id string) (Blueprint, bool) {
	b, ok := c.byID[id]
	return b, ok
}

// All returns every catalog Blueprint in id-sorted order (deterministic for the
// palette and tests).
func (c *Catalog) All() []Blueprint {
	ids := make([]string, 0, len(c.byID))
	for id := range c.byID {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]Blueprint, 0, len(ids))
	for _, id := range ids {
		out = append(out, c.byID[id])
	}
	return out
}

// ring places n points evenly on a circle of the given radius centred at the
// blueprint origin, starting from straight up (12 o'clock) and going clockwise,
// matching internal/demo's ring so the dome catalog entry reproduces the demo
// dome's footprint. Coordinates round to 0.01 for byte-stable placement.
func ring(n int, radius, startDeg float64) []domain.Vec2 {
	pts := make([]domain.Vec2, n)
	for i := range n {
		theta := (startDeg - float64(i)*360.0/float64(n)) * math.Pi / 180.0
		pts[i] = domain.Vec2{
			X: math.Round(radius*math.Cos(theta)*100) / 100,
			Y: math.Round(radius*math.Sin(theta)*100) / 100,
		}
	}
	return pts
}

// contractsFor builds the per-Task Contract map from a Blueprint's tasks, with a
// generic measurable Done criterion per task type. Keeps every catalog Blueprint
// guaranteed to have a contract for every Task (acceptance: contracts exist for
// every catalog Blueprint).
func contractsFor(tasks []Task) map[domain.TaskID]Contract {
	done := map[domain.TaskType]string{
		TypeFoundation: "footprint slab placed and level",
		TypeWall:       "wall segment closes its arc to full height",
		TypeDomeCap:    "cap seals the dome silhouette",
		TypePanel:      "panel array faces the sun, frame filled",
		TypeMast:       "mast reaches target height, antenna seated",
	}
	out := make(map[domain.TaskID]Contract, len(tasks))
	for _, t := range tasks {
		out[t.ID] = Contract{
			TaskID:   t.ID,
			Type:     t.Type,
			Envelope: t.Envelope,
			Done:     done[t.Type],
		}
	}
	return out
}

// domeBlueprint is the lunar habitat dome as a catalog Blueprint, matching
// internal/demo.DomeBlueprint's task shapes (four foundations, six walls each on a
// foundation, a dome-cap needing all walls) so a placed dome injects the same DAG
// the demo rovers already build. The wall ring is deliberately sparse (six, not a
// tight octagon) so the dome shell reads through the gaps — matching the refined
// mock hero (web/src/mocks/snapshot.ts).
func domeBlueprint() Blueprint {
	// Ring radii are worksite units; the renderer draws 1 unit ≈ 0.3 scene units
	// (SCENE_UNITS_PER_METER·worksiteUnitsToMeters), so these compact radii ring the
	// walls/foundations snugly around the dome skirt instead of scattering them
	// across the plain. The dome shell occupies ~10 worksite units of radius, so the
	// wall ring sits just outside it.
	wallPos := ring(6, 12, 90)
	foundationPos := ring(4, 11, 68)

	footEnv := Envelope{Center: domain.Vec3{}, Size: domain.Vec3{X: 14, Y: 14, Z: 4}}
	wallEnv := Envelope{Center: domain.Vec3{}, Size: domain.Vec3{X: 12, Y: 12, Z: 14}}
	capEnv := Envelope{Center: domain.Vec3{}, Size: domain.Vec3{X: 40, Y: 40, Z: 26}}

	var tasks []Task
	for i := 1; i <= 4; i++ {
		tasks = append(tasks, Task{
			ID:       domain.TaskID(fmt.Sprintf("foundation-%d", i)),
			Type:     TypeFoundation,
			Pos:      foundationPos[i-1],
			Envelope: footEnv,
		})
	}
	wallIDs := make([]domain.TaskID, 0, 6)
	for i := 1; i <= 6; i++ {
		id := domain.TaskID(fmt.Sprintf("wall-%d", i))
		wallIDs = append(wallIDs, id)
		foundation := domain.TaskID(fmt.Sprintf("foundation-%d", (i-1)%4+1))
		tasks = append(tasks, Task{
			ID:       id,
			Type:     TypeWall,
			Deps:     []domain.TaskID{foundation},
			Pos:      wallPos[i-1],
			Envelope: wallEnv,
		})
	}
	tasks = append(tasks, Task{
		ID:       domain.TaskID(TypeDomeCap),
		Type:     TypeDomeCap,
		Deps:     wallIDs,
		Pos:      domain.Vec2{X: 0, Y: 0},
		Envelope: capEnv,
	})

	return Blueprint{
		ID:          "dome",
		Name:        "Habitat dome",
		Description: "Pressurised lunar habitat: 4 foundations, 6 walls, a sealing cap.",
		Tasks:       tasks,
		Contracts:   contractsFor(tasks),
	}
}

// solarArrayBlueprint is a photovoltaic farm: two foundation pads in a row, each
// carrying a panel that depends on it. A simple two-tier DAG that builds in
// parallel (both foundations first) then tops out with the panels.
func solarArrayBlueprint() Blueprint {
	footEnv := Envelope{Center: domain.Vec3{}, Size: domain.Vec3{X: 16, Y: 12, Z: 3}}
	panelEnv := Envelope{Center: domain.Vec3{Z: 6}, Size: domain.Vec3{X: 18, Y: 14, Z: 8}}

	// Pads sit ±5 worksite units off the origin (≈3 scene units apart) so the two
	// sun-tracking panels stand shoulder-to-shoulder as one array, not two isolated
	// panels marooned across the plain.
	tasks := []Task{
		{ID: "pad-1", Type: TypeFoundation, Pos: domain.Vec2{X: -5, Y: 0}, Envelope: footEnv},
		{ID: "pad-2", Type: TypeFoundation, Pos: domain.Vec2{X: 5, Y: 0}, Envelope: footEnv},
		{ID: "panel-1", Type: TypePanel, Deps: []domain.TaskID{"pad-1"}, Pos: domain.Vec2{X: -5, Y: 0}, Envelope: panelEnv},
		{ID: "panel-2", Type: TypePanel, Deps: []domain.TaskID{"pad-2"}, Pos: domain.Vec2{X: 5, Y: 0}, Envelope: panelEnv},
	}
	return Blueprint{
		ID:          "solar-array",
		Name:        "Solar array",
		Description: "Two-pad photovoltaic array: foundations then sun-tracking panels.",
		Tasks:       tasks,
		Contracts:   contractsFor(tasks),
	}
}

// commsMastBlueprint is a communications mast: a single foundation, a mast on it,
// and a dome-cap-typed antenna keystone on the mast — a strictly linear DAG that
// exercises a deeper dependency chain than the dome's two tiers.
func commsMastBlueprint() Blueprint {
	footEnv := Envelope{Center: domain.Vec3{}, Size: domain.Vec3{X: 12, Y: 12, Z: 3}}
	mastEnv := Envelope{Center: domain.Vec3{Z: 12}, Size: domain.Vec3{X: 6, Y: 6, Z: 24}}
	antennaEnv := Envelope{Center: domain.Vec3{Z: 26}, Size: domain.Vec3{X: 14, Y: 14, Z: 6}}

	tasks := []Task{
		{ID: "base", Type: TypeFoundation, Pos: domain.Vec2{X: 0, Y: 0}, Envelope: footEnv},
		{ID: "mast", Type: TypeMast, Deps: []domain.TaskID{"base"}, Pos: domain.Vec2{X: 0, Y: 0}, Envelope: mastEnv},
		{ID: "antenna", Type: TypeDomeCap, Deps: []domain.TaskID{"mast"}, Pos: domain.Vec2{X: 0, Y: 0}, Envelope: antennaEnv},
	}
	return Blueprint{
		ID:          "comms-mast",
		Name:        "Comms mast",
		Description: "Linear chain: foundation, mast, antenna keystone.",
		Tasks:       tasks,
		Contracts:   contractsFor(tasks),
	}
}
