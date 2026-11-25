/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of Duel Hippo.
 *
 * Duel Hippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * Duel Hippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Duel Hippo. If not, see <https://www.gnu.org/licenses/>.
 */

// dev-electron.mjs — `make debug`: the Vite dev server plus Electron, together.
//
//   * Vite serves web/ with hot module replacement: a CSS edit swaps in place,
//     a script edit reloads the page (the game modules build the scene when
//     they load, so a full reload is the honest refresh).
//   * Electron loads the page from Vite (--dev-url) with the main-process
//     inspector on INSPECT (default 9229) for VS Code's "Attach" or
//     chrome://inspect, and DevTools when DEVTOOLS=1.
//   * An edit under app/ restarts Electron, since the main process and the
//     preload cannot be hot-swapped.
//   * Quitting Electron (⌘Q, closing the window) or Ctrl-C stops both.

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const APP = path.join(SRC, "app");
const electron = createRequire(import.meta.url)("electron"); // the binary's path

const PORT = Number(process.env.DEV_PORT) || 5173;
const INSPECT = process.env.INSPECT || "9229";
const DEVTOOLS = process.env.DEVTOOLS === "1";
const USER_DATA = process.env.USER_DATA_DIR || path.join(SRC, "..", "data");

const server = await createServer({
  configFile: path.join(SRC, "vite.config.mjs"),
  server: { port: PORT, strictPort: true, host: "localhost" },
});
await server.listen();
const url = `http://localhost:${PORT}/`;
console.log(`Vite dev server on ${url}`);

let child = null,
  restarting = false;

function launch() {
  const argv = [
    `--inspect=${INSPECT}`,
    path.join(APP, "main.js"),
    `--dev-url=${url}`,
    `--user-data-dir=${USER_DATA}`,
  ];
  if (DEVTOOLS) argv.push("--devtools");
  child = spawn(electron, argv, { stdio: "inherit", cwd: SRC });
  child.on("exit", async (code) => {
    child = null;
    if (restarting) {
      restarting = false;
      launch();
      return;
    }
    await server.close();
    process.exit(code ?? 0);
  });
}

// Restart Electron on main-process edits, once per burst of saves.
let timer = null;
watch(APP, { recursive: true }, (_event, file) => {
  if (!file || !file.endsWith(".js") || file.startsWith("tests")) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`app/${file} changed — restarting Electron`);
    if (!child) return launch();
    restarting = true;
    child.kill();
  }, 250);
});

for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    if (child) child.kill();
    await server.close();
    process.exit(0);
  });

launch();
