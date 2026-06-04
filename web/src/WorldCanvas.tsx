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

function draw(canvas: HTMLCanvasElement, snapshot: Snapshot | null, selected: string | null) {
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

  // Tasks.
  for (const t of snapshot.tasks) {
    const x = tx(t.pos);
    const y = ty(t.pos);
    const color = STATUS_COLOR[t.status] ?? "#888";

    ctx.beginPath();
    ctx.rect(x - TASK_R, y - TASK_R, TASK_R * 2, TASK_R * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = t.status === "UNCLAIMED" ? 0.55 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.stroke();

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    draw(canvas, snapshot, selected);

    const onResize = () => draw(canvas, snapshot, selected);
    window.addEventListener("resize", onResize);

    // Also redraw if the canvas element itself is resized (layout changes).
    const ro = new ResizeObserver(() => draw(canvas, snapshot, selected));
    ro.observe(canvas);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, [snapshot, selected]);

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
