// useSnapshot — owns the single piece of world state: the latest Snapshot.
//
// The dashboard is a pure re-render of that snapshot (TECHSPEC §4, ADR-0004):
// there is no client-side simulation and no timer that mutates world state.
// This hook only manages the transport — open the socket, keep the latest
// frame, auto-reconnect with capped exponential backoff so the dashboard
// survives a gateway restart — plus a `wsOpen` flag for the connected
// indicator and a no-op-friendly `send` for the browser → server control path.

import { useCallback, useEffect, useRef, useState } from "react";
import { isSnapshot, type Control, type Snapshot } from "../types/wire";
import { MOCK_SNAPSHOT } from "../mocks/snapshot";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";
const MOCK = import.meta.env.VITE_MOCK === "1";

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 10_000;

export type Connection = {
  /** Latest world snapshot, or null before the first frame arrives. */
  snapshot: Snapshot | null;
  /** True while the WebSocket itself is OPEN. */
  wsOpen: boolean;
  /** The WS URL in use (for display). */
  url: string;
  /** Send a control message to the gateway (no-op if the socket is not open). */
  send: (c: Control) => void;
};

export function useSnapshot(): Connection {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(MOCK ? MOCK_SNAPSHOT : null);
  const [wsOpen, setWsOpen] = useState<boolean>(MOCK);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (MOCK) return; // mock mode: static snapshot, no socket.

    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = ws;

      ws.onopen = () => {
        attempt = 0; // reset backoff on a healthy connection
        setWsOpen(true);
      };

      ws.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data as string);
          if (isSnapshot(parsed)) setSnapshot(parsed);
        } catch {
          // Ignore malformed frames; never crash the pure render.
        }
      };

      ws.onerror = () => {
        // onclose handles the reconnect; closing here avoids a leaked socket.
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      };

      ws.onclose = () => {
        setWsOpen(false);
        if (socketRef.current === ws) socketRef.current = null;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      // Capped exponential backoff with a little jitter.
      const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
      const delay = base / 2 + Math.random() * (base / 2);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = socketRef.current;
      socketRef.current = null;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  const send = useCallback((c: Control) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(c));
    }
  }, []);

  return { snapshot, wsOpen, url: WS_URL, send };
}
