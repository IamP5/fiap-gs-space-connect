# Interactive Choreography: a backend-orchestrated cueKill on k8s pod-per-rover

**Status:** accepted (revised 2026-06-08 — reverses this ADR's original "browser fires the raw kill" decision; see History)

The Epic 07 cinematic needs the headline **Kill** to land at the climax, on the rover building the hero wall, with the camera framed — and to be reliable take after take.

## Decision

The climax is **backend-orchestrated**, triggered by the operator:

- The build is **re-paced to film length** (the demo as-built finishes the dome in ~20s; the scripted-kill window is sub-1-second — a machine can hit it, a human cannot). Re-pacing uses cinematic Coordinator auction/lease windows + a new Rover-agent slow-cadence flag (`--op-every-ms`; `opEvery` is hard-coded today at `agent.go:327`).
- The hero wall (`lunar/wall-1`) is **held** un-leasable until a cue arrives, so the climax target is always available (no race).
- The operator presses one key → the browser sends a new control `{cmd:"cueKill"}` → the **Coordinator** releases the hold, lets a Rover lease + drive to the wall, and fires the kill on that Rover. The "which Rover / when" logic stays in Go (deterministic, under test).
- This runs on the **k8s pod-per-rover** topology (`COORDINATOR_ROVERS=external`, 6 Rover Pods). The kill is the **in-process outage** (`KILLER_ON_KILL=false`): the Rover darkens **in place** and keeps its failure position — **never a `kubectl delete pod`**. Its Lease Expires, the task Re-auctions, and a **surviving** Rover seals the dome (Self-heal). The victim's `--recover-ms` is tuned **long** (≥ the heal arc) so it stays a cool-grey silhouette through the seal — any revive lands *after* the dome closes.

## Considered options

- **Browser fires the raw `{cmd:"kill"}` on the snapshot's `lunar/wall-1` assignee** (this ADR's original decision). Rejected on the timing evidence above: the wall is LEASED for <1s, so a hand-pressed key almost always finds it already DONE (no-op), and by a 1:36 narrative mark the whole dome finished ~70s earlier. A human cannot pace a manual kill against the real engine cadence.
- **In-proc `Cinematic()` coordinator hosted on k8s** (no rover Pods). Simpler, but we want the real pod-per-rover swarm visible (`kubectl get pods`) and the real in-process-kill-over-the-bus Self-heal as the credibility story.
- **Real `kubectl delete pod` kill.** Rejected: a deleted Pod restarts a fresh agent at its *start* position and returns instantly — the opposite of a believable failure. The in-process outage preserves the failure position (see `deploy/k8s/README.md`).

## Consequences

- **"Never fabricated" holds:** the operator triggers a *real* kill and the real Self-heal; only the *when* is human (interactive Choreography — see `CONTEXT.md`). The Coordinator orchestrates, not fakes.
- **ADR-0004 snapshot-purity intact:** the only additions are an arm flag (client UI state) and one new control verb (`cueKill`). No new snapshot fields; the scene stays a pure re-render.
- **Determinism preserved:** the k8s roster mirrors `DomeRovers()`; same Rover holds + is killed + same survivor heals every run. `reloadDemo` resets the board with no pod restart (deterministic pre-roll).
- The cinematic enablement is a **k8s overlay** (`deploy/k8s/`) + agent/coordinator flags; the default deploy and `Rehearsal()` are untouched. All Self-heal / e2e verification runs on the k8s stack (the frontend mock is one frozen frame and cannot drive the heal), with `kubectl logs` tailed across all services.

## History

- **2026-06-07 (original):** decided the *browser* fires the raw kill on the `lunar/wall-1` leaseholder (interactive Choreography logic in `App.tsx`), a deliberate exception to "the demo package is the choreography home."
- **2026-06-08 (this revision):** a code audit showed the kill window is sub-1-second and the build a ~20s sprint — a human can't hit it. Reversed to a **backend-orchestrated cueKill** (re-pace + hero-wall hold) on **k8s pod-per-rover** with the **in-process kill**. The choreographic decision returns to Go, where it's deterministic and tested.
