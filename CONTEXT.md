# SwarmBuild

Swarm-intelligence orchestration for autonomous construction in hostile, high-latency environments (the MVP scenario is robots building a lunar habitat before humans arrive). The product thesis: the worksite **reorganises itself** when robots fail, with no operator in the control loop.

## Language

### The worksite

**Rover**:
A single autonomous construction robot. It has its own decision loop, battery, and capabilities, bids for work, and reports its own state. A rover is an independent system regardless of how it is hosted.
_Avoid_: Bot, drone, unit, worker, agent (reserve "Robot Agent" for the software module that embodies a rover).

**Coordinator**:
The edge node (a lander) that runs the auction, tracks the worksite, and detects failure. It lives at the worksite, not on Earth — tactical decisions never wait for Earth.
_Avoid_: Server, master, controller, orchestrator.

**Earth**:
The remote mission-control side. Sets high-level goals and receives telemetry over a slow, asynchronous link; deliberately **outside** the tactical loop because of round-trip latency.
_Avoid_: Ground, base station, mission control (use "Earth" for the high-latency remote side specifically).

**Capability profile**:
The per-domain definition of what rovers can do and how cost is scored (lunar, mining, rescue). Swapping the profile retargets the same swarm to a different domain.
_Avoid_: Config, settings, robot type.

### The work

**Blueprint**:
The high-level definition of what to build. Decomposed into tasks; the operator authors a blueprint, never individual rover commands.
_Avoid_: Plan, spec, design, project.

**Task**:
An atomic unit of construction with a type, dependencies, and a lifecycle status. The smallest thing a rover is awarded and executes.
_Avoid_: Job, work item, ticket, step.

**Dependency**:
A "must-happen-before" ordering between tasks (no wall before its foundation). A blueprint whose dependencies form a cycle is rejected before work begins.
_Avoid_: Prerequisite, blocker, link.

**Ready set**:
The tasks whose dependencies are all complete — the only tasks eligible to be auctioned right now.
_Avoid_: Backlog, queue, todo.

**Task status**:
The lifecycle of a task: **UNCLAIMED** (needs a rover) → **LEASED** (a rover holds it) → **DONE** (terminal). A lost lease returns the task to UNCLAIMED.
_Avoid_: Open/in-progress/closed, pending/active/finished.

### Allocation

**Auction**:
The mechanism that assigns a task to the lowest-cost eligible rover (a Contract Net Protocol). Replaces a job queue because allocation must respect distance, capability, and dependencies.
_Avoid_: Scheduling, dispatch, assignment round.

**Bid**:
A rover's cost to perform an announced task, computed from distance, battery, capability, and current load. Lower is better; ties break deterministically by lower rover id.
_Avoid_: Offer, quote, vote.

**Award**:
The act of granting an auctioned task to the winning rover, as a lease.
_Avoid_: Assign, allocate (use for the general concept, "award" for the auction outcome).

### Failure and recovery

**Lease**:
A time-bounded grant of a task to a rover (it has a TTL). A task is never permanently bound to a rover, so a dead rover cannot freeze the work.
_Avoid_: Lock, claim, reservation, ownership.

**Heartbeat**:
The periodic signal by which a working rover renews its lease. Silence beyond the limit is how failure is detected.
_Avoid_: Ping, keepalive, pulse, healthcheck.

**Expiry**:
The lease ending because heartbeats stopped, releasing the task back to UNCLAIMED **exactly once**. The trigger for recovery.
_Avoid_: Timeout, cancellation, eviction.

**Re-auction**:
Announcing an expired (or otherwise released) task for a fresh auction so it is reassigned.
_Avoid_: Retry, requeue, reschedule.

**Self-heal**:
The emergent property that the worksite continues after a rover fails — recovery is the composition of expiry + re-auction, with no special supervisory logic and no Earth intervention. This is the entire pitch.
_Avoid_: Failover, recovery procedure, fault handling.

### Shared state

**World Model**:
The single shared picture of the worksite (every task and its status) that all rovers and the coordinator converge on, even after losing contact with each other.
_Avoid_: Database, store, state, cache.

**Partition**:
A loss of communication that splits the swarm. Rovers keep working on their local slice of the World Model while partitioned.
_Avoid_: Outage, disconnect, split-brain.

**Reconciliation**:
Merging divergent World Models back into one coherent picture when a link returns — order-independent and conflict-free, so concurrent claims on a task resolve deterministically.
_Avoid_: Sync, replication, conflict resolution.

### Demonstration

**Adapter (the seam)**:
The pluggable boundary between the orchestration core and the "world" (simulation today, real hardware later). Swapping it — not changing the core — is what enables the mining/rescue spin-offs.
_Avoid_: Driver, plugin, interface (too generic — name this boundary specifically).

**Kill**:
The deliberate failing of a rover during the demo to trigger self-heal. The headline kill is instantaneous; an optional encore fails a rover as a genuinely separate running system.
_Avoid_: Stop, disable, crash, terminate.

**Choreography**:
The deliberate pacing of the demo so an evaluator can *see* the self-heal beats (lease draining, re-auction, the replacement driving over). Every beat is derived from a real worksite event, never fabricated.
_Avoid_: Animation, scripting, demo mode, staging.
