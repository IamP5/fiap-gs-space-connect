
import type { CatalogTask } from "./placement";

export type CatalogBlueprint = {
  id: string;
  name: string;
  description: string;
  tasks: CatalogTask[];
};

function ring(n: number, radius: number, startDeg: number): { X: number; Y: number }[] {
  const pts: { X: number; Y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const theta = ((startDeg - (i * 360) / n) * Math.PI) / 180;
    pts.push({
      X: Math.round(radius * Math.cos(theta) * 100) / 100,
      Y: Math.round(radius * Math.sin(theta) * 100) / 100,
    });
  }
  return pts;
}

function domeBlueprint(): CatalogBlueprint {
  const wallPos = ring(8, 12, 90);
  const foundationPos = ring(4, 11, 68);
  const footEnv = { center: { X: 0, Y: 0, Z: 0 }, size: { X: 14, Y: 14, Z: 4 } };
  const wallEnv = { center: { X: 0, Y: 0, Z: 0 }, size: { X: 12, Y: 12, Z: 14 } };
  const capEnv = { center: { X: 0, Y: 0, Z: 0 }, size: { X: 40, Y: 40, Z: 26 } };

  const tasks: CatalogTask[] = [];
  for (let i = 1; i <= 4; i++) {
    tasks.push({ id: `foundation-${i}`, type: "foundation", rel: foundationPos[i - 1], envelope: footEnv });
  }
  for (let i = 1; i <= 8; i++) {
    tasks.push({ id: `wall-${i}`, type: "wall", rel: wallPos[i - 1], envelope: wallEnv });
  }
  tasks.push({ id: "dome-cap", type: "dome-cap", rel: { X: 0, Y: 0 }, envelope: capEnv });
  return {
    id: "dome",
    name: "Habitat dome",
    description: "4 foundations, 8 walls, a sealing cap.",
    tasks,
  };
}

function solarArrayBlueprint(): CatalogBlueprint {
  const footEnv = { center: { X: 0, Y: 0, Z: 0 }, size: { X: 16, Y: 12, Z: 3 } };
  const panelEnv = { center: { X: 0, Y: 0, Z: 6 }, size: { X: 18, Y: 14, Z: 8 } };
  return {
    id: "solar-array",
    name: "Solar array",
    description: "Two pads, then sun-tracking panels.",
    tasks: [
      { id: "pad-1", type: "foundation", rel: { X: -5, Y: 0 }, envelope: footEnv },
      { id: "pad-2", type: "foundation", rel: { X: 5, Y: 0 }, envelope: footEnv },
      { id: "panel-1", type: "panel", rel: { X: -5, Y: 0 }, envelope: panelEnv },
      { id: "panel-2", type: "panel", rel: { X: 5, Y: 0 }, envelope: panelEnv },
    ],
  };
}

function commsMastBlueprint(): CatalogBlueprint {
  const footEnv = { center: { X: 0, Y: 0, Z: 0 }, size: { X: 12, Y: 12, Z: 3 } };
  const mastEnv = { center: { X: 0, Y: 0, Z: 12 }, size: { X: 6, Y: 6, Z: 24 } };
  const antennaEnv = { center: { X: 0, Y: 0, Z: 26 }, size: { X: 14, Y: 14, Z: 6 } };
  return {
    id: "comms-mast",
    name: "Comms mast",
    description: "Foundation, mast, antenna keystone.",
    tasks: [
      { id: "base", type: "foundation", rel: { X: 0, Y: 0 }, envelope: footEnv },
      { id: "mast", type: "mast", rel: { X: 0, Y: 0 }, envelope: mastEnv },
      { id: "antenna", type: "dome-cap", rel: { X: 0, Y: 0 }, envelope: antennaEnv },
    ],
  };
}

export const CATALOG: CatalogBlueprint[] = [
  commsMastBlueprint(),
  domeBlueprint(),
  solarArrayBlueprint(),
];

export function blueprintById(id: string): CatalogBlueprint | undefined {
  return CATALOG.find((b) => b.id === id);
}
