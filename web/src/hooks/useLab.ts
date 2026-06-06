// useLab — drives ONE in-app live lab generation and accumulates its streamed
// "watch it think" events (bh-07a). It POSTs to the gateway's /lab/generate SSE
// endpoint and reads the response body as a stream, parsing each `data:` frame
// into a LabEvent. It is the transport for the agent console; the events are a
// separate feed and NEVER touch the world Snapshot re-render path (ADR-0004).
//
// EventSource only supports GET, but the run needs a POST body (the task type),
// so we use fetch + a ReadableStream reader instead — the same SSE wire format,
// parsed by lib/lab.ts (pure, unit-tested).

import { useCallback, useRef, useState } from "react";
import {
  type LabEvent,
  parseSSEEvent,
  splitSSEStream,
} from "../lib/lab";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";

// httpBase derives the gateway's HTTP origin from the configured WS URL
// (ws://host:port/ws → http://host:port), so the lab endpoint and the snapshot
// socket always point at the same gateway with no extra config.
function httpBase(): string {
  try {
    const u = new URL(WS_URL);
    u.protocol = u.protocol === "wss:" ? "https:" : "http:";
    u.pathname = "";
    u.search = "";
    return u.origin;
  } catch {
    return "http://localhost:8080";
  }
}

export type LabState = {
  /** Every event received for the current/last run, in arrival order. */
  events: LabEvent[];
  /** True while a run is streaming. */
  running: boolean;
  /** A transport-level error (the run never started / the connection dropped). */
  error: string | null;
};

export type LabApi = LabState & {
  /** Start a live generation for the given catalog task type. */
  generate: (taskType: string) => void;
  /** Abort the in-flight run (and reset the console on the next generate). */
  cancel: () => void;
};

export function useLab(): LabApi {
  const [events, setEvents] = useState<LabEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  const generate = useCallback(
    (taskType: string) => {
      // One run at a time: abort any in-flight stream first.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setEvents([]);
      setError(null);
      setRunning(true);

      const push = (e: LabEvent) => setEvents((prev) => [...prev, e]);

      void (async () => {
        try {
          const resp = await fetch(`${httpBase()}/lab/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task_id: `${taskType}-lab`, task_type: taskType }),
            signal: ac.signal,
          });
          if (!resp.ok || !resp.body) {
            setError(
              resp.status === 503
                ? "Live lab not enabled on the gateway (no API key configured server-side)."
                : `Lab request failed (HTTP ${resp.status}).`,
            );
            setRunning(false);
            return;
          }

          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { blocks, rest } = splitSSEStream(buffer);
            buffer = rest;
            for (const block of blocks) {
              const ev = parseSSEEvent(block);
              if (ev) push(ev);
            }
          }
          // Flush any trailing complete frame the stream ended on.
          const tail = parseSSEEvent(buffer);
          if (tail) push(tail);
        } catch (err) {
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            setError(err instanceof Error ? err.message : "lab stream error");
          }
        } finally {
          if (abortRef.current === ac) abortRef.current = null;
          setRunning(false);
        }
      })();
    },
    [],
  );

  return { events, running, error, generate, cancel };
}
