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

// input.js — keyboard and touch, read into one shared control state.
//
// `key` (held keys by KeyboardEvent.code) and `touch` (virtual stick,
// throttle slider, fire button) are polled once a frame by readInput(). The
// one-shot presses — bomb, flip, camera, pause — call back into the game
// through the handlers bindInput() is given, so this module needs no import
// of the modules it drives.
//
// Bindings are the prototype's (DESIGN.md, "Input").

import { $, clamp } from "./util.js";
import { game, opt } from "./state.js";
import { sfx } from "./audio.js";
import { say } from "./msg.js";

export const isTouch =
  window.matchMedia("(pointer:coarse)").matches || "ontouchstart" in window;

export const key = {};
export const touch = {
  pitch: 0,
  roll: 0,
  fire: false,
  thr: null,
  held: false, // a thumb is on the stick, even inside its dead zone
  flying: false, // the stick, not the keyboard, is what's steering
};

const PREVENT = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"];

// The game actions presses trigger; set by bindInput():
// { startGame, setPause, toggleFull, dropBomb, flip, stepSpeed }
let act = null;

export function releaseKeys() {
  for (const k in key) key[k] = false;
}

function press(code) {
  if (code === "KeyM") {
    $("bMute").textContent = sfx.toggle() ? "SOUND OFF" : "SOUND ON";
    return;
  }
  if (code === "KeyF") {
    act.toggleFull();
    return;
  }
  // Game speed, from anywhere: - slower, = (the + key) faster.
  if (code === "Minus" || code === "NumpadSubtract") {
    act.stepSpeed(-1);
    return;
  }
  if (code === "Equal" || code === "NumpadAdd") {
    act.stepSpeed(1);
    return;
  }
  if (game.state !== "play") {
    if (code === "Enter") act.startGame(game.mode);
    return;
  }
  if (code === "KeyP" || code === "Escape") {
    act.setPause(!game.paused);
    return;
  }
  if (game.paused) return;
  if (code === "KeyB") act.dropBomb();
  if (code === "KeyC") game.camZoom = (game.camZoom + 1) % 2;
  if (code === "KeyI") {
    opt.invert = !opt.invert;
    say(opt.invert ? "Pitch inverted" : "Pitch normal", 1.2);
  }
  if (code === "KeyH") $("help").classList.toggle("hidden");
  if (
    game.mode === "classic" &&
    (code === "ArrowLeft" || code === "ArrowRight" || code === "KeyX")
  )
    act.flip();
}

// The continuous controls for this frame, each in −1…1.
export function readInput() {
  let pitch = (key.ArrowDown ? 1 : 0) - (key.ArrowUp ? 1 : 0) + touch.pitch;
  if (opt.invert) pitch = -pitch;
  const roll =
    game.mode === "classic"
      ? 0
      : (key.ArrowLeft ? 1 : 0) - (key.ArrowRight ? 1 : 0) + touch.roll;
  const yaw =
    game.mode === "classic" ? 0 : (key.KeyA ? 1 : 0) - (key.KeyD ? 1 : 0);
  return {
    pitch: clamp(pitch, -1, 1),
    roll: clamp(roll, -1, 1),
    yaw,
    fire: !!(key.Space || touch.fire),
  };
}

// Steering keys hand control back to the keyboard (see autoLevel).
const STEER = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyA",
  "KeyD",
];

// True when the plane should fly itself level: the stick is what's been
// steering, it has been let go, and no key is steering either. `isTouch`
// alone won't do: touch-screen laptops (and jsdom) report it during
// keyboard play, which must stay exactly the prototype's.
export function autoLevel(inp) {
  return touch.flying && !touch.held && !inp.pitch && !inp.roll && !inp.yaw;
}

export function bindInput(actions) {
  act = actions;

  window.addEventListener("keydown", (e) => {
    if (PREVENT.includes(e.code)) e.preventDefault();
    if (STEER.includes(e.code)) touch.flying = false;
    if (!key[e.code]) press(e.code);
    key[e.code] = true;
  });
  window.addEventListener("keyup", (e) => {
    key[e.code] = false;
  });
  window.addEventListener("blur", releaseKeys);

  // ── Touch controls ────────────────────────────────────────────────────────
  // Pointer events with pointer capture, so a thumb that slides off a control
  // keeps driving it until it lifts.
  const stick = $("stick"),
    knob = $("knob");
  let sid = null;
  const move = (e) => {
    const r = stick.getBoundingClientRect(),
      R = r.width / 2;
    let dx = (e.clientX - r.left - R) / R,
      dy = (e.clientY - r.top - R) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    knob.style.transform = `translate(${dx * R * 0.6}px,${dy * R * 0.6}px)`;
    touch.pitch = Math.abs(dy) < 0.12 ? 0 : dy;
    touch.roll = Math.abs(dx) < 0.12 ? 0 : -dx;
  };
  stick.addEventListener("pointerdown", (e) => {
    sid = e.pointerId;
    touch.held = touch.flying = true;
    stick.setPointerCapture(sid);
    move(e);
  });
  stick.addEventListener("pointermove", (e) => {
    if (e.pointerId === sid) move(e);
  });
  const end = (e) => {
    if (e.pointerId !== sid) return;
    sid = null;
    touch.held = false;
    touch.pitch = touch.roll = 0;
    knob.style.transform = "";
  };
  stick.addEventListener("pointerup", end);
  stick.addEventListener("pointercancel", end);

  const thr = $("thr");
  let tid = null;
  const tmove = (e) => {
    const r = thr.getBoundingClientRect();
    touch.thr = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
  };
  thr.addEventListener("pointerdown", (e) => {
    tid = e.pointerId;
    thr.setPointerCapture(tid);
    tmove(e);
  });
  thr.addEventListener("pointermove", (e) => {
    if (e.pointerId === tid) tmove(e);
  });
  const tend = (e) => {
    if (e.pointerId === tid) {
      tid = null;
      touch.thr = null;
    }
  };
  thr.addEventListener("pointerup", tend);
  thr.addEventListener("pointercancel", tend);

  const fb = $("bFire");
  fb.addEventListener("pointerdown", (e) => {
    fb.setPointerCapture(e.pointerId);
    touch.fire = true;
  });
  for (const ev of ["pointerup", "pointercancel"])
    fb.addEventListener(ev, () => {
      touch.fire = false;
    });
  $("bBomb").addEventListener("pointerdown", () => act.dropBomb());
  $("bFlip").addEventListener("pointerdown", () => act.flip());
  $("bCam").addEventListener("click", () => {
    game.camZoom = (game.camZoom + 1) % 2;
  });
  $("bPause").addEventListener("click", () => act.setPause(!game.paused));
}
