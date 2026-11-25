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

// flight.js — the player's plane: one flight model, two modes.
//
// Classic: the plane is locked to z = 0 and its orientation is an angle `th`
// in the XY plane plus a roll `ph` of 0 or π (the flip); pitch is relative to
// the plane, so inverted "pull up" turns the other way, as in the original.
// Free: full quaternion orientation, and bank (`right.y`) yaws the plane
// about world up — a coordinated turn.
//
// Every number here is the prototype's; DESIGN.md ("Rules & numbers") is the
// reference for what they mean. Landing, service and crash rules live here
// too because they are decided by the same contact test.

import {
  V,
  Q,
  PI,
  AX,
  AY,
  AZ,
  clamp,
  wrapA,
  tv,
  tv2,
  rotLocal,
  rotWorld,
  qSide,
  basis,
  $,
} from "./util.js";
import {
  G,
  STALL,
  THR,
  DRAG,
  GEAR,
  CX,
  HOME,
  EB,
  LANE,
  LEVEL,
} from "./constants.js";
import { scene } from "./scene.js";
import { S, game } from "./state.js";
import { sfx } from "./audio.js";
import { puff, boom } from "./effects.js";
import { say } from "./msg.js";
import { readInput, autoLevel, key, touch } from "./input.js";
import {
  groundY,
  onRun,
  makePlane,
  blob,
  targets,
  solids,
  hippos,
  fields,
  onAnyField,
} from "./world.js";
import { fire } from "./weapons.js";
import { net, send, myTeam } from "./net/bus.js";
import { v3 } from "./net/protocol.js";

export const PB = basis(new Q()); // the player's basis, recomputed in place

export const P = {
  pos: new V(),
  q: new Q(),
  vel: new V(),
  speed: 0,
  sink: 0,
  thr: 0,
  fuel: 100,
  ammo: 300,
  bombs: 6,
  dmg: 0,
  alive: false,
  grounded: true,
  gunCd: 0,
  bombCd: 0,
  side: 1,
  th: 0,
  ph: 0,
  phT: 0,
  svc: 0,
  // Team games only: the runway this plane belongs to (its team's field),
  // who did the last damage (a seat, or "e" for an enemy flyer), and whether
  // it is a ghost (Endless enemies, out of planes: can't shoot or be hurt).
  base: HOME,
  hitBy: null,
  ghost: false,
};
P.obj = makePlane(0xf2f2ea, 0x3fd8e8, 0x55ffff, 0x14a0b4);
scene.add(P.obj);
P.shadow = blob();

export const crashAt = new V();

export function resetPlayer() {
  P.base = HOME;
  P.hitBy = null;
  if (net.on) {
    // A team game: the team's own field, teammates lined up in seat order.
    P.base = fields[myTeam()] || HOME;
    const mates = [...net.roster.values()]
      .filter((p) => p.team === myTeam())
      .map((p) => p.seat)
      .sort((a, b) => a - b);
    P.pos.set(
      P.base.x - 190 + Math.max(0, mates.indexOf(net.seat)) * 55,
      GEAR,
      P.base.z,
    );
  } else P.pos.set(HOME.x - 190, GEAR, 0);
  P.th = 0;
  P.ph = P.phT = 0;
  qSide(P.q, 0, 0);
  P.vel.set(0, 0, 0);
  P.speed = 0;
  P.sink = 0;
  P.thr = 0;
  P.fuel = 100;
  P.ammo = 300;
  P.bombs = 6;
  P.dmg = 0;
  P.alive = true;
  P.grounded = true;
  P.obj.visible = true;
  touch.thr = null;
}

// Classic only: in the air, roll onto the back (the original's flip); on the
// ground and nearly stopped, turn the plane round.
export function flip() {
  if (!P.alive || P.dmg >= 100) return;
  if (P.grounded) {
    if (P.speed < 4) {
      P.th = wrapA(P.th + PI);
      P.ph = P.phT = wrapA(P.ph + PI);
      say("Turned around", 0.8);
    }
    return;
  }
  P.phT = Math.abs(wrapA(P.phT)) < 0.1 ? PI : 0;
}

export function updPlayer(dt) {
  const inp = readInput();
  if (key.KeyW) P.thr += 0.7 * dt;
  if (key.KeyS) P.thr -= 0.7 * dt;
  if (touch.thr !== null) P.thr = touch.thr;
  const dead = P.dmg >= 100;
  P.thr = P.fuel <= 0 || dead ? 0 : clamp(P.thr, 0, 1);
  P.fuel = Math.max(0, P.fuel - (0.12 + P.thr) * 0.42 * dt);
  P.gunCd -= dt;
  P.bombCd -= dt;
  let b = basis(P.q, PB);
  const ctrl = clamp(P.speed / STALL, 0.1, 1.2) * (dead ? 0.15 : 1);
  // Hands off the touch stick: ease back to straight and level. Never while
  // shot down, and the nose is left alone below stall so it can drop and
  // pick up speed, as DESIGN.md has it.
  const level = !dead && autoLevel(inp),
    levelNose = level && P.speed >= STALL;

  // ── Orientation ───────────────────────────────────────────────────────────
  if (game.mode === "classic") {
    if (!P.grounded) {
      P.th += inp.pitch * 1.5 * ctrl * Math.cos(P.ph) * dt;
      if (P.speed < STALL) {
        const k = (1 - P.speed / STALL) * 1.6 * dt;
        P.th += clamp(wrapA(-PI / 2 - P.th), -k, k);
      }
      if (dead) P.th += clamp(wrapA(-PI / 2 - P.th), -0.5 * dt, 0.5 * dt);
      const outL = P.pos.x < LANE.min && Math.cos(P.th) < 0,
        outR = P.pos.x > LANE.max && Math.cos(P.th) > 0;
      if (outL || outR) {
        P.th += 1.3 * Math.cos(P.ph) * dt;
        say("Turn back!", 0.6);
      } else if (levelNose) {
        // Level means the nose on the horizon, whichever way it points.
        const err = wrapA((Math.cos(P.th) >= 0 ? 0 : PI) - P.th);
        P.th += easeTo(err, LEVEL.pitch, LEVEL.pitchMax) * ctrl * dt;
      }
    }
    P.ph += clamp(wrapA(P.phT - P.ph), -5 * dt, 5 * dt);
    qSide(P.q, P.th, P.ph);
    P.th = wrapA(P.th);
  } else if (!P.grounded) {
    rotLocal(P.q, AX, inp.pitch * 1.25 * ctrl * dt);
    rotLocal(P.q, AZ, inp.roll * 2.3 * ctrl * dt);
    rotLocal(P.q, AY, inp.yaw * 0.55 * ctrl * dt);
    rotWorld(P.q, AY, b.r.y * 1.05 * ctrl * dt); // banking turns the plane
    if (P.speed < STALL && b.f.y > -0.85)
      rotLocal(P.q, AX, -(1 - P.speed / STALL) * 1.4 * dt);
    if (dead) {
      rotLocal(P.q, AX, -0.35 * dt);
      rotLocal(P.q, AZ, 0.6 * dt);
    }
    if (level) {
      // Roll the wings level (this also ends the banking turn), then bring
      // the nose to the horizon. Pitching about the wing axis moves the nose
      // by u.y per radian, hence the factor: it works inverted too.
      const bank = Math.atan2(b.r.y, b.u.y);
      rotLocal(P.q, AZ, easeTo(-bank, LEVEL.roll, LEVEL.rollMax) * ctrl * dt);
      if (levelNose) {
        const climb = Math.asin(clamp(b.f.y, -1, 1));
        rotLocal(
          P.q,
          AX,
          easeTo(-climb * b.u.y, LEVEL.pitch, LEVEL.pitchMax) * ctrl * dt,
        );
      }
    }
    tv.set(P.pos.x - CX, 0, P.pos.z);
    if (Math.max(Math.abs(tv.x), Math.abs(tv.z)) > 3500) {
      const s = Math.sign(tv2.copy(b.f).cross(tv.negate()).y) || 1;
      rotWorld(P.q, AY, s * 0.9 * dt);
      say("Edge of the map — turning back", 0.6);
    }
    P.q.normalize();
  }
  b = basis(P.q, PB);

  // ── Speed, lift, sink ─────────────────────────────────────────────────────
  // Gravity acts along the nose: dives speed you up, climbs slow you down.
  P.speed += (P.thr * THR - DRAG * P.speed * P.speed - G * b.f.y) * dt;
  P.speed = clamp(P.speed, 0, 140);
  const lift =
    Math.min(1, (P.speed / STALL) ** 2) * Math.max(0, 0.55 + 0.45 * b.u.y);
  P.sink +=
    (Math.min(45, G * (1 - lift) * 2.2) - P.sink) * Math.min(1, dt * 1.6);
  if (P.grounded) P.sink = 0;
  P.vel.copy(b.f).multiplyScalar(P.speed);
  P.vel.y -= P.sink;
  P.pos.addScaledVector(P.vel, dt);
  if (game.mode === "classic") P.pos.z = 0;

  // ── Ground contact: land, or crash ────────────────────────────────────────
  // "Home" is this plane's own runway: HOME, or its team's field.
  const gy = groundY(P.pos.x, P.pos.z) + GEAR,
    onHome = onRun(P.pos, P.base),
    onRw =
      onHome ||
      (net.on ? onAnyField(P.pos) : onRun(P.pos, P.base === HOME ? EB : HOME));
  if (!P.grounded && P.pos.y <= gy) {
    const vs = -P.vel.y,
      along = game.mode === "classic" || Math.abs(b.f.z) < 0.35;
    if (
      onRw &&
      !dead &&
      vs < 6.5 &&
      Math.abs(b.r.y) < 0.26 &&
      b.f.y > -0.2 &&
      b.u.y > 0.85 &&
      along
    ) {
      P.grounded = true;
      if (game.mode === "classic") {
        P.th = Math.cos(P.th) >= 0 ? 0 : PI;
        P.ph = P.phT = P.th;
      }
      say(
        onHome
          ? "Touchdown! Roll to a stop to refuel"
          : "Landed on enemy turf. Cheeky.",
        2.5,
      );
    } else
      return crash(
        P.pos,
        dead
          ? "Shot down!"
          : onRw
            ? "Too hard! Wings level, sink under 6 m/s"
            : "Crashed — land on a runway",
      );
  }
  if (P.grounded) {
    if (game.mode !== "classic") {
      let hd = Math.atan2(-b.f.x, -b.f.z);
      hd += (inp.roll + inp.yaw) * 0.7 * clamp(P.speed / 12, 0.25, 1) * dt;
      P.q.setFromAxisAngle(AY, hd);
    }
    P.pos.y = gy;
    P.speed = Math.max(0, P.speed - (onRw ? (P.thr < 0.05 ? 7 : 0.6) : 9) * dt);
    if (!onRw && P.speed > 22) return crash(P.pos, "Ran off the runway");
    if (P.speed > STALL * 1.05 && (inp.pitch > 0.2 || P.speed > STALL * 1.45)) {
      P.grounded = false;
      P.pos.y += 0.4;
      if (game.mode === "classic") P.th += 0.1 * Math.cos(P.ph);
      else rotLocal(P.q, AX, 0.1);
    }
    if (onHome && P.speed < 3 && P.thr < 0.1) service(dt);
    else $("svc").classList.add("hidden");
  } else $("svc").classList.add("hidden");

  // ── Obstacles ─────────────────────────────────────────────────────────────
  for (const t of targets)
    if (P.pos.y < t.h + 1.5 && Math.hypot(P.pos.x - t.x, P.pos.z - t.z) < t.r)
      return crash(
        P.pos,
        t.alive
          ? "Flew into the " + t.name.toLowerCase()
          : "Flew into the rubble",
      );
  for (const s of solids)
    if (P.pos.y < s.h + 1.5 && Math.hypot(P.pos.x - s.x, P.pos.z - s.z) < s.r)
      return crash(P.pos, "Flew into a building");
  for (const h of hippos)
    if (
      h.alive &&
      P.pos.y < 5.5 &&
      Math.hypot(P.pos.x - h.x, P.pos.z - h.z) < 4.5
    )
      return crash(P.pos, "You hit a hippo. The hippo is fine.");

  // ── Guns: alternating muzzles ─────────────────────────────────────────────
  if (inp.fire && P.gunCd <= 0 && !dead) {
    if (P.ghost) {
      P.gunCd = 1.5;
      say("Ghosts can't shoot. Bomb the town for your team!", 1.4);
    } else if (P.ammo >= 1) {
      P.gunCd = 0.075;
      P.ammo--;
      P.side = -P.side;
      tv2
        .copy(P.pos)
        .addScaledVector(b.f, 4.6)
        .addScaledVector(b.r, 0.55 * P.side)
        .addScaledVector(b.u, 0.6);
      fire(tv2, b.f, P.speed + 420, "p");
      sfx.gun();
    } else {
      P.gunCd = 0.6;
      say("Out of ammo — land at home to rearm", 1.2);
    }
  }
  if (P.dmg > 45 && Math.random() < (dt * P.dmg) / 5)
    puff(tv2.copy(P.pos).addScaledVector(b.f, 2), 0x555555, 1, 2, 1.1, 1.3, 3);

  P.obj.position.copy(P.pos);
  P.obj.quaternion.copy(P.q);
  P.obj.userData.prop.rotation.z += (P.thr * 55 + (P.speed > 1 ? 6 : 0)) * dt;
}

// A turn rate that closes `err` proportionally, capped at `max` rad/s.
function easeTo(err, gain, max) {
  return clamp(err * gain, -max, max);
}

// On the home runway, stopped, throttle idle: refuel, rearm, repair.
function service(dt) {
  const was = P.fuel + P.ammo + P.bombs - P.dmg;
  P.fuel = Math.min(100, P.fuel + 22 * dt);
  P.ammo = Math.min(300, P.ammo + 90 * dt);
  P.dmg = Math.max(0, P.dmg - 25 * dt);
  P.svc += dt;
  if (P.svc > 0.9 && P.bombs < 6) {
    P.bombs++;
    P.svc = 0;
    sfx.tick();
  }
  const full = P.fuel >= 100 && P.ammo >= 300 && P.bombs >= 6 && P.dmg <= 0;
  $("svc").textContent = full
    ? "Ready! Throttle up to take off"
    : "Servicing: fuel, guns, bombs, repairs…";
  $("svc").classList.remove("hidden");
  if (
    !full &&
    was !== P.fuel + P.ammo + P.bombs - P.dmg &&
    Math.random() < dt * 3
  )
    sfx.tick();
}

export function crash(pos, why) {
  // Everyone learns where, and which player (if any) gets the kill.
  if (net.on)
    send({
      t: "down",
      p: v3(pos),
      by: Number.isInteger(P.hitBy) && P.dmg >= 100 ? P.hitBy : null,
    });
  crashAt.copy(pos);
  boom(pos, true);
  puff(pos, 0x333333, 10, 5, 3, 3, 7);
  P.alive = false;
  P.obj.visible = false;
  P.shadow.visible = false;
  // A ghost has no planes left to lose: it is back on the runway shortly.
  if (!P.ghost) S.lives--;
  game.respawnT = 3.2;
  say(why, 3);
}
