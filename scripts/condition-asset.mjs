#!/usr/bin/env node
/**
 * condition-asset.mjs — OFFLINE asset conditioning pipeline (Issue #52).
 *
 * Turns an arbitrary source model (NASA / CC0 / CC-BY .glb or .gltf) into a
 * web-light, render-ready, self-hosted, Draco-compressed `.glb` under
 * `web/public/assets/models/`.
 *
 * Two stages:
 *   1. GEOMETRY CONDITIONING (this script, via the project's already-installed
 *      `three`): fix up-axis (Z-up -> Y-up), `computeVertexNormals()` when
 *      missing, recenter pivot to origin, fit-to-unit (a `fitToView`-style bake
 *      so 1 world-unit == the model's largest dimension), and STRIP any NASA
 *      insignia decal mesh (the NASA "meatball"/worm logo is NOT public domain).
 *   2. COMPRESSION (shelled out to `npx @gltf-transform/cli`, NOT a project
 *      dependency): `optimize --compress draco` (+ `simplify` for >15 MB inputs).
 *      The vendored decoder in `web/public/draco/` decodes it OFFLINE at runtime.
 *
 * Usage:
 *   node scripts/condition-asset.mjs <source.(glb|gltf)> <out-name> [options]
 *
 * Args:
 *   <source>    Path to the source model (.glb or .gltf).
 *   <out-name>  Output basename (without extension). Result is written to
 *               web/public/assets/models/<out-name>.glb
 *
 * Options:
 *   --up=z|y        Source up-axis. `z` rotates -90deg about X to Y-up
 *                   (NASA/CAD default). Default: y (no rotation).
 *   --no-fit        Skip fit-to-unit scaling (keep source scale).
 *   --no-recenter   Skip recenter-to-origin.
 *   --strip=<re>    Extra case-insensitive regex of mesh/node names to drop, in
 *                   ADDITION to the built-in NASA-insignia name patterns.
 *   --simplify      Force gltf-transform `simplify` (auto-on for inputs >15 MB).
 *   --keep-intermediate  Keep the pre-compression baked .glb for inspection.
 *
 * Re-run example (vendored sample, end-to-end):
 *   node scripts/condition-asset.mjs sources/dragon_draco.glb dragon_conditioned --up=y
 *
 * The conditioned .glb is committed; the source is NOT (keep sources out of the
 * bundle). Record provenance/licence in web/public/assets/CREDITS.md.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "web", "public", "assets", "models");

// `three` lives under web/node_modules (not the repo root), so resolve it from
// there and import the ESM modules by absolute file URL. This keeps the script
// in scripts/ while reusing the project's already-installed three (no new dep).
const webRequire = createRequire(join(REPO_ROOT, "web", "package.json"));
const threeEntry = webRequire.resolve("three");
const threeJsmDir = join(dirname(threeEntry), "..", "examples", "jsm");
const THREE = await import(pathToFileURL(threeEntry).href);
const { GLTFLoader } = await import(
  pathToFileURL(join(threeJsmDir, "loaders", "GLTFLoader.js")).href
);
const { GLTFExporter } = await import(
  pathToFileURL(join(threeJsmDir, "exporters", "GLTFExporter.js")).href
);

// three's GLTFLoader embedded-texture path references the browser `self` global,
// which Node does not define — alias it to globalThis so conditioning glbs with
// embedded textures doesn't throw `self is not defined` under Node 22.
if (typeof globalThis.self === "undefined") globalThis.self = globalThis;

// three's GLTFExporter binary path uses the browser FileReader API. Node 22 has
// Blob but not FileReader, so provide a minimal async polyfill.
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.onload = null;
      this.onloadend = null;
      this.onerror = null;
      this.result = null;
    }
    _done() {
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }
    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          this._done();
        })
        .catch((e) => this.onerror?.(e));
    }
    readAsDataURL(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          const b64 = Buffer.from(buf).toString("base64");
          this.result = `data:${blob.type || "application/octet-stream"};base64,${b64}`;
          this._done();
        })
        .catch((e) => this.onerror?.(e));
    }
  };
}

// NASA insignia decal node/mesh name patterns — never public domain, must be
// stripped from any redistributed model.
const INSIGNIA_PATTERNS = [
  /insignia/i,
  /meatball/i,
  /\bworm\b/i,
  /nasa[_-]?logo/i,
  /\blogo\b/i,
  /decal/i,
];

function parseArgs(argv) {
  const positional = [];
  const opts = { up: "y", fit: true, recenter: true, simplify: false, keepIntermediate: false, strip: null };
  for (const a of argv) {
    if (a === "--no-fit") opts.fit = false;
    else if (a === "--no-recenter") opts.recenter = false;
    else if (a === "--simplify") opts.simplify = true;
    else if (a === "--keep-intermediate") opts.keepIntermediate = true;
    else if (a.startsWith("--up=")) opts.up = a.slice(5).toLowerCase();
    else if (a.startsWith("--strip=")) opts.strip = new RegExp(a.slice(8), "i");
    else if (a.startsWith("--")) throw new Error(`Unknown option: ${a}`);
    else positional.push(a);
  }
  if (positional.length < 2) {
    throw new Error(
      "Usage: node scripts/condition-asset.mjs <source.(glb|gltf)> <out-name> [--up=z|y] [--no-fit] [--no-recenter] [--strip=<re>] [--simplify]",
    );
  }
  return { source: positional[0], outName: positional[1], opts };
}

async function loadModel(absSource) {
  const buf = readFileSync(absSource);
  // Provide a base path so a .gltf with external resources resolves correctly.
  const loader = new GLTFLoader();
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return await new Promise((res, rej) => {
    loader.parse(arrayBuffer, dirname(absSource) + "/", (g) => res(g), (e) => rej(e));
  });
}

/** Remove nodes whose name matches the insignia (or extra --strip) patterns. */
function stripInsignia(root, extra) {
  const toRemove = [];
  root.traverse((obj) => {
    const name = obj.name || "";
    if (!name) return;
    if (INSIGNIA_PATTERNS.some((re) => re.test(name)) || (extra && extra.test(name))) {
      toRemove.push(obj);
    }
  });
  for (const obj of toRemove) {
    obj.parent?.remove(obj);
  }
  return toRemove.map((o) => o.name);
}

/** computeVertexNormals() on any mesh geometry that lacks a normal attribute. */
function fixNormals(root) {
  let fixed = 0;
  root.traverse((obj) => {
    if (obj.isMesh && obj.geometry && !obj.geometry.getAttribute("normal")) {
      obj.geometry.computeVertexNormals();
      fixed++;
    }
  });
  return fixed;
}

function main() {
  const { source, outName, opts } = parseArgs(process.argv.slice(2));
  const absSource = resolve(process.cwd(), source);
  if (!existsSync(absSource)) throw new Error(`Source not found: ${absSource}`);

  const sourceMB = statSync(absSource).size / (1024 * 1024);
  const simplify = opts.simplify || sourceMB > 15;

  console.log(`[condition] source: ${absSource} (${sourceMB.toFixed(2)} MB)`);

  return (async () => {
    const gltf = await loadModel(absSource);
    const model = gltf.scene;

    // --- 1. up-axis fix (bake the rotation into geometry via a wrapper) -------
    if (opts.up === "z") {
      // Z-up -> Y-up: rotate -90deg about X.
      model.rotation.x = -Math.PI / 2;
      model.updateMatrixWorld(true);
    }

    // --- strip NASA insignia (and any extra --strip names) -------------------
    const stripped = stripInsignia(model, opts.strip);
    if (stripped.length) console.log(`[condition] stripped insignia/decal nodes: ${stripped.join(", ")}`);

    // --- normals -------------------------------------------------------------
    const nFixed = fixNormals(model);
    if (nFixed) console.log(`[condition] computeVertexNormals() on ${nFixed} geometr${nFixed === 1 ? "y" : "ies"}`);

    // Bake the current transform (incl. up-axis rotation) into a fresh group so
    // exported geometry is already in Y-up world space.
    model.updateMatrixWorld(true);

    // --- recenter to origin + fit-to-unit (fitToView-style bake) -------------
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // Wrap in a pivot so recenter + fit are applied above the rotated model and
    // then baked on export.
    const pivot = new THREE.Group();
    pivot.add(model);
    if (opts.recenter) {
      model.position.sub(center);
      console.log(`[condition] recentered (was off-origin by ${center.length().toFixed(3)})`);
    }
    if (opts.fit) {
      const scale = 1 / maxDim;
      pivot.scale.setScalar(scale);
      console.log(`[condition] fit-to-unit: maxDim ${maxDim.toFixed(3)} -> 1.0 (scale ${scale.toExponential(2)})`);
    }
    pivot.updateMatrixWorld(true);

    // --- export the baked, uncompressed intermediate .glb --------------------
    mkdirSync(OUT_DIR, { recursive: true });
    const intermediate = join(OUT_DIR, `${outName}.baked.glb`);
    const exporter = new GLTFExporter();
    const glbArrayBuffer = await new Promise((res, rej) => {
      exporter.parse(
        pivot,
        (result) => res(result),
        (err) => rej(err),
        { binary: true },
      );
    });
    writeFileSync(intermediate, Buffer.from(glbArrayBuffer));
    console.log(`[condition] baked intermediate -> ${intermediate}`);

    // --- 2. compress via gltf-transform (npx; NOT a project dependency) ------
    const finalOut = join(OUT_DIR, `${outName}.glb`);
    const cliArgs = ["--yes", "@gltf-transform/cli", "optimize", intermediate, finalOut, "--compress", "draco"];
    if (simplify) {
      cliArgs.push("--simplify", "true");
      console.log(`[condition] simplify ENABLED (source ${sourceMB.toFixed(1)} MB > 15 MB or --simplify)`);
    }
    console.log(`[condition] npx ${cliArgs.join(" ")}`);
    execFileSync("npx", cliArgs, { stdio: "inherit", cwd: REPO_ROOT });

    if (!opts.keepIntermediate) rmSync(intermediate, { force: true });

    const finalMB = statSync(finalOut).size / (1024 * 1024);
    console.log(`[condition] DONE -> ${finalOut} (${finalMB.toFixed(3)} MB, ${((1 - finalMB / sourceMB) * 100).toFixed(0)}% smaller)`);
    console.log("[condition] Record provenance/licence in web/public/assets/CREDITS.md.");
  })();
}

main().catch((err) => {
  console.error(`[condition] FAILED: ${err.message}`);
  process.exit(1);
});
