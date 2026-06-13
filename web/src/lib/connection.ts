
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
    return { label: "gateway up · world not connected", kind: "warn" };
  }
  return { label: "disconnected · reconnecting…", kind: "down" };
}
