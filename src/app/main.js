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
const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  net,
  protocol,
  shell,
} = require("electron");
const { parseArgs } = require("./cli-args");
const updater = require("./updater");

const args = parseArgs(process.argv);
const isDev = !!args.devUrl;
const WWW = path.join(__dirname, "..", "www");
const APP_ORIGIN = "app://duelhippo";
let mainWin = null;

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
  // About is the page's own card (web/scripts/about.js), as in Rest Hippo
  // and Chip Hippo, not Electron's native panel: on macOS it replaces the
  // app menu's About, elsewhere it goes in Help.
  const about = {
    label: "About Duel Hippo",
    click: () => {
      if (mainWin && !mainWin.isDestroyed())
        mainWin.webContents.send("menu:about");
    },
  };
  // The answer comes back on the updater channel, whoever asked.
  const updates = {
    label: "Check for Updates…",
    click: () => updater.checkForUpdates({ manual: true }),
  };
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              about,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : [{ label: "File", submenu: [{ role: "quit" }] }]),
    { label: "View", submenu: view },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: isMac ? [updates] : [updates, { type: "separator" }, about],
    },
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
  // system browser, and the About card's support address to the mail app.
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(isDev ? args.devUrl : APP_ORIGIN)) return;
    e.preventDefault();
    if (/^mailto:/.test(url)) shell.openExternal(url);
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
  mainWin = win;
  win.on("closed", () => {
    if (mainWin === win) mainWin = null;
  });
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
    // Unpackaged (make debug), the Dock would show Electron's own icon: give
    // it the app's, from the macOS rendering with its transparent margin
    // (make icons). A packaged build has it from its .icns already.
    const dockIcon = path.join(__dirname, "..", "icons", "mac.png");
    if (!app.isPackaged && app.dock && fs.existsSync(dockIcon))
      app.dock.setIcon(dockIcon);
    // The page asks for its startup check itself, ten seconds in, if the
    // player has turned automatic checks on: the setting is the page's, kept
    // in localStorage with the game's other options.
    updater.initUpdater(() => mainWin);
    ipcMain.handle("updater:check", (_e, manual) => {
      updater.checkForUpdates({ manual: manual === true });
    });
    ipcMain.handle("updater:install", () => updater.quitAndInstall());
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // A game: closing its window ends it, on every platform.
  app.on("window-all-closed", () => app.quit());
}
