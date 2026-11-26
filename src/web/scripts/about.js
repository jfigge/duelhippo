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

// about.js — the About card (#about in index.html), after Rest Hippo's and
// Chip Hippo's: the logo, the name with an (i) that shows the version, what
// the game is, the credit, the support address and the sponsor link.
//
// It opens from Settings ▸ About Duel Hippo in every shell, and from the
// desktop menu (About Duel Hippo, through the preload's `onAbout`) at any
// time. It opens over whatever is showing, so `beforeOpen` lets game.js
// pause a game first. While it is up it takes the keyboard: Escape closes it
// (the (i)'s details first), and no key reaches the game.
//
// The sponsor link is left off on iOS: the App Store does not allow a link
// to payment outside the app (Guideline 3.1.1), as Chip Hippo leaves it off
// its Mac App Store build.

const shellName = {
  electron: "Desktop app",
  ios: "iPhone app",
  web: "Browser",
};

// Vite sets VITE_APP_VERSION from package.json (vite.config.mjs). Unbundled,
// under the tests, there is none.
const VERSION = (import.meta.env || {}).VITE_APP_VERSION || "";

export function bindAbout({ w = window, beforeOpen = () => {} } = {}) {
  const doc = w.document;
  const $ = (id) => doc.getElementById(id);
  const card = $("about"),
    info = $("aboutInfo"),
    build = $("aboutBuild");
  const shell = doc.documentElement.dataset.platform || "web";
  const isOpen = () => !card.classList.contains("hidden");

  if (shell === "ios")
    for (const id of ["aboutDonate", "aboutDonateDot"])
      $(id).classList.add("hidden");

  const rows = [["Version", VERSION || "dev build"]];
  const d = w.duelhippo;
  if (d) {
    rows.push(
      ["Electron", d.versions?.electron],
      ["Chromium", d.versions?.chrome],
    );
    rows.push(["Platform", [d.os, d.arch].filter(Boolean).join(" ")]);
  } else rows.push(["Platform", shellName[shell] || shellName.web]);
  for (const [label, value] of rows) {
    const row = doc.createElement("div"),
      l = doc.createElement("span"),
      v = doc.createElement("b");
    l.textContent = label;
    v.textContent = value || "—";
    row.append(l, v);
    build.append(row);
  }

  const details = (show) => {
    build.hidden = !show;
    info.setAttribute("aria-expanded", String(show));
  };
  function open() {
    if (isOpen()) return;
    beforeOpen();
    details(false);
    card.classList.remove("hidden");
    $("aboutClose").focus();
  }
  function close() {
    card.classList.add("hidden");
  }

  $("bAbout").addEventListener("click", open);
  $("aboutClose").addEventListener("click", close);
  info.addEventListener("click", () => details(build.hidden));
  // A click on the backdrop, outside the card, closes it.
  card.addEventListener("click", (e) => {
    if (e.target === card) close();
    else if (!build.hidden && !build.contains(e.target) && e.target !== info)
      details(false);
  });
  // Before input.js's listener on the same window: capture runs first.
  w.addEventListener(
    "keydown",
    (e) => {
      if (!isOpen()) return;
      e.stopImmediatePropagation();
      if (e.code !== "Escape" && e.key !== "Escape") return;
      e.preventDefault();
      if (!build.hidden) details(false);
      else close();
    },
    true,
  );
  d?.onAbout?.(open);
  return { open, close, isOpen };
}
