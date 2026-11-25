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

// weapons.js — guns and bombs: pooled projectiles and what they hit.
//
// Numbers from DESIGN.md: bullets live 1.4 s and are swept as segments (so a
// fast round cannot tunnel through a plane between frames); bombs fall under
// gravity and blast within target radius + 12 m.

import * as THREE from "three";
import { V, tv, segD2, basis } from "./util.js";
import { G } from "./constants.js";
import { scene, box, put } from "./scene.js";
import { game, opt } from "./state.js";
import { sfx } from "./audio.js";
import { puff, boom } from "./effects.js";
import { say } from "./msg.js";
import { groundY, targets, hurtTarget, hippos, scareHippo } from "./world.js";
import { P, PB } from "./flight.js";
import { enemies, killEnemy, ownsEnemy } from "./ai.js";
import { solidRemotes } from "./remote.js";
import { net, send, teamOf, myTeam, canHurt } from "./net/bus.js";
import { v3, unit3 } from "./net/protocol.js";

// ── Bullets ─────────────────────────────────────────────────────────────────
export const bullets = [];
const bGeo = new THREE.BoxGeometry(0.32, 0.32, 4.5);
const bMatP = new THREE.MeshBasicMaterial({ color: 0xfff27a }),
  bMatE = new THREE.MeshBasicMaterial({ color: 0xff55ff });

// Where a round points. Its own vector, not the shared `tv`: the enemy AI
// passes `tv` itself as `dir`, and the prototype's `tv.copy(pos).add(dir)`
// then overwrote the direction before adding it — every enemy round was
// drawn aimed at twice its own position. Drawing only; the round's velocity
// was always taken from `dir` first, so no gameplay number moves.
const aim = new V();

// `own` is 'p' for the player's rounds, 'e' for an enemy's, and in a match
// 'r' for another player's, whose seat is `seat` (net/match.js fires those
// as they report them).
export function fire(pos, dir, spd, own, seat = null) {
  if (net.on && own === "p")
    send({ t: "f", o: v3(pos), d: unit3(dir), s: spd });
  let b = bullets.find((b) => !b.on);
  if (!b) {
    if (bullets.length > 240) return;
    b = { m: new THREE.Mesh(bGeo, bMatP), v: new V(), p0: new V() };
    scene.add(b.m);
    bullets.push(b);
  }
  b.on = true;
  b.own = own;
  b.seat = seat;
  // A teammate's rounds are the player's yellow; everyone else's magenta.
  b.m.material =
    own === "p" || (own === "r" && teamOf(seat) === myTeam()) ? bMatP : bMatE;
  b.m.visible = true;
  b.m.position.copy(pos);
  b.v.copy(dir).multiplyScalar(spd);
  b.life = 1.4;
  b.m.lookAt(aim.copy(pos).add(dir));
}

export function updBullets(dt) {
  for (const b of bullets) {
    if (!b.on) continue;
    b.p0.copy(b.m.position);
    b.m.position.addScaledVector(b.v, dt);
    b.life -= dt;
    const p = b.m.position;
    let hit = false;
    if (b.own === "r") {
      // Another player's round. It can only hurt this plane: the machine
      // that is hit decides, then says so by crashing. A teammate's cannot,
      // unless friendly fire is on; a ghost is never hit. Everything else it
      // touches is for show, as the shooter's machine does that damage.
      if (
        P.alive &&
        !P.ghost &&
        canHurt(b.seat) &&
        segD2(b.p0, p, P.pos) < 22
      ) {
        hit = true;
        P.hitBy = b.seat;
        P.dmg = Math.min(100, P.dmg + 6);
        sfx.hit();
        puff(P.pos, 0xff55ff, 3, 6, 0.6, 0.3);
        if (P.dmg >= 100) say("Engine hit! Going down…", 2.5);
      }
    } else if (b.own === "p") {
      for (const e of enemies)
        if (e.alive && segD2(b.p0, p, e.pos) < 40) {
          hit = true;
          puff(e.pos, 0xfff27a, 3, 8, 0.7, 0.3);
          sfx.hit();
          // Another player's flyer (Endless enemies): report the hit.
          if (!ownsEnemy(e)) {
            send({ t: "eh", i: enemies.indexOf(e) });
            break;
          }
          e.hp--;
          if (e.hp <= 0) killEnemy(e, true);
          break;
        }
      // Another plane hit: sparks only; their machine takes the damage.
      if (!hit && net.on)
        for (const r of solidRemotes())
          if (canHurt(r.seat) && segD2(b.p0, p, r.pos) < 22) {
            hit = true;
            puff(r.pos, 0xfff27a, 3, 6, 0.6, 0.3);
            sfx.hit();
            break;
          }
      if (!hit)
        for (const t of targets)
          if (t.alive && p.y < t.h && Math.hypot(p.x - t.x, p.z - t.z) < t.r) {
            hit = true;
            hurtTarget(t, 1, p.clone());
            break;
          }
      if (!hit)
        for (const h of hippos)
          if (h.alive && p.y < 4.5 && Math.hypot(p.x - h.x, p.z - h.z) < 4) {
            hit = true;
            scareHippo(h);
            break;
          }
    } else if (P.alive && !P.ghost && segD2(b.p0, p, P.pos) < 22) {
      hit = true;
      P.hitBy = "e";
      P.dmg = Math.min(100, P.dmg + 6);
      sfx.hit();
      puff(P.pos, 0xff55ff, 3, 6, 0.6, 0.3);
      if (P.dmg >= 100) say("Engine hit! Going down…", 2.5);
    }
    if (!hit && p.y < groundY(p.x, p.z)) {
      hit = true;
      puff(p, 0xb9a47c, 2, 4, 0.8, 0.5, 2);
    }
    if (hit || b.life <= 0) {
      b.on = false;
      b.m.visible = false;
    }
  }
}

// ── Bombs ───────────────────────────────────────────────────────────────────
export const bombs = [];

// A pooled bomb: an idle one, or a new one.
function freeBomb() {
  let b = bombs.find((b) => !b.on);
  if (!b) {
    const m = new THREE.Group();
    put(m, box(0.55, 0.55, 1.6, 0x2e2e2e), 0, 0, 0);
    put(m, box(1.1, 0.08, 0.4, 0x2e2e2e), 0, 0, 0.75);
    put(m, box(0.08, 1.1, 0.4, 0x2e2e2e), 0, 0, 0.75);
    scene.add(m);
    b = { m, v: new V() };
    bombs.push(b);
  }
  return b;
}

export function dropBomb() {
  if (
    game.state !== "play" ||
    game.paused ||
    !P.alive ||
    P.grounded ||
    P.bombs < 1 ||
    P.bombCd > 0 ||
    P.dmg >= 100
  )
    return;
  P.bombs--;
  P.bombCd = 0.45;
  const b = freeBomb();
  basis(P.q, PB);
  b.on = true;
  b.m.visible = true;
  b.m.position.copy(P.pos).addScaledVector(PB.u, -2.2);
  b.v.copy(P.vel);
  b.shown = false;
  if (net.on) send({ t: "b", p: v3(b.m.position), v: v3(b.v) });
  // The whistle lasts exactly the fall time, h = vd·t + ½·G·t² solved for t,
  // in real seconds — so stretched when the game is slowed down.
  const h = Math.max(
      1,
      b.m.position.y - groundY(b.m.position.x, b.m.position.z),
    ),
    vd = Math.max(0, -b.v.y);
  b.snd = sfx.whistle((-vd + Math.sqrt(vd * vd + 2 * G * h)) / G / opt.speed);
}

// The other player's bomb, for show: where it lands is their machine's to
// judge, and it reports any building it hits.
export function showBomb(pos, vel) {
  const b = freeBomb();
  b.on = true;
  b.shown = true;
  b.snd = null;
  b.m.visible = true;
  b.m.position.copy(pos);
  b.v.copy(vel);
}

export function updBombs(dt) {
  for (const b of bombs) {
    if (!b.on) continue;
    b.v.y -= G * dt;
    b.m.position.addScaledVector(b.v, dt);
    b.m.lookAt(tv.copy(b.m.position).add(b.v));
    const p = b.m.position;
    if (p.y <= groundY(p.x, p.z) + 0.3) {
      b.on = false;
      b.m.visible = false;
      if (b.snd) b.snd.stop();
      boom(p, true);
      if (b.shown) continue;
      for (const t of targets)
        if (t.alive && Math.hypot(p.x - t.x, p.z - t.z) < t.r + 12)
          hurtTarget(t, 12, p.clone());
      for (const h of hippos)
        if (h.alive && Math.hypot(p.x - h.x, p.z - h.z) < 14) scareHippo(h);
    }
  }
}
