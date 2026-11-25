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

// world.js — terrain, airfields, scenery, the enemy town and the hippos.
//
// The world is laid out along +X so both modes share it (DESIGN.md, "World"):
// home runway at x=0 → hippos → enemy town → enemy runway at x=2850. The
// flat play area is centred on CX; hills rise past FLAT from the centre.
//
// Everything static is built when this module is first imported, in the
// prototype's order (ground, runways, dressing, trees, clouds, hippos), so a
// seeded Math.random lays the world out exactly as the prototype did — the
// equivalence test relies on that.

import * as THREE from "three";
import { V, Q, PI, AY, rnd, clamp, tv2 } from "./util.js";
import { CX, FLAT, HOME, EB, LANE, TDEF } from "./constants.js";
import { scene, M, box, put, flat } from "./scene.js";
import { S } from "./state.js";
import { puff, boom } from "./effects.js";
import { say } from "./msg.js";
// Neither imports a game module, so they cannot disturb the evaluation
// order above.
import { net, send, myTeam } from "./net/bus.js";
import { TEAM, fieldSpots } from "./net/teams.js";

export function groundY(x, z) {
  const d = Math.max(Math.abs(x - CX), Math.abs(z));
  return d <= FLAT
    ? 0
    : (d - FLAT) *
        0.24 *
        (0.65 + 0.35 * Math.sin(x * 0.004 + 1) * Math.cos(z * 0.005));
}
export const onRun = (p, R) =>
  Math.abs(p.x - R.x) < R.hl && Math.abs(p.z - R.z) < R.hw;

// ── Ground: one patchwork mesh, flat play area, hills at the edges ──────────
{
  const GS = 9000,
    GN = 56,
    g = new THREE.PlaneGeometry(GS, GS, GN, GN).toNonIndexed(),
    p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++)
    p.setZ(i, groundY(p.getX(i) + CX, -p.getY(i)));
  const pal = [
    0x5f9a40, 0x6ea648, 0x528a36, 0x96a64f, 0xb8a656, 0x77a044, 0x5c8e3c,
  ].map((c) => new THREE.Color(c));
  const lo = new THREE.Color(0x5b8a3a),
    hi = new THREE.Color(0x9a8a66),
    c = new THREE.Color();
  for (let q = 0; q < p.count / 6; q++) {
    let h = 0;
    for (let k = 0; k < 6; k++) h += p.getZ(q * 6 + k);
    h /= 6;
    if (h > 0.5) c.copy(lo).lerp(hi, clamp(h / 260, 0, 1));
    else c.copy(pal[(Math.random() * pal.length) | 0]);
    for (let k = 0; k < 6; k++) c.toArray(col, (q * 6 + k) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(
    g,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  m.rotation.x = -PI / 2;
  m.position.x = CX;
  scene.add(m);
  // the dirt road the classic lane follows
  put(
    scene,
    flat(LANE.max - LANE.min + 600, 9, 0xb9a47c, -1),
    (LANE.min + LANE.max) / 2,
    0.03,
    0,
  );
}

// ── Runways ─────────────────────────────────────────────────────────────────
function runway(R, edge, into = scene) {
  put(into, flat(R.hl * 2, R.hw * 2, 0x8d8371, -2), R.x, 0.05, R.z);
  for (let x = -R.hl + 30; x < R.hl - 30; x += 32)
    put(into, flat(13, 1.2, 0xf4f1e6, -4), R.x + x, 0.06, R.z);
  for (const s of [-1, 1])
    for (let i = 0; i < 5; i++)
      put(
        into,
        flat(14, 2, 0xf4f1e6, -4),
        R.x + s * (R.hl - 12),
        0.06,
        R.z - 12 + i * 6,
      );
  for (let x = -R.hl; x <= R.hl; x += 46)
    for (const s of [-1, 1])
      put(into, box(1, 0.7, 1, edge), R.x + x, 0.35, R.z + s * (R.hw + 1.5));
}
runway(HOME, 0x55ffff);
runway(EB, 0xff55ff);

// ── Solids you can fly into (free mode reaches the off-lane buildings) ──────
export const solids = [];
function hangar(x, z, roof, solid = true, into = scene) {
  const g = new THREE.Group();
  put(g, box(30, 10, 24, 0x8a6e52), 0, 5, 0);
  put(g, box(32, 2.4, 26, roof), 0, 11.2, 0);
  put(g, box(16, 8, 0.4, 0x3b2c22), 0, 4, 12.1);
  g.position.set(x, 0, z);
  into.add(g);
  if (solid) solids.push({ x, z, r: 17, h: 12.5 });
  return g;
}
{
  // home base dressing (behind the lane, visible as backdrop in classic)
  hangar(-110, -60, 0x2fc6d6);
  hangar(-150, -95, 0x2fc6d6);
  const tw = new THREE.Group();
  put(tw, box(6, 16, 6, 0xd9d2c0), 0, 8, 0);
  put(tw, box(9, 4, 9, 0x55ffff), 0, 18, 0);
  tw.position.set(140, 0, -55);
  scene.add(tw);
  solids.push({ x: 140, z: -55, r: 6, h: 20 });
  put(scene, box(0.4, 12, 0.4, 0xeeeeee), 120, 6, -28);
  put(scene, box(5, 3, 0.15, 0x55ffff), 122.7, 10.5, -28);
  const sock = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 5, 8, 1, true),
    M(0xff8a2a),
  );
  sock.rotation.z = PI / 2;
  put(scene, sock, 166, 9, -30);
  put(scene, box(0.3, 9, 0.3, 0xdddddd), 163.5, 4.5, -30);
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 1.8, 8),
      M(i % 2 ? 0xc23b3b : 0x2b6fb3),
    );
    put(scene, d, -60 + (i % 3) * 2.1, 0.9 + (i > 2 ? 1.8 : 0), -40);
  }
  // enemy airfield dressing
  hangar(EB.x - 120, -70, 0xb03aa0);
  hangar(EB.x + 120, -70, 0xb03aa0);
}

// ── Trees (instanced) and clouds ────────────────────────────────────────────
// Where each tree stands, so a team game can clear its airfields (below).
const trees = { crown: null, trunk: null, at: [], hidden: [] };
{
  const N = 900,
    crown = new THREE.InstancedMesh(
      new THREE.ConeGeometry(4, 10, 6),
      M(0x3d7a35),
      N,
    );
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.6, 0.7, 3, 5),
    M(0x6b4a2a),
    N,
  );
  const m = new THREE.Matrix4(),
    s = new V(),
    p = new V(),
    q = new Q();
  const bad = (x, z) => {
    // keep the lane & classic camera clear
    if (x > LANE.min - 200 && x < LANE.max + 200 && z > -30 && z < 160)
      return true;
    for (const R of [HOME, EB])
      if (Math.abs(x - R.x) < R.hl + 70 && Math.abs(z - R.z) < 110) return true;
    return Math.abs(x - CX) > 4300 || Math.abs(z) > 4300;
  };
  let i = 0,
    tries = 0;
  while (i < N && tries++ < 20000) {
    const cx = rnd(CX - 3600, CX + 3600),
      cz = rnd(-3600, 3600),
      n = 6 + ((Math.random() * 20) | 0);
    for (let k = 0; k < n && i < N; k++) {
      const x = cx + rnd(-90, 90),
        z = cz + rnd(-90, 90);
      if (bad(x, z)) continue;
      const sc = rnd(0.7, 1.6),
        y = groundY(x, z);
      q.setFromAxisAngle(AY, rnd(0, 6.3));
      m.compose(p.set(x, y + 8 * sc, z), q, s.set(sc, sc, sc));
      crown.setMatrixAt(i, m);
      m.compose(p.set(x, y + 1.5 * sc, z), q, s.set(sc, sc, sc));
      trunk.setMatrixAt(i, m);
      trees.at.push(x, z);
      i++;
    }
  }
  crown.count = trunk.count = i;
  scene.add(crown, trunk);
  trees.crown = crown;
  trees.trunk = trunk;

  const cm = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    flatShading: true,
    transparent: true,
    opacity: 0.93,
  });
  const cg = new THREE.IcosahedronGeometry(1, 0);
  for (let c = 0; c < 60; c++) {
    const grp = new THREE.Group(),
      n = 3 + ((Math.random() * 4) | 0);
    for (let j = 0; j < n; j++) {
      const b = new THREE.Mesh(cg, cm);
      b.scale.set(rnd(24, 44), rnd(11, 19), rnd(18, 32));
      b.position.set(j * 27 - n * 13 + rnd(-8, 8), rnd(-5, 5), rnd(-10, 10));
      grp.add(b);
    }
    const behind = c < 30; // half the clouds form the classic-mode backdrop
    grp.position.set(
      behind ? rnd(LANE.min - 400, LANE.max + 400) : rnd(CX - 3800, CX + 3800),
      rnd(behind ? 300 : 380, 700),
      behind ? rnd(-1100, -160) : rnd(-3800, 3800),
    );
    if (!behind && Math.abs(grp.position.z) < 90) grp.position.z += 400;
    scene.add(grp);
  }
}

// ── Plane models and their ground shadows ───────────────────────────────────
// `kind` is the plane type (constants.js PLANES). Kind 0, the Kite, is the
// prototype's biplane; the others are drawn by planeKinds below, each with
// its wheels on the same line, GEAR below the origin.
export function makePlane(body, wing, trim, dark, kind = 0) {
  if (kind) return planeKinds[kind](body, wing, trim, dark);
  const g = new THREE.Group(),
    strut = 0x3a2a1a;
  put(g, box(1.4, 1.4, 6.4, body), 0, 0, 0.2);
  put(g, box(1.7, 1.7, 1.1, 0x2b2b2b), 0, 0, -3.4);
  put(g, box(10.5, 0.16, 1.7, wing), 0, 1.7, -1.3);
  put(g, box(9.4, 0.16, 1.6, wing), 0, -0.65, -1.0);
  for (const sx of [-3.6, 3.6])
    put(g, box(0.12, 2.35, 0.12, strut), sx, 0.52, -1.15);
  for (const sx of [-0.6, 0.6])
    put(g, box(0.1, 1.1, 0.1, strut), sx, 1.15, -1.6);
  put(g, box(3.8, 0.12, 1.2, wing), 0, 0.25, 3.1);
  put(g, box(0.12, 1.5, 1.2, dark), 0, 0.95, 3.25);
  put(g, box(1.45, 0.3, 2.2, dark), 0, 0.72, -0.2); // cockpit coaming
  const wg = new THREE.CylinderGeometry(0.48, 0.48, 0.3, 10);
  for (const sx of [-0.95, 0.95]) {
    const w = new THREE.Mesh(wg, M(0x222222));
    w.rotation.z = PI / 2;
    put(g, w, sx, -1.47, -1.8);
    put(g, box(0.1, 0.9, 0.1, strut), sx * 0.7, -1.05, -1.8);
  }
  put(g, box(0.15, 0.5, 0.15, strut), 0, -0.85, 3.3);
  const rg = new THREE.CircleGeometry(0.62, 16);
  for (const sx of [-3.7, 3.7]) {
    const c = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: trim }));
    c.rotation.x = -PI / 2;
    put(g, c, sx, 1.79, -1.3);
  }
  g.userData.prop = put(g, box(0.22, 2.8, 0.08, 0x6b4a2a), 0, 0, -4.0);
  return g;
}
// The shared parts of the other plane types, laid out as makePlane does.
const STRUT = 0x3a2a1a;
function struts(g, xs, h, y, z) {
  for (const sx of xs) put(g, box(0.12, h, 0.12, STRUT), sx, y, z);
}
function wheels(g, r, sx, z) {
  const wg = new THREE.CylinderGeometry(r, r, 0.3, 10);
  for (const s of [-sx, sx]) {
    const w = new THREE.Mesh(wg, M(0x222222));
    w.rotation.z = PI / 2;
    put(g, w, s, -1.95 + r, z);
    put(g, box(0.1, 1.95 - 2 * r + 0.6, 0.1, STRUT), s * 0.7, -1.2 + r, z);
  }
}
function roundels(g, trim, sx, y, z) {
  const rg = new THREE.CircleGeometry(0.62, 16);
  for (const s of [-sx, sx]) {
    const c = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: trim }));
    c.rotation.x = -PI / 2;
    put(g, c, s, y, z);
  }
}
function prop(g, len, z) {
  g.userData.prop = put(g, box(0.22, len, 0.08, 0x6b4a2a), 0, 0, z);
}

const planeKinds = {
  // Hornet: a short, stubby biplane round a rotary engine's drum cowl.
  1(body, wing, trim, dark) {
    const g = new THREE.Group();
    put(g, box(1.3, 1.3, 5.2, body), 0, 0, 0.4);
    const cowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.95, 1, 12),
      M(0x8a8a8a),
    );
    cowl.rotation.x = PI / 2;
    put(g, cowl, 0, 0, -2.6);
    put(g, box(8.2, 0.16, 1.6, wing), 0, 1.45, -1);
    put(g, box(7.8, 0.16, 1.5, wing), 0, -0.6, -0.8);
    struts(g, [-2.9, 2.9], 2.05, 0.42, -0.95);
    struts(g, [-0.55, 0.55], 0.85, 1, -1.2);
    put(g, box(3.2, 0.12, 1.1, wing), 0, 0.2, 2.7);
    put(g, box(0.12, 1.3, 1.1, dark), 0, 0.8, 2.85);
    put(g, box(1.35, 0.3, 1.8, dark), 0, 0.72, 0);
    wheels(g, 0.48, 0.9, -1.5);
    put(g, box(0.15, 0.5, 0.15, STRUT), 0, -0.85, 2.9);
    roundels(g, trim, 3, 1.54, -1);
    prop(g, 2.6, -3.15);
    return g;
  },
  // Lancer: a long-nosed parasol monoplane, its one wing on struts above.
  2(body, wing, trim, dark) {
    const g = new THREE.Group();
    put(g, box(1.15, 1.2, 7.4, body), 0, 0, 0.3);
    put(g, box(1.25, 1.25, 1.4, 0x2b2b2b), 0, 0, -3.9);
    put(g, box(12, 0.18, 2, wing), 0, 2, -0.9);
    struts(g, [-0.55, 0.55], 1.4, 1.3, -0.9);
    for (const s of [-1, 1]) {
      const st = put(g, box(0.1, 3.4, 0.1, STRUT), s * 1.8, 0.7, -0.9);
      st.rotation.z = -s * (PI / 4);
    }
    put(g, box(4, 0.12, 1.2, wing), 0, 0.2, 3.6);
    put(g, box(0.12, 1.8, 1.3, dark), 0, 1, 3.75);
    put(g, box(1.2, 0.3, 1.8, dark), 0, 0.7, 0.4);
    wheels(g, 0.48, 0.95, -1.6);
    put(g, box(0.15, 0.5, 0.15, STRUT), 0, -0.85, 3.8);
    roundels(g, trim, 4.2, 2.1, -0.9);
    prop(g, 2.9, -4.7);
    return g;
  },
  // Brute: a big biplane, two bays of struts a side, twin fins, bomb racks.
  3(body, wing, trim, dark) {
    const g = new THREE.Group();
    put(g, box(1.8, 1.8, 7.6, body), 0, 0, 0.4);
    put(g, box(2, 2, 1.2, 0x2b2b2b), 0, 0, -3.8);
    put(g, box(14, 0.18, 2.2, wing), 0, 2.1, -1.2);
    put(g, box(13, 0.18, 2.1, wing), 0, -0.8, -1);
    struts(g, [-5.8, -3.2, 3.2, 5.8], 2.85, 0.65, -1.1);
    struts(g, [-0.7, 0.7], 1.2, 1.5, -1.6);
    put(g, box(5.2, 0.14, 1.5, wing), 0, 0.3, 3.9);
    for (const s of [-2.4, 2.4]) put(g, box(0.14, 1.7, 1.4, dark), s, 0.85, 4);
    put(g, box(1.85, 0.3, 2.6, dark), 0, 0.92, -0.3);
    for (const s of [-0.45, 0.45])
      put(g, box(0.4, 0.4, 1.6, 0x2e2e2e), s, -1.15, -0.2);
    wheels(g, 0.55, 1.15, -1.9);
    put(g, box(0.15, 0.6, 0.15, STRUT), 0, -1.1, 4);
    roundels(g, trim, 5, 2.2, -1.2);
    prop(g, 3.4, -4.45);
    return g;
  },
};

// A player out of planes in Endless enemies flies a see-through ghost.
export function ghostly(obj, on) {
  obj.traverse((o) => {
    if (!o.material) return;
    o.material.transparent = on;
    o.material.opacity = on ? 0.35 : 1;
    o.material.depthWrite = !on;
  });
}
export function blob() {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(5, 16),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  );
  m.rotation.x = -PI / 2;
  scene.add(m);
  return m;
}
export function syncShadow(sh, pos, on) {
  const gy = groundY(pos.x, pos.z),
    alt = pos.y - gy;
  sh.visible = on && alt < 300;
  sh.position.set(pos.x, gy + 0.2, pos.z);
  sh.material.opacity = 0.32 * clamp(1 - alt / 300, 0, 1);
  sh.scale.setScalar(1 + alt / 150);
}

// ── The enemy town ──────────────────────────────────────────────────────────
export const targets = [];
function makeTarget(kind, x, side, z = 0) {
  const g = new THREE.Group();
  let r, h, hp, pts, name;
  if (kind === "flag") {
    // A team's flag (Bomb the flag): three bombs, or a long burst of fire.
    const c = TEAM[side % TEAM.length];
    put(g, box(6, 1.2, 6, 0x6b6150), 0, 0.6, 0);
    put(g, box(0.5, 18, 0.5, 0xeeeeee), 0, 9, 0);
    put(g, box(7, 4.2, 0.2, c.plane[2]), 3.6, 15.6, 0);
    r = 9;
    h = 18;
    hp = 36;
    pts = 500;
    name = c.name + " flag";
  } else if (kind === "hangar") {
    put(g, box(30, 10, 24, 0x8a6e52), 0, 5, 0);
    put(g, box(32, 2.4, 26, 0xb03aa0), 0, 11.2, 0);
    r = 17;
    h = 12.5;
    hp = 6;
    pts = 150;
    name = "Hangar";
  } else if (kind === "factory") {
    put(g, box(26, 14, 18, 0xa0523d), 0, 7, 0);
    put(g, box(27, 1.2, 19, 0x6e3428), 0, 14.4, 0);
    put(
      g,
      new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 20, 8), M(0x5a3a2a)),
      8,
      17,
      -4,
    );
    r = 15;
    h = 16;
    hp = 8;
    pts = 200;
    name = "Factory";
  } else if (kind === "tanks") {
    for (const sx of [-6, 6])
      put(
        g,
        new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 7, 12), M(0xd8d8d8)),
        sx,
        3.5,
        0,
      );
    r = 12;
    h = 7;
    hp = 4;
    pts = 100;
    name = "Fuel depot";
  } else {
    put(g, box(20, 12, 20, 0xc9b48a), 0, 6, 0);
    put(g, box(22, 1.5, 22, 0xb03aa0), 0, 12.7, 0);
    put(g, box(0.3, 10, 0.3, 0xeeeeee), 0, 18, 0);
    put(g, box(4, 2.4, 0.12, 0xff55ff), 2.1, 21.6, 0);
    r = 12;
    h = 13;
    hp = 6;
    pts = 250;
    name = "Headquarters";
  }
  g.position.set(x, 0, z);
  scene.add(g);
  return {
    g,
    kind,
    name,
    x,
    z,
    r,
    h,
    hp,
    pts,
    alive: true,
    smokeT: rnd(1),
    side,
  };
}
// `defs` is TDEF in a one-player game (and Endless enemies). Bomb the flag
// passes one [kind, x, team, z] per team (flagDefs).
export function buildTargets(defs = TDEF) {
  for (const t of targets) scene.remove(t.g);
  targets.length = 0;
  for (const d of defs) targets.push(makeTarget(d[0], d[1], d[2], d[3]));
}
function wreck(t) {
  t.alive = false;
  t.g.scale.y = 0.18;
  t.g.traverse((o) => {
    if (o.material && o.material.color) o.material.color.setHex(0x3b3530);
  });
  boom(tv2.set(t.x, t.h * 0.5, t.z).clone(), true);
}
export function hurtTarget(t, n, pos) {
  if (!t.alive) return;
  // A team's own flag, with friendly fire off.
  if (net.on && !net.ff && t.side === myTeam()) return;
  t.hp -= n;
  // In a match, whoever does the damage reports it (net/protocol.js "tg"),
  // as an amount, so two bombers' hits add up on every machine.
  if (net.on) send({ t: "tg", i: targets.indexOf(t), d: n });
  if (t.hp > 0) {
    puff(pos, 0xffd27a, 3, 8, 0.8, 0.35, 2);
    return;
  }
  wreck(t);
  if (net.on) return teamWreck(t, true);
  S.score += t.pts;
  say(t.name + " destroyed  +" + t.pts, 1.8);
  if (targets.every((t) => !t.alive)) {
    S.score += 1000;
    S.wave++;
    say("Enemy town flattened!  +1000", 4);
    S.rebuildT = 30;
  }
}
// Another player's damage to a building, as they reported it. It scores
// for them, not here.
export function applyTarget(i, d) {
  const t = targets[i];
  if (!t || !t.alive || !Number.isFinite(d) || d <= 0) return;
  t.hp -= d;
  if (t.hp > 0) return;
  wreck(t);
  teamWreck(t, false);
}
// A building down in a team game. A flag takes its team out of Bomb the flag
// (net/match.js hears of it through net.onFlag); the town, in Endless
// enemies, scores for whoever flattened it and rebuilds when it is all gone.
function teamWreck(t, byMe) {
  if (t.kind === "flag") {
    const mine = t.side === myTeam();
    if (byMe && !mine) {
      S.score += t.pts;
      say(t.name + " down!  +" + t.pts, 2.5);
    } else say(mine ? "Your flag is down!" : t.name + " is down", 2.5);
    if (net.onFlag) net.onFlag(t.side);
    return;
  }
  if (byMe) {
    S.score += t.pts;
    say(t.name + " destroyed  +" + t.pts, 1.8);
  }
  if (targets.some((u) => u.alive)) return;
  if (byMe) {
    S.score += 1000;
    say("Enemy town flattened!  +1000", 4);
  } else say("Enemy town flattened!", 4);
  S.rebuildT = 30;
}

// ── Team airfields ──────────────────────────────────────────────────────────
// One per team, round a ring (net/teams.js fieldSpots), each with a runway
// edged in the team's colour and a hangar. Trees on the new runways are put
// away while a match lasts.
export const fields = [];
let fieldSolids = [];

export function buildFields(n) {
  clearFields();
  fieldSpots(n).forEach(({ x, z }, team) => {
    const c = TEAM[team % TEAM.length];
    const f = { x, z, hl: 230, hw: 18, team, g: new THREE.Group() };
    runway({ x: 0, z: 0, hl: f.hl, hw: f.hw }, c.plane[2], f.g);
    hangar(-120, -70, c.plane[1], false, f.g);
    f.g.position.set(x, 0, z);
    scene.add(f.g);
    fieldSolids.push({ x: x - 120, z: z - 70, r: 17, h: 12.5 });
    fields.push(f);
  });
  solids.push(...fieldSolids);
  hideTrees((x, z) =>
    fields.some(
      (f) => Math.abs(x - f.x) < f.hl + 70 && Math.abs(z - f.z) < 110,
    ),
  );
}

export function clearFields() {
  for (const f of fields) scene.remove(f.g);
  fields.length = 0;
  for (const s of fieldSolids) {
    const i = solids.indexOf(s);
    if (i >= 0) solids.splice(i, 1);
  }
  fieldSolids = [];
  hideTrees(() => false);
}

// A team's flag stands beside its runway, clear of the planes' path.
export const flagDefs = () =>
  fields.map((f) => ["flag", f.x + 60, f.team, f.z + 70]);

export const onAnyField = (p) =>
  fields.some((f) => onRun(p, f)) || onRun(p, HOME) || onRun(p, EB);

const zero = new THREE.Matrix4().makeScale(0, 0, 0);
function hideTrees(hide) {
  const { crown, trunk, at } = trees;
  if (!crown) return;
  for (const [i, m] of trees.hidden) {
    crown.setMatrixAt(i, m.crown);
    trunk.setMatrixAt(i, m.trunk);
  }
  trees.hidden = [];
  for (let i = 0; i < crown.count; i++) {
    if (!hide(at[i * 2], at[i * 2 + 1])) continue;
    const m = { crown: new THREE.Matrix4(), trunk: new THREE.Matrix4() };
    crown.getMatrixAt(i, m.crown);
    trunk.getMatrixAt(i, m.trunk);
    trees.hidden.push([i, m]);
    crown.setMatrixAt(i, zero);
    trunk.setMatrixAt(i, zero);
  }
  crown.instanceMatrix.needsUpdate = trunk.instanceMatrix.needsUpdate = true;
}
// Factory chimneys smoke while the factory stands.
export function updTown(dt) {
  for (const t of targets)
    if (t.alive && t.kind === "factory" && (t.smokeT -= dt) <= 0) {
      t.smokeT = 0.35;
      puff(tv2.set(t.x + 8, 28, -4), 0x8a8a8a, 1, 1.5, 2, 4, 4);
    }
}

// ── Hippos (they replace the original's oxen) ───────────────────────────────
export const hippos = [];
function makeHippo(x) {
  const g = new THREE.Group(),
    c = 0x9a95b8;
  put(g, box(4.4, 2.6, 2.6, c), 0, 2.4, 0);
  put(g, box(2, 1.9, 2.2, c), 2.9, 2.6, 0);
  put(g, box(1.2, 1.3, 2.3, 0xb4afcf), 4.2, 2.2, 0);
  for (const sz of [-0.7, 0.7])
    put(g, box(0.4, 0.5, 0.4, 0xff9ec7), 2.6, 3.75, sz);
  for (const sx of [-1.5, 1.5])
    for (const sz of [-0.85, 0.85])
      put(g, box(0.8, 1.2, 0.8, 0x7d7898), sx, 0.6, sz);
  g.position.set(x, 0, 0);
  scene.add(g);
  return { g, x0: x, x, z: 0, alive: true, dir: 1, t: rnd(5) };
}
for (const x of [520, 1050, 1720]) hippos.push(makeHippo(x));

export function scareHippo(h) {
  h.alive = false;
  h.g.visible = false;
  h.t = 25;
  S.score = Math.max(0, S.score - 50);
  puff(tv2.set(h.x, 3, h.z), 0x9a95b8, 8, 10, 1, 0.8, 4);
  say("Leave the hippos alone!  −50", 1.8);
}
export function updHippos(dt) {
  for (const h of hippos) {
    if (!h.alive) {
      if ((h.t -= dt) <= 0) {
        h.alive = true;
        h.g.visible = true;
      }
      continue;
    }
    h.t += dt;
    if (Math.sin(h.t * 0.4) > 0.96) h.dir = -h.dir;
    h.x = clamp(h.x + h.dir * 1.2 * dt, h.x0 - 30, h.x0 + 30);
    h.g.position.x = h.x;
    h.g.rotation.y = h.dir > 0 ? 0 : PI;
  }
}
