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

// menus.test.js — the screens round the game: what Enter starts and where,
// keys on a focused button, the match menu's toggle, the focus and the sound
// after a pause, the start camera on a raised runway, and the labels a
// screen reader reads. Port only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

// A Web Audio stand-in, so the sound's resume can be watched. Every node
// takes any call and returns another node.
const node = () =>
  new Proxy(function () {}, {
    get: (_, k) =>
      k === "getChannelData" ? () => new Float32Array(1000) : node(),
    set: () => true,
    apply: () => node(),
  });
let audio = null;
class FakeAudio {
  constructor() {
    this.state = "suspended";
    this.sampleRate = 100;
    this.currentTime = 0;
    this.resumes = 0;
    audio = this;
    return new Proxy(this, {
      get: (t, k) => (k in t ? t[k] : () => node()),
      set: (t, k, v) => ((t[k] = v), true),
    });
  }
  resume() {
    this.resumes++;
    this.state = "running";
    return Promise.resolve();
  }
}

const game = await loadPort(11);
const { w, duel } = game;
w.AudioContext = FakeAudio;
const P = duel.P,
  S = duel.S,
  net = duel.net;
const $ = (id) => w.document.getElementById(id);
const shown = (id) => !$(id).classList.contains("hidden");
const { key } = await import("../input.js");
const { run } = await import("../course.js");
const { mapNow } = await import("../maps.js");
const { showMaps } = await import("../game.js");
const canvas = () => $("view").querySelector("canvas");

// A key pressed with `el` focused: the event starts there and bubbles.
function keyOn(el, code) {
  for (const type of ["keydown", "keyup"])
    el.dispatchEvent(new w.KeyboardEvent(type, { code, bubbles: true }));
}

// Out of a game and back to the title, whatever state it was in.
function toTitle() {
  if (duel.state === "play") $("menu").click();
  else if (shown("over")) $("oMenu").click();
}

test("Enter on the title starts the last game started", () => {
  assert.equal(duel.state, "title");
  game.press("Enter");
  assert.equal(duel.state, "play");
  assert.equal(duel.mode, "classic", "a first game: Classic");
  toTitle();
  $("title").querySelector('[data-start="free"]').click();
  toTitle();
  game.press("Enter");
  assert.equal(duel.mode, "free", "the last start, Free flight");
  toTitle();
});

test("Enter does nothing on the course, controls and scores screens", () => {
  for (const [open, back, id] of [
    ["bCourse", "cBack", "course"],
    ["bControls", "ctBack", "controls"],
    ["bScores", "scBack", "scores"],
  ]) {
    $(open).click();
    assert.ok(shown(id));
    game.press("Enter");
    assert.equal(duel.state, "title", `nothing started from ${id}`);
    assert.ok(shown(id), `still on ${id}`);
    $(back).click();
  }
});

test("after a course, Enter flies the course again", () => {
  $("bCourse").click();
  $("cFly").click();
  assert.ok(run.on);
  game.press("KeyP");
  $("quit").click();
  assert.ok(shown("over"));
  game.press("Enter");
  assert.equal(duel.state, "play");
  assert.ok(run.on, "the course, not Free flight");
  assert.equal(mapNow(), "field");
  toTitle();
});

test("Enter and Space on a focused button are the button's alone", () => {
  const b = $("bControls");
  b.focus();
  keyOn(b, "Enter");
  assert.equal(duel.state, "title", "Enter did not start a game too");
  keyOn(b, "Space");
  assert.equal(duel.state, "title");
  game.start("classic");
  const pick = $("pNext");
  pick.focus();
  pick.dispatchEvent(
    new w.KeyboardEvent("keydown", { code: "Space", bubbles: true }),
  );
  assert.ok(!key.Space, "the guns did not fire as well");
  pick.dispatchEvent(
    new w.KeyboardEvent("keyup", { code: "Space", bubbles: true }),
  );
  // The flight controls on a touch screen are not menu buttons: a tap
  // focuses one, and Space must still fire.
  const fireB = $("bFire");
  fireB.focus();
  fireB.dispatchEvent(
    new w.KeyboardEvent("keydown", { code: "Space", bubbles: true }),
  );
  assert.ok(key.Space, "Space fires with FIRE focused");
  for (const b of $("touchui").querySelectorAll("button"))
    assert.equal(b.tabIndex, -1, `${b.id} never takes the keyboard`);
  fireB.dispatchEvent(
    new w.KeyboardEvent("keyup", { code: "Space", bubbles: true }),
  );
  toTitle();
});

test("the lobby's list keeps its keys", () => {
  const sel = $("onLayout");
  game.start("free");
  sel.dispatchEvent(
    new w.KeyboardEvent("keydown", { code: "ArrowDown", bubbles: true }),
  );
  assert.ok(!key.ArrowDown, "not a pull-up");
  sel.dispatchEvent(
    new w.KeyboardEvent("keyup", { code: "ArrowDown", bubbles: true }),
  );
  toTitle();
});

test("resuming puts the keyboard back on the scene, and the sound", () => {
  game.start("free");
  assert.equal(w.document.activeElement, canvas());
  assert.ok(audio, "the sound started with the game");
  game.press("KeyP");
  assert.ok(shown("pause"));
  $("resume").focus();
  audio.state = "interrupted"; // iOS, after a call
  const before = audio.resumes;
  $("resume").click();
  assert.ok(!shown("pause"));
  assert.equal(w.document.activeElement, canvas(), "off the Resume button");
  assert.equal(audio.resumes, before + 1, "interrupted is resumed too");
  assert.equal(audio.state, "running");
  // Running already: left alone.
  game.press("KeyP");
  $("resume").click();
  assert.equal(audio.resumes, before + 1);
  toTitle();
});

test("in a match, P and the pause button open and close the match menu", () => {
  game.start("free");
  net.on = true; // a match, as far as the menu goes
  try {
    game.press("KeyP");
    assert.ok(shown("pause"));
    assert.equal($("pTitle").textContent, "Match menu");
    game.press("KeyP");
    assert.ok(!shown("pause"), "P closes it again");
    game.press("Escape");
    assert.ok(shown("pause"));
    $("bPause").click();
    assert.ok(!shown("pause"), "and so does the touch button");
  } finally {
    net.on = false;
  }
  toTitle();
});

test("Enter on a match's over card starts nothing", () => {
  game.start("free");
  game.press("KeyP");
  $("quit").click();
  assert.ok(shown("over"));
  net.on = true; // the over card a match shows, counting or done
  try {
    game.press("Enter");
    assert.equal(duel.state, "over", "no one-player game under the match");
  } finally {
    net.on = false;
  }
  toTitle();
});

test("on a raised runway the start camera is level with it", () => {
  game.start("free");
  assert.equal(duel.camera.position.y, 20, "the Countryside's 20 m");
  toTitle();
  S.best = 1e6;
  showMaps();
  w.document.querySelector('[data-map="sky"]').click();
  game.start("free");
  assert.equal(mapNow(), "sky");
  assert.ok(P.pos.y > 100, "Sky islands' runway is high up");
  assert.ok(
    Math.abs(duel.camera.position.y - (P.pos.y + 18)) < 1e-9,
    `camera at ${duel.camera.position.y}, runway at ${P.pos.y}`,
  );
  toTitle();
  w.document.querySelector('[data-map="field"]').click();
});

test("the screen reader's labels: maps, levels and the pause button", () => {
  assert.equal($("bPause").getAttribute("aria-label"), "Pause");
  for (const id of ["maps", "onMaps", "cSizes"])
    assert.equal($(id).getAttribute("role"), "group", id);
  const title = [...$("maps").querySelectorAll("button")];
  assert.deepEqual(
    title.filter((b) => b.getAttribute("aria-pressed") === "true"),
    [w.document.querySelector('[data-map="field"]')],
  );
  assert.ok(title.every((b) => b.hasAttribute("aria-pressed")));
});
