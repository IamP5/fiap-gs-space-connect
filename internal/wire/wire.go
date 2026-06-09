package wire

import (
	"fmt"
	"swarmbuild/internal/core/domain"
)

const (
	SubjTaskAnnounce = "task.announce"
	SubjTaskAward    = "task.award"
	SubjTaskComplete = "task.complete"
	SubjTaskFailed   = "task.failed"
	SubjSnapshot     = "world.snapshot"
	SubjEarthUplink  = "earth.uplink"
)

func SubjBid(task domain.TaskID) string { return "task.bid." + string(task) }

const SubjBidWildcard = "task.bid.*"

func SubjHeartbeat(robot domain.RobotID) string { return "robot.heartbeat." + string(robot) }

const SubjHeartbeatWildcard = "robot.heartbeat.*"

func SubjTelemetry(robot domain.RobotID) string { return "robot.telemetry." + string(robot) }

const SubjTelemetryWildcard = "robot.telemetry.*"

func SubjBuildOp(task domain.TaskID) string { return "build.op." + string(task) }

const SubjBuildOpWildcard = "build.op.*"

const (
	KVBucketWorld = "world"
)

func KVSpecKey(task domain.TaskID) string { return "spec/" + string(task) }

type Announce struct {
	TaskID  domain.TaskID   `json:"task_id"`
	Type    domain.TaskType `json:"type"`
	Pos     domain.Vec2     `json:"pos"`
	Mode    string          `json:"mode,omitempty"`
	SiteID  string          `json:"site,omitempty"`
	Version domain.Lamport  `json:"version"`
}

type Bid struct {
	TaskID domain.TaskID  `json:"task_id"`
	Robot  domain.RobotID `json:"robot_id"`
	Cost   float64        `json:"cost"`
}

type Award struct {
	TaskID   domain.TaskID   `json:"task_id"`
	Robot    domain.RobotID  `json:"robot_id"`
	Type     domain.TaskType `json:"type,omitempty"`
	Mode     string          `json:"mode,omitempty"`
	Pos      domain.Vec2     `json:"pos"`
	LeaseTTL domain.Tick     `json:"lease_ttl"`
	Version  domain.Lamport  `json:"version"`

	PriorOps []BuildOp `json:"prior_ops,omitempty"`
}

type Complete struct {
	TaskID domain.TaskID  `json:"task_id"`
	Robot  domain.RobotID `json:"robot_id"`
}

type Failed struct {
	TaskID domain.TaskID  `json:"task_id"`
	Robot  domain.RobotID `json:"robot_id"`
	Reason string         `json:"reason,omitempty"`
}

const ReasonBuilderDied = "builder-died"

type Heartbeat struct {
	Robot  domain.RobotID `json:"robot_id"`
	TaskID domain.TaskID  `json:"task_id"`
	At     domain.Tick    `json:"at"`
}

type Telemetry struct {
	Robot   domain.RobotID `json:"robot_id"`
	Pos     domain.Vec2    `json:"pos"`
	Battery float64        `json:"battery"`
	Alive   bool           `json:"alive"`
	Load    int            `json:"load"`
	At      domain.Tick    `json:"at"`
	Site    string         `json:"site,omitempty"`
}

type RoverView struct {
	ID      domain.RobotID `json:"id"`
	Pos     domain.Vec2    `json:"pos"`
	Battery float64        `json:"battery"`
	Alive   bool           `json:"alive"`
	Load    int            `json:"load"`
	Task    domain.TaskID  `json:"task,omitempty"`
	Site    string         `json:"site,omitempty"`
}

type TaskView struct {
	ID          domain.TaskID   `json:"id"`
	Type        domain.TaskType `json:"type"`
	Pos         domain.Vec2     `json:"pos"`
	Status      string          `json:"status"`
	Assignee    domain.RobotID  `json:"assignee,omitempty"`
	LeaseExpiry domain.Tick     `json:"lease_expiry,omitempty"`
	Version     domain.Lamport  `json:"version"`
	Deps        []domain.TaskID `json:"deps,omitempty"`
	Site        string          `json:"site,omitempty"`
	BuildSpec   []BuildOp       `json:"build_spec,omitempty"`
}

type BuildShape string

const (
	ShapeBox      BuildShape = "box"
	ShapeCylinder BuildShape = "cylinder"
	ShapeSphere   BuildShape = "sphere"
	ShapeModel    BuildShape = "model"
	ShapeModule   BuildShape = "module"
)

const (
	BuildOpPlace  = "place"
	BuildOpMove   = "move"
	BuildOpDelete = "delete"
)

type Material struct {
	Color        string   `json:"color"`
	Roughness    *float64 `json:"roughness,omitempty"`
	Metalness    *float64 `json:"metalness,omitempty"`
	Map          string   `json:"map,omitempty"`
	NormalMap    string   `json:"normal_map,omitempty"`
	RoughnessMap string   `json:"roughness_map,omitempty"`
	AOMap        string   `json:"ao_map,omitempty"`
}

type BuildOp struct {
	Op       string      `json:"op"`
	ID       string      `json:"id"`
	Shape    BuildShape  `json:"shape"`
	Pos      domain.Vec3 `json:"pos"`
	Rot      domain.Vec3 `json:"rot"`
	Scale    domain.Vec3 `json:"scale"`
	Material Material    `json:"material"`
	ModelRef string      `json:"model_ref,omitempty"`
	AssetKey string      `json:"asset_key,omitempty"`
	Part     string      `json:"part,omitempty"`
}

type BuildOpMsg struct {
	TaskID domain.TaskID `json:"task_id"`
	Seq    int           `json:"seq"`
	Op     BuildOp       `json:"op"`
}

const (
	EventBid      = "bid"
	EventWon      = "won"
	EventExpired  = "expired"
	EventSolidify = "solidify"
	EventRevived  = "revived"
)

type Event struct {
	Kind   string         `json:"kind"`
	TaskID domain.TaskID  `json:"task_id,omitempty"`
	Robot  domain.RobotID `json:"robot_id,omitempty"`
	Value  float64        `json:"value,omitempty"`
	At     domain.Tick    `json:"at"`
}

type Snapshot struct {
	Type      string      `json:"type"`
	Connected bool        `json:"connected"`
	Rovers    []RoverView `json:"rovers"`
	Tasks     []TaskView  `json:"tasks"`
	Events    []Event     `json:"events,omitempty"`
	At        domain.Tick `json:"at"`
}

type EarthUplink struct {
	Type   string      `json:"type"`
	Rovers []RoverView `json:"rovers"`
	Tasks  []TaskView  `json:"tasks"`
	At     domain.Tick `json:"at"`
}

type Control struct {
	Cmd   string         `json:"cmd"`
	Robot domain.RobotID `json:"robot,omitempty"`
	Value float64        `json:"value,omitempty"`

	BlueprintID string      `json:"blueprint_id,omitempty"`
	Origin      domain.Vec2 `json:"origin,omitzero"`
	Rotation    float64     `json:"rotation,omitempty"`
	Mode        string      `json:"mode,omitempty"`
}

const SubjControl = "control.command"

func (a Announce) String() string {
	return fmt.Sprintf("announce task=%s type=%s v=%d", a.TaskID, a.Type, a.Version)
}
