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
//
// Plane types (constants.js PLANES) are not the prototype's. The plane's own
// numbers are read from `P.pt`, and the Kite's are the prototype's literals,
// so flying the Kite is the prototype's flight. What the others add (engine
// torque, snap stalls and spins) runs only for a plane that has it.

import {
  V,
  Q,
  PI,
  UP,
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
  GEAR,
  CX,
  HOME,
  EB,
  LANE,
  LEVEL,
  ADS,
  PLANES,
  PLANE_KEY,
  SPIN,
  MSL,
} from "./constants.js";
import { scene } from "./scene.js";
import { S, game, opt } from "./state.js";
import { sfx } from "./audio.js";
import { puff, boom } from "./effects.js";
import { say } from "./msg.js";
import { readInput, autoLevel, sightsUp, key, touch } from "./input.js";
import {
  groundY,
  onRun,
  makePlane,
  ghostly,
  blob,
  targets,
  solids,
  hippos,
  fields,
  onAnyField,
  land,
} from "./world.js";
import { fire } from "./weapons.js";
import { net, send, myTeam } from "./net/bus.js";
import { v3 } from "./net/protocol.js";
import { TEAM } from "./net/teams.js";

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
  // Plane types: which (`kind`, an index into PLANES, and `pt`, its entry),
  // missiles aboard and the service's reload timer for them, and a spin:
  // `spin` is 0, or 1 (to the left) / -1 (to the right), `spinT` how long
  // the recovery has been held, `snapT` how long a snap stall has been
  // building, `spinH` the spin's heading (Free flight).
  kind: 0,
  pt: PLANES[0],
  msl: 0,
  mslT: 0,
  spin: 0,
  spinT: 0,
  snapT: 0,
  spinH: 0,
  // The colours worn: -1 the player's own, else a team's (net/teams.js).
  livery: -1,
};
const OWN = [0xf2f2ea, 0x3fd8e8, 0x55ffff, 0x14a0b4];
P.obj = makePlane(...OWN);
scene.add(P.obj);
P.shadow = blob();

// One mesh per livery and plane type, made the first time it is worn.
const meshes = new Map([["-1:0", P.obj]]);

// Put the player's plane in `livery` (-1: its own colours), as its type.
export function wear(livery = P.livery) {
  P.livery = livery;
  const k = livery + ":" + P.kind;
  let next = meshes.get(k);
  if (!next) {
    next = makePlane(
      ...(livery < 0 ? OWN : TEAM[livery % TEAM.length].plane),
      P.kind,
    );
    next.visible = false;
    scene.add(next);
    meshes.set(k, next);
  }
  if (next !== P.obj) {
    next.position.copy(P.obj.position);
    next.quaternion.copy(P.obj.quaternion);
    next.visible = P.obj.visible;
    P.obj.visible = false;
    P.obj = next;
  }
  ghostly(P.obj, P.ghost);
}

function setKind(k) {
  P.kind = k;
  P.pt = PLANES[k];
  wear();
}

export const crashAt = new V();

export function resetPlayer() {
  setKind(opt.plane);
  P.base = HOME;
  P.hitBy = null;
  if (net.on) {
    // A team game: the team's own field, teammates lined up in seat order.
    P.base = fields[myTeam()] || HOME;
    const mates = [...net.roster.values()]
      .filter((p) => p.team === myTeam())
      .map((p) => p.seat)
      .sort((a, b) => a - b);
    const x =
      P.base.x - P.base.hl + 40 + Math.max(0, mates.indexOf(net.seat)) * 55;
    P.pos.set(x, groundY(x, P.base.z) + GEAR, P.base.z);
  } else {
    // 40 m from the runway's end (on the Countryside, x = −190 at y = GEAR,
    // as the prototype has it; at sea, on the flight deck).
    const x = HOME.x - HOME.hl + 40;
    P.pos.set(x, groundY(x, 0) + GEAR, 0);
  }
  P.th = 0;
  P.ph = P.phT = 0;
  qSide(P.q, 0, 0);
  P.vel.set(0, 0, 0);
  P.speed = 0;
  P.sink = 0;
  P.thr = 0;
  P.fuel = 100;
  P.ammo = P.pt.ammo;
  P.bombs = P.pt.bombs;
  P.msl = P.pt.missiles;
  P.mslT = 0;
  P.spin = P.spinT = P.snapT = 0;
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

// Looking down the sights: Free flight only (Classic is side-on), and only
// while there is a plane to look along.
export function aiming() {
  return game.state === "play" && game.mode === "free" && P.alive && sightsUp();
}

// The stick down the sights: it follows the keys at ADS.ramp per second, so
// a tap moves the nose a little. Out of the sights it is the keys as they
// are, and it picks up from them when the sights go up.
const aimStick = { pitch: 0, roll: 0, yaw: 0 };
function steady(inp, on, dt) {
  const k = 1 - Math.exp(-dt * ADS.ramp);
  for (const a in aimStick)
    aimStick[a] = on ? aimStick[a] + (inp[a] - aimStick[a]) * k : inp[a];
  return on ? { ...inp, ...aimStick } : inp;
}

export function updPlayer(dt) {
  const inp = readInput(),
    pt = P.pt;
  if (key.KeyW) P.thr += 0.7 * dt;
  if (key.KeyS) P.thr -= 0.7 * dt;
  if (touch.thr !== null) P.thr = touch.thr;
  const dead = P.dmg >= 100;
  P.thr = P.fuel <= 0 || dead ? 0 : clamp(P.thr, 0, 1);
  P.fuel = Math.max(0, P.fuel - (0.12 + P.thr) * pt.burn * dt);
  if (!P.grounded) S.flown[P.kind] += dt;
  P.gunCd -= dt;
  P.bombCd -= dt;
  let b = basis(P.q, PB);
  const ctrl = clamp(P.speed / pt.stall, 0.1, 1.2) * (dead ? 0.15 : 1);
  if (pt.snap) snapStall(inp, b, dt);
  // Hands off the touch stick: ease back to straight and level. Never while
  // shot down or spinning, and the nose is left alone below stall so it can
  // drop and pick up speed, as DESIGN.md has it.
  const level = !dead && !P.spin && autoLevel(inp),
    levelNose = level && P.speed >= pt.stall;

  // ── Orientation ───────────────────────────────────────────────────────────
  if (game.mode === "classic") {
    if (!P.grounded) {
      if (P.spin) {
        // Spinning, side-on: the nose tumbles over and over.
        P.th += P.spin * SPIN.yaw * dt;
        spinRecovery(inp, dt);
      } else {
        P.th += inp.pitch * pt.cpitch * ctrl * Math.cos(P.ph) * dt;
        if (P.speed < pt.stall) {
          const k = (1 - P.speed / pt.stall) * 1.6 * dt;
          P.th += clamp(wrapA(-PI / 2 - P.th), -k, k);
        }
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
    // Down the sights the stick is finer and eases in. Off, `fine` and
    // `fineBank` are 1 and `st` is `inp`: x * 1 is x exactly, so keyboard
    // play stays the prototype's.
    const aim = aiming(),
      fine = aim ? ADS.rate : 1,
      fineBank = aim ? ADS.bank : 1,
      st = steady(inp, aim, dt);
    if (P.spin) spinFree(inp, b, ctrl, dt);
    else {
      rotLocal(P.q, AX, st.pitch * pt.pitch * ctrl * dt * fine);
      rotLocal(P.q, AZ, st.roll * pt.roll * ctrl * dt * fine);
      rotLocal(P.q, AY, st.yaw * pt.yaw * ctrl * dt * fine);
      // banking turns the plane
      rotWorld(P.q, AY, b.r.y * pt.bank * ctrl * dt * fineBank);
      if (pt.torque) torque(st, b, ctrl, fine, dt);
      if (P.speed < pt.stall && b.f.y > -0.85)
        rotLocal(P.q, AX, -(1 - P.speed / pt.stall) * 1.4 * dt);
    }
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
    if (!P.spin && Math.max(Math.abs(tv.x), Math.abs(tv.z)) > 3500) {
      const s = Math.sign(tv2.copy(b.f).cross(tv.negate()).y) || 1;
      rotWorld(P.q, AY, s * 0.9 * dt);
      say("Edge of the map — turning back", 0.6);
    }
    // The City's cloud ceiling is solid: near it the nose is pushed down,
    // harder the closer the plane gets.
    const under = land.ceil - 30;
    if (land.ceil && !P.spin && P.pos.y > under && b.f.y > -0.2) {
      const k = clamp((P.pos.y - under) / 30, 0.2, 1);
      rotLocal(P.q, AX, -1.6 * k * Math.sign(b.u.y || 1) * dt);
      say("Cloud ceiling — keep below it", 0.6);
    }
    P.q.normalize();
  }
  b = basis(P.q, PB);

  // ── Speed, lift, sink ─────────────────────────────────────────────────────
  // Gravity acts along the nose: dives speed you up, climbs slow you down.
  P.speed += (P.thr * pt.thr - pt.drag * P.speed * P.speed - G * b.f.y) * dt;
  P.speed = clamp(P.speed, 0, 140);
  // A stalled wing in a spin bleeds the speed away, and lifts nothing.
  const spinV = pt.stall * SPIN.speed;
  if (P.spin && P.speed > spinV)
    P.speed -= (P.speed - spinV) * Math.min(1, dt * 2);
  const lift = P.spin
    ? 0
    : Math.min(1, (P.speed / pt.stall) ** 2) * Math.max(0, 0.55 + 0.45 * b.u.y);
  P.sink +=
    (Math.min(45, G * (1 - lift) * 2.2) - P.sink) * Math.min(1, dt * 1.6);
  if (P.grounded) P.sink = 0;
  P.vel.copy(b.f).multiplyScalar(P.speed);
  P.vel.y -= P.sink;
  P.pos.addScaledVector(P.vel, dt);
  if (game.mode === "classic") P.pos.z = 0;
  if (land.ceil && P.pos.y > land.ceil) P.pos.y = land.ceil;

  // ── Ground contact: land, or crash ────────────────────────────────────────
  // "Home" is this plane's own runway: HOME, or its team's field.
  const gy = groundY(P.pos.x, P.pos.z) + GEAR,
    onHome = onRun(P.pos, P.base),
    onRw =
      onHome ||
      (net.on ? onAnyField(P.pos) : onRun(P.pos, P.base === HOME ? EB : HOME));
  if (!P.grounded && P.pos.y <= gy) {
    const vs = -P.vel.y,
      along = game.mode === "classic" || Math.abs(b.f.z) < pt.along;
    if (
      onRw &&
      !dead &&
      !P.spin &&
      vs < pt.sink &&
      Math.abs(b.r.y) < pt.bankLand &&
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
          : P.spin
            ? "Spun in! Push, idle, opposite rudder to recover"
            : onRw
              ? `Too hard! Wings level, sink under ${Math.floor(pt.sink)} m/s`
              : land.crash
                ? land.crash(P.pos)
                : "Crashed — land on a runway",
      );
  }
  // A flight deck has nothing round it: off its edge, a plane at flying
  // speed flies on, and a slower one goes into the sea.
  if (P.grounded && land.deck && !onRw) {
    if (P.speed < pt.stall) return crash(P.pos, "Rolled off the deck");
    P.grounded = false;
  }
  if (P.grounded) {
    if (game.mode !== "classic") {
      let hd = Math.atan2(-b.f.x, -b.f.z);
      hd += (inp.roll + inp.yaw) * 0.7 * clamp(P.speed / 12, 0.25, 1) * dt;
      P.q.setFromAxisAngle(AY, hd);
    }
    P.pos.y = gy;
    P.speed = Math.max(
      0,
      P.speed - (onRw ? (P.thr < 0.05 ? land.brake : 0.6) : 9) * dt,
    );
    if (!onRw && P.speed > 22) return crash(P.pos, "Ran off the runway");
    if (
      P.speed > pt.stall * 1.05 &&
      (inp.pitch > 0.2 || P.speed > pt.stall * 1.45)
    ) {
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
    if (
      P.pos.y < t.y + t.h + 1.5 &&
      Math.hypot(P.pos.x - t.x, P.pos.z - t.z) < t.r
    )
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
      P.gunCd = pt.cadence;
      P.ammo--;
      P.side = -P.side;
      tv2
        .copy(P.pos)
        .addScaledVector(b.f, 4.6)
        .addScaledVector(b.r, 0.55 * P.side)
        .addScaledVector(b.u, 0.6);
      fire(tv2, b.f, P.speed + pt.muzzle, "p");
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

// ── Plane types: torque, snap stalls, spins ─────────────────────────────────
// A rotary engine (constants.js PLANES `torque`, `gyro`), in Free flight:
// under power the nose wanders left, and the spinning engine's gyroscope
// makes a turn to the right quicker, and drop the nose, and one to the left
// slower, and lift it.
function torque(inp, b, ctrl, fine, dt) {
  const pt = P.pt,
    g = pt.gyro * P.thr,
    turn = b.r.y * pt.bank * ctrl; // rad/s about world up; < 0 turning right
  rotLocal(P.q, AY, pt.torque * P.thr * ctrl * dt);
  rotLocal(
    P.q,
    AZ,
    inp.roll * pt.roll * ctrl * dt * fine * g * (inp.roll < 0 ? 1 : -1),
  );
  rotWorld(P.q, AY, turn * dt * g * (turn < 0 ? 1 : -1));
  // The nose dips (right) or lifts (left) in the vertical, whatever the bank.
  gyroAxis.crossVectors(b.f, UP);
  if (gyroAxis.lengthSq() > 0.01)
    rotWorld(P.q, gyroAxis.normalize(), turn * g * 0.5 * dt);
}
const gyroAxis = new V();

// A snap stall: hauling back while slow and losing speed, for SPIN.hold
// seconds, flicks the plane into a spin, to the side the stick or the bank
// (or, with a rotary, the engine) takes it.
let lastSpeed = 0;
function snapStall(inp, b, dt) {
  const s = P.pt.snap,
    slowing = P.speed < lastSpeed;
  lastSpeed = P.speed;
  if (P.grounded || P.spin || P.dmg >= 100) {
    P.snapT = 0;
    return;
  }
  if (!(P.speed < s.v * P.pt.stall && slowing && inp.pitch > s.pull)) {
    P.snapT = 0;
    return;
  }
  if ((P.snapT += dt) < SPIN.hold) return;
  P.snapT = P.spinT = 0;
  if (game.mode === "classic") P.spin = Math.cos(P.ph) >= 0 ? 1 : -1;
  else {
    P.spin =
      Math.sign(inp.roll + inp.yaw) || (P.pt.torque ? 1 : b.r.y < 0 ? -1 : 1);
    P.spinH = Math.atan2(-b.f.x, -b.f.z);
  }
  say(
    game.mode === "classic"
      ? "Spin! Push and throttle off to recover"
      : "Spin! Push, throttle off, opposite rudder",
    2.5,
  );
}

// Spinning in Free flight: round and round about the vertical, nose low and
// a wing down, the stick nearly useless.
const spinQ = new Q();
function spinFree(inp, b, ctrl, dt) {
  const pt = P.pt;
  P.spinH += P.spin * SPIN.yaw * dt;
  spinQ.setFromAxisAngle(UP, P.spinH);
  rotLocal(spinQ, AX, -SPIN.nose);
  rotLocal(spinQ, AZ, P.spin * SPIN.bank);
  P.q.slerp(spinQ, 1 - Math.exp(-dt * SPIN.ease));
  const k = SPIN.authority * ctrl * dt;
  rotLocal(P.q, AX, inp.pitch * pt.pitch * k);
  rotLocal(P.q, AZ, inp.roll * pt.roll * k);
  rotLocal(P.q, AY, inp.yaw * pt.yaw * k);
  spinRecovery(inp, dt);
}

// Out of a spin: push, idle and (Free flight) rudder or stick against the
// spin, all held together for the plane's `spinExit` seconds.
function spinRecovery(inp, dt) {
  const against = game.mode === "classic" || (inp.yaw || inp.roll) * P.spin < 0;
  if (inp.pitch < -0.2 && P.thr < 0.2 && against) {
    if ((P.spinT += dt) < P.pt.spinExit) return;
    P.spin = P.spinT = 0;
    say("Out of the spin. Ease out of the dive", 2);
  } else P.spinT = 0;
}

// ── Changing plane ──────────────────────────────────────────────────────────
// Only on the plane's own runway, stopped, throttle idle: where service
// happens.
export function idleAtHome() {
  return (
    game.state === "play" &&
    P.alive &&
    P.grounded &&
    onRun(P.pos, P.base) &&
    P.speed < 3 &&
    P.thr < 0.1
  );
}

// Swap to plane type `k`. What is aboard keeps its share of the new plane's
// load, so a swap refills nothing; service tops it up. True if it happened.
export function pickPlane(k) {
  if (game.state !== "play" || game.paused || !PLANES[k] || k === P.kind)
    return false;
  if (!idleAtHome()) {
    say("Stop on your own runway, throttle idle, to change plane", 1.8);
    return false;
  }
  const was = P.pt;
  setKind(k);
  const pt = P.pt;
  P.ammo = Math.min(pt.ammo, (P.ammo * pt.ammo) / was.ammo);
  P.bombs = Math.floor((P.bombs * pt.bombs) / was.bombs);
  P.msl = was.missiles ? Math.floor((P.msl * pt.missiles) / was.missiles) : 0;
  P.mslT = 0;
  opt.plane = k;
  try {
    window.localStorage.setItem(PLANE_KEY, k);
  } catch {
    // No storage: the choice lasts the session.
  }
  return true;
}

// On the home runway, stopped, throttle idle: refuel, rearm, repair. Up to
// the plane's own load (the Kite's is the prototype's).
function service(dt) {
  const pt = P.pt,
    was = P.fuel + P.ammo + P.bombs + P.msl - P.dmg;
  P.fuel = Math.min(100, P.fuel + 22 * dt);
  P.ammo = Math.min(pt.ammo, P.ammo + 90 * dt);
  P.dmg = Math.max(0, P.dmg - 25 * dt);
  P.svc += dt;
  if (P.svc > 0.9 && P.bombs < pt.bombs) {
    P.bombs++;
    P.svc = 0;
    sfx.tick();
  }
  if (P.msl < pt.missiles && (P.mslT += dt) > MSL.rearm) {
    P.msl++;
    P.mslT = 0;
    sfx.tick();
  }
  const full =
    P.fuel >= 100 &&
    P.ammo >= pt.ammo &&
    P.bombs >= pt.bombs &&
    P.msl >= pt.missiles &&
    P.dmg <= 0;
  $("svc").textContent = full
    ? "Ready! Throttle up to take off"
    : "Servicing: fuel, guns, bombs, repairs…";
  $("svc").classList.remove("hidden");
  if (
    !full &&
    was !== P.fuel + P.ammo + P.bombs + P.msl - P.dmg &&
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
