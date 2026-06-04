// WorldCanvas — a pure 2D render of the latest world snapshot.
//
// This is the throwaway 2D scaffold that 3D will later replace (ADR-0004).
// Everything drawn is a function of `snapshot` only: tasks color-coded by
// status, rovers with a battery indicator (dimmed if dead), and a "lease beam"
// from each rover to the task it holds. World coordinates are fit into the
// canvas with padding; it redraws on snapshot change and on resize.

import { useEffect, useRef } from "react";
import type { Snapshot, TaskStatus } from "./types";
import { ROVER_R as PROJ_ROVER_R, pickRover, project } from "./hitTest";
import {
  type ActiveBeat,
  activeBeats,
  beatProgress,
  ringColor,
  ringFraction,
} from "./choreography";

// Functional telemetry encoding (DESIGN.md treats these as live-data signals,
// not brand chrome — the brand palette itself is black + white only).
const STATUS_COLOR: Record<TaskStatus, string> = {
  UNCLAIMED: "#9aa4b2", // idle grey
  LEASED: "#f5a623", // amber — leased
  DONE: "#2ecc71", // green — done
};

// Condensed industrial display cut per DESIGN.md (D-DIN → Arial Narrow fallback).
const DISPLAY_FONT = '"D-DIN-Bold", "Arial Narrow", Arial, sans-serif';
const UI_FONT = '"D-DIN", "Inter", Arial, sans-serif';

// Projection layout constants live in hitTest.ts so the draw and the click
// hit-test share one source of truth. Re-aliased here for local readability.
const ROVER_R = PROJ_ROVER_R;
const TASK_R = 9;

// Per-task inferred TTL for the drain ring. We never receive the lease TTL
// directly; instead we remember the largest (lease_expiry - at) seen while the
// task has been LEASED. A renewal (expiry increases) re-records the span so the
// ring refills; leaving LEASED clears the entry so a future lease starts fresh.
// This is the mechanism that makes an orphaned (killed-rover) task dramatic: its
// expiry stops being renewed, so the ring simply drains to empty.
type RingBase = { expiry: number; fullSpan: number };

function draw(
  canvas: HTMLCanvasElement,
  snapshot: Snapshot | null,
  selected: string | null,
  beats: ActiveBeat[],
  nowMs: number,
  ringBase: Map<string, RingBase>,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW === 0 || cssH === 0) return;

  // Match the backing store to the displayed size for crisp rendering.
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background — pure Canvas Night.
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, cssW, cssH);

  if (!snapshot) {
    ctx.fillStyle = "#5a5a5f"; // ink-mute
    ctx.font = `700 18px ${DISPLAY_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("AWAITING FIRST SNAPSHOT", cssW / 2, cssH / 2);
    return;
  }

  // World → canvas projection: the SAME pure math the click hit-test uses, so a
  // click always lands on the rover the user sees (see hitTest.ts).
  const { tx, ty } = project(
    snapshot.rovers.map((r) => r.pos),
    snapshot.tasks.map((t) => t.pos),
    cssW,
    cssH,
  );

  drawGrid(ctx, cssW, cssH);

  // Maintain the per-task inferred-TTL map from DURABLE snapshot state only.
  // For each LEASED task with a positive expiry: record/refresh fullSpan when
  // the lease is new or renewed (expiry grew). Forget any task that is no longer
  // LEASED so a fresh lease re-infers its span. (Decoration-only bookkeeping.)
  {
    const seen = new Set<string>();
    for (const t of snapshot.tasks) {
      if (t.status !== "LEASED" || !(t.lease_expiry && t.lease_expiry > 0)) continue;
      seen.add(t.id);
      const prev = ringBase.get(t.id);
      if (!prev || t.lease_expiry > prev.expiry) {
        const span = t.lease_expiry - snapshot.at;
        ringBase.set(t.id, {
          expiry: t.lease_expiry,
          // Keep the largest span ever seen for this lease so a partial first
          // reading (we joined mid-lease) doesn't permanently shrink the ring.
          fullSpan: prev ? Math.max(prev.fullSpan, span) : span,
        });
      }
    }
    for (const id of [...ringBase.keys()]) {
      if (!seen.has(id)) ringBase.delete(id);
    }
  }

  // Lease beams first, so markers sit on top.
  const taskById = new Map(snapshot.tasks.map((t) => [t.id, t]));
  for (const r of snapshot.rovers) {
    if (!r.alive) continue;
    const held = r.task ? taskById.get(r.task) : undefined;
    if (!held) continue;
    ctx.save();
    ctx.strokeStyle = "rgba(46, 204, 113, 0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(tx(r.pos), ty(r.pos));
    ctx.lineTo(tx(held.pos), ty(held.pos));
    ctx.stroke();
    ctx.restore();
  }

  // Latest solidify-pop progress per task id (most recent beat wins), so a just-
  // completed task gets a quick scale/flash. NaN/absent → no pop.
  const solidifyProgress = new Map<string, number>();
  for (const b of beats) {
    if (b.kind !== "solidify" || !b.task_id) continue;
    solidifyProgress.set(b.task_id, beatProgress(b, nowMs));
  }

  // Tasks.
  for (const t of snapshot.tasks) {
    const x = tx(t.pos);
    const y = ty(t.pos);
    const color = STATUS_COLOR[t.status] ?? "#888";

    // TTL drain ring: a thin arc around LEASED tasks that empties as the lease
    // approaches expiry. Derived purely from the durable expiry + inferred span
    // (ringBase), NOT from a beat — so an orphaned task visibly drains to red.
    if (t.status === "LEASED" && t.lease_expiry && t.lease_expiry > 0) {
      const base = ringBase.get(t.id);
      const frac = ringFraction(t.lease_expiry, snapshot.at, base?.fullSpan ?? 0);
      const ringR = TASK_R + 6;
      // Faint full-circle track, then the draining arc on top.
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.stroke();
      if (frac > 0) {
        ctx.beginPath();
        // Drain clockwise from 12 o'clock; remaining fraction stays lit.
        ctx.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = ringColor(frac);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Solidify pop: brief scale-up + flash on a just-completed task.
    const pop = solidifyProgress.get(t.id);
    const popActive = pop !== undefined && pop < 1;
    const grow = popActive ? (1 - (pop as number)) * 6 : 0; // up to +6px, decaying
    const r = TASK_R + grow;

    ctx.beginPath();
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = t.status === "UNCLAIMED" ? 0.55 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.stroke();

    // The flash: an expanding white outline that fades as the pop completes.
    if (popActive) {
      ctx.save();
      const flashR = r + 4 + (pop as number) * 10;
      ctx.beginPath();
      ctx.rect(x - flashR, y - flashR, flashR * 2, flashR * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(46,204,113,${(1 - (pop as number)).toFixed(3)})`;
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = `700 12px ${DISPLAY_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(t.id.toUpperCase(), x, y - TASK_R - 6);
    ctx.fillStyle = color;
    ctx.font = `10px ${UI_FONT}`;
    ctx.fillText(t.status, x, y + TASK_R + 13);
  }

  // Rovers.
  for (const r of snapshot.rovers) {
    const x = tx(r.pos);
    const y = ty(r.pos);
    const dim = !r.alive;

    // Selection indicator: an extra outer ring around the rover the user is
    // about to act on. Drawn under the body/battery so it reads as a halo.
    // Live selections glow danger-red (this is the KILL target); a dead rover
    // selection is muted (it cannot be killed).
    if (selected === r.id) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, ROVER_R + 9, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = dim ? "#5a5a5f" : "#e74c3c";
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.restore();
    }

    // Rovers render monochrome — white on black, per the brand's no-accent rule.
    ctx.beginPath();
    ctx.arc(x, y, ROVER_R, 0, Math.PI * 2);
    ctx.fillStyle = dim ? "#1a1a1d" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = dim ? "#3a3a3f" : "#ffffff";
    ctx.stroke();

    // Battery ring: arc proportional to charge.
    const battery = Math.max(0, Math.min(1, r.battery));
    ctx.beginPath();
    ctx.arc(x, y, ROVER_R + 4, -Math.PI / 2, -Math.PI / 2 + battery * Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = dim
      ? "#555"
      : battery > 0.5
        ? "#2ecc71"
        : battery > 0.2
          ? "#f5a623"
          : "#e74c3c";
    ctx.stroke();

    // Id sits inside the disc: ink on the white body, mute on the dimmed one.
    ctx.fillStyle = dim ? "#5a5a5f" : "#000000";
    ctx.font = `700 11px ${DISPLAY_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(r.id.toUpperCase(), x, y + 4);

    ctx.font = `10px ${UI_FONT}`;
    ctx.fillStyle = dim ? "#5a5a5f" : "#f0f0fa";
    const label = dim ? "DOWN" : `${Math.round(battery * 100)}%`;
    ctx.fillText(label, x, y + ROVER_R + 16);
  }

  // Rover-targeted transient beats, drawn last so they sit above the world.
  // A beat whose target rover is gone from the snapshot is silently skipped.
  const roverById = new Map(snapshot.rovers.map((r) => [r.id, r]));

  // Stagger simultaneous bid labels for the same rover so they don't overlap.
  const bidStack = new Map<string, number>();

  for (const b of beats) {
    if (b.kind === "won" && b.robot_id) {
      const rv = roverById.get(b.robot_id);
      if (!rv) continue;
      const p = beatProgress(b, nowMs);
      const x = tx(rv.pos);
      const y = ty(rv.pos);
      // A bright ring that expands outward and fades once.
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, ROVER_R + 4 + p * 18, 0, Math.PI * 2);
      ctx.lineWidth = 3 * (1 - p) + 0.5;
      ctx.strokeStyle = `rgba(46,204,113,${(1 - p).toFixed(3)})`;
      ctx.stroke();
      ctx.restore();
    } else if (b.kind === "bid" && b.robot_id) {
      const rv = roverById.get(b.robot_id);
      if (!rv) continue;
      const p = beatProgress(b, nowMs);
      const x = tx(rv.pos);
      const y = ty(rv.pos);
      const slot = bidStack.get(b.robot_id) ?? 0;
      bidStack.set(b.robot_id, slot + 1);
      // Float up and fade; stacked bids are offset vertically by their slot.
      const baseY = y - ROVER_R - 14 - slot * 14;
      const floatY = baseY - p * 14;
      const cost = typeof b.value === "number" ? b.value.toFixed(1) : "";
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = "#f5a623"; // amber — the bid signal
      ctx.font = `700 12px ${DISPLAY_FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(cost, x, floatY);
      ctx.restore();
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(58,58,63,0.45)"; // hairline-on-dark, dimmed
  ctx.lineWidth = 1;
  const step = 48;
  for (let gx = 0; gx <= w; gx += step) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
  for (let gy = 0; gy <= h; gy += step) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }
  ctx.restore();
}

type WorldCanvasProps = {
  snapshot: Snapshot | null;
  selected: string | null;
  onPick: (id: string | null) => void;
};

export function WorldCanvas({ snapshot, selected, onPick }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Presentation-only ephemeral state — NOT a violation of "pure re-render of the
  // snapshot": these are strictly derived from the server's own beats/durable
  // state and never invent world facts; they only DECORATE the snapshot.
  //   - latest:    current props, so the rAF loop always draws the freshest world.
  //   - beats:     active transient beats with their performance.now() spawn time.
  //   - ringBase:  per-task inferred lease TTL for the drain ring (see RingBase).
  //   - lastAt:    last snapshot.at appended, to dedupe re-renders of one frame.
  const latest = useRef<{ snapshot: Snapshot | null; selected: string | null }>({
    snapshot,
    selected,
  });
  const beats = useRef<ActiveBeat[]>([]);
  const ringBase = useRef<Map<string, RingBase>>(new Map());
  const lastAt = useRef<number>(Number.NEGATIVE_INFINITY);

  latest.current = { snapshot, selected };

  // Ingest a snapshot's transient beats exactly once per distinct frame. Each
  // beat is stamped with performance.now() so its animation progress is
  // independent of the ~12 Hz snapshot cadence. A target rover/task that has
  // vanished is handled at draw time (silently skipped), never here.
  if (snapshot && snapshot.at !== lastAt.current) {
    lastAt.current = snapshot.at;
    const now = performance.now();
    const incoming = snapshot.events ?? [];
    if (incoming.length > 0) {
      beats.current = [...beats.current, ...incoming.map((e) => ({ ...e, spawn: now }))];
    }
  }

  // Single continuous render loop: drives the TTL ring drain and beat fades
  // smoothly between snapshots, prunes expired beats each frame, and is the one
  // place the world is drawn. Cancelled on unmount so it never leaks.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;

    const tick = () => {
      const now = performance.now();
      beats.current = activeBeats(beats.current, now);
      draw(canvas, latest.current.snapshot, latest.current.selected, beats.current, now, ringBase.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!snapshot) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Click position in CSS px. offsetX/offsetY are relative to the target's
    // padding box already; fall back to the bounding rect when unavailable.
    const ne = e.nativeEvent;
    let px = ne.offsetX;
    let py = ne.offsetY;
    if (px === undefined || py === undefined) {
      const rect = canvas.getBoundingClientRect();
      px = e.clientX - rect.left;
      py = e.clientY - rect.top;
    }

    // Project against the displayed CSS size (the projection works in CSS px).
    const id = pickRover(snapshot, px, py, canvas.clientWidth, canvas.clientHeight);
    onPick(id); // null when empty space was clicked → deselect.
  };

  return <canvas ref={canvasRef} className="world-canvas" onClick={handleClick} />;
}
