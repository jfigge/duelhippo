// vite.config.mjs — one web build for all three shells.
//
// The game's root is web/; the production bundle goes to www/, which is both
// what Electron packages (served over its app:// protocol) and what Capacitor
// copies into the iOS app (capacitor.config.json's webDir). base './' keeps
// every asset URL relative, so the same files work under app://, capacitor://
// and any path on a web host.

import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// The About card's version (web/scripts/about.js), the same in every shell.
// Vite loads VITE_* variables after this file runs, so setting it here works.
process.env.VITE_APP_VERSION = JSON.parse(
  readFileSync(here("./package.json"), "utf8"),
).version;

export default defineConfig({
  root: here("./web"),
  base: "./",
  publicDir: here("./web/public"),
  build: {
    outDir: here("./www"),
    emptyOutDir: true,
    // three.js is most of the bundle; one chunk is simplest for every shell.
    chunkSizeWarningLimit: 1500,
    target: "es2022",
  },
  server: {
    port: Number(process.env.WEB_PORT) || 5173,
    strictPort: true,
    // The root is web/, but three.js and the other dependencies live in
    // src/node_modules/, which the dev server must be able to serve.
    fs: { allow: [here(".")] },
  },
  preview: {
    port: Number(process.env.WEB_PORT) || 5173,
    strictPort: true,
  },
});
