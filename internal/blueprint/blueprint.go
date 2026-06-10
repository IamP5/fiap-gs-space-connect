package blueprint

import (
	"fmt"
	"math"
	"sort"
	"swarmbuild/internal/core/domain"
)

const (
	TypeFoundation domain.TaskType = "foundation"
	TypeWall       domain.TaskType = "wall"
	TypeDomeCap    domain.TaskType = "dome-cap"
	TypePanel      domain.TaskType = "panel"
	TypeMast       domain.TaskType = "mast"
)

type Envelope struct {
	Center domain.Vec3 `json:"center"`
	Size   domain.Vec3 `json:"size"`
}

type Contract struct {
	TaskID   domain.TaskID   `json:"task_id"`
	Type     domain.TaskType `json:"type"`
	Envelope Envelope        `json:"envelope"`
	Done     string          `json:"done"`
	Style    string          `json:"style,omitempty"`
}

type Task struct {
	ID       domain.TaskID
	Type     domain.TaskType
	Deps     []domain.TaskID
	Pos      domain.Vec2
	Envelope Envelope
}

type Blueprint struct {
	ID          string
	Name        string
	Description string
	Tasks       []Task
	Contracts   map[domain.TaskID]Contract
}

type PlacedTask struct {
	Task     domain.Task
	Pos      domain.Vec2
	Envelope Envelope
}

func (b Blueprint) Place(instance string, origin domain.Vec2, rotation float64) []PlacedTask {
	sin, cos := math.Sin(rotation), math.Cos(rotation)
	prefix := func(id domain.TaskID) domain.TaskID {
		return domain.TaskID(instance + "/" + string(id))
	}

	out := make([]PlacedTask, 0, len(b.Tasks))
	for _, t := range b.Tasks {
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
			},
			Pos:      abs,
			Envelope: t.Envelope,
		})
	}
	return out
}

func (p PlacedTask) Footprint() (minX, minY, maxX, maxY float64) {
	hx := math.Abs(p.Envelope.Size.X) / 2
	hy := math.Abs(p.Envelope.Size.Y) / 2
	cx := p.Pos.X + p.Envelope.Center.X
	cy := p.Pos.Y + p.Envelope.Center.Y
	return cx - hx, cy - hy, cx + hx, cy + hy
}

type Catalog struct {
	byID map[string]Blueprint
}

func DefaultCatalog() *Catalog {
	c := &Catalog{byID: make(map[string]Blueprint)}
	for _, b := range []Blueprint{domeBlueprint(), solarArrayBlueprint(), commsMastBlueprint()} {
		c.byID[b.ID] = b
	}
	return c
}

func (c *Catalog) Get(id string) (Blueprint, bool) {
	b, ok := c.byID[id]
	return b, ok
}

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

func domeBlueprint() Blueprint {
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

func solarArrayBlueprint() Blueprint {
	footEnv := Envelope{Center: domain.Vec3{}, Size: domain.Vec3{X: 16, Y: 12, Z: 3}}
	panelEnv := Envelope{Center: domain.Vec3{Z: 6}, Size: domain.Vec3{X: 18, Y: 14, Z: 8}}

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
