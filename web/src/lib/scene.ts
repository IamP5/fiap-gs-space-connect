
import type { TaskView, Vec2 } from "../types/wire";

export const GROUND_SPAN = 20;
export const GROUND_MARGIN = 2.5;

export const SCENE_UNITS_PER_METER = 0.12;

export const REAL_METERS = {
  rover: 2.5,
  astronaut: 2.0,
  emu: 2.2,
  habitat: 6.0,
  baseStation: 4.0,
  crawler: 40,
  mobileLauncher: 120,
  gantry: 90,
  lander: 7.0,
  solarPanel: 10,
  commsMast: 12,
  commsDish: 6,
  dish70: 26,
  radome: 5,
} as const;

export type SetPiece = {
  key: string;
  modelRef: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  realMeters: number;
  fallbackColor: string;
  fallbackShape?: "box" | "capsule";
};

export const LUNAR_SET_PIECES: SetPiece[] = [
  {
    key: "crawler",
    modelRef: "/assets/models/nasa_crawler.glb",
    position: [-18, 0, -32],
    rotation: [0, Math.PI / 5, 0],
    realMeters: REAL_METERS.crawler,
    fallbackColor: "#5a5a4e",
  },
  {
    key: "mobile-launcher",
    modelRef: "/assets/models/nasa_mobile_launcher.glb",
    position: [-5, 0, -38],
    rotation: [0, 0, 0],
    realMeters: REAL_METERS.mobileLauncher,
    fallbackColor: "#6b6b72",
  },
  {
    key: "gantry",
    modelRef: "/assets/models/nasa_gantry.glb",
    position: [8, 0, -34],
    rotation: [0, -Math.PI / 8, 0],
    realMeters: REAL_METERS.gantry,
    fallbackColor: "#7a4a3a",
  },
  {
    key: "lander",
    modelRef: "/assets/models/nasa_lunar_module.glb",
    position: [25, 0, -24],
    rotation: [0, -Math.PI / 4, 0],
    realMeters: REAL_METERS.lander,
    fallbackColor: "#b8a070",
  },
  {
    key: "habitat-1",
    modelRef: "/assets/models/habitat-demo-unit-1.glb",
    position: [19, 0, -6],
    rotation: [0, Math.PI / 5, 0],
    realMeters: 22,
    fallbackColor: "#9aa0aa",
  },
  {
    key: "habitat-2",
    modelRef: "/assets/models/habitat-demo-unit-2.glb",
    position: [24, 0, 1],
    rotation: [0, -Math.PI / 6, 0],
    realMeters: 20,
    fallbackColor: "#929aa6",
  },
  {
    key: "radome",
    modelRef: "/assets/models/radome.glb",
    position: [15, 0, 6],
    rotation: [0, -Math.PI / 4, 0],
    realMeters: 14,
    fallbackColor: "#8b929e",
  },
  {
    key: "base-station",
    modelRef: "/assets/models/base-station.glb",
    position: [12, 0, -12],
    rotation: [0, Math.PI / 6, 0],
    realMeters: REAL_METERS.baseStation,
    fallbackColor: "#8c8c84",
  },
  {
    key: "dish-70m",
    modelRef: "/assets/models/nasa_dish_70m.glb",
    position: [31, 0, -13],
    rotation: [0, Math.PI / 2.6, 0],
    realMeters: REAL_METERS.dish70,
    fallbackColor: "#b4b8be",
  },
  {
    key: "comms-mast",
    modelRef: "/assets/models/comms-mast.glb",
    position: [32, 0, -4],
    rotation: [0, 0, 0],
    realMeters: REAL_METERS.commsMast,
    fallbackColor: "#7d8590",
  },
  {
    key: "solar-1",
    modelRef: "/assets/models/solar-panel.glb",
    position: [14, 0, 14],
    rotation: [0, -Math.PI / 9, 0],
    realMeters: REAL_METERS.solarPanel,
    fallbackColor: "#3f4656",
  },
  {
    key: "solar-2",
    modelRef: "/assets/models/solar-panel.glb",
    position: [19, 0, 15],
    rotation: [0, -Math.PI / 9, 0],
    realMeters: REAL_METERS.solarPanel,
    fallbackColor: "#3f4656",
  },
  {
    key: "solar-3",
    modelRef: "/assets/models/solar-panel.glb",
    position: [24, 0, 15],
    rotation: [0, -Math.PI / 9, 0],
    realMeters: REAL_METERS.solarPanel,
    fallbackColor: "#3f4656",
  },
  {
    key: "solar-4",
    modelRef: "/assets/models/solar-panel.glb",
    position: [29, 0, 14],
    rotation: [0, -Math.PI / 9, 0],
    realMeters: REAL_METERS.solarPanel,
    fallbackColor: "#3f4656",
  },
  {
    key: "astronaut",
    modelRef: "/assets/models/astronaut.glb",
    position: [11, 0, 5],
    rotation: [0, -Math.PI / 3, 0],
    realMeters: REAL_METERS.astronaut,
    fallbackColor: "#c8ccd4",
    fallbackShape: "capsule",
  },
  {
    key: "emu",
    modelRef: "/assets/models/nasa_emu.glb",
    position: [8, 0, -9],
    rotation: [0, Math.PI / 4, 0],
    realMeters: REAL_METERS.emu,
    fallbackColor: "#d2d6dc",
    fallbackShape: "capsule",
  },
];

export const SHACKLETON_SET_PIECES: SetPiece[] = [
  {
    key: "shk-habitat-1",
    modelRef: "/assets/models/habitat-demo-unit-1.glb",
    position: [-8, 0, -9],
    rotation: [0, Math.PI / 5, 0],
    realMeters: 22,
    fallbackColor: "#6b7280",
  },
  {
    key: "shk-habitat-2",
    modelRef: "/assets/models/habitat-demo-unit-2.glb",
    position: [-1, 0, -13],
    rotation: [0, -Math.PI / 6, 0],
    realMeters: 20,
    fallbackColor: "#646b78",
  },
  {
    key: "shk-radome",
    modelRef: "/assets/models/radome.glb",
    position: [11, 0, -9],
    rotation: [0, -Math.PI / 4, 0],
    realMeters: 14,
    fallbackColor: "#5a626e",
  },
  {
    key: "shk-isru",
    modelRef: "/assets/models/machine_generator.glb",
    position: [7, 0, 2],
    rotation: [0, Math.PI / 3, 0],
    realMeters: 12,
    fallbackColor: "#5e6672",
  },
  {
    key: "shk-comms-dish",
    modelRef: "/assets/models/nasa_dish_70m.glb",
    position: [-13, 0, 2],
    rotation: [0, Math.PI / 2.5, 0],
    realMeters: 10,
    fallbackColor: "#69707c",
  },
  {
    key: "shk-solar",
    modelRef: "/assets/models/solar-panel.glb",
    position: [12, 0, -13],
    rotation: [0, -Math.PI / 6, 0],
    realMeters: 14,
    fallbackColor: "#4f5662",
  },
  {
    key: "shk-astronaut",
    modelRef: "/assets/models/astronaut.glb",
    position: [2, 0, -5],
    rotation: [0, -Math.PI / 3, 0],
    realMeters: REAL_METERS.astronaut,
    fallbackColor: "#c8ccd4",
    fallbackShape: "capsule",
  },
];

export type SiteFrame = {
  cx: number;
  cy: number;
  rot: number;
  worksiteUnitsToMeters: number;
  sunDir: [number, number, number];
  sunIntensity: number;
  terrainTint: string;
  fog: [string, number, number];
  pieces: SetPiece[];
};

export const SITE_FRAMES: Record<"lunar" | "shackleton", SiteFrame> = {
  lunar: {
    cx: 0,
    cy: 0,
    rot: 0,
    worksiteUnitsToMeters: 2.5,
    sunDir: [2300, 2600, -6490],
    sunIntensity: 3.6,
    terrainTint: "#969798",
    fog: ["#000000", 180, 680],
    pieces: LUNAR_SET_PIECES,
  },
  shackleton: {
    cx: 400,
    cy: 0,
    rot: 0.3,
    worksiteUnitsToMeters: 2.5,
    sunDir: [6490, 90, -2300],
    sunIntensity: 1.7,
    terrainTint: "#64676d",
    fog: ["#05060a", 120, 520],
    pieces: SHACKLETON_SET_PIECES,
  },
};

export const DEFAULT_SITE_FRAME: SiteFrame = SITE_FRAMES.lunar;

export const MOON_RADIUS = 90;
export const MOON_POSITION: [number, number, number] = [0, 60, -520];

export const SUN_POSITION: [number, number, number] = [2300, 1265, -6490];

export const ORBIT_SUN_POSITION: [number, number, number] = [806, 795, -6929];
export const SUN_RADIUS = 80;

export const EARTH_RADIUS = Math.round(MOON_RADIUS * 3.67);
export const EARTH_POSITION: [number, number, number] = [-3993, -460, -2427];

export const MARKER_LON_OFFSET = 108;

export function latLonToGlobeNormal(
  lat: number,
  lon: number,
  lonOffset = MARKER_LON_OFFSET,
): [number, number, number] {
  const DEG = Math.PI / 180;
  const phi = lat * DEG;
  const lambda = (lon + lonOffset) * DEG;
  const cosPhi = Math.cos(phi);
  const nx = cosPhi * Math.sin(lambda);
  const ny = Math.sin(phi);
  const nz = cosPhi * Math.cos(lambda);
  return [nx, ny, nz];
}

export function latLonToGlobePoint(
  lat: number,
  lon: number,
  lonOffset = MARKER_LON_OFFSET,
): [number, number, number] {
  const [nx, ny, nz] = latLonToGlobeNormal(lat, lon, lonOffset);
  return [
    MOON_POSITION[0] + nx * MOON_RADIUS,
    MOON_POSITION[1] + ny * MOON_RADIUS,
    MOON_POSITION[2] + nz * MOON_RADIUS,
  ];
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export type ScenePoint = { x: number; y: number; z: number };

export function computeBounds(points: Vec2[]): Bounds {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.X < minX) minX = p.X;
    if (p.Y < minY) minY = p.Y;
    if (p.X > maxX) maxX = p.X;
    if (p.Y > maxY) maxY = p.Y;
  }
  if (maxX - minX < 1) {
    minX -= 1;
    maxX += 1;
  }
  if (maxY - minY < 1) {
    minY -= 1;
    maxY += 1;
  }
  return { minX, minY, maxX, maxY };
}

export type SceneMap = {
  scale: number;
  at: (pos: Vec2, height?: number) => ScenePoint;
  invert: (x: number, z: number) => Vec2;
};

export function siteMap(
  site: Pick<SiteFrame, "cx" | "cy" | "rot" | "worksiteUnitsToMeters">,
): SceneMap {
  const s = SCENE_UNITS_PER_METER * site.worksiteUnitsToMeters;
  const { cx, cy, rot } = site;
  const cos = Math.cos(rot),
    sin = Math.sin(rot);
  return {
    scale: s,
    at: (p: Vec2, height = 0): ScenePoint => {
      const dx = p.X - cx,
        dy = p.Y - cy;
      const rx = dx * cos - dy * sin,
        ry = dx * sin + dy * cos;
      return { x: rx * s, y: height, z: -ry * s };
    },
    invert: (x: number, z: number): Vec2 => {
      const rx = x / s,
        ry = -z / s;
      const dx = rx * cos + ry * sin,
        dy = -rx * sin + ry * cos;
      return { X: dx + cx, Y: dy + cy };
    },
  };
}

export const CRATER_FLOOR_RADIUS = 18;
export const CRATER_RIM_RADIUS = 34;
export const CRATER_OUTER_RADIUS = 70;
export const CRATER_RIM_HEIGHT = 7;

function smoothstep01(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function craterProfile(r: number): number {
  if (r <= CRATER_FLOOR_RADIUS) return 0;
  if (r <= CRATER_RIM_RADIUS)
    return CRATER_RIM_HEIGHT * smoothstep01(CRATER_FLOOR_RADIUS, CRATER_RIM_RADIUS, r);
  if (r <= CRATER_OUTER_RADIUS)
    return CRATER_RIM_HEIGHT * (1 - smoothstep01(CRATER_RIM_RADIUS, CRATER_OUTER_RADIUS, r));
  return 0;
}

export const SKYLIGHT_CENTER: readonly [number, number] = [-26, -8];
export const SKYLIGHT_MOUTH_RADIUS = 5.5;
export const SKYLIGHT_RIM_RADIUS = 9;
export const SKYLIGHT_OUTER_RADIUS = 14;
export const SKYLIGHT_MOUTH_DROP = 1.8;
export const SKYLIGHT_RIM_LIP = 0.8;
export const SKYLIGHT_SHAFT_BOTTOM = 13;

export function skylightProfile(dr: number): number {
  if (dr >= SKYLIGHT_OUTER_RADIUS) return 0;
  if (dr <= SKYLIGHT_MOUTH_RADIUS) return -SKYLIGHT_MOUTH_DROP;
  if (dr <= SKYLIGHT_RIM_RADIUS) {
    const t = smoothstep01(SKYLIGHT_MOUTH_RADIUS, SKYLIGHT_RIM_RADIUS, dr);
    return -SKYLIGHT_MOUTH_DROP + (SKYLIGHT_MOUTH_DROP + SKYLIGHT_RIM_LIP) * t;
  }
  return SKYLIGHT_RIM_LIP * (1 - smoothstep01(SKYLIGHT_RIM_RADIUS, SKYLIGHT_OUTER_RADIUS, dr));
}


export type GradePad = { center: [number, number]; radius: number };
export type RoverTrack = { from: [number, number]; to: [number, number]; width: number };

export const LUNAR_BASE_PADS: GradePad[] = [
  { center: [25, -24], radius: 7 },
  { center: [19, -3], radius: 12 },
  { center: [22, 15], radius: 9 },
];

export const LUNAR_ROVER_TRACKS: RoverTrack[] = [
  { from: [25, -24], to: [19, -3], width: 1.4 },
  { from: [19, -3], to: [22, 15], width: 1.4 },
  { from: [19, -3], to: [4, 2], width: 1.2 },
];


export type BuildTier = "foundation" | "wall" | "dome" | "other";

export function tierOf(type: string): BuildTier {
  const t = type.toLowerCase();
  if (t.includes("foundation")) return "foundation";
  if (t.includes("wall")) return "wall";
  if (t.includes("dome") || t.includes("cap") || t.includes("roof")) return "dome";
  return "other";
}

export function tierHeight(tier: BuildTier): number {
  switch (tier) {
    case "foundation":
      return 0.15;
    case "wall":
      return 0.9;
    case "dome":
      return 1.9;
    default:
      return 1.9;
  }
}

export function isBuilt(task: Pick<TaskView, "status">): boolean {
  return task.status === "DONE";
}
