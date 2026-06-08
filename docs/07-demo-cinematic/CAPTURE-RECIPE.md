# Epic 07 — Cinematic capture recipe (k8s + chrome-devtools MCP)

The 2:30 shooting script (`DEMO-CINEMATIC-SCRIPT.md`) is exercised on the **k8s
cinematic overlay** (#160), not the `VITE_MOCK` mock — the mock is one frozen
frame with a no-op `send()` (`web/src/hooks/useSnapshot.ts:40`), so it cannot drive
the Self-heal. This recipe brings the overlay up, attaches chrome-devtools MCP
through a **dedicated Chrome profile + remote-debug port** (resolving the Epic-06
"devtools-MCP Chrome-profile lock" that deferred screenshot capture), and asserts
a take **end-to-end across screen *and* services**.

Topology: ADR-0011. The overlay runs `COORDINATOR_ROVERS=cinematic` — the in-process
`lunar-R*` / `shackleton-R*` swarm holds the hero wall (`lunar/wall-1`) un-leasable
until the operator's `cueKill` cue; the kill is the **in-process outage** delivered
in place (`KILLER_ON_KILL=false`), **never a Pod delete**. (Why the standalone Rover
Pods are dropped in cinematic mode: see `deploy/k8s/overlays/cinematic/kustomization.yaml`.)

---

## 1. Bring up the cinematic overlay

```sh
./deploy/k8s/up.sh --cinematic
```

Builds + `kind load`s the images, applies `deploy/k8s/overlays/cinematic/`, prunes
any leftover standalone Rover Pods, waits for rollouts, and auto-port-forwards
**web → http://localhost:5173** and **gateway → ws://localhost:8080/ws**. The default
(non-cinematic) deploy is untouched — `./deploy/k8s/up.sh` (no flag) still brings up
the pod-per-rover base byte-for-byte.

Render-only sanity (no cluster):

```sh
kubectl kustomize deploy/k8s/                     # base — COORDINATOR_ROVERS=external, 6 Rover Pods
kubectl kustomize deploy/k8s/overlays/cinematic/  # cinematic — COORDINATOR_ROVERS=cinematic, 0 Rover Pods
```

---

## 2. Launch a dedicated Chrome for chrome-devtools MCP (resolves the profile lock)

The Epic-06 blocker: chrome-devtools MCP cannot attach to a Chrome that is already
running under your **default** user profile (the profile is locked by the live
browser). Fix: start a **separate** Chrome instance with its OWN `--user-data-dir`
and a remote-debugging port. Your normal Chrome can stay open — this is a second,
isolated instance.

macOS:

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="${TMPDIR:-/tmp}/swarmbuild-chrome-mcp" \
  --no-first-run --no-default-browser-check \
  "http://localhost:5173"
```

Linux:

```sh
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/swarmbuild-chrome-mcp \
  --no-first-run --no-default-browser-check \
  "http://localhost:5173"
```

Confirm the debug endpoint is live (lists the open tab):

```sh
curl -s http://localhost:9222/json/version
```

Point chrome-devtools MCP at `http://localhost:9222` (the dedicated instance), then
`new_page` / `select_page` → `navigate_page` to `http://localhost:5173`. Because this
is a throwaway `--user-data-dir`, it never collides with your everyday profile.

Headless variant (CI / no window): add `--headless=new` to the launch above; MCP
attaches to `:9222` identically.

---

## 3. Pre-roll: reset the board deterministically (no Pod restart)

Before each take, reset the worksite to the deterministic seed **without** bouncing
any Pod (so the board is identical every run) by firing the in-app **Reload demo**
(`{cmd:"reloadDemo"}`). It rebuilds the Planner / World Model / Leases in-process on
the live coordinator Pod — verified to keep the SAME coordinator Pod (no restart).
Keep `liveMode` OFF (replay path, no model latency).

---

## 4. Walk the take + fire the climax cue

The dome builds everything EXCEPT the held hero wall. At the climax (script beat
C2), fire the **cueKill** cue from the dashboard (`{cmd:"cueKill"}`). The Coordinator:
releases the hold → a Rover leases + drives to `lunar/wall-1` → takes the in-process
kill in place → Lease Expiry → Re-auction → a surviving Rover seals the dome. The
victim's `--recover-ms` revive (if any) lands only **after** the seal.

Beat-locked copy rule (capture discipline, not a gating engine): never land the
beat-locked lines (`ROBÔ PERDIDO`, `CÚPULA FECHADA`, `+2.6s ATRÁS`) before the real
worksite event happens. Latency: drag the real slider to 2600 ms by hand (a cue-key
would desync the slider's local readout).

---

## 4b. Orbit-open camera-arc — "found by light" (Beats 1–2, #158)

The film's opening Scenery beat (script Beats 1–2 "WANDERING" + "SUN REVEAL"). Arm
the cinematic layer (`R`, or load with `?reel=1`), be in **orbit** view, and press
**`O`** (mnemonic: open). The camera drifts laterally along the Moon's dark limb
(sun off-frame) then **arcs** so the *fixed* sun's GodRays + celestial bloom crest
into frame, easing into `ORBIT_POSE` (~9 s). The marker reticles read under the
flare as exposure stops down (fire the marker lock-on cue `M` here for Beat 3).

**Camera-arc, NOT sun-arc (load-bearing):** the sun never moves — it stays at
`ORBIT_SUN_POSITION`. Only the *camera* azimuth swings (the rig rotates the settled
`ORBIT_POSE` offset around the Moon, lib `web/src/lib/reel/openArc.ts`). The rig
reuses the descent/traverse `transitioning` discipline: while it runs, CameraFeel
idle-sway + OrbitControls stand down; on settle (or cancel) it restores `ORBIT_POSE`
and re-enables controls cleanly — no stuck-disabled controls, no leaked glare.
Pressing `O` again cancels mid-arc (the rig settles into `ORBIT_POSE`); a second
press re-runs it. The rig only runs in orbit; firing it on the surface is inert.

**Fallback (script-sanctioned — the open NEVER blocks the climax):** if the open is
cut or never fired, the orbit is byte-for-byte unchanged — a **cold static
`ORBIT_POSE` hold + idle sway**, and the "found by light" read simply moves to the
descent glare (Beat 4, `runDescent`). This slice is lowest-priority by design;
omitting it costs nothing in the rest of the take. (Pure-Scenery, so it can be
self-checked under `VITE_MOCK=1` at `localhost:5173/?reel=1` in orbit without the
k8s overlay — sample the camera position over time and confirm the SUN body
position is unchanged while the camera drifts → arcs → settles on `ORBIT_POSE`.)

---

## 5. Assert the take end-to-end (screen + services)

Tail every service during the take in a second terminal:

```sh
./deploy/k8s/logs.sh --cinematic     # interleaved coordinator + gateway + NATS + killer (+ Rover Pods if any)
./deploy/k8s/logs.sh --climax        # one-shot: just the climax trail from the coordinator
```

The climax trail to confirm in the coordinator stream (verified on `kind-swarmbuild`):

```
cueKill: hero wall released + kill armed   task=lunar/wall-1   (cue received)
award task=lunar/wall-1 to=lunar-Rx                            (hero wall leased)
scripted kill rover=lunar-Rx                                   (in-process kill — NO pod delete)
expiry task=lunar/wall-1 ... returned to UNCLAIMED             (Lease Expiry)
award task=lunar/wall-1 to=lunar-Ry                            (Re-auction → survivor)
complete task=lunar/wall-1 by=lunar-Ry                         (Task DONE → dome sealed)
```

### chrome-devtools MCP smoke (the e2e proof)

With the overlay up and the dedicated Chrome attached:

1. `navigate_page` → `http://localhost:5173`.
2. `take_screenshot` of the live dashboard.
3. Confirm the WebSocket snapshot is flowing — rovers + tasks present (e.g.
   `evaluate_script` reading the rendered roster/ledger, or `list_network_requests`
   showing the `ws://localhost:8080/ws` upgrade with frames).
4. Cross-check `./deploy/k8s/logs.sh --cinematic` shows the swarm auctioning /
   building — screen **and** services agree. Fire `cueKill`, then re-screenshot and
   re-check `--climax` to confirm the heal landed.

---

## 6. Tear down

```sh
./deploy/k8s/down.sh            # delete the swarmbuild namespace, stop the port-forwards (keep the cluster)
./deploy/k8s/down.sh --cluster  # also delete the kind cluster
```

Close the dedicated Chrome window; its `--user-data-dir` is a throwaway under
`$TMPDIR` and can be deleted freely.

---

## Known limitation — `--op-every-ms` / long `--recover-ms`

The merged #154 `Cinematic()` pacing KEEPS the coordinator's **in-process** swarm
(it does not set `NoInProcRovers`), so the cinematic fleet is in-process and the
standalone Rover-Pod flags `--op-every-ms` (slow build cadence) and a long
`--recover-ms` (victim stays down through the seal) are **not in the live path
today** — the in-process rovers use the demo defaults, and the **hero-wall hold** is
what provides film-length pacing (the dome parks waiting for the operator's cue, so
there is no race to 1:36). Landing the kill on a *standalone Rover Pod-agent* that
honours those flags in place needs a small Go follow-up: a `cinematic-external`
selector = `External()` (no in-process rovers) **+** the hero-wall hold
(`HeldTask`/`CueKillAfter`). That is a one-line coordinator switch case + a demo
helper, deliberately out of #160's infra scope ("do NOT modify Go code"). When it
lands, add the agent flags to the six Rover Pods and drop the rover-delete patch from
`overlays/cinematic/kustomization.yaml`.
