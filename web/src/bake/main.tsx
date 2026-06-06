// Bake-only render harness entry (bh-06). Mounts the REAL Scene3D with a single
// DONE task carrying an injected Build spec, so cmd/bake's vision pass can drive
// headless Chrome against the actual renderer, wait for the canvas to settle, and
// screenshot it. This module is NEVER loaded on the headline path; it is a
// standalone Vite entry the bake serves locally.
//
// DETERMINISM (so screenshots are reproducible):
//   - The spec is injected as DATA (fetched from the harness server, see
//     loadSpec), never random.
//   - Scene3D's default camera is a FIXED orbit pose ([0,14,18]); we never move
//     it. There are NO choreography beats (the task is already DONE and the
//     snapshot carries no events), so nothing animates.
//   - We signal readiness via window.__BAKE_READY__ only AFTER three animation
//     frames have painted, so the bake driver screenshots a settled canvas.
//
// No API key is ever referenced here — keys are server-side only (cmd/bake).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Scene3D } from "../components/Scene3D";
import type { BuildOp, Snapshot, TaskView } from "../types/wire";

declare global {
  interface Window {
    // Set true by this module once the canvas has painted a few frames, so the
    // headless driver knows the screenshot will be stable.
    __BAKE_READY__?: boolean;
    // Optional inline spec injection (the driver may set this before load instead
    // of serving /spec.json).
    __BAKE_SPEC__?: { ops?: BuildOp[]; task_type?: string };
  }
}

// SpecPayload is what the harness server serves at /spec.json (or what is set on
// window.__BAKE_SPEC__): the ordered Build ops to render and the task type (so the
// synthetic task reads as the right tier in Scene3D).
type SpecPayload = {
  ops?: BuildOp[];
  task_type?: string;
};

// loadSpec resolves the injected Build spec: an inline window global if present,
// else the JSON the harness server serves at /spec.json. A failure yields an empty
// spec (Scene3D then renders the primitive fallback) so the page never hangs.
async function loadSpec(): Promise<SpecPayload> {
  if (window.__BAKE_SPEC__) return window.__BAKE_SPEC__;
  try {
    const res = await fetch("/spec.json", { cache: "no-store" });
    if (!res.ok) return {};
    return (await res.json()) as SpecPayload;
  } catch {
    return {};
  }
}

// syntheticSnapshot wraps an injected Build spec in the minimal Snapshot Scene3D
// needs: a single DONE task at the worksite centre carrying the build_spec (so the
// interpreted-spec render path runs), no rovers, no events (so nothing animates).
// `at` is a fixed constant — the snapshot never changes, so the demand loop draws
// exactly once.
function syntheticSnapshot(payload: SpecPayload): Snapshot {
  const task: TaskView = {
    id: "bake-subject",
    type: payload.task_type ?? "foundation",
    pos: { X: 0, Y: 0 },
    status: "DONE",
    version: 1,
    build_spec: payload.ops ?? [],
  };
  return {
    type: "snapshot",
    connected: true,
    rovers: [],
    tasks: [task],
    events: [],
    at: 1,
  };
}

// signalReadyAfterPaint flips window.__BAKE_READY__ once a few animation frames
// have painted, giving the WebGL canvas time to render the settled scene before
// the driver screenshots it.
function signalReadyAfterPaint() {
  let frames = 0;
  const tick = () => {
    frames += 1;
    if (frames >= 3) {
      window.__BAKE_READY__ = true;
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function main() {
  const payload = await loadSpec();
  const snapshot = syntheticSnapshot(payload);
  const root = createRoot(document.getElementById("bake-root")!);
  root.render(
    <StrictMode>
      <Scene3D snapshot={snapshot} selected={null} onPick={() => {}} />
    </StrictMode>,
  );
  signalReadyAfterPaint();
}

void main();
