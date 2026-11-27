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
// Bindings are the prototype's (DESIGN.md, "Input"), plus the port's own:
// the sights (Shift, Caps Lock; AIM on a touch screen), a missile (R; MSL),
// and < > or 1–4 to change plane on the runway (or its arrows, or a swipe),
// and steering by tilting the phone in place of the stick (opt.tilt).

import { $, clamp, setLabel } from "./util.js";
import { game, opt } from "./state.js";
import { sfx } from "./audio.js";
import {
  listenMotion,
  askMotion,
  listenTilt,
  askOrientation,
  tilt,
} from "./motion.js";

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
  aim: false, // the AIM button: down the sights
};

const PREVENT = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"];

// The game actions presses trigger; set by bindInput():
// { enter, togglePause, toggleFull, dropBomb, flip, stepSpeed, toggleInvert,
//   pickPlane, stepPlane, fireMissile, stepCam, cycleWeather,
//   fix(touch, allowed), repairing, repairKey, repairMove }
let act = null;

export function releaseKeys() {
  for (const k in key) key[k] = false;
}

function press(code) {
  if (code === "KeyM") {
    setLabel($("bMute"), "Sound", sfx.toggle() ? "off" : "on");
    return;
  }
  // G, not the prototype's F, which fixes the plane in flight (repair.js).
  if (code === "KeyG") {
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
  // Enter flies again, but only from the screens that offer it: the game
  // decides which (game.js enterKey).
  if (game.state !== "play") {
    if (code === "Enter" || code === "NumpadEnter") act.enter();
    return;
  }
  if (code === "KeyP" || code === "Escape") {
    act.togglePause();
    return;
  }
  if (game.paused) return;
  // A repair under way takes the number keys (repair.js).
  if (act.repairing() && /^(Digit|Numpad)[0-9]$/.test(code)) {
    act.repairKey(+code.at(-1));
    return;
  }
  if (code === "KeyF") act.fix();
  if (code === "KeyT") act.cycleWeather();
  if (code === "KeyB") act.dropBomb();
  if (code === "KeyR") act.fireMissile();
  if (/^Digit[1-4]$/.test(code)) act.pickPlane(+code.slice(5) - 1);
  // < and > share their keys with , and . so Shift is optional.
  if (code === "Comma") act.stepPlane(-1);
  if (code === "Period") act.stepPlane(1);
  if (code === "KeyC") act.stepCam();
  if (code === "KeyI") act.toggleInvert();
  if (code === "KeyH") $("help").classList.toggle("hidden");
  if (
    game.mode === "classic" &&
    (code === "ArrowLeft" || code === "ArrowRight" || code === "KeyX")
  )
    act.flip();
}

// The continuous controls for this frame, each in −1…1.
// Aiming down the sights: Caps Lock latches it, Shift flips it while held.
// The lock's state is read from every key event rather than counted from its
// presses, since macOS sends Caps Lock's keydown and keyup on alternate
// presses.
let capsLock = false;
export function sightsUp() {
  return touch.aim || !!(key.ShiftLeft || key.ShiftRight) !== capsLock;
}

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

// With tilt on from a past session, the first tap of this one asks again:
// an app's grant can lapse between launches. Once granted, it asks no more.
let tiltOk = false;
function askTilt() {
  if (opt.tilt && !tiltOk) askOrientation().then((ok) => (tiltOk = ok));
}

// Turns tilt steering on or off. iOS lets a page read the phone's tilt only
// if asked from inside a tap, so call this from one; it settles with whether
// tilt is on.
export function setTilt(on) {
  const done = (v) => {
    opt.tilt = v;
    touch.pitch = touch.roll = 0;
    touch.held = false;
    document.body.classList.toggle("tilt", v);
    return v;
  };
  if (!on) return Promise.resolve(done(false));
  return askOrientation().then((ok) => done((tiltOk = ok)));
}

export function bindInput(actions) {
  act = actions;

  window.addEventListener("keydown", (e) => {
    // Typing a room code (or picking from a list) is not flying; and Enter
    // or Space on a focused menu button is that button's, not the game's
    // too. The flight controls on screen (FIRE, AIM…) are no menu: they
    // never take focus (below), and should one have it, Space still fires.
    const t = e.target;
    if (
      t instanceof window.HTMLInputElement ||
      t instanceof window.HTMLSelectElement ||
      t instanceof window.HTMLTextAreaElement ||
      (t instanceof window.HTMLButtonElement &&
        !t.closest("#touchui") &&
        (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space"))
    )
      return;
    capsLock = e.getModifierState("CapsLock");
    if (PREVENT.includes(e.code)) e.preventDefault();
    if (STEER.includes(e.code)) touch.flying = false;
    if (!key[e.code]) press(e.code);
    key[e.code] = true;
  });
  window.addEventListener("keyup", (e) => {
    capsLock = e.getModifierState("CapsLock");
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

  // The flight controls on screen never take the keyboard's focus, so a
  // tap leaves Space (and the rest) with the game. Their own handlers act
  // on pointerdown or click, which this does not stop.
  for (const b of $("touchui").querySelectorAll("button")) {
    b.tabIndex = -1;
    b.addEventListener("pointerdown", (e) => e.preventDefault());
  }
  // And sound woken by the first touch or key after an interruption.
  for (const ev of ["pointerdown", "keydown"])
    window.addEventListener(ev, () => sfx.resume(), { passive: true });

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
  $("bMsl").addEventListener("pointerdown", () => act.fireMissile());
  $("bAim").addEventListener("pointerdown", () => {
    touch.aim = !touch.aim;
    $("bAim").classList.toggle("on", touch.aim);
  });
  $("bFlip").addEventListener("pointerdown", () => act.flip());
  $("bCam").addEventListener("click", () => act.stepCam());
  $("bWx").addEventListener("click", () => act.cycleWeather());
  // FIX: a repair by moves of the phone. iOS lets a page read the motion
  // sensors only if asked from inside a tap, so it is asked here.
  $("bFix").addEventListener("click", () => {
    askMotion().then((ok) => act.fix(true, ok));
  });
  listenMotion((kind) => {
    if (act.repairing()) act.repairMove(kind);
  });
  $("bPause").addEventListener("click", () => act.togglePause());

  // Tilt steering: the phone's tilt drives the stick's numbers, so the
  // plane flies, inverts and auto-levels just as from the stick. Level is
  // the angle the phone is held at as the flight goes live: at the start
  // and on every resume. A repair by phone takes the phone's moves, so
  // the plane flies itself level meanwhile.
  window.addEventListener("click", askTilt);
  let live = false;
  listenTilt((r) => {
    if (!opt.tilt || sid !== null) return;
    const now = game.state === "play" && !game.paused;
    if (now && !live) {
      live = true;
      tilt.centre();
      touch.pitch = touch.roll = 0;
      touch.held = false;
      return;
    }
    live = now;
    if (!now) return;
    const hold = !act.repairing();
    touch.pitch = hold ? r.pitch : 0;
    touch.roll = hold ? r.roll : 0;
    touch.held = hold && r.held;
    touch.flying = true;
  });

  // A sideways swipe across the scene changes plane, as < and > do: left
  // for the previous, right for the next. Not one that starts on a control.
  let swipe = null;
  window.addEventListener("pointerdown", (e) => {
    swipe =
      e.pointerType === "touch" &&
      game.state === "play" &&
      !e.target.closest?.("button, #stick, #thr")
        ? { id: e.pointerId, x: e.clientX, y: e.clientY }
        : null;
  });
  window.addEventListener("pointerup", (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x,
      dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 2 * Math.abs(dy))
      act.stepPlane(dx < 0 ? -1 : 1, true);
  });
}
