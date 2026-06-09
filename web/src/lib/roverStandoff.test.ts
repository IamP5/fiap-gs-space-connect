import { describe, expect, it } from "vitest";
import type { Vec2 } from "../types/wire";
import { BUILD_STANDOFF, roverStandoffPos } from "./roverStandoff";

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.X - b.X, a.Y - b.Y);

describe("roverStandoffPos", () => {
  it("leaves a rover that is well clear of every block untouched (the drive in still reads)", () => {
    const rover = { X: 0, Y: -50 };
    const blocks = [
      { X: 0, Y: 0 },
      { X: 20, Y: 0 },
    ];
    // Returned BY REFERENCE so a far rover is rendered exactly where it really is.
    expect(roverStandoffPos(rover, blocks)).toBe(rover);
  });

  it("returns the rover unchanged when there are no blocks to clear", () => {
    const rover = { X: 3, Y: 4 };
    expect(roverStandoffPos(rover, [])).toBe(rover);
  });

  it("pushes a rover embedded in a block out to exactly the standoff ring", () => {
    const block = { X: 10, Y: 10 };
    // A rover sitting almost dead-centre (1 u south) is well inside the standoff.
    const out = roverStandoffPos({ X: 10, Y: 9 }, [block]);
    expect(dist(out, block)).toBeCloseTo(BUILD_STANDOFF, 6);
  });

  it("parks a south-approaching rover in front (on the −Y side it drove in from)", () => {
    const block = { X: 0, Y: 0 };
    const out = roverStandoffPos({ X: 0, Y: -1 }, [block]); // came up from the south
    expect(out.X).toBeCloseTo(0, 6);
    expect(out.Y).toBeCloseTo(-BUILD_STANDOFF, 6); // pushed further south, clear of the block
  });

  it("preserves a non-axis approach bearing while clamping to the ring", () => {
    const block = { X: 0, Y: 0 };
    const out = roverStandoffPos({ X: 2, Y: 2 }, [block]); // NE of centre, inside the standoff
    expect(out.X).toBeCloseTo(out.Y, 6); // same diagonal bearing
    expect(out.X).toBeGreaterThan(0);
    expect(dist(out, block)).toBeCloseTo(BUILD_STANDOFF, 6);
  });

  it("falls back to the −Y (viewer) side when the rover sits exactly on the block centre", () => {
    const block = { X: 5, Y: 5 };
    const out = roverStandoffPos({ X: 5, Y: 5 }, [block]);
    expect(out.X).toBeCloseTo(5, 6);
    expect(out.Y).toBeCloseTo(5 - BUILD_STANDOFF, 6);
  });

  it("clears the NEAREST block when several are within range", () => {
    const near = { X: 0, Y: 0 };
    const far = { X: 100, Y: 0 };
    const out = roverStandoffPos({ X: 0, Y: -0.5 }, [far, near]);
    expect(dist(out, near)).toBeCloseTo(BUILD_STANDOFF, 6);
  });

  it("respects a custom standoff distance", () => {
    const block = { X: 0, Y: 0 };
    const out = roverStandoffPos({ X: 0, Y: -0.5 }, [block], 8);
    expect(dist(out, block)).toBeCloseTo(8, 6);
  });
});
