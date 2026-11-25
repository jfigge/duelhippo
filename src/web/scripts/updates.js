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

// updates.js — what the desktop app says about updates. The updater itself
// is the shell's (src/app/updater.js); this only listens to it, through the
// preload's `duelhippo.updater`, and does nothing where that is absent: the
// browser and iOS. It is not part of the game: main.js binds it, never
// game.js, and it draws no random numbers.
//
// It follows the other hippos:
//   - The automatic check is off until the player turns it on (the title's
//     Updates button). When on, it runs once, ten seconds after launch.
//   - A check the player asked for (Help ▸ Check for Updates…) always
//     answers. An automatic one speaks only when it finds something.
//   - A downloaded update installs when the game is quit, or on Restart. The
//     Restart note shows only on the title screen, so it never sits over a
//     game in progress.

import { UPDATES_KEY } from "./constants.js";

export const CHECK_DELAY_MS = 10000;
const NOTE_MS = 5000;

export function bindUpdates({
  w = window,
  delay = CHECK_DELAY_MS,
  noteMs = NOTE_MS,
} = {}) {
  const up = w.duelhippo?.updater;
  if (!up) return;
  const doc = w.document;
  const $ = (id) => doc.getElementById(id);
  const note = $("upd"),
    text = note.querySelector("span"),
    restart = $("updRestart"),
    toggle = $("bUpdates");
  let timer = 0,
    ready = null;

  const auto = () => w.localStorage.getItem(UPDATES_KEY) === "1";
  const label = () => {
    const i = doc.createElement("i");
    i.textContent = "Updates";
    toggle.replaceChildren(i, auto() ? " auto" : " manual");
  };
  toggle.classList.remove("hidden");
  label();
  toggle.addEventListener("click", () => {
    w.localStorage.setItem(UPDATES_KEY, auto() ? "0" : "1");
    label();
  });
  restart.addEventListener("click", () => up.install());

  // A passing note goes after a few seconds, and leaves the Restart note
  // standing if an update is ready.
  function say(msg, stay = false) {
    w.clearTimeout(timer);
    text.textContent = msg;
    note.classList.toggle("ready", stay);
    restart.classList.toggle("hidden", !stay);
    note.classList.remove("hidden");
    if (!stay)
      timer = w.setTimeout(() => {
        if (ready) say(ready, true);
        else note.classList.add("hidden");
      }, noteMs);
  }

  up.onEvent((ev) => {
    const v = ev?.version ? ` ${ev.version}` : "";
    switch (ev?.type) {
      case "checking":
        if (ev.manual) say("Checking for updates…");
        break;
      case "available":
        say(`Downloading Duel Hippo${v}…`);
        break;
      case "downloaded":
        ready = `Duel Hippo${v} is ready. It installs when you quit.`;
        say(ready, true);
        break;
      case "not-available":
        if (!ev.manual) break;
        if (ev.reason === "dev-build")
          say("Updates come only to an installed copy");
        else if (ev.reason === "store-build")
          say("Your app store keeps this copy up to date");
        else
          say(`Duel Hippo${ev.current ? " " + ev.current : ""} is up to date`);
        break;
      case "error":
        console.warn(`[updater] ${ev.message}`);
        if (ev.manual) say("Could not get the update. Try again later.");
        break;
    }
  });

  if (auto()) w.setTimeout(() => up.check(false), delay);
}
