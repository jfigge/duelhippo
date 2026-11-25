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

// remote.js — the other player's plane, as this machine sees it.
//
// It is not simulated here. The other machine flies it and sends its state
// about 20 times a second (net/match.js); this keeps the last few updates
// and draws the plane a little in the past, between two of them, so it moves
// smoothly however the updates arrive. Past the newest update it carries on
// along its nose for a moment, then waits.

import { V, Q } from "./util.js";
import { scene } from "./scene.js";
import { makePlane, blob, syncShadow } from "./world.js";

// How far behind the newest update the plane is drawn: two updates' worth,
// so one late or lost update does not show.
export const DELAY_MS = 110;
const EXTRAPOLATE_MS = 250;

const LOOKS = {
  rival: [0x3a2a40, 0xe055d0, 0xff55ff, 0x7a1f70], // magenta: the duel
  wingman: [0xf2f2ea, 0xffd84a, 0xffff55, 0xb49a14], // yellow: co-op
};

export const R = {
  pos: new V(),
  q: new Q(),
  vel: new V(),
  speed: 0,
  thr: 0,
  alive: false,
  grounded: true,
  dmg: 0,
  score: 0,
  kills: 0,
  lives: 3,
  obj: null,
  shadow: blob(),
  buf: [], // { at, p: V, q: Q, s }
};
R.shadow.visible = false;

const objs = {};
function look(kind) {
  if (!objs[kind]) {
    objs[kind] = makePlane(...LOOKS[kind]);
    objs[kind].visible = false;
    scene.add(objs[kind]);
  }
  return objs[kind];
}

export function resetRemote(kind) {
  for (const o of Object.values(objs)) o.visible = false;
  R.obj = look(kind === "duel" ? "rival" : "wingman");
  R.alive = false;
  R.buf.length = 0;
  R.score = R.kills = 0;
  R.lives = 3;
  R.shadow.visible = false;
}

export function hideRemote() {
  for (const o of Object.values(objs)) o.visible = false;
  R.alive = false;
  R.shadow.visible = false;
  R.buf.length = 0;
}

// One state update from the other machine (net/protocol.js unpacks it).
export function pushState(s, at) {
  if (s.alive && !R.alive) R.buf.length = 0; // a new plane: no sliding in
  R.alive = s.alive;
  R.grounded = s.grounded;
  R.dmg = s.dmg;
  R.thr = s.thr;
  R.score = s.score;
  R.kills = s.kills;
  R.lives = s.lives;
  if (!s.alive) return;
  R.buf.push({
    at,
    p: new V().fromArray(s.p),
    q: new Q().fromArray(s.q),
    s: s.speed,
  });
  if (R.buf.length > 8) R.buf.shift();
}

const fwd = new V();

// Place the plane for real time `now` (ms).
export function updRemote(now, dt) {
  const o = R.obj;
  if (!o) return;
  const buf = R.buf;
  if (!R.alive || !buf.length) {
    o.visible = false;
    syncShadow(R.shadow, R.pos, false);
    return;
  }
  const t = now - DELAY_MS;
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1].at > t) i--;
  const b = buf[i],
    a = buf[i - 1];
  if (a && t >= a.at && t <= b.at) {
    const k = (t - a.at) / Math.max(1, b.at - a.at);
    R.pos.lerpVectors(a.p, b.p, k);
    R.q.slerpQuaternions(a.q, b.q, k);
    R.speed = a.s + (b.s - a.s) * k;
  } else {
    // Ahead of the newest update (or before the oldest): hold its attitude
    // and, briefly, keep flying it.
    const ahead = Math.min(EXTRAPOLATE_MS, Math.max(0, t - b.at)) / 1000;
    R.q.copy(b.q);
    R.speed = b.s;
    fwd.set(0, 0, -1).applyQuaternion(b.q);
    R.pos.copy(b.p).addScaledVector(fwd, b.s * ahead);
  }
  R.vel.set(0, 0, -1).applyQuaternion(R.q).multiplyScalar(R.speed);
  o.visible = true;
  o.position.copy(R.pos);
  o.quaternion.copy(R.q);
  o.userData.prop.rotation.z += (R.thr * 55 + (R.speed > 1 ? 6 : 0)) * dt;
  syncShadow(R.shadow, R.pos, true);
}
