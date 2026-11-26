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

// missiles.js — homing missiles: the lock, the launch and the flight. Not
// part of the prototype; only the plane types after the Kite carry them
// (constants.js PLANES, MSL for the numbers).
//
// A lock is earned, not given: hold the sights (Free flight only) on an enemy
// plane for MSL.lock seconds. Then R (or MSL on a touch screen) launches.
// A missile turns more slowly than a plane can, so a hard break turn at the
// right moment beats it, and the plane being locked is told (a LOCK warning)
// as soon as the lock starts to build.
//
// Who decides a hit is as for rounds (net/match.js): a flyer's owner, and a
// plane's own machine. Every machine flies every missile from its launch; the
// one homing on this player's plane (`P`) is the one that counts here, and
// the rest are for show.

import * as THREE from "three";
import { V, clamp, basis } from "./util.js";
import { MSL } from "./constants.js";
import { scene, box, put } from "./scene.js";
import { game } from "./state.js";
import { sfx } from "./audio.js";
import { puff, boom } from "./effects.js";
import { say } from "./msg.js";
import { groundY } from "./world.js";
import { P, aiming } from "./flight.js";
import { enemies, killEnemy, ownsEnemy } from "./ai.js";
import { remotes } from "./remote.js";
import { net, send, canHurt } from "./net/bus.js";
import { v3, unit3 } from "./net/protocol.js";

// The lock being built: on what, for how long, how long off it; whether the
// tone has sounded, and which seat has been told it is being locked.
export const lock = { tgt: null, t: 0, gap: 0, said: false, told: null };
// Seats locking on to this player's plane (from their "lk").
export const lockers = new Set();
export const missiles = [];

// Its own scratch, not util.js's shared set: nothing here may disturb the
// aliasing the prototype's code relies on.
const MB = basis(new THREE.Quaternion()),
  to = new V(),
  want = new V(),
  axis = new V(),
  seg = new V(),
  o = new V();

const live = (t) => !!t && t.alive && !t.ghost && !t.gone;
export const locked = () => !!lock.tgt && lock.t >= MSL.lock;

// What can be locked: the flyers, and every other player's plane that can be
// hurt (remote.js solidRemotes, read straight off the map so that a frame
// spent aiming builds no arrays).
function* quarries() {
  for (const e of enemies) if (e.alive) yield e;
  for (const r of remotes.values())
    if (r.alive && !r.ghost && canHurt(r.seat)) yield r;
}

// A target's name on the wire ("ms"): a seat, or "e" and a flyer's index.
const nameOf = (t) =>
  Number.isInteger(t.seat) ? t.seat : "e" + enemies.indexOf(t);

// The target a launch message names, as this machine knows it.
export function targetNamed(to) {
  if (to === net.seat) return P;
  if (Number.isInteger(to)) return remotes.get(to) || null;
  const m = typeof to === "string" && /^e(\d)$/.exec(to);
  return m ? enemies[+m[1]] || null : null;
}

function setTarget(t) {
  if (t === lock.tgt) return;
  tell(false);
  lock.tgt = t;
  lock.t = lock.gap = 0;
  lock.said = false;
}

// Another player is told when the lock on them starts, and when it ends.
function tell(on) {
  const seat = lock.tgt?.seat;
  if (!Number.isInteger(seat)) return;
  if (on && lock.told !== seat) {
    send({ t: "lk", to: seat, on: 1 });
    lock.told = seat;
  } else if (!on && lock.told === seat) {
    send({ t: "lk", to: seat, on: 0 });
    lock.told = null;
  }
}

// Once a frame: build, hold or drop the lock.
export function updLock(dt) {
  const can =
    P.pt.missiles > 0 &&
    P.msl > 0 &&
    P.alive &&
    !P.grounded &&
    !P.ghost &&
    P.dmg < 100 &&
    aiming();
  let best = null;
  if (can) {
    const b = basis(P.q, MB);
    let bc = Math.cos(MSL.cone);
    for (const t of quarries()) {
      to.copy(t.pos).sub(P.pos);
      const d = to.length();
      if (d < 1 || d > MSL.range) continue;
      const c = b.f.dot(to) / d;
      if (c > bc) {
        bc = c;
        best = t;
      }
    }
  }
  if (best && best === lock.tgt) {
    lock.t += dt;
    lock.gap = 0;
  } else if (can && live(lock.tgt) && (lock.gap += dt) <= MSL.grace) {
    // A moment off target: the lock holds, but does not build.
  } else setTarget(best);
  if (!lock.tgt) return;
  if (lock.t > 0.5) tell(true);
  if (lock.t >= MSL.lock && !lock.said) {
    lock.said = true;
    sfx.lock();
  } else if (lock.t < MSL.lock && Math.floor(lock.t) > Math.floor(lock.t - dt))
    sfx.lockTick();
}

// R, or MSL on a touch screen.
export function fireMissile() {
  if (game.state !== "play" || game.paused || !P.alive) return;
  if (!P.pt.missiles) return say(`The ${P.pt.name} carries no missiles`, 1.4);
  if (game.mode === "classic")
    return say("Missiles need the sights: not in Classic", 1.4);
  if (!P.msl) return say("No missiles left: land at home to rearm", 1.4);
  if (!locked())
    return say("No lock: hold the sights on a plane for 3 seconds", 1.4);
  const b = basis(P.q, MB),
    tgt = lock.tgt,
    spd = P.speed + MSL.boost;
  o.copy(P.pos).addScaledVector(b.f, 4).addScaledVector(b.u, -1.4);
  launch(o, b.f, spd, tgt, "p");
  P.msl--;
  if (net.on)
    send({ t: "ms", o: v3(o), d: unit3(b.f), s: spd, to: nameOf(tgt) });
  setTarget(null);
  sfx.launch();
}

// A pooled missile: an idle one, or a new one.
function freeMissile() {
  let m = missiles.find((m) => !m.on);
  if (!m) {
    const g = new THREE.Group();
    put(g, box(0.32, 0.32, 2.4, 0xdedede), 0, 0, 0);
    put(g, box(1, 0.06, 0.45, 0x8a2020), 0, 0, 0.95);
    put(g, box(0.06, 1, 0.45, 0x8a2020), 0, 0, 0.95);
    scene.add(g);
    m = { g, pos: new V(), p0: new V(), dir: new V() };
    missiles.push(m);
  }
  return m;
}

// `own` is "p" for this player's missile, "r" for another player's (their
// `seat`), fired here from their "ms" for show, or for real at this plane.
export function launch(pos, dir, spd, tgt, own, seat = null) {
  const m = freeMissile();
  m.on = true;
  m.own = own;
  m.seat = seat;
  m.tgt = tgt;
  m.pos.copy(pos);
  m.dir.copy(dir).normalize();
  m.speed = spd;
  m.life = MSL.life;
  m.smoke = 0;
  m.g.visible = true;
  place(m);
  if (own === "r" && tgt === P) say("Missile! Break hard!", 2);
}

function place(m) {
  m.g.position.copy(m.pos);
  m.g.lookAt(to.copy(m.pos).sub(m.dir)); // fins (+z) at the back
}

function off(m) {
  m.on = false;
  m.g.visible = false;
}

// Squared distance from p to the segment ab: a fast missile cannot pass
// through a plane between frames.
function segDist2(a, b, p) {
  seg.copy(b).sub(a);
  const l = seg.lengthSq();
  const k = l ? clamp(want.copy(p).sub(a).dot(seg) / l, 0, 1) : 0;
  return seg.multiplyScalar(k).add(a).distanceToSquared(p);
}

export function updMissiles(dt) {
  for (const m of missiles) {
    if (!m.on) continue;
    m.life -= dt;
    m.speed = Math.min(MSL.speed, m.speed + MSL.accel * dt);
    if (live(m.tgt)) {
      want.copy(m.tgt.pos).sub(m.pos).normalize();
      const ang = Math.acos(clamp(m.dir.dot(want), -1, 1));
      // Out-turned: the seeker has lost it, and it flies on straight.
      if (ang > MSL.seeker) m.tgt = null;
      else if (ang > 1e-4)
        m.dir.applyAxisAngle(
          axis.copy(m.dir).cross(want).normalize(),
          Math.min(ang, MSL.turn * dt),
        );
    } else m.tgt = null;
    m.p0.copy(m.pos);
    m.pos.addScaledVector(m.dir, m.speed * dt);
    place(m);
    if ((m.smoke -= dt) <= 0) {
      m.smoke = 0.05;
      puff(m.pos, 0xd8d8d8, 1, 1, 0.6, 0.9);
    }
    if (m.tgt && segDist2(m.p0, m.pos, m.tgt.pos) < MSL.fuse * MSL.fuse) hit(m);
    else if (m.pos.y < groundY(m.pos.x, m.pos.z, m.pos.y)) {
      off(m);
      boom(m.pos.clone(), false);
    } else if (m.life <= 0) {
      off(m);
      puff(m.pos, 0x777777, 4, 4, 1.2, 0.8);
    }
  }
}

// Gone off by its target. Whose word counts is the usual rule: a flyer's
// owner's, and the plane's own machine's.
function hit(m) {
  const t = m.tgt;
  off(m);
  boom(m.pos.clone(), false);
  if (m.own === "p") {
    if (!enemies.includes(t)) return; // a player's plane: theirs to judge
    if (!ownsEnemy(t)) return send({ t: "eh", i: enemies.indexOf(t), n: 3 });
    t.hp -= 3;
    if (t.hp <= 0) killEnemy(t, true);
  } else if (t === P && P.alive && !P.ghost && canHurt(m.seat)) {
    P.hitBy = m.seat;
    P.dmg = Math.min(100, P.dmg + MSL.dmg);
    sfx.hit();
    say(P.dmg >= 100 ? "Missile hit! Going down…" : "Missile hit!", 2);
  }
}

// A missile on its way to this player's plane.
export const incoming = () =>
  missiles.some((m) => m.on && m.own === "r" && m.tgt === P);

// A new game or match, or the title: no missiles, no lock.
export function clearMissiles() {
  for (const m of missiles) off(m);
  setTarget(null);
  lock.told = null;
  lockers.clear();
}
