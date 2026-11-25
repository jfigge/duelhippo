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

// maps.js — the maps beyond the prototype's Countryside. The City and the
// Sea are built here (constants.js CITY, SEA); the rest (constants.js MAPS:
// Sky islands, Arctic, Canyon, Zeppelins, Night raid, Volcano, Storm) in
// maps/, from the shared pieces in `kit` below.
//
// Each is built the first time it is picked, into a group that is shown
// while it is the map in play, from its own seeded random numbers: never
// Math.random, whose draws are the prototype's. useMap() swaps the scenery,
// the two runways (HOME and EB, changed in place), the solids, where the
// hippos live, the town, the sky, and plugs the map's rules into world.js
// `land`. On the Countryside every one of those is the prototype's.
// startMap() is each game's fresh start for what a map moves or keeps
// (a convoy, the weather), so every machine in a team game agrees.
//
// The trick all the maps share: what stands on the ground counts as ground.
// A tower's roof or a flight deck is just higher ground to groundY, so
// planes, rounds, bombs, missiles and shadows all meet it with no new code.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PI } from "./util.js";
import { CX, HOME, EB, TDEF, SKY, MAPS, CITY, SEA } from "./constants.js";
import { scene, camera, M, box, put, flat } from "./scene.js";
import { game } from "./state.js";
import { say } from "./msg.js";
import { sfx } from "./audio.js";
import { puff, boom } from "./effects.js";
import { P, crash } from "./flight.js";
import { fire } from "./weapons.js";
import { MORE } from "./maps/index.js";
import {
  land,
  countryside,
  runway,
  hangar,
  setSolids,
  COUNTRY_SOLIDS,
  placeHippos,
  buildTargets,
  targets,
} from "./world.js";

// The sky's light from below takes the ground's colour: grass on the
// Countryside, grey in the City, blue at sea. Night dims both lights.
const hemi = scene.children.find((o) => o.isHemisphereLight),
  sun = scene.children.find((o) => o.isDirectionalLight),
  LIGHT = [hemi.intensity, sun.intensity];

// The Countryside, as the prototype has it: put back when it is picked again.
const COUNTRY = {
  land: { ...land },
  home: { ...HOME },
  enemy: { ...EB },
  solids: COUNTRY_SOLIDS,
  hippos: [
    [520, 0, 0],
    [1050, 0, 0],
    [1720, 0, 0],
  ],
  sky: SKY,
  fog: [700, 3400],
  below: hemi.groundColor.getHex(),
  light: [1, 1],
};

let current = "field";
const built = {};
export const mapNow = () => current;

// A map, as its builder returns it. Anything left out is the Countryside's:
//   group    its scenery, shown while it is the map in play
//   country  true: the Countryside's own scenery, ground and town, under
//            this map's sky (Storm, Night raid)
//   land     its rules (world.js `land`)
//   home, enemy, solids, hippos   the two runways, what to fly into, and
//            where the hippos live ([x, z, y] each)
//   sky, fog [near, far], below (the ground's light), light [hemisphere,
//            sun] as shares of the Countryside's
//   enter(), leave()   anything else to set up and put back; enter() runs
//            once the map's town stands
//   start()  a new game on it: what it moves (convoy, airships) and keeps
//            (weather, wind) starts afresh, from time since then
export function useMap(id) {
  if (!MAPS[id]) id = "field";
  if (id === current) return;
  if (built[current]) {
    built[current].group?.removeFromParent();
    built[current].leave?.();
  }
  current = id;
  const m = {
    ...COUNTRY,
    ...(id === "field" ? {} : (built[id] ??= BUILD[id](kit))),
  };
  countryside.visible = id === "field" || !!m.country;
  if (m.group) scene.add(m.group);
  Object.assign(land, COUNTRY.land, m.land);
  Object.assign(HOME, m.home);
  Object.assign(EB, m.enemy);
  setSolids(m.solids);
  placeHippos(m.hippos);
  scene.background.setHex(m.sky);
  scene.fog.color.setHex(m.sky);
  [scene.fog.near, scene.fog.far] = m.fog;
  hemi.groundColor.setHex(m.below);
  hemi.intensity = LIGHT[0] * m.light[0];
  sun.intensity = LIGHT[1] * m.light[1];
  buildTargets();
  m.enter?.();
}

// A new game on the map in play (game.js startGame, once its targets and
// the player are placed).
export function startMap() {
  if (current !== "field") built[current]?.start?.();
}

// mulberry32: a small, good, seeded generator.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Flat decals merged into one mesh: [x, z] centres, each w × d.
function decals(at, w, d, color, off, y) {
  const gs = at.map(([x, z]) =>
    new THREE.PlaneGeometry(w, d).rotateX(-PI / 2).translate(x, y, z),
  );
  const m = new THREE.Mesh(
    mergeGeometries(gs),
    new THREE.MeshLambertMaterial({
      color,
      polygonOffset: true,
      polygonOffsetFactor: off,
      polygonOffsetUnits: off,
    }),
  );
  for (const g of gs) g.dispose();
  return m;
}

// The home and enemy airfields' dressing, where the Countryside has it (so
// its solids, COUNTRY_SOLIDS, are where they stand).
function dressing(into) {
  hangar(-110, -60, 0x2fc6d6, false, into);
  hangar(-150, -95, 0x2fc6d6, false, into);
  put(into, box(6, 16, 6, 0xd9d2c0), 140, 8, -55);
  put(into, box(9, 4, 9, 0x55ffff), 140, 18, -55);
  hangar(EB.x - 120, -70, 0xb03aa0, false, into);
  hangar(EB.x + 120, -70, 0xb03aa0, false, into);
}

// Fire an enemy round from `from` at the player, leading them, if they are
// within `range` (m) and alive and solid: a map's flak. Returns whether it
// fired. `spread` is the aim's scatter (rad). Never past a round's reach
// (weapons.js: 1.4 s at 480 m/s), less a little: a shot that cannot get
// there is only noise, and a warning of nothing.
const flakTv = new THREE.Vector3(),
  REACH = 480 * 1.4 - 20;
export function flakAt(from, range = 600, spread = 0.03) {
  if (!P.alive || P.ghost || game.state !== "play") return false;
  const d = from.distanceTo(P.pos);
  if (d > range) return false;
  // Where it aims, leading the plane: that is where the round must reach.
  const v = 480,
    dir = flakTv
      .copy(P.pos)
      .addScaledVector(P.vel, d / v)
      .sub(from);
  if (dir.length() > REACH) return false;
  dir.normalize();
  dir.x += (Math.random() - 0.5) * spread * 2;
  dir.y += (Math.random() - 0.5) * spread * 2;
  dir.z += (Math.random() - 0.5) * spread * 2;
  // fire() copies both, so a scratch vector will do.
  fire(from, dir.normalize(), v, "e");
  sfx.egun(camera.position.distanceTo(from));
  return true;
}

// A target's real shape (world.js makeTarget's `hit`), from parts in its
// own frame (built along x, its origin where it stands): boxes [x0, x1, y0,
// y1, z0, z1], and a box with a seventh number narrows to a point at x1 (a
// bow), at that height. `round(x, y, z, pad)`, if given, is any other part.
// A point is turned into that frame by the target's heading, and a wreck's
// squash (world.js wreck) is allowed for.
export function shape(parts, round = null) {
  return (t, p, pad = 0) => {
    const a = t.g.rotation.y,
      c = Math.cos(a),
      s = Math.sin(a),
      dx = p.x - t.x,
      dz = p.z - t.z,
      x = dx * c - dz * s,
      z = dx * s + dz * c,
      sy = t.g.scale.y || 1,
      y = p.y - t.y;
    for (let i = 0; i < parts.length; i++) {
      const b = parts[i];
      if (x < b[0] - pad || x > b[1] + pad) continue;
      let y0 = b[2],
        y1 = b[3],
        z0 = b[4],
        z1 = b[5];
      if (b.length > 6) {
        const f = Math.min(1, Math.max(0, (x - b[0]) / (b[1] - b[0]))),
          zc = (z0 + z1) / 2;
        y0 += (b[6] - y0) * f;
        y1 += (b[6] - y1) * f;
        z0 += (zc - z0) * f;
        z1 += (zc - z1) * f;
      }
      if (
        y > y0 * sy - pad &&
        y < y1 * sy + pad &&
        z > z0 - pad &&
        z < z1 + pad
      )
        return true;
    }
    return round ? round(x, y / sy, z, pad) : false;
  };
}

// What every map's builder is given (maps/*.js): the shared pieces.
export const kit = {
  THREE,
  seeded,
  decals,
  avoider,
  water,
  carrier,
  foam,
  dressing,
  runway,
  hangar,
  flakAt,
  shape,
  scene,
  camera,
  sfx,
  M,
  box,
  put,
  flat,
  COUNTRY,
  land,
  targets,
  crash,
  CX,
  P,
  say,
  puff,
  boom,
};

const BUILD = { city, sea, ...MORE };

// A flyer about to fly into something (a tower, a mountain) turns for the
// clearest way round it, the one nearest where it was going. Under a
// ceiling none climbs into the cloud; without one, a flyer also climbs to
// get over. `to` is where it wants to go (ai.js), changed in place. `top`,
// if given, is the highest the ground reaches: a flyer well above it has
// nothing to look out for. `wide` (m), if given, is room kept either side
// of its path, and it will not turn back into what it is going round while
// the way it wants to go is still blocked: for something long that a flyer
// closes on at a shallow angle (an airship's hull), which a single line
// ahead sees too late. It runs for every flyer every frame, so it
// allocates nothing.
const TURNS = [0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4],
  TURN_C = TURNS.map(Math.cos),
  TURN_S = TURNS.map(Math.sin);
function avoider(height, ceil, top = Infinity, wide = 0, boxes = null) {
  // How far along a probe (from x, y, z, d m a metre along x and z, r up)
  // it meets one of `boxes` ([x0, x1, y0, y1, z0, z1], grown 25 m up and
  // down as the ground is): exactly, where the probe's steps could pass
  // between two samples across a thin hull. 0 if it doesn't within 240 m.
  const boxed = (x, y, z, dx, dz, r) => {
    let best = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      let lo = 0,
        hi = 240;
      for (let a = 0; a < 3; a++) {
        const p = a === 0 ? x : a === 1 ? y : z,
          d = a === 0 ? dx : a === 1 ? r : dz,
          m0 = a === 1 ? b[2] - 25 : b[a * 2],
          m1 = a === 1 ? b[3] + 25 : b[a * 2 + 1];
        if (Math.abs(d) < 1e-9) {
          if (p < m0 || p > m1) lo = Infinity;
          continue;
        }
        const t0 = (m0 - p) / d,
          t1 = (m1 - p) / d;
        lo = Math.max(lo, Math.min(t0, t1));
        hi = Math.min(hi, Math.max(t0, t1));
      }
      if (lo <= hi && (!best || lo < best)) best = Math.max(lo, 1);
    }
    return best;
  };
  // How far along (dx, dz), `o` m to its left, the ground rises into the
  // way; 0 if it doesn't within 240 m. Careful (`wide`), it asks about the
  // height the flyer will be at there, from `y0` climbing or diving `r` m a
  // metre, and 25 m above that, so open air under a hull is open.
  const line = (pos, dx, dz, o, r, y0 = pos.y) => {
    const x = pos.x - dz * o,
      z = pos.z + dx * o,
      b = boxes ? boxed(x, y0, z, dx, dz, r) : 0;
    for (let s = 30; s <= 240; s += 30) {
      if (b && b <= s) return b;
      const y = y0 + r * s;
      if (height(x + dx * s, z + dz * s, wide ? y + 25 : Infinity) > y - 25)
        return s;
    }
    return b;
  };
  // The nearest of the lines along (dx, dz): the middle one, and careful,
  // those either side, each at both slopes (r1, r2: the flyer's climb now
  // and the one it wants), from height y0.
  const ahead = (pos, dx, dz, r1, r2, y0 = pos.y) => {
    let n = 0;
    for (let i = 0; i < (wide ? 6 : 1); i++) {
      const o = i < 2 ? 0 : i < 4 ? wide : -wide,
        m = line(pos, dx, dz, o, i & 1 ? r2 : r1, y0);
      if (m && (!n || m < n)) n = m;
    }
    return n;
  };
  return (pos, f, to) => {
    const l = Math.hypot(f.x, f.z) || 1,
      fx = f.x / l,
      fz = f.z / l,
      tl = Math.hypot(to.x, to.z) || 1,
      rNow = wide ? f.y / l : 0,
      rWant = wide ? Math.max(-0.7, Math.min(0.7, to.y / tl)) : 0,
      low = pos.y - 25 + Math.min(0, rNow * 240, rWant * 240) < top,
      now = low ? ahead(pos, fx, fz, rNow, rWant) : 0,
      // Careful, the way it wants to go too, at the climb it wants.
      want =
        !now && wide && low
          ? ahead(pos, to.x / tl, to.z / tl, rWant, rWant)
          : 0;
    // Careful: if the way that is blocked is clear 40 m lower, level, what
    // blocks it can be flown under (a hull, from beside its keel): it holds
    // that way, and dives.
    if (now || want) {
      const ux = now ? fx : to.x / tl,
        uz = now ? fz : to.z / tl;
      // Only an obstacle at the flyer's own height counts: a probe that
      // meets the street on its way down is no hull to dive under.
      if (
        wide &&
        ahead(pos, ux, uz, 0, 0) &&
        !ahead(pos, ux, uz, 0, 0, pos.y - 40)
      ) {
        const L = Math.max(200, tl);
        to.set(ux * L, Math.min(to.y, -L * 0.4), uz * L);
        return;
      }
    }
    if (now || want) {
      let bx = fx,
        bz = fz,
        score = -Infinity,
        // The nearest thing a turn to each side sweeps across on its way.
        // (Straight ahead is on neither side: it vetoes neither turn.)
        nearL = Infinity,
        nearR = Infinity,
        near = now || Infinity;
      // Straight on (if it is clear: the way it wants is what is blocked),
      // then each turn, smallest first each side.
      for (let k = wide ? -1 : 0; k < TURNS.length; k++) {
        const c = k < 0 ? 1 : TURN_C[k],
          s = k < 0 ? 0 : TURN_S[k],
          dx = fx * c - fz * s,
          dz = fx * s + fz * c,
          hit = ahead(pos, dx, dz, rNow, rWant);
        let v = hit ? hit / 1000 : 1 + (dx * to.x + dz * to.z) / tl;
        if (wide && k >= 0) {
          // Careful: a clear way that is reached without sweeping across
          // anything close comes first, so a flyer turns away from a hull
          // beside it rather than through it.
          const swept = s > 0 ? nearL : nearR;
          if (!hit && swept > 120) v += 3;
          if (hit) {
            if (s > 0) nearL = Math.min(nearL, hit);
            else nearR = Math.min(nearR, hit);
            near = Math.min(near, hit);
          }
        }
        if (v > score) {
          score = v;
          bx = dx;
          bz = dz;
        }
      }
      const L = Math.max(200, tl),
        // Close, with no clear way: over it, hard.
        climb = wide && near < 90 && score < 1 ? 1.2 : 0.4;
      to.set(
        bx * L,
        ceil ? Math.min(to.y, 0) : Math.max(to.y, L * climb),
        bz * L,
      );
    }
    if (ceil && pos.y > ceil - 70)
      to.y = Math.min(to.y, -Math.hypot(to.x, to.z) * 0.15);
  };
}

// ════════════════════════════════════════════════════════════════════════════
// The City: a grid of towers, most too tall to clear, under a solid cloud
// ceiling. A wide boulevard runs between the airfields along z = 0, with the
// enemy town on its median, as the Countryside's lane has it.
// ════════════════════════════════════════════════════════════════════════════
const TOWER = [
  0xd9d4c7, 0xbfc7cf, 0xe6d2b0, 0xa9b8c4, 0xcfc0d8, 0xc8d6cf, 0xe0c8bd,
];

function city() {
  const rand = seeded(1984),
    rnd = (a, b) => a + rand() * (b - a);
  const { pitch, block, ceil } = CITY;
  const group = new THREE.Group();
  const home = COUNTRY.home,
    enemy = COUNTRY.enemy;

  // Windows: one tile, repeated along and up every face. (No 2D canvas
  // under the tests: plain walls then.)
  let tex = null;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 32;
  const c2 = cv.getContext("2d");
  if (c2) {
    c2.fillStyle = "#ffffff";
    c2.fillRect(0, 0, 32, 32);
    c2.fillStyle = "#56677a";
    c2.fillRect(5, 7, 22, 17);
    c2.fillStyle = "#7d90a5";
    c2.fillRect(5, 7, 22, 5);
    tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
  }
  const mats = TOWER.map(
    (color) => new THREE.MeshLambertMaterial({ color, map: tex }),
  );

  // The towers, block by block. `cells` finds the few in a block quickly:
  // a point in a street belongs to the nearest block, which holds no tower
  // reaching it.
  const towers = [],
    cells = new Map(),
    pave = [],
    parks = [];
  const key = (bx, bz) => (bx + 100) * 1000 + bz + 100;
  for (let bx = -8; bx <= 20; bx++)
    for (let bz = -14; bz <= 14; bz++) {
      const x = bx * pitch,
        z = bz * pitch;
      if (bz === 0) continue; // the boulevard
      if (
        Math.abs(z) < 260 &&
        (Math.abs(x - home.x) < 420 || Math.abs(x - enemy.x) < 420)
      )
        continue; // parkland round the airfields
      const park = rand() < 0.1 || (bx === 4 && bz === 2);
      (park ? parks : pave).push([x, z]);
      if (park) continue;
      const dist = Math.hypot(x - CX, z) / 2600,
        n = 1 + ((rand() * 3) | 0),
        slots =
          n === 1
            ? [[0, 0]]
            : n === 2
              ? [
                  [-35, 0],
                  [35, 0],
                ]
              : [
                  [-35, -35],
                  [35, -35],
                  [0, 35],
                ];
      const here = [];
      for (const [sx, sz] of slots) {
        const w = n === 1 ? rnd(80, 120) : rnd(50, 64),
          d = n === 1 ? rnd(70, 120) : rnd(50, 64),
          tall = rand() < 0.75 - dist * 0.4,
          // Round the enemy field, where its flyers patrol a 420 m ring at
          // 180 m, the towers stay low enough for them to pass over.
          ring = Math.abs(x + sx - enemy.x) < 560 && Math.abs(z + sz) < 560,
          h = Math.min(
            ring ? 140 : Infinity,
            tall
              ? rnd(180, 460) * Math.max(0.6, 1.1 - dist * 0.5)
              : rnd(40, 110),
          );
        const t = {
          x: x + sx,
          z: z + sz,
          hx: w / 2,
          hz: d / 2,
          h,
          mat: (rand() * TOWER.length) | 0,
          gone: false,
        };
        towers.push(t);
        here.push(t);
      }
      cells.set(key(bx, bz), here);
    }

  const height = (x, z) => {
    const c = cells.get(key(Math.round(x / pitch), Math.round(z / pitch)));
    let y = 0;
    if (c)
      for (const t of c)
        if (
          !t.gone &&
          t.h > y &&
          Math.abs(x - t.x) < t.hx &&
          Math.abs(z - t.z) < t.hz
        )
          y = t.h;
    return y;
  };

  // One mesh per tower colour, and one for the plant on the roofs; drawn
  // again when a team game clears room for its fields.
  let drawn = [];
  function drawTowers() {
    for (const m of drawn) {
      group.remove(m);
      m.geometry.dispose();
    }
    drawn = [];
    const byMat = mats.map(() => []),
      roofs = [];
    for (const t of towers) {
      if (t.gone) continue;
      const g = new THREE.BoxGeometry(t.hx * 2, t.h, t.hz * 2),
        uv = g.attributes.uv;
      // Faces +x, −x, +y, −y, +z, −z, four corners each: a window every
      // 7 m along and 5 m up; the roof and floor take a plain corner.
      for (let f = 0; f < 6; f++) {
        const along = f < 2 ? t.hz * 2 : f >= 4 ? t.hx * 2 : 0;
        for (let v = f * 4; v < f * 4 + 4; v++)
          if (!along) uv.setXY(v, 0.05, 0.05);
          else
            uv.setXY(
              v,
              uv.getX(v) * Math.max(1, Math.round(along / 7)),
              uv.getY(v) * Math.max(1, Math.round(t.h / 5)),
            );
      }
      byMat[t.mat].push(g.translate(t.x, t.h / 2, t.z));
      roofs.push(
        new THREE.BoxGeometry(t.hx, 4, t.hz * 0.8).translate(t.x, t.h + 2, t.z),
      );
    }
    byMat.forEach((gs, i) => {
      if (!gs.length) return;
      drawn.push(
        put(group, new THREE.Mesh(mergeGeometries(gs), mats[i]), 0, 0, 0),
      );
      for (const g of gs) g.dispose();
    });
    drawn.push(
      put(group, new THREE.Mesh(mergeGeometries(roofs), M(0x7b7d82)), 0, 0, 0),
    );
    for (const g of roofs) g.dispose();
  }
  drawTowers();

  // The ground: streets everywhere, pavement and parks on the blocks.
  put(group, flat(14000, 14000, 0x4d5157, -1), CX, 0, 0);
  group.add(decals(pave, block + 14, block + 14, 0x8c8a84, -2, 0.1));
  group.add(decals(parks, block + 14, block + 14, 0x5f9a40, -2, 0.1));
  for (const R of [home, enemy])
    put(group, flat(860, 540, 0x6ea648, -2), R.x, 0.08, 0);
  runway(home, 0x55ffff, group);
  runway(enemy, 0xff55ff, group);
  dressing(group);
  // The boulevard's grass median, where the town stands, and its lanes.
  put(group, flat(enemy.x - home.x - 500, 70, 0x5f9a40, -3), CX, 0.12, 0);
  const dash = [];
  for (let x = home.x + 450; x < enemy.x - 250; x += 30)
    dash.push([x, -70], [x, 70]);
  group.add(decals(dash, 12, 1, 0xf4f1e6, -4, 0.13));
  // A pond in the park the hippos live in.
  put(group, flat(70, 50, 0x3a8cc4, -3), 920, 0.15, 460);

  // The ceiling: a solid overcast, ragged underneath.
  const deck = new THREE.Mesh(
    new THREE.PlaneGeometry(14000, 14000),
    new THREE.MeshBasicMaterial({ color: 0xaab4be, side: THREE.DoubleSide }),
  );
  deck.rotation.x = -PI / 2;
  put(group, deck, CX, ceil + 25, 0);
  const puffs = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    M(0xd0d7de),
    700,
  );
  puffs.material.emissive.setHex(0x5d646c);
  const mx = new THREE.Matrix4(),
    at = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    sc = new THREE.Vector3();
  for (let i = 0; i < 700; i++) {
    at.set(rnd(CX - 3600, CX + 3600), ceil + rnd(0, 18), rnd(-3600, 3600));
    sc.set(rnd(40, 90), rnd(14, 26), rnd(40, 90));
    puffs.setMatrixAt(i, mx.compose(at, q, sc));
  }
  group.add(puffs);

  // Streets are narrow for a plane, so City flyers turn twice as hard
  // (`agile`).
  const avoid = avoider(height, ceil, Infinity, 10);

  // A team game: room cleared round each team's field (whole blocks of
  // towers put away), a park, its runway and its hangar. The ground (`gone`)
  // changes at once; the towers are drawn again once, when the game starts
  // (or its first frame), not once a field: that is half a second for eight.
  let stale = false;
  function field(f, c) {
    for (const t of towers)
      if (Math.abs(t.x - f.x) < f.hl + 260 && Math.abs(t.z - f.z) < 260)
        t.gone = stale = true;
    put(f.g, flat(f.hl * 2 + 400, 460, 0x6ea648, -3), 0, 0.12, 0);
    runway({ x: 0, z: 0, hl: f.hl, hw: f.hw }, c.plane[2], f.g);
    hangar(-120, -70, c.plane[1], false, f.g);
    return [{ x: f.x - 120, z: f.z - 70, r: 17, h: 12.5 }];
  }
  function settle() {
    if (!stale) return;
    stale = false;
    drawTowers();
  }
  // The fields gone: the ground at once, the towers drawn when the map is
  // next shown or played (enter, start), which a rematch's new fields may
  // change again first.
  function unfield() {
    if (!towers.some((t) => t.gone)) return;
    for (const t of towers) t.gone = false;
    stale = true;
  }

  return {
    group,
    towers,
    land: {
      height,
      floor: () => 0,
      crash: (p) =>
        height(p.x, p.z) > 0
          ? "Flew into a tower"
          : "Crashed — land on a runway",
      ceil,
      dust: 0x9a968c,
      avoid,
      agile: 2,
      town: TDEF,
      field,
      unfield,
      tick: settle,
    },
    enter: settle,
    start: settle,
    home,
    enemy,
    solids: COUNTRY_SOLIDS,
    hippos: [
      [900, 432, 0],
      [950, 490, 0],
      [925, 460, -1.4],
    ],
    sky: 0xa9bccb,
    fog: [500, 3000],
    below: 0x5a5d62,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// The Sea: open water, an anchored carrier for each side whose flight deck
// is its runway, and the enemy fleet to bomb where the town was. A few
// islands; hippos wallow off one of them.
// ════════════════════════════════════════════════════════════════════════════
// Large islands, each a cluster of peaks ([dx, dz, radius, height]): ridges
// and mountains to fly over, round and through. They keep clear of the
// lane the carriers and the fleet lie on, and of the ring the team
// carriers stand round (net/teams.js RING, 1900 m about CX, give or take a
// deck): the inner two lie inside it, the rest outside.
const BIG = [
  {
    x: 1400,
    z: 950,
    peaks: [
      [0, 0, 320, 170],
      [-160, 60, 200, 120],
      [150, -40, 220, 140],
    ],
  },
  {
    x: 1450,
    z: -1000,
    peaks: [
      [0, 0, 340, 240],
      [180, 80, 200, 150],
      [-200, -60, 220, 110],
    ],
  },
  {
    x: 1300,
    z: 2950,
    peaks: [
      [0, 0, 450, 320],
      [-300, 100, 300, 200],
      [280, -60, 320, 230],
    ],
  },
  {
    x: 1500,
    z: -3000,
    peaks: [
      [0, 0, 420, 280],
      [320, 40, 280, 180],
      [-260, -80, 300, 200],
    ],
  },
  {
    x: -1300,
    z: 1700,
    peaks: [
      [0, 0, 380, 260],
      [200, -150, 260, 160],
    ],
  },
  {
    x: 4200,
    z: -1700,
    peaks: [
      [0, 0, 400, 300],
      [-150, 220, 260, 180],
    ],
  },
  {
    x: 4250,
    z: 1750,
    peaks: [
      [0, 0, 360, 220],
      [160, -180, 240, 150],
    ],
  },
];
for (const b of BIG)
  b.reach = Math.max(...b.peaks.map(([dx, dz, r]) => Math.hypot(dx, dz) + r));
// The ground's height runs many times a frame (every flyer looks ahead
// along eight lines), so these are plain loops that allocate nothing.
//
// A big island's ground: the highest of its peaks' smooth cones, less a
// little, so the coast is a gentle beach; 0 is the sea.
function bigHeight(b, x, z) {
  let h = 0;
  for (let i = 0; i < b.peaks.length; i++) {
    const k = b.peaks[i],
      f = 1 - Math.hypot(x - b.x - k[0], z - b.z - k[1]) / k[2];
    if (f > 0) h = Math.max(h, k[3] * f * f * (3 - 2 * f));
  }
  return Math.max(0, h - 2);
}
// The big island whose ground (x, z) is, or null; and that ground.
function bigAt(x, z) {
  for (let i = 0; i < BIG.length; i++) {
    const b = BIG[i];
    if (
      Math.abs(x - b.x) < b.reach &&
      Math.abs(z - b.z) < b.reach &&
      bigHeight(b, x, z) > 0
    )
      return b;
  }
  return null;
}
function bigGround(x, z) {
  for (let i = 0; i < BIG.length; i++) {
    const b = BIG[i];
    if (Math.abs(x - b.x) < b.reach && Math.abs(z - b.z) < b.reach) {
      const h = bigHeight(b, x, z);
      if (h > 0) return h;
    }
  }
  return 0;
}

// The small islands, [x, z, r]: a sand bar, a frustum of 9 sides from r at
// its foot (y −2.5) to 0.75 r on top (y 3.5), and on it a hill of 7 sides,
// 0.6 r across its foot to 0.15 r on top, 0.35 r high: the meshes sea()
// draws, so the ground is where they are.
const ISLES = [
  [1050, 380, 90],
  [520, -620, 60],
  [2100, 700, 120],
  [3700, -900, 80],
  [-700, 600, 70],
];
const SAND = { top: 3.5, foot: -2.5, sides: 9, hill: 7 },
  // Where the sand's slope meets the water, as a share of r.
  SHORE = 0.75 + 0.25 * (SAND.top / (SAND.top - SAND.foot));
// How far (dx, dz) is from the axis of a CylinderGeometry of `n` sides,
// scaled so its sides are at their corners' radius: a polygon's own
// distance, which a circle's would overstate between the corners. Three
// puts corner k at atan2(x, z) = 2πk/n.
function sideDist(dx, dz, n) {
  const e = Math.hypot(dx, dz);
  if (!e) return 0;
  const k = (2 * PI) / n,
    a = Math.atan2(dx, dz),
    off = a - k * (Math.floor(a / k) + 0.5);
  return (e * Math.cos(off)) / Math.cos(PI / n);
}
// The island under (x, z), or null.
function isleAt(x, z) {
  for (let i = 0; i < ISLES.length; i++) {
    const I = ISLES[i],
      dx = x - I[0],
      dz = z - I[1];
    if (
      Math.abs(dx) < I[2] &&
      Math.abs(dz) < I[2] &&
      sideDist(dx, dz, SAND.sides) < I[2] * SHORE
    )
      return I;
  }
  return null;
}
function isleGround(I, x, z) {
  const dx = x - I[0],
    dz = z - I[1],
    r = I[2],
    s = sideDist(dx, dz, SAND.sides) / r;
  if (s > 0.75)
    return Math.max(0, SAND.top - ((SAND.top - SAND.foot) * (s - 0.75)) / 0.25);
  if (Math.hypot(dx, dz) >= r * 0.6) return SAND.top;
  const u = sideDist(dx, dz, SAND.hill) / r;
  return u >= 0.6
    ? SAND.top
    : SAND.top + r * 0.35 * Math.min(1, (0.6 - u) / 0.45);
}
// The fleet, where the Countryside's town stands: [kind, x, side, z].
const FLEET = [
  ["destroyer", 850, null, -40],
  ["cargo", 1200, null, 30],
  ["destroyer", 1550, null, 50],
  ["patrol", 1750, null, -60],
  ["cargo", 1900, null, -30],
  ["destroyer", 2200, null, 20],
  ["destroyer", 3250, null, -60],
  ["patrol", 3450, null, 40],
];
const HULL = 0x8a919c,
  BOOT = 0x8a2b2b,
  FOAM = 0xd8ecf5;

// The island on the deck's starboard side, as ground: [dx, dz, half-x,
// half-z, height above the deck].
const ISLAND = [20, 17, 17, 4.5, 26];

// Open water to the horizon, faceted, each triangle its own shade of blue
// (from `pal`), gently rolling, its surface just under y = 0.
export function water(
  into,
  rand,
  pal = [0x2a6fa8, 0x2f78b0, 0x2868a2, 0x3380b8, 0x2c73ab],
) {
  const g = new THREE.PlaneGeometry(14000, 14000, 120, 120).toNonIndexed(),
    p = g.attributes.position;
  for (let i = 0; i < p.count; i++)
    p.setZ(i, Math.sin(p.getX(i) * 0.02) * Math.cos(p.getY(i) * 0.017));
  const cs = pal.map((c) => new THREE.Color(c)),
    col = new Float32Array(p.count * 3);
  for (let t = 0; t < p.count / 3; t++) {
    const c = cs[(rand() * cs.length) | 0];
    for (let k = 0; k < 3; k++) c.toArray(col, (t * 3 + k) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(
    g,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  m.rotation.x = -PI / 2;
  return put(into, m, CX, -1.2, 0);
}

// A carrier, its deck centred on the origin and along x, top at SEA.deck.
function carrier(trim, roof) {
  const g = new THREE.Group(),
    D = SEA.deck;
  put(g, box(250, 16, 34, HULL), -5, D - 10, 0);
  put(g, box(250, 1.2, 34.2, BOOT), -5, -1.2, 0);
  const bow = new THREE.Mesh(new THREE.CylinderGeometry(0, 17, 30, 3), M(HULL));
  bow.rotation.set(PI / 2, 0, -PI / 2);
  bow.scale.set(1, 1, 0.75);
  put(g, bow, 135, D - 10, 0);
  put(g, box(270, 2, 42, 0x5c626d), 0, D - 2.5, 0);
  put(g, box(SEA.hl * 2, 1, SEA.hw * 2, 0x3d4148), 0, D - 0.5, 0);
  for (let x = -120; x < 130; x += 22)
    put(g, box(11, 0.1, 1, 0xf4f1e6), x, D + 0.05, 0);
  for (const s of [-1, 1])
    put(g, box(SEA.hl * 2 - 10, 0.1, 0.6, 0xf4f1e6), 0, D + 0.05, s * 19);
  // the arrester wires, at the stern
  for (let i = 0; i < 4; i++)
    put(g, box(0.4, 0.3, 36, 0xdddddd), -115 + i * 9, D + 0.15, 0);
  // edge lights in the side's colour, as a runway's
  for (let x = -SEA.hl; x <= SEA.hl; x += 20)
    for (const s of [-1, 1])
      put(g, box(1, 0.7, 1, trim), x, D + 0.35, s * (SEA.hw + 0.5));
  // the island and its mast
  const [ix, iz, hx, hz, ih] = ISLAND;
  put(g, box(hx * 2, 18, hz * 2, 0x9aa1ac), ix, D + 9, iz);
  put(g, box(18, 7, 8, 0x8f96a2), ix + 2, D + 21.5, iz);
  put(g, box(20, 1.2, 10, roof), ix + 2, D + ih - 0.6, iz);
  put(g, box(1, 16, 1, 0xdedede), ix + 4, D + ih + 8, iz);
  put(g, box(8, 1, 1, 0xdedede), ix + 4, D + ih + 13, iz);
  put(g, box(5, 3, 0.15, trim), ix + 7, D + ih + 14.5, iz);
  // a wash of foam round the hull
  g.add(foam(300, 54));
  return g;
}
function foam(w, d) {
  const m = flat(w, d, FOAM, -3);
  m.material.transparent = true;
  m.material.opacity = 0.35;
  m.material.depthWrite = false;
  m.position.y = -0.3;
  return m;
}

// The ships' shapes, as they are built below: a destroyer's bow runs out
// to 53 m and its stern to 40, a cargo ship's hull to 45, past their r.
const SHAPE = {
  destroyer: shape([
    [-40, 40, -2, 6, -6, 6],
    [40, 53, -5.2, 5.6, -5.2, 5.2, 2],
    [-9, 13, 6, 12, -4.5, 4.5],
    [1.5, 10.5, 12, 16, -3.5, 3.5],
    [0.5, 11.5, 16, 17, -4, 4],
    [-14.3, -9.7, 7.5, 16.5, -2.3, 2.3],
    [25.5, 30.5, 6, 9, -2.5, 2.5],
    [-32.5, -27.5, 6, 9, -2.5, 2.5],
    [29, 37, 7.6, 8.4, -0.4, 0.4],
    [-39, -31, 7.6, 8.4, -0.4, 0.4],
    [3.6, 4.4, 17, 27, -0.4, 0.4],
  ]),
  cargo: shape([
    [-45, 45, -2, 8, -10, 10],
    [-43, -29, 8, 22, -9, 9],
    [-44, -28, 22, 23, -10, 10],
    // the stacks of containers, one to three high
    ...Array.from({ length: 15 }, (_, k) => {
      const i = (k / 3) | 0,
        j = k % 3,
        x = -18 + i * 12.5,
        z = -6.5 + j * 6.5;
      return [x - 5.5, x + 5.5, 8, 11.2 + ((i + j) % 3) * 3.3, z - 3, z + 3];
    }),
  ]),
  patrol: shape([
    [-14, 14, -1, 3, -3.5, 3.5],
    [-6, 2, 3, 7, -2.5, 2.5],
    [-6.5, 2.5, 7, 7.6, -3, 3],
    [7.5, 10.5, 3, 5, -1.5, 1.5],
  ]),
};

// The fleet's ships, as targets (world.js makeTarget): each builds into `g`,
// along x, and gives its numbers. Magenta marks them as the enemy's.
const SHIPS = {
  destroyer(g) {
    const c = 0x7b7f88;
    put(g, box(80, 8, 12, c), 0, 2, 0);
    const bow = new THREE.Mesh(new THREE.CylinderGeometry(0, 6, 14, 3), M(c));
    bow.rotation.set(PI / 2, 0, -PI / 2);
    bow.scale.set(1, 1, 1.2);
    put(g, bow, 46, 2, 0);
    put(g, box(80, 1, 12.2, BOOT), 0, -1.6, 0);
    put(g, box(22, 6, 9, 0x8a8e96), 2, 9, 0);
    put(g, box(9, 4, 7, 0x8a8e96), 6, 14, 0);
    put(g, box(11, 1, 8, 0xb03aa0), 6, 16.5, 0);
    put(
      g,
      new THREE.Mesh(new THREE.CylinderGeometry(2, 2.3, 9, 8), M(0x4a4a50)),
      -12,
      12,
      0,
    );
    for (const gx of [28, -30]) {
      put(g, box(5, 3, 5, 0x6a6e76), gx, 7.5, 0);
      put(g, box(8, 0.7, 0.7, 0x3a3a40), gx + Math.sign(gx) * 5, 8, 0);
    }
    put(g, box(0.8, 10, 0.8, 0xdedede), 4, 22, 0);
    put(g, box(4, 2.4, 0.12, 0xff55ff), 6, 25.5, 0);
    g.add(foam(96, 20));
    return {
      r: 28,
      h: 14,
      hp: 8,
      pts: 250,
      name: "Destroyer",
      hit: SHAPE.destroyer,
    };
  },
  cargo(g) {
    put(g, box(90, 10, 20, 0x2e4a6b), 0, 3, 0);
    put(g, box(90, 1, 20.2, BOOT), 0, -1.6, 0);
    put(g, box(14, 14, 18, 0xe8e4da), -36, 15, 0);
    put(g, box(16, 1, 20, 0xb03aa0), -36, 22.5, 0);
    const cc = [0xd94f3a, 0x3a7fd9, 0xe0b23a, 0x3aa86a, 0xb03aa0, 0xdedede];
    let k = 0;
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 3; j++)
        for (let l = 0; l < 1 + ((i + j) % 3); l++)
          put(
            g,
            box(11, 3.2, 6, cc[k++ % cc.length]),
            -18 + i * 12.5,
            9.6 + l * 3.3,
            -6.5 + j * 6.5,
          );
    g.add(foam(104, 28));
    return {
      r: 32,
      h: 14,
      hp: 6,
      pts: 200,
      name: "Cargo ship",
      hit: SHAPE.cargo,
    };
  },
  patrol(g) {
    put(g, box(28, 4, 7, 0x8a8e96), 0, 1, 0);
    put(g, box(8, 4, 5, 0x9aa0a8), -2, 5, 0);
    put(g, box(9, 0.6, 6, 0xb03aa0), -2, 7.3, 0);
    put(g, box(3, 2, 3, 0x5a5e66), 9, 4, 0);
    g.add(foam(38, 12));
    return {
      r: 13,
      h: 7.5,
      hp: 3,
      pts: 100,
      name: "Patrol boat",
      hit: SHAPE.patrol,
    };
  },
};

function sea() {
  const rand = seeded(1805),
    rnd = (a, b) => a + rand() * (b - a);
  const group = new THREE.Group();
  const home = { ...COUNTRY.home, hl: SEA.hl, hw: SEA.hw },
    enemy = { ...COUNTRY.enemy, hl: SEA.hl, hw: SEA.hw };

  water(group, rand);

  // The carriers: the two sides', and in a team game each team's.
  const decks = [home, enemy];
  for (const [R, trim, roof] of [
    [home, 0x55ffff, 0x2fc6d6],
    [enemy, 0xff55ff, 0xb03aa0],
  ])
    put(group, carrier(trim, roof), R.x, 0, R.z);

  // Islands: a sand bar, a green hill (as ISLES has them), palms.
  for (const [x, z, r] of ISLES) {
    const { top, foot, sides, hill } = SAND;
    put(
      group,
      new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.75, r, top - foot, sides),
        M(0xe3cf8f),
      ),
      x,
      (top + foot) / 2,
      z,
    );
    put(
      group,
      new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.15, r * 0.6, r * 0.35, hill),
        M(0x5f9a40),
      ),
      x,
      top + r * 0.175,
      z,
    );
    for (let i = 0; i < Math.round(r / 12); i++) {
      const a = rnd(0, PI * 2),
        d = rnd(r * 0.62, r * 0.72),
        px = x + Math.cos(a) * d,
        pz = z + Math.sin(a) * d,
        h = rnd(10, 16);
      put(group, box(0.8, h, 0.8, 0x7a5a3a), px, 3 + h / 2, pz).rotation.z =
        rnd(-0.2, 0.2);
      for (let k = 0; k < 5; k++) {
        const ay = (k / 5) * PI * 2,
          leaf = put(
            group,
            box(7, 0.3, 1.6, 0x3d8a35),
            px + Math.cos(ay) * 3,
            3 + h,
            pz - Math.sin(ay) * 3,
          );
        leaf.rotation.set(0, ay, -0.35);
      }
    }
  }

  // The large islands: one faceted mesh each, shaded by height (beach,
  // grass, rock, and bare rock on the high peaks), wooded on the lower
  // slopes.
  const SHADE = [
    [6, [0xe3cf8f, 0xd9c37f]],
    [80, [0x5f9a40, 0x6ea648, 0x528a36]],
    [180, [0x77904a, 0x8a8a6a, 0x7d8a58]],
    [Infinity, [0x9a9180, 0x8a8478, 0xa8a090]],
  ];
  const woods = [];
  for (const b of BIG) {
    const size = b.reach * 2 + 40,
      n = Math.round(size / 24),
      g = new THREE.PlaneGeometry(size, size, n, n).toNonIndexed(),
      p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const h = bigHeight(b, b.x + p.getX(i), b.z - p.getY(i));
      p.setZ(i, h > 0 ? h : -6);
    }
    const col = new Float32Array(p.count * 3),
      c = new THREE.Color();
    for (let t = 0; t < p.count / 3; t++) {
      const h = (p.getZ(t * 3) + p.getZ(t * 3 + 1) + p.getZ(t * 3 + 2)) / 3,
        pal = SHADE.find(([top]) => h < top)[1];
      c.setHex(pal[(rand() * pal.length) | 0]);
      for (let k = 0; k < 3; k++) c.toArray(col, (t * 3 + k) * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(
      g,
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    m.rotation.x = -PI / 2;
    put(group, m, b.x, 0, b.z);
    for (let i = 0; i < 90; i++) {
      const x = b.x + rnd(-b.reach, b.reach),
        z = b.z + rnd(-b.reach, b.reach),
        h = bigHeight(b, x, z);
      if (h > 8 && h < 110) woods.push([x, h, z, rnd(1.4, 2.6)]);
    }
  }
  const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(4, 10, 6),
      M(0x3d7a35),
      woods.length,
    ),
    trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.6, 0.7, 3, 5),
      M(0x6b4a2a),
      woods.length,
    ),
    mx = new THREE.Matrix4(),
    at = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    sc = new THREE.Vector3();
  woods.forEach(([x, y, z, s], i) => {
    sc.set(s, s, s);
    crowns.setMatrixAt(i, mx.compose(at.set(x, y + 8 * s, z), q, sc));
    trunks.setMatrixAt(i, mx.compose(at.set(x, y + 1.5 * s, z), q, sc));
  });
  group.add(crowns, trunks);

  // The ground: a deck (and its island) is solid down to the water; a small
  // island is a sand bar with a hill on it; a large one, its peaks.
  function onDeck(x, z) {
    for (let i = 0; i < decks.length; i++) {
      const d = decks[i];
      if (Math.abs(x - d.x) < SEA.hl && Math.abs(z - d.z) < SEA.hw) return d;
    }
    return null;
  }
  function height(x, z) {
    const d = onDeck(x, z);
    if (d)
      return Math.abs(x - d.x - ISLAND[0]) < ISLAND[2] &&
        Math.abs(z - d.z - ISLAND[1]) < ISLAND[3]
        ? SEA.deck + ISLAND[4]
        : SEA.deck;
    const I = isleAt(x, z);
    return I ? isleGround(I, x, z) : bigGround(x, z);
  }
  // The highest any of it reaches: a flyer well above that steers freely.
  const top = Math.max(
    SEA.deck + ISLAND[4],
    ...ISLES.map(([, , r]) => SAND.top + r * 0.35),
    ...BIG.map((b) => Math.max(...b.peaks.map((k) => k[3]))),
  );
  function crash(p) {
    if (onDeck(p.x, p.z)) return "Flew into the carrier";
    if (isleAt(p.x, p.z) || bigAt(p.x, p.z)) return "Flew into an island";
    return "Ditched in the sea";
  }

  // A team game: each team's carrier, its deck the team's runway.
  function field(f, c) {
    f.hl = SEA.hl;
    f.hw = SEA.hw;
    f.g.add(carrier(c.plane[2], c.plane[1]));
    decks.push(f);
    return [];
  }

  return {
    group,
    land: {
      height,
      floor: () => 0,
      crash,
      avoid: avoider(height, 0, top),
      brake: SEA.brake,
      dust: FOAM,
      town: FLEET,
      kinds: SHIPS,
      field,
      unfield: () => {
        decks.length = 2;
      },
      // A team's flag stands on its deck, beside the island, clear of the
      // planes rolling down the middle.
      flagAt: (f) => [f.x - 60, f.z + 17],
    },
    home,
    enemy,
    solids: [],
    hippos: [
      [1010, 300, -1.6],
      [1035, 290, -1.8],
      [985, 312, -1.5],
    ],
    sky: SKY,
    fog: [900, 4200],
    below: 0x2f5f80,
  };
}
