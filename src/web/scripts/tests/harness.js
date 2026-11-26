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

// harness.js — runs the prototype and the port side by side, headless.
//
// The point is the user's rule for this port: gameplay behaviour and numbers
// identical to features/prototype/. Rather than re-deriving expected values,
// the tests load BOTH games — the prototype's game.js on three.js r128 as a
// global, exactly as shipped, and the port's ES modules on current three.js —
// each into its own jsdom window, seed both Math.randoms identically, feed
// both the same key presses frame by frame, and compare the simulation state.
//
// Two things make that comparison fair:
//   * three.js draws on Math.random for every object's uuid, and r128 and
//     current three.js do not make the same number of objects. Calls from
//     inside generateUUID are served from a separate stream, so the GAME's
//     random sequence lines up call for call. (Recognised by stack frame name,
//     which is why the prototype is loaded from the unminified three.js.)
//   * WebGL does not exist here, so both games get a stand-in renderer. The
//     prototype only ever calls setPixelRatio, setSize, render and
//     domElement; so does the port.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const PROTO = at("../../../../features/prototype/src/");
const R128 = at("../../../node_modules/three-r128/build/three.js");
const PORT_HTML = at("../../index.html");

export const FRAME_MS = 1000 / 60;

// ── Deterministic randomness ────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seededRandom(seed) {
  const game = mulberry32(seed),
    uuid = mulberry32(seed ^ 0x5eed);
  return () => (new Error().stack.includes("generateUUID") ? uuid() : game());
}

// ── A jsdom window with what the games expect of a browser ─────────────────
function makeWindow(html) {
  // r128 warns once per Lambert material that it has no flat shading (it
  // ignored the option; current three.js honours it). Expected; dropped.
  const vc = new VirtualConsole();
  vc.forwardTo(console, { omitJSDOMErrors: false });
  const warn = console.warn;
  vc.removeAllListeners("warn");
  vc.on("warn", (m, ...rest) => {
    if (!String(m).includes("flatShading")) warn(m, ...rest);
  });
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "http://localhost/",
    virtualConsole: vc,
  });
  const w = dom.window;
  const ctx2d = new Proxy({}, { get: () => () => {}, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = (type) =>
    type === "2d" ? ctx2d : null;
  w.matchMedia = () => ({ matches: false });
  let raf = null,
    clock = 0;
  w.requestAnimationFrame = (cb) => {
    raf = cb;
    return 1;
  };
  Object.defineProperty(w.performance, "now", { value: () => clock });
  w.innerWidth = 1280;
  w.innerHeight = 760;
  // Let time pass with no frame drawn (a hidden page draws none).
  w.__advance = (ms) => {
    clock += ms;
  };
  // One frame of the real loop, FRAME_MS after the last.
  w.__step = () => {
    clock += FRAME_MS;
    const cb = raf;
    raf = null;
    cb(clock);
  };
  return w;
}

function fakeRenderer(w) {
  return {
    domElement: w.document.createElement("canvas"),
    setPixelRatio() {},
    setSize() {},
    clearDepth() {},
    render() {},
  };
}

// ── The prototype, as shipped, with its known bugs fixed ───────────────────
// Each fix is a change to the prototype's source text, made here because
// features/ is never edited. The port makes the same fix, so the suites
// still hold it to the prototype frame by frame. A fix whose text is no
// longer found fails loudly rather than quietly comparing against the bug.
const PROTO_FIXES = [
  // Free-flight enemy flyers never turned: `des` was `to`, the shared `tv`,
  // which the turn overwrote with the flyer's own heading (ai.js updEnemy).
  ["const des = to.normalize(),", "const des = to.clone().normalize(),"],
  // A target behind is turned to level, not dived at (ai.js updEnemy).
  [
    "const des = to.clone().normalize(), ang =",
    "const des = to.clone().normalize(); if (b.f.dot(des) < 0 && des.y < 0 && Math.abs(des.x) + Math.abs(des.z) > 1e-6) { des.y = 0; des.normalize(); } const ang =",
  ],
];
function fixPrototype(src) {
  for (const [from, to] of PROTO_FIXES) {
    if (!src.includes(from))
      throw new Error(`prototype fix not found: ${from}`);
    src = src.replace(from, to);
  }
  return src;
}

export function loadPrototype(seed) {
  const html = readFileSync(PROTO + "index.html", "utf8")
    .replace(/<!--FONTS-->[\s\S]*?<!--\/FONTS-->/, "")
    .replace(/<!--CSS-->[\s\S]*?<!--\/CSS-->/, "")
    .replace(/<!--THREE-->[\s\S]*?<!--\/THREE-->/, "")
    .replace(/<!--GAME-->[\s\S]*?<!--\/GAME-->/, "");
  const w = makeWindow(html);
  w.Math.random = seededRandom(seed);
  w.eval(readFileSync(R128, "utf8"));
  w.THREE.WebGLRenderer = function () {
    return fakeRenderer(w);
  };
  w.eval(fixPrototype(readFileSync(PROTO + "game.js", "utf8")));
  return driver(w, w.__duel);
}

// ── The port ────────────────────────────────────────────────────────────────
// ES modules are per-process singletons, so this may run once per test file.
export async function loadPort(seed) {
  const w = makeWindow(readFileSync(PORT_HTML, "utf8"));
  globalThis.window = w;
  globalThis.document = w.document;
  Math.random = seededRandom(seed);
  const { boot } = await import("../game.js");
  if (!boot({ createRenderer: () => fakeRenderer(w) }))
    throw new Error("port failed to boot");
  return driver(w, w.__duel);
}

// ── Driving and reading either game the same way ────────────────────────────
function driver(w, duel) {
  const key = (type, code) =>
    w.dispatchEvent(new w.KeyboardEvent(type, { code, bubbles: true }));
  return {
    w,
    duel,
    start: (mode) => duel.startGame(mode),
    down: (code) => key("keydown", code),
    up: (code) => key("keyup", code),
    press(code) {
      key("keydown", code);
      key("keyup", code);
    },
    // Run whole frames for `ms` of game time.
    run(ms) {
      for (let n = Math.round(ms / FRAME_MS); n > 0; n--) w.__step();
    },
    // Mutate the player through the game's own objects (and its own three.js).
    poke(fn) {
      fn(duel.P, duel);
    },
    snapshot() {
      const P = duel.P,
        S = duel.S;
      const v = (p) => [p.x, p.y, p.z];
      return {
        state: duel.state,
        mode: duel.mode,
        pos: v(P.pos),
        vel: v(P.vel),
        q: [P.q.x, P.q.y, P.q.z, P.q.w],
        speed: P.speed,
        sink: P.sink,
        thr: P.thr,
        fuel: P.fuel,
        ammo: P.ammo,
        bombs: P.bombs,
        dmg: P.dmg,
        grounded: P.grounded,
        alive: P.alive,
        score: S.score,
        kills: S.kills,
        lives: S.lives,
        wave: S.wave,
        enemies: duel.enemies.filter((e) => e.alive).map((e) => v(e.pos)),
        targets: duel.targets.map((t) => t.alive),
        msg: w.document.getElementById("msg").textContent,
      };
    },
  };
}

// Deep comparison: exact for everything but numbers, which must agree to
// `tol` (relative, with an absolute floor) — current three.js computes some
// vector maths in a different but equivalent order to r128 (applyQuaternion
// was rewritten in r155), which moves the last bits of a float.
export function diff(a, b, tol = 1e-6, path = "") {
  if (typeof a === "number" && typeof b === "number") {
    const d = Math.abs(a - b),
      lim = tol * Math.max(1, Math.abs(a), Math.abs(b));
    return d <= lim ? [] : [`${path}: ${a} vs ${b}`];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length)
      return [`${path}: length ${a.length} vs ${b.length}`];
    return a.flatMap((x, i) => diff(x, b[i], tol, `${path}[${i}]`));
  }
  if (a && b && typeof a === "object") {
    return Object.keys(a).flatMap((k) =>
      diff(a[k], b[k], tol, path ? `${path}.${k}` : k),
    );
  }
  return a === b
    ? []
    : [`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`];
}
