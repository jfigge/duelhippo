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

// ai.js — the enemy flyers: spawn, steer, shoot, die.
//
// They hunt the player while the player is airborne (leading the target by
// distance / 440 s) and patrol over their own airfield otherwise. Turn rate
// rises with the wave and the player's kills; they fire bursts of 8 when the
// player is inside 420 m and ~10° of the nose (DESIGN.md, "Enemies").
//
// Endless enemies (a team game): each player's machine flies one flyer, the
// one at its own seat's index, which hunts whichever plane is nearest and
// comes back a few seconds after it is shot down. The others are drawn from
// their owners' state updates (net/match.js).

import {
  V,
  Q,
  PI,
  UP,
  AY,
  rnd,
  clamp,
  wrapA,
  tv,
  tv2,
  tm,
  qSide,
  basis,
} from "./util.js";
import { EB, LANE } from "./constants.js";
import { scene, camera } from "./scene.js";
import { S, game } from "./state.js";
import { sfx } from "./audio.js";
import { puff, boom } from "./effects.js";
import { say } from "./msg.js";
import { groundY, makePlane, blob, syncShadow } from "./world.js";
import { CX } from "./constants.js";
import { P, crash } from "./flight.js";
import { fire } from "./weapons.js";
import { solidRemotes } from "./remote.js";
import { net, send } from "./net/bus.js";
import { v3, unit3 } from "./net/protocol.js";

export const enemies = [];
for (let i = 0; i < 6; i++) addEnemy(i);
function addEnemy(i) {
  const o = makePlane(0x3a2a40, 0xe055d0, 0xff55ff, 0x7a1f70);
  o.visible = false;
  scene.add(o);
  enemies.push({
    obj: o,
    shadow: blob(),
    pos: new V(),
    q: new Q(),
    up: new V(0, 1, 0),
    alive: false,
    hp: 3,
    speed: 58,
    cd: 0,
    burst: 0,
    t: 0,
    ph0: i * 1.05,
    th: 0,
    ph: 0,
    phT: 0,
    turn: 0.75,
  });
}

// Endless enemies has one flyer per seat, up to nine.
export function ensureEnemies(n) {
  while (enemies.length < n) addEnemy(enemies.length);
}

// Whose machine decides what happens to a flyer: this one's, except in a
// team game, where each machine owns the flyer at its seat.
export const ownsEnemy = (e) => !net.on || enemies.indexOf(e) === net.seat;

export function spawnEnemy() {
  const e = enemies.find((e) => !e.alive);
  if (!e) return;
  e.alive = true;
  e.hp = 3;
  e.speed = 58;
  e.cd = 1.5;
  e.burst = 0;
  e.turn = 0.7 + Math.min(0.35, S.wave * 0.06 + S.kills * 0.01);
  e.pos.set(
    EB.x + rnd(-250, 350),
    rnd(220, 380),
    game.mode === "classic" ? 0 : rnd(-300, 300),
  );
  e.th = PI;
  e.ph = e.phT = PI;
  e.up.set(0, 1, 0);
  if (game.mode === "classic") qSide(e.q, e.th, e.ph);
  else e.q.setFromAxisAngle(AY, PI / 2 + rnd(-0.5, 0.5));
  e.obj.visible = true;
}

// In a one-player game `scored` is just whether the player scored. In a team
// game the owner tells everyone, and `by` is the seat that gets the kill.
export function killEnemy(e, scored, by = scored && net.on ? net.seat : null) {
  if (net.on && ownsEnemy(e)) {
    send({ t: "ek", i: enemies.indexOf(e), by });
    e.respawnT = 4;
  }
  boom(e.pos, false);
  e.alive = false;
  e.obj.visible = false;
  e.shadow.visible = false;
  if (scored) {
    S.score += 100;
    S.kills++;
    say("Enemy down!  +100", 1.4);
  }
}

const EB_ = basis(new Q());

// Who a flyer hunts: the player — or, in a team game, whichever plane in the
// air is nearest. Ghosts are not worth the bullets.
function quarry(e) {
  if (!net.on) return P;
  let best = P,
    bd =
      P.alive && !P.grounded && !P.ghost ? P.pos.distanceTo(e.pos) : Infinity;
  for (const r of solidRemotes()) {
    if (r.grounded) continue;
    const d = r.pos.distanceTo(e.pos);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}

// Endless enemies: this machine's flyer, back in the air a few seconds after
// it falls, somewhere over the middle of the map.
export function hostEnemy(dt) {
  const e = enemies[net.seat];
  if (!e) return;
  if (e.alive) return updEnemy(e, dt);
  if ((e.respawnT = (e.respawnT ?? 0) - dt) > 0) return;
  e.alive = true;
  e.hp = 3;
  e.speed = 58;
  e.cd = 2;
  e.burst = 0;
  e.turn = 0.85;
  e.pos.set(CX + rnd(-1200, 1200), rnd(260, 420), rnd(-1200, 1200));
  e.up.set(0, 1, 0);
  e.q.setFromAxisAngle(AY, rnd(0, 2 * PI));
  e.obj.visible = true;
}

export function updEnemy(e, dt) {
  const T = quarry(e);
  const hunting = T.alive && !T.grounded;
  let tgt;
  if (hunting) {
    const d = T.pos.distanceTo(e.pos);
    tgt = tv2.copy(T.pos).addScaledVector(T.vel, clamp(d / 440, 0, 1.2));
  } else {
    e.t += dt * 0.25;
    tgt = tv2.set(
      EB.x + Math.cos(e.t + e.ph0) * 420,
      270 + Math.sin(e.t * 1.7 + e.ph0) * 40,
      game.mode === "classic" ? 0 : Math.sin(e.t + e.ph0) * 420,
    );
  }
  const to = tv.copy(tgt).sub(e.pos);
  const alt = e.pos.y - groundY(e.pos.x, e.pos.z);
  let b = basis(e.q, EB_);
  if (game.mode === "classic") {
    to.z = 0;
    if (alt < 100) to.set(Math.cos(e.th) * 60, 140, 0);
    if (e.pos.x < LANE.min + 100) to.set(200, 40, 0);
    else if (e.pos.x > LANE.max + 100) to.set(-200, 40, 0);
    const want = Math.atan2(to.y, to.x),
      k = e.turn * 1.4 * dt;
    e.th = wrapA(e.th + clamp(wrapA(want - e.th), -k, k));
    const c = Math.cos(e.th);
    if (c < -0.2) e.phT = PI;
    else if (c > 0.2) e.phT = 0;
    e.ph += clamp(wrapA(e.phT - e.ph), -4 * dt, 4 * dt);
    qSide(e.q, e.th, e.ph);
  } else {
    if (alt < 100) to.y = to.length() * 0.7;
    const des = to.normalize(),
      ang = Math.acos(clamp(b.f.dot(des), -1, 1));
    const nf = tv2.copy(b.f);
    if (ang > 1e-4)
      nf.applyAxisAngle(
        tv.copy(b.f).cross(des).normalize(),
        Math.min(ang, e.turn * dt),
      );
    nf.y = clamp(nf.y, -0.7, 0.7);
    nf.normalize();
    const lat = des.dot(b.r);
    e.up
      .lerp(
        tv
          .copy(UP)
          .addScaledVector(b.r, clamp(lat * 3, -1.6, 1.6))
          .normalize(),
        1 - Math.exp(-dt * 3),
      )
      .normalize();
    tm.lookAt(e.pos, tv.copy(e.pos).add(nf), e.up);
    e.q.setFromRotationMatrix(tm);
  }
  b = basis(e.q, EB_);
  e.speed += (58 - b.f.y * 18 - e.speed) * Math.min(1, dt);
  e.pos.addScaledVector(b.f, e.speed * dt);
  if (game.mode === "classic") e.pos.z = 0;

  e.cd -= dt;
  if (hunting && e.cd <= 0) {
    tv.copy(T.pos).sub(e.pos);
    const d = tv.length();
    if (d < 420 && b.f.dot(tv.divideScalar(d)) > 0.982) {
      const dir = tv
        .copy(b.f)
        .add(
          tv2.set(
            rnd(-0.025, 0.025),
            rnd(-0.025, 0.025),
            game.mode === "classic" ? 0 : rnd(-0.025, 0.025),
          ),
        )
        .normalize();
      fire(tv2.copy(e.pos).addScaledVector(b.f, 5), dir, e.speed + 380, "e");
      // The other machines fire the same round, and judge their own hits.
      if (net.on)
        send({ t: "ef", o: v3(tv2), d: unit3(dir), s: e.speed + 380 });
      sfx.egun(camera.position.distanceTo(e.pos));
      e.burst++;
      e.cd = e.burst > 7 ? ((e.burst = 0), 1.3) : 0.11;
    }
  }
  if (e.pos.y < groundY(e.pos.x, e.pos.z) + 2) return killEnemy(e, false);
  if (P.alive && !P.ghost && P.pos.distanceTo(e.pos) < 6.5) {
    killEnemy(e, true);
    return crash(P.pos, "Mid-air collision!");
  }
  if (e.hp <= 1 && Math.random() < dt * 18)
    puff(e.pos, 0x555555, 1, 2, 1, 1.2, 3);
  e.obj.position.copy(e.pos);
  e.obj.quaternion.copy(e.q);
  e.obj.userData.prop.rotation.z += 50 * dt;
  syncShadow(e.shadow, e.pos, true);
}
