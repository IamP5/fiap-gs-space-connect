
import { describe, expect, it } from "vitest";
import { connectionStatus } from "./connection";

describe("connectionStatus", () => {
  it("is green only when the socket is open AND the world is connected", () => {
    expect(connectionStatus(true, true)).toEqual({
      label: "all systems connected",
      kind: "ok",
    });
  });

  it("is amber when the socket is up but the world is not connected", () => {
    expect(connectionStatus(true, false)).toEqual({
      label: "gateway up · world not connected",
      kind: "warn",
    });
  });

  it("is red whenever the socket is down, regardless of the world flag", () => {
    expect(connectionStatus(false, false).kind).toBe("down");
    expect(connectionStatus(false, true).kind).toBe("down");
    expect(connectionStatus(false, true).label).toBe("disconnected · reconnecting…");
  });
});
