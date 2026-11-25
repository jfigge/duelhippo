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

// updates.test.js — the desktop app's update notes, against a stand-in for
// the preload's bridge: what each step of an update says, when an automatic
// check runs, and that the browser and iOS (no bridge) get none of it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { bindUpdates } from "../updates.js";
import { UPDATES_KEY } from "../constants.js";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

// A page, with a bridge whose pushes the test makes, unless `bridge` is false.
function page({ bridge = true, auto = false } = {}) {
  const dom = new JSDOM(html, { url: "http://localhost/" });
  const w = dom.window;
  if (auto) w.localStorage.setItem(UPDATES_KEY, "1");
  const calls = [];
  let push = () => {};
  if (bridge)
    w.duelhippo = {
      updater: {
        check: (manual) => calls.push(["check", manual]),
        install: () => calls.push(["install"]),
        onEvent: (fn) => (push = fn),
      },
    };
  bindUpdates({ w, delay: 20, noteMs: 30 });
  const $ = (id) => w.document.getElementById(id);
  return {
    w,
    $,
    calls,
    push: (ev) => push(ev),
    note: () =>
      $("upd").classList.contains("hidden") ? "" : $("upd").textContent.trim(),
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("without the desktop bridge there is no Updates button and no note", () => {
  const p = page({ bridge: false });
  assert.ok(p.$("bUpdates").classList.contains("hidden"));
  assert.ok(p.$("upd").classList.contains("hidden"));
});

test("the automatic check is off until the player turns it on", async () => {
  let p = page();
  assert.match(p.$("bUpdates").textContent, /Updates\s+manual/);
  await wait(60);
  assert.deepEqual(p.calls, [], "no check at launch");
  p.$("bUpdates").click();
  assert.equal(p.w.localStorage.getItem(UPDATES_KEY), "1");
  assert.match(p.$("bUpdates").textContent, /Updates\s+auto/);
  p = page({ auto: true });
  assert.deepEqual(p.calls, [], "not at once");
  await wait(60);
  assert.deepEqual(p.calls, [["check", false]], "one quiet check, later");
});

test("an automatic check speaks only when it finds something", () => {
  const p = page();
  p.push({ type: "checking", manual: false });
  p.push({ type: "not-available", manual: false, current: "0.9.0" });
  p.push({ type: "error", manual: false, message: "offline" });
  assert.equal(p.note(), "");
  p.push({ type: "available", manual: false, version: "0.10.0" });
  assert.match(p.note(), /Downloading Duel Hippo 0\.10\.0/);
});

test("an asked-for check always answers", () => {
  const p = page();
  p.push({ type: "checking", manual: true });
  assert.match(p.note(), /Checking for updates/);
  p.push({ type: "not-available", manual: true, current: "0.9.0" });
  assert.match(p.note(), /Duel Hippo 0\.9\.0 is up to date/);
  p.push({ type: "not-available", manual: true, reason: "dev-build" });
  assert.match(p.note(), /only to an installed copy/);
  p.push({ type: "error", manual: true, message: "offline" });
  assert.match(p.note(), /Could not get the update/);
});

test("a downloaded update waits on the title for the player's Restart", async () => {
  const p = page();
  p.push({ type: "downloaded", manual: false, version: "0.10.0" });
  assert.match(p.note(), /0\.10\.0 is ready\. It installs when you quit\./);
  assert.ok(p.$("upd").classList.contains("ready"), "title screen only");
  assert.ok(!p.$("updRestart").classList.contains("hidden"));
  assert.deepEqual(p.calls, [], "nothing restarts by itself");
  // A passing note gives way to it again.
  p.push({ type: "checking", manual: true });
  assert.ok(p.$("updRestart").classList.contains("hidden"));
  await new Promise((r) => p.w.setTimeout(r, 60));
  assert.match(p.note(), /is ready/);
  p.$("updRestart").click();
  assert.deepEqual(p.calls, [["install"]]);
});
