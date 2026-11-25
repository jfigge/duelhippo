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

// speed-and-pause.test.js — the two things the port adds to the prototype's
// game flow: a game-speed setting, and a pause that ignores the blink of a
// full-screen transition. Port only; the prototype has neither.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort, FRAME_MS } from "./harness.js";

const game = await loadPort(42);
const { w, duel } = game;
const $ = (id) => w.document.getElementById(id);
const paused = () => !$("pause").classList.contains("hidden");

function setHidden(hidden) {
  Object.defineProperty(w.document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  w.document.dispatchEvent(new w.Event("visibilitychange"));
}

test("full speed by default, and nothing on the HUD says otherwise", () => {
  assert.equal($("bSpeed").textContent, "SPEED 100%");
  assert.ok($("hSpeedRow").classList.contains("hidden"));
});

test("- and = step the speed through 25–100% and remember it", () => {
  game.press("Minus");
  assert.equal($("bSpeed").textContent, "SPEED 75%");
  assert.equal($("bSpeedPause").textContent, "SPEED 75%");
  assert.equal($("hSpeed").textContent, "75%");
  assert.ok(!$("hSpeedRow").classList.contains("hidden"));
  for (let i = 0; i < 5; i++) game.press("Minus");
  assert.equal($("bSpeed").textContent, "SPEED 25%", "stops at the slowest");
  assert.equal(w.localStorage.getItem("duelhippo.speed"), "0.25");
  for (let i = 0; i < 5; i++) game.press("Equal");
  assert.equal($("bSpeed").textContent, "SPEED 100%", "stops at full speed");
});

test("the speed button cycles slower, then back to full", () => {
  const seen = [];
  for (let i = 0; i < 4; i++) {
    $("bSpeed").click();
    seen.push($("bSpeed").textContent);
  }
  assert.deepEqual(seen, ["SPEED 75%", "SPEED 50%", "SPEED 25%", "SPEED 100%"]);
});

test("half speed: a second of real time is half a second of game", () => {
  game.press("Minus");
  game.press("Minus"); // 50%
  game.start("classic");
  game.run(FRAME_MS);
  game.down("KeyW");
  game.run(1000);
  game.up("KeyW");
  // Throttle opens at 0.7 per game-second: 0.35 after half a game-second.
  assert.ok(Math.abs(duel.P.thr - 0.35) < 0.015, `thr ${duel.P.thr}`);
  for (let i = 0; i < 2; i++) game.press("Equal");
});

test("a full-screen blink does not pause the game", () => {
  game.start("classic");
  game.run(100);
  setHidden(true);
  setHidden(false); // back within the same instant
  assert.equal(paused(), false);
});

test("pressing F for full screen does not pause the game", () => {
  game.start("classic");
  game.run(100);
  game.press("KeyF");
  setHidden(true);
  w.__advance(600); // macOS takes about this long
  setHidden(false);
  assert.equal(paused(), false);
});

test("actually leaving the game does pause it", () => {
  game.start("classic");
  game.run(2000); // well clear of the F press above
  setHidden(true);
  w.__advance(2000);
  setHidden(false);
  assert.equal(paused(), true);
  $("resume").click();
  assert.equal(paused(), false);
});
