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

// cockpit.js — the third view on C in Free flight (camera.js): from the
// pilot's seat, the plane's own wings, struts and propeller in view, over a
// dashboard drawn for each plane type. Not part of the prototype.
//
// Each dashboard has a radar, fuel and ammunition gauges, a throttle that
// moves with the player's, and an enemy indicator found only here: an arrow
// to the nearest plane that can be hurt, and how far off it is. They are
// modelled in the eye's own space, in a scene of their own that game.js
// draws over the world (after clearing depth), so the world camera's near
// plane stays where it was and the panel never cuts into the scenery.
//
// Gauge faces are canvases, redrawn ten times a second as the HUD is. Under
// the tests there is no real 2D canvas: the faces draw nothing, and the rest
// (the throttle, which panel shows) still runs.

import * as THREE from "three";
import { scene, camera } from "./scene.js";
import { game } from "./state.js";
import { P, aiming } from "./flight.js";
import { nearestFoe } from "./missiles.js";
import { drawRadarOn } from "./hud.js";

const { PI } = Math;

// The looks: board, its padded lip, gauge rims, the side walls (all
// colours), and each face's background, markings and needle (CSS).
const STYLES = {
  wood: {
    board: 0x6b3f1f,
    lip: 0x2a1a10,
    rim: 0xc8a24a,
    wall: 0x4a2c16,
    knob: 0x111111,
    face: "#efe6cf",
    ink: "#1b140c",
    needle: "#9a1c10",
    radar: "rgba(12,20,16,.96)",
  },
  black: {
    board: 0x1d1f22,
    lip: 0x3b2a1e,
    rim: 0x6c6f73,
    wall: 0x232528,
    knob: 0xb01e1e,
    face: "#0e0f10",
    ink: "#e8e2c8",
    needle: "#ff8a2a",
    radar: "rgba(6,8,18,.96)",
  },
  alloy: {
    board: 0x9aa1a6,
    lip: 0x30343a,
    rim: 0xdfe3e6,
    wall: 0x80878c,
    knob: 0x1c1c1c,
    face: "#1a1c20",
    ink: "#f2f2ea",
    needle: "#ffd23a",
    radar: "rgba(10,14,22,.96)",
  },
  olive: {
    board: 0x4b5233,
    lip: 0x22261a,
    rim: 0x2b2b2b,
    wall: 0x3d4329,
    knob: 0xd8b04a,
    face: "#141512",
    ink: "#d8e6b0",
    needle: "#ff5a2a",
    radar: "rgba(8,12,8,.96)",
  },
};

// Each plane type's cockpit (constants.js PLANES, by index). `eye` is the
// seat in the plane's own frame (m: right, up, back), behind its coaming
// (world.js makePlane) and under the top wing, far enough back that the
// wing is a band across the top of the view, not a lid over it. The panel is `w` ×
// `h` (in the eye's space, a screen 1.23 wide at 16:9), leaning back by
// `tilt`. Each gauge is [x, y, radius, shape]; `thr` is the throttle: a
// lever on a wall quadrant, a plunger through the panel, or a lever on a
// pedestal.
export const LAYOUTS = [
  // Kite: varnished wood, brass rims, a quadrant on the left wall.
  {
    eye: [0, 1.2, 1.5],
    style: "wood",
    w: 1.34,
    h: 0.24,
    tilt: 0.22,
    radar: [0, 0.125, 0.095, "round"],
    fuel: [-0.36, 0.12, 0.065, "round"],
    foe: [-0.185, 0.155, 0.052, "round"],
    ammo: [0.205, 0.12, 0.065, "round"],
    thr: { kind: "wall", x: -0.47, y: 0.07 },
  },
  // Hornet: a small black panel, dials crowded in, a plunger in the middle.
  {
    eye: [0, 1.0, 1.4],
    style: "black",
    w: 1.02,
    h: 0.24,
    tilt: 0.3,
    radar: [-0.24, 0.12, 0.09, "round"],
    foe: [-0.05, 0.168, 0.048, "round"],
    fuel: [0.11, 0.165, 0.05, "round"],
    ammo: [0.255, 0.115, 0.06, "round"],
    thr: { kind: "plunger", x: -0.03, y: 0.055 },
  },
  // Lancer: riveted aluminium, square instruments in a row, a lever on the
  // right wall.
  {
    eye: [0, 1.6, 1.8],
    style: "alloy",
    w: 1.4,
    h: 0.2,
    tilt: 0.12,
    fuel: [-0.34, 0.1, 0.06, "square"],
    radar: [-0.12, 0.1, 0.085, "square"],
    foe: [0.09, 0.1, 0.06, "square"],
    ammo: [0.29, 0.1, 0.06, "square"],
    thr: { kind: "wall", x: 0.48, y: 0.06 },
    rivets: true,
  },
  // Brute: a broad olive panel in two rows, the radar big on the right, the
  // throttle on a pedestal in the middle.
  {
    eye: [0, 1.6, 1.6],
    style: "olive",
    w: 1.64,
    h: 0.26,
    tilt: 0.18,
    fuel: [-0.43, 0.18, 0.052, "round"],
    ammo: [-0.43, 0.07, 0.052, "round"],
    foe: [-0.27, 0.125, 0.055, "round"],
    radar: [0.3, 0.13, 0.105, "round"],
    thr: { kind: "pedestal", x: 0.03, y: 0 },
  },
];
export const seat = (kind) => LAYOUTS[kind]?.eye ?? LAYOUTS[0].eye;

// The panel's own scene and camera, drawn over the world's (game.js).
export const dash = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(60, 1, 0.05, 20),
};
const hemi = new THREE.HemisphereLight(0xfff4e0, 0x403830, 0.95 * PI),
  key = new THREE.DirectionalLight(0xffffff, 0.55 * PI);
key.position.set(0.4, 1, 0.8);
dash.scene.add(hemi, key);
// The world's lights, which the panel's follow (dim at night, grey in fog).
const worldHemi = scene.children.find((o) => o.isHemisphereLight),
  worldSun = scene.children.find((o) => o.isDirectionalLight),
  BASE = [worldHemi.intensity, worldSun.intensity];

const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
const at = (parent, m, x, y, z) => (m.position.set(x, y, z), parent.add(m), m);

// A gauge: a rim and a canvas face, its own texture. Returns the face's
// drawing context (null with no 2D canvas) and its texture.
function gauge(board, st, [x, y, r, shape]) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const ctx = cv.getContext("2d"),
    tex = new THREE.CanvasTexture(cv);
  const face = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  if (shape === "square") {
    const s = r * 2;
    at(
      board,
      new THREE.Mesh(
        new THREE.BoxGeometry(s + 0.02, s + 0.02, 0.012),
        lam(st.rim),
      ),
      x,
      y,
      0.012,
    );
    at(board, new THREE.Mesh(new THREE.PlaneGeometry(s, s), face), x, y, 0.019);
  } else {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(r, r * 0.11, 8, 32),
      lam(st.rim),
    );
    at(board, rim, x, y, 0.016);
    at(
      board,
      new THREE.Mesh(new THREE.CircleGeometry(r, 32), face),
      x,
      y,
      0.017,
    );
  }
  return { ctx, tex, face, shape };
}

// A throttle: the moving part is a group whose x rotation (a lever) or z
// position (a plunger) follows P.thr.
function throttle(rig, board, st, t) {
  const g = new THREE.Group();
  if (t.kind === "plunger") {
    // Through the panel: pulled out at idle, pushed home at full.
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.1, 10),
      lam(0x9a9a9a),
    );
    shaft.rotation.x = PI / 2;
    at(g, shaft, 0, 0, -0.03);
    at(
      g,
      new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.016, 0.016), lam(st.knob)),
      0,
      0,
      0.02,
    );
    at(board, g, t.x, t.y, 0.04);
    return (k) => (g.position.z = 0.075 - 0.06 * k);
  }
  // A lever on a pivot: back towards the pilot at idle, forward at full.
  const len = t.kind === "pedestal" ? 0.2 : 0.15;
  at(
    g,
    new THREE.Mesh(new THREE.BoxGeometry(0.012, len, 0.012), lam(0x2a2a2a)),
    0,
    len / 2,
    0,
  );
  at(
    g,
    new THREE.Mesh(
      new THREE.SphereGeometry(t.kind === "pedestal" ? 0.022 : 0.017, 12, 8),
      lam(st.knob),
    ),
    0,
    len,
    0,
  );
  if (t.kind === "pedestal") {
    // A console rising from the floor, the lever in a slot on its top.
    at(
      rig,
      new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.2), lam(st.wall)),
      t.x,
      -0.03,
      0.06,
    );
    at(rig, g, t.x, 0.015, 0.06);
  } else {
    // A wall beside the pilot, and a quadrant plate on it.
    const s = Math.sign(t.x);
    const wall = at(
      rig,
      new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.42), lam(st.wall)),
      t.x + s * 0.05,
      0.08,
      0.08,
    );
    wall.rotation.y = -s * 0.25;
    at(
      rig,
      new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.17), lam(st.lip)),
      t.x + s * 0.025,
      t.y + 0.01,
      0.08,
    );
    at(rig, g, t.x, t.y, 0.08);
  }
  return (k) => (g.rotation.x = 0.6 - 1.1 * k);
}

function build(kind) {
  const lay = LAYOUTS[kind],
    st = STYLES[lay.style],
    rig = new THREE.Group();
  // The board, its foot at the bottom of the screen, leaning back.
  const board = new THREE.Group();
  board.rotation.x = -lay.tilt;
  rig.add(board);
  at(
    board,
    new THREE.Mesh(
      new THREE.BoxGeometry(lay.w, lay.h + 0.06, 0.02),
      lam(st.board),
    ),
    0,
    (lay.h - 0.06) / 2,
    0,
  );
  // The padded lip along its top.
  const lip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, lay.w, 12),
    lam(st.lip),
  );
  lip.rotation.z = PI / 2;
  at(board, lip, 0, lay.h, 0.012);
  if (lay.rivets) {
    const rg = new THREE.SphereGeometry(0.005, 6, 4),
      rm = lam(0xc9ced2);
    for (let x = -lay.w / 2 + 0.03; x < lay.w / 2; x += 0.07)
      for (const y of [0.015, lay.h - 0.03])
        at(board, new THREE.Mesh(rg, rm), x, y, 0.012);
  }
  const faces = {};
  for (const k of ["radar", "fuel", "ammo", "foe"])
    faces[k] = gauge(board, st, lay[k]);
  const thr = throttle(rig, board, st, lay.thr);
  rig.visible = false;
  dash.scene.add(rig);
  return { rig, st, faces, thr };
}
const built = [];
const panel = (kind) => (built[kind] ??= build(kind));

// ── The faces ───────────────────────────────────────────────────────────────
// A dial's needle sweeps 270°, from bottom left (empty) to bottom right.
const sweep = (k) => PI * 0.75 + Math.max(0, Math.min(1, k)) * PI * 1.5;
function back(g, st) {
  const c = g.ctx;
  c.clearRect(0, 0, 256, 256);
  c.fillStyle = st.face;
  if (g.shape === "square") c.fillRect(0, 0, 256, 256);
  else {
    c.beginPath();
    c.arc(128, 128, 127, 0, 2 * PI);
    c.fill();
  }
}
function ticks(c, st, n, red = 0) {
  for (let i = 0; i <= n; i++) {
    const a = sweep(i / n);
    c.strokeStyle = i / n < red ? "#d0302a" : st.ink;
    c.lineWidth = i % 2 ? 4 : 8;
    c.beginPath();
    c.moveTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112);
    c.lineTo(
      128 + Math.cos(a) * (i % 2 ? 98 : 88),
      128 + Math.sin(a) * (i % 2 ? 98 : 88),
    );
    c.stroke();
  }
}
function needle(c, st, k) {
  const a = sweep(k);
  c.strokeStyle = st.needle;
  c.lineWidth = 9;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(128 - Math.cos(a) * 18, 128 - Math.sin(a) * 18);
  c.lineTo(128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96);
  c.stroke();
  c.fillStyle = st.ink;
  c.beginPath();
  c.arc(128, 128, 12, 0, 2 * PI);
  c.fill();
}
function text(c, st, s, x, y, px, col = st.ink) {
  c.fillStyle = col;
  c.font = `bold ${px}px sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(s, x, y);
}

function drawFuel(g, st) {
  const c = g.ctx;
  back(g, st);
  ticks(c, st, 8, 0.2);
  text(c, st, "E", 62, 196, 30);
  text(c, st, "F", 194, 196, 30);
  text(c, st, "FUEL", 128, 186, 26);
  needle(c, st, P.fuel / 100);
}
function drawAmmo(g, st) {
  const c = g.ctx;
  back(g, st);
  ticks(c, st, 6);
  text(c, st, "ROUNDS", 128, 70, 22);
  text(c, st, String(Math.floor(P.ammo)), 128, 168, 34);
  const extra =
    (P.pt.bombs ? `B${P.bombs}` : "") + (P.pt.missiles ? `  M${P.msl}` : "");
  text(c, st, extra, 128, 210, 26);
  needle(c, st, P.ammo / P.pt.ammo);
}
// The nearest foe: an arrow for its bearing off the nose (up is dead ahead),
// a chevron when it is well above or below, and its distance.
const rel = new THREE.Vector3(),
  B = {
    f: new THREE.Vector3(),
    u: new THREE.Vector3(),
    r: new THREE.Vector3(),
  };
function drawFoe(g, st) {
  const c = g.ctx;
  back(g, st);
  text(c, st, "ENEMY", 128, 34, 24);
  const { foe, dist } = nearestFoe();
  if (!foe) {
    text(c, st, "—", 128, 128, 60);
    return;
  }
  B.f.set(0, 0, -1).applyQuaternion(P.q);
  B.u.set(0, 1, 0).applyQuaternion(P.q);
  B.r.set(1, 0, 0).applyQuaternion(P.q);
  rel.copy(foe.pos).sub(P.pos);
  const x = rel.dot(B.r),
    y = rel.dot(B.u),
    z = rel.dot(B.f),
    a = Math.atan2(x, z),
    el = Math.atan2(y, Math.hypot(x, z));
  c.save();
  c.translate(128, 118);
  c.rotate(a);
  c.fillStyle = st.needle;
  c.beginPath();
  c.moveTo(0, -66);
  c.lineTo(34, -8);
  c.lineTo(12, -8);
  c.lineTo(12, 50);
  c.lineTo(-12, 50);
  c.lineTo(-12, -8);
  c.lineTo(-34, -8);
  c.closePath();
  c.fill();
  c.restore();
  if (Math.abs(el) > PI / 12)
    text(c, st, el > 0 ? "▲" : "▼", 214, 118, 34, st.needle);
  text(
    c,
    st,
    dist < 1000
      ? `${Math.round(dist / 10) * 10} m`
      : `${(dist / 1000).toFixed(1)} km`,
    128,
    212,
    34,
  );
}
function drawRadar(g, st) {
  back(g, st);
  drawRadarOn(g.ctx, 256, st.radar);
}

// ── Each frame ──────────────────────────────────────────────────────────────
// The view is on in Free flight, in play, alive, on the third camera, and
// not down the sights (which has the view of its own).
export const cockpitOn = () =>
  game.state === "play" &&
  game.mode === "free" &&
  game.camZoom === 2 &&
  P.alive &&
  !aiming();

let shown = -1,
  faceT = 0;
const D = 0.6; // how far ahead of the eye the panel stands
export function updCockpit(dt) {
  const on = cockpitOn();
  document.body.classList.toggle("cockpit", on);
  if (!on) {
    if (shown >= 0) built[shown].rig.visible = false;
    shown = -1;
    return;
  }
  const p = panel(P.kind);
  if (shown !== P.kind) {
    if (shown >= 0) built[shown].rig.visible = false;
    p.rig.visible = true;
    shown = P.kind;
    faceT = 0;
  }
  // The same view as the world's, the panel's foot on the screen's bottom
  // edge, shrunk on a narrow screen so its sides still show.
  const cam = dash.camera;
  if (cam.fov !== camera.fov || cam.aspect !== camera.aspect) {
    cam.fov = camera.fov;
    cam.aspect = camera.aspect;
    cam.updateProjectionMatrix();
  }
  const half = D * Math.tan((cam.fov * PI) / 360),
    s = Math.min(1, (half * cam.aspect) / 0.62);
  p.rig.position.set(0, -half, -D);
  p.rig.scale.setScalar(s);
  p.thr(P.thr);
  // The panel's light follows the world's.
  hemi.intensity = 0.95 * PI * (worldHemi.intensity / BASE[0]);
  key.intensity = 0.55 * PI * (worldSun.intensity / BASE[1]);
  if ((faceT -= dt) > 0) return;
  faceT = 0.1;
  const glow = 0.5 + 0.5 * Math.min(1, worldHemi.intensity / BASE[0]);
  for (const [k, draw] of [
    ["radar", drawRadar],
    ["fuel", drawFuel],
    ["ammo", drawAmmo],
    ["foe", drawFoe],
  ]) {
    const g = p.faces[k];
    g.face.color.setScalar(glow);
    if (!g.ctx) continue;
    draw(g, p.st);
    g.tex.needsUpdate = true;
  }
}
