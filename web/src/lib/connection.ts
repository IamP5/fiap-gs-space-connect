// connection — pure derivation of the header "all systems connected" indicator.
//
// The dot is green ONLY when the WebSocket is open AND the latest snapshot
// reports the coordinator's bus is healthy; amber when the socket is up but the
// world is not (yet) healthy; red while disconnected. Pulled out of App as a
// pure function so the three-state logic is unit-testable without a DOM.

export type StatusKind = "ok" | "warn" | "down";

export type ConnectionStatus = {
  label: string;
  kind: StatusKind;
};

export function connectionStatus(wsOpen: boolean, worldConnected: boolean): ConnectionStatus {
  if (wsOpen && worldConnected) {
    return { label: "all systems connected", kind: "ok" };
  }
  if (wsOpen) {
    // Socket up but the world says it is not (yet) healthy.
    return { label: "gateway up · world not connected", kind: "warn" };
  }
  return { label: "disconnected · reconnecting…", kind: "down" };
}
