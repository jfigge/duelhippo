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

// util.js — math helpers and the scratch objects every module shares.
//
// Ported verbatim from the prototype (features/prototype/src/game.js). The
// scratch vectors `tv`, `tv2`, `tq` and `tm` are deliberately ONE set shared
// across modules, exactly as they were one set inside the prototype's closure:
// several call sites hand a scratch vector to a function that itself writes
// the other one (boom(tv2…), puff(tv2…)), and the gameplay numbers are pinned
// to the prototype's, aliasing included. Giving each module its own scratch
// set would be tidier and would quietly change behaviour.

import * as THREE from "three";

export const V = THREE.Vector3;
export const Q = THREE.Quaternion;
export const PI = Math.PI;

export const $ = (id) => document.getElementById(id);
export const rnd = (a = 1, b) =>
  b === undefined ? Math.random() * a : a + Math.random() * (b - a);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrapA = (a) => {
  while (a > PI) a -= 2 * PI;
  while (a < -PI) a += 2 * PI;
  return a;
};

export const UP = new V(0, 1, 0);
export const AX = new V(1, 0, 0);
export const AY = new V(0, 1, 0);
export const AZ = new V(0, 0, 1);

export const tq = new Q();
export const tm = new THREE.Matrix4();
export const tv = new V();
export const tv2 = new V();

export const rotLocal = (q, a, ang) => {
  tq.setFromAxisAngle(a, ang);
  q.multiply(tq);
};
export const rotWorld = (q, a, ang) => {
  tq.setFromAxisAngle(a, ang);
  q.premultiply(tq);
};

// The plane model faces -Z; this turns it to +X.
export const Q_FACE = new Q().setFromAxisAngle(AY, -PI / 2);

// Classic-mode orientation: an angle `th` in the XY plane, then a roll `ph`
// of 0 or π about the plane's own nose (the flip).
export function qSide(q, th, ph) {
  q.setFromAxisAngle(AZ, th);
  q.multiply(Q_FACE);
  tq.setFromAxisAngle(AZ, ph);
  q.multiply(tq);
  return q;
}

// Forward / up / right unit vectors of an orientation.
export function basis(q, o) {
  o = o || { f: new V(), u: new V(), r: new V() };
  o.f.set(0, 0, -1).applyQuaternion(q);
  o.u.set(0, 1, 0).applyQuaternion(q);
  o.r.set(1, 0, 0).applyQuaternion(q);
  return o;
}

// Squared distance from p to segment ab (bullet sweep tests).
export const segD2 = (a, b, p) => {
  tv.copy(b).sub(a);
  const l = tv.lengthSq();
  const t = l ? clamp(tv2.copy(p).sub(a).dot(tv) / l, 0, 1) : 0;
  return tv.multiplyScalar(t).add(a).distanceToSquared(p);
};
