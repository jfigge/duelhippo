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

// main.js — Electron main process for Duel Hippo.
//
// One window, one page: the same web build the browser and iOS run. In a
// packaged app (and `make build`) the page is served from www/ over a custom
// app:// protocol; under `make debug` it is loaded from the Vite dev server
// (--dev-url), so web edits hot-reload in place.
//
// Why app:// and not file://: Vite emits <script type="module" crossorigin>,
// and module scripts over file:// run into Chromium's opaque-origin CORS
// rules. A privileged standard scheme gives the page a real, stable origin —
// which is also what keeps localStorage (the best score) in one place.

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, Menu, net, protocol, shell } = require("electron");
const { parseArgs } = require("./cli-args");

const args = parseArgs(process.argv);
const isDev = !!args.devUrl;
const WWW = path.join(__dirname, "..", "www");
const APP_ORIGIN = "app://duelhippo";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

// Serve www/ — and nothing outside it — at app://duelhippo/.
function serveWww() {
  protocol.handle("app", (req) => {
    const { pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    const file = path.normalize(path.join(WWW, rel));
    if (!file.startsWith(WWW + path.sep) || !fs.existsSync(file))
      return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const view = [{ role: "togglefullscreen" }];
  if (isDev)
    view.unshift(
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
    );
  const template = [
    ...(isMac
      ? [{ role: "appMenu" }]
      : [{ label: "File", submenu: [{ role: "quit" }] }]),
    { label: "View", submenu: view },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 800,
    minHeight: 450,
    backgroundColor: "#000000",
    title: "Duel Hippo",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());

  // The game never navigates and never opens windows; links go to the
  // system browser.
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(isDev ? args.devUrl : APP_ORIGIN)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    // Echo the page's console here, so `make debug` shows game errors in the
    // terminal without opening DevTools.
    win.webContents.on("console-message", (e) => {
      const level = e.level ?? "info";
      if (level === "warning" || level === "error")
        console.log(`[page:${level}] ${e.message}`);
    });
    win.loadURL(args.devUrl);
  } else {
    win.loadURL(`${APP_ORIGIN}/index.html`);
  }
  if (args.devTools) win.webContents.openDevTools({ mode: "detach" });
  return win;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    if (!isDev && !fs.existsSync(path.join(WWW, "index.html"))) {
      console.error(`No web build at ${WWW} — run \`make web-build\` first.`);
      app.exit(1);
      return;
    }
    serveWww();
    buildMenu();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // A game: closing its window ends it, on every platform.
  app.on("window-all-closed", () => app.quit());
}
