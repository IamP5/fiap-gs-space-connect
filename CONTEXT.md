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
The deliberate pacing of the demo so an evaluator can *see* the self-heal beats (lease draining, re-auction, the replacement driving over). Every beat is derived from a real worksite event, never fabricated. Pacing has two modes: **scripted** (the demo package widens the real auction/lease windows and auto-fires the rehearsal Kill — server-authoritative, deterministic) and **interactive** (an **operator** paces the demo live from the dashboard, firing *real* worksite events — the Kill, the Earth-latency climb — at the dramatic moment). Interactive choreography only moves the *when* of a real event to a human; it never fabricates a beat, so "derived from a real worksite event" still holds.
_Avoid_: Animation, scripting, demo mode, staging.

**Scenery**:
The non-diegetic decoration layer of the 3D view that encodes **no** World Model state — the Moon, starfield, regolith ground, inert space set-pieces (a landed lander, launch structures), and the **orbit site markers** (the in-world diamonds and their `operacional / em construção` site-identity labels). A marker label denotes that a worksite is *established*, **not** that its dome is complete — the dome's true completion lives in the snapshot-derived **MissionHud progress bar + Task Ledger**, never in the marker. It exists for realism/orientation only: unlike Choreography it is not derived from a worksite event, and unlike the rendered Rovers and Tasks it is never read back as truth. It is the boundary that keeps the scene a pure re-render of the snapshot (ADR-0004) even as realistic assets are added. Set-pieces that *imply* activity the swarm isn't doing (e.g. an active launch) are admitted only as Scenery, knowingly non-diegetic — they are not a worksite beat.
_Avoid_: Background, props, set dressing, backdrop (name the non-diegetic layer specifically).

### The build harness (AI construction layer)

The agentic layer that sits **on top of** the deterministic swarm. It never decides *who* builds or *when* (the Auction owns that, untouched); it only produces *what a completed task looks like*. The swarm self-heals deterministically; the harness adds the visible construction.

**Architect**:
The single planning harness that turns a Blueprint into Build contracts — it authors *intent* ("what this wall should look like, and what done means"). Distinct from the **Planner** module, which deterministically computes the DAG and ready set; the Architect is the LLM layer that authors the per-task specs the Planner's tasks are built against.
_Avoid_: Leader, orchestrator, master, delegator (it does not assign work — the Auction does); also avoid reusing "Planner" for it.

**Build contract**:
The per-task definition of what to construct and what "done" looks like, authored by the Architect and handed to whichever Rover wins the task at Auction. The construction analogue of the sprint contract: agreed before any geometry is generated.
_Avoid_: Ticket, task spec, prompt, instructions.

**Build harness**:
The agentic loop a Rover runs to satisfy a Build contract — it generates a Build spec (declarative build operations), observing its own world snapshot, until the contract's "done" is met. One per working Rover.
_Avoid_: Generator, codegen, agent loop, executor.

**Build spec**:
The declarative, engine-agnostic description of geometry a Build harness emits — an **append-only ordered log of build operations** the renderer **folds, then interprets, never executes**. An operation either *places* geometry (a primitive/model with transform + material) or, when a harness revises its own earlier work, *moves* or *deletes* an existing one; folding the log yields the Task's current geometry. It is durable Task state (carried in the snapshot), so the scene stays a pure re-render (ADR-0004). Designed to grow from primitives + procedural materials to custom models (glTF) and textures without changing the seam.
_Avoid_: Three.js code, mesh, payload, script (it is data, not executable code).

**Asset**:
A licensed, self-hosted piece of 3D art a Build spec can place — a glTF model (`.glb`) or a texture — referenced by a Build op (`model_ref` / `material.map`) and always backed by a primitive fallback so a missing one degrades to geometry, never a broken scene. Distinct from a **Model** (the LLM behind the Model seam) and from a **Rover** (the worker): an Asset is inert art.
_Avoid_: Model, mesh, prop, resource (reserve "model" for the LLM).

**Asset catalog**:
The curated, validated, **closed** set of Assets a Build harness is allowed to place — each entry pairing an Asset's `model_ref` with the task types it suits. Carried by the Build contract so a Rover (in either Build mode) composes geometry + Assets by **choosing from this bounded set**, never emitting a free-form reference. It is the "ready architecture" the swarm delegates to.
_Avoid_: Asset library, model list, registry, manifest (name the bounded, contract-carried set specifically).

**Build mode**:
How a Task's geometry is produced when a Rover works it: **replay** (the deterministic default — the Rover streams a frozen, pre-approved Build spec from cache, no model call, the bulletproof headline) or **live** (the Rover runs its Build harness *as it works*, so the structure is generated and visibly self-corrected in the world step by step). Live mode deliberately trades determinism for authenticity and is chosen per Blueprint placement; the two coexist, even side by side (ADR-0009).
_Avoid_: Demo mode, dev mode, online/offline (name the choice, not an environment).

**Model seam**:
The pluggable boundary between the Build harness and the LLM provider — a single narrow interface the harness depends on, with the vendor SDK behind it. Swapping the provider (GPT-class → Gemini → local) is a config change, never a harness change. The same "swap the seam, not the core" philosophy as the world Adapter, applied to the model.
_Avoid_: LLM client, provider, model wrapper, SDK (name the boundary, not the thing behind it).

**Build envelope**:
The spatial bounds a Build harness must keep its geometry within for one Task. It is what lets independent workers' output **compose** into one Blueprint without overlap or misalignment: each worker generates inside its envelope, against a shared coordinate frame, seeing neighbours' accumulated build ops. Generation runs in dependency order so each envelope is filled against a coherent world.
_Avoid_: Bounding box, region, zone, slot.
