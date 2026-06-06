import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Resolve a file beside this config to an absolute path WITHOUT needing
// @types/node (no `node:url`/`__dirname`): import.meta.url is an ES2020 module
// feature, and Vite runs the config from this directory, so the URL's pathname is
// the on-disk path Rollup needs for an HTML entry.
const here = (p: string) => new URL(p, import.meta.url).pathname;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        // The main dashboard app (unchanged behaviour).
        main: here("./index.html"),
        // The bake-only render harness (bh-06): a standalone page the bake's
        // vision pass drives in headless Chrome to screenshot the real Scene3D.
        // A separate entry so it never affects the dashboard bundle.
        "bake-harness": here("./bake-harness.html"),
      },
    },
  },
});
