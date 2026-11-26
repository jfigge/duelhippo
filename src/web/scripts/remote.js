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

// remote.js — the other players' planes, as this machine sees them.
//
// They are not simulated here. Each player's machine flies its own plane and
// sends its state about 20 times a second (net/match.js); this keeps the
// last few updates of each and draws every plane a little in the past,
// between two of them, so it moves smoothly however the updates arrive.
// Past the newest update a plane carries on along its nose for a moment,
// then waits. Planes wear their team's colours (net/teams.js) and are drawn
// as the plane type their player flies; a player out of planes in Endless
// enemies flies on as a see-through ghost.

import { V, Q } from "./util.js";
import { scene } from "./scene.js";
import { S } from "./state.js";
import { makePlane, blob, syncShadow, ghostly } from "./world.js";
import { TEAM } from "./net/teams.js";
import { net } from "./net/bus.js";

// How far behind the newest update a plane is drawn: two updates' worth,
// so one late or lost update does not show.
export const DELAY_MS = 110;
const EXTRAPOLATE_MS = 250;

export const remotes = new Map(); // seat → remote

const planeFor = (team, kind) => {
  const obj = makePlane(...TEAM[team % TEAM.length].plane, kind);
  obj.visible = false;
  scene.add(obj);
  return obj;
};

export function addRemote(seat, team) {
  dropRemote(seat);
  const obj = planeFor(team, 0);
  const r = {
    seat,
    team,
    kind: 0,
    pos: new V(),
    q: new Q(),
    vel: new V(),
    speed: 0,
    thr: 0,
    alive: false,
    grounded: true,
    ghost: false,
    dmg: 0,
    score: 0,
    kills: 0,
    lives: 3,
    out: false, // out of planes (or of the match)
    gone: false, // left the match
    // net/link.js's number on their last crash or out: a state update
    // numbered before it is stale (net/match.js).
    after: -Infinity,
    obj,
    shadow: blob(),
    buf: [], // { at, p: V, q: Q, s }
  };
  r.shadow.visible = false;
  remotes.set(seat, r);
  return r;
}

export function dropRemote(seat) {
  const r = remotes.get(seat);
  if (!r) return;
  scene.remove(r.obj);
  scene.remove(r.shadow);
  dispose(r.obj);
  dispose(r.shadow);
  remotes.delete(seat);
}

// makePlane and blob build every plane's geometries and materials afresh,
// so a plane put away gives its GPU memory back; all but the navigation
// lights', which every plane shares (world.js NAV).
function dispose(obj) {
  const shared = (x) => x?.userData.shared;
  obj.traverse((o) => {
    if (!shared(o.geometry)) o.geometry?.dispose();
    for (const m of [].concat(o.material ?? [])) if (!shared(m)) m.dispose();
  });
}

export function clearRemotes() {
  for (const seat of [...remotes.keys()]) dropRemote(seat);
}

// One state update from a player's machine (net/protocol.js unpacks it).
export function pushState(seat, s, at) {
  const r = remotes.get(seat);
  if (!r) return;
  if (s.alive && !r.alive) r.buf.length = 0; // a new plane: no sliding in
  r.alive = s.alive;
  r.grounded = s.grounded;
  r.dmg = s.dmg;
  r.thr = s.thr;
  r.score = s.score;
  r.kills = s.kills;
  r.lives = s.lives;
  if (s.plane !== r.kind) {
    // They changed plane on their runway.
    const obj = planeFor(r.team, (r.kind = s.plane));
    obj.visible = r.obj.visible;
    obj.position.copy(r.obj.position);
    obj.quaternion.copy(r.obj.quaternion);
    scene.remove(r.obj);
    dispose(r.obj);
    r.obj = obj;
    ghostly(r.obj, r.ghost);
  }
  if (s.ghost !== r.ghost) ghostly(r.obj, (r.ghost = s.ghost));
  if (!s.alive) return;
  r.buf.push({
    at,
    p: new V().fromArray(s.p),
    q: new Q().fromArray(s.q),
    s: s.speed,
  });
  if (r.buf.length > 8) r.buf.shift();
}

const fwd = new V();

// Place every plane for real time `now` (ms).
export function updRemotes(now, dt) {
  for (const r of remotes.values()) place(r, now, dt);
}

function place(r, now, dt) {
  const o = r.obj,
    buf = r.buf;
  if (!r.alive || !buf.length) {
    o.visible = false;
    syncShadow(r.shadow, r.pos, false);
    return;
  }
  const t = now - DELAY_MS;
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1].at > t) i--;
  const b = buf[i],
    a = buf[i - 1];
  if (a && t >= a.at && t <= b.at) {
    const k = (t - a.at) / Math.max(1, b.at - a.at);
    r.pos.lerpVectors(a.p, b.p, k);
    r.q.slerpQuaternions(a.q, b.q, k);
    r.speed = a.s + (b.s - a.s) * k;
  } else {
    // Ahead of the newest update (or before the oldest): hold its attitude
    // and, briefly, keep flying it.
    const ahead = Math.min(EXTRAPOLATE_MS, Math.max(0, t - b.at)) / 1000;
    r.q.copy(b.q);
    r.speed = b.s;
    fwd.set(0, 0, -1).applyQuaternion(b.q);
    r.pos.copy(b.p).addScaledVector(fwd, b.s * ahead);
  }
  r.vel.set(0, 0, -1).applyQuaternion(r.q).multiplyScalar(r.speed);
  o.visible = true;
  o.position.copy(r.pos);
  o.quaternion.copy(r.q);
  o.userData.prop.rotation.z += (r.thr * 55 + (r.speed > 1 ? 6 : 0)) * dt;
  syncShadow(r.shadow, r.pos, !r.ghost);
}

// Planes that can fight: in the air (or on a runway), and not ghosts.
export const solidRemotes = () =>
  [...remotes.values()].filter((r) => r.alive && !r.ghost);

// Each team's score: this player's and everyone else's last report.
export function teamScores() {
  const out = new Array(net.teams).fill(0);
  for (const p of net.roster.values()) {
    if (p.team < 0 || p.team >= net.teams) continue;
    out[p.team] +=
      p.seat === net.seat ? S.score : (remotes.get(p.seat)?.score ?? 0);
  }
  return out;
}
