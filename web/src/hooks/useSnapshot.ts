
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isEarthUplink,
  isSnapshot,
  type Control,
  type EarthUplink,
  type Snapshot,
} from "../types/wire";
import { MOCK_EARTH, MOCK_SNAPSHOT } from "../mocks/snapshot";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";
const MOCK = import.meta.env.VITE_MOCK === "1";

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 10_000;

export type Connection = {
  snapshot: Snapshot | null;
  earth: EarthUplink | null;
  wsOpen: boolean;
  url: string;
  send: (c: Control) => void;
};

export function useSnapshot(): Connection {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(MOCK ? MOCK_SNAPSHOT : null);
  const [earth, setEarth] = useState<EarthUplink | null>(MOCK ? MOCK_EARTH : null);
  const [wsOpen, setWsOpen] = useState<boolean>(MOCK);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (MOCK) return;

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
        attempt = 0;
        setWsOpen(true);
      };

      ws.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data as string);
          if (isSnapshot(parsed)) setSnapshot(parsed);
          else if (isEarthUplink(parsed)) setEarth(parsed);
        } catch {
          return;
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          return;
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
          return;
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

  return { snapshot, earth, wsOpen, url: WS_URL, send };
}
