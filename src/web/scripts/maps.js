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

// maps.js — the maps beyond the prototype's Countryside: the City and the
// Sea (constants.js MAPS, CITY, SEA).
//
// Each is built the first time it is picked, into a group that is shown
// while it is the map in play, from its own seeded random numbers: never
// Math.random, whose draws are the prototype's. useMap() swaps the scenery,
// the two runways (HOME and EB, changed in place), the solids, where the
// hippos live, the town, the sky, and plugs the map's rules into world.js
// `land`. On the Countryside every one of those is the prototype's.
//
// The trick both maps share: what stands on the ground counts as ground.
// A tower's roof or a flight deck is just higher ground to groundY, so
// planes, rounds, bombs, missiles and shadows all meet it with no new code.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PI } from "./util.js";
import { CX, HOME, EB, TDEF, SKY, MAPS, CITY, SEA } from "./constants.js";
import { scene, M, box, put, flat } from "./scene.js";
import {
  land,
  countryside,
  runway,
  hangar,
  setSolids,
  COUNTRY_SOLIDS,
  placeHippos,
  buildTargets,
} from "./world.js";

// The sky's light from below takes the ground's colour: grass on the
// Countryside, grey in the City, blue at sea.
const hemi = scene.children.find((o) => o.isHemisphereLight);

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
};

let current = "field";
const built = {};
export const mapNow = () => current;

export function useMap(id) {
  if (!MAPS[id]) id = "field";
  if (id === current) return;
  if (built[current]) built[current].group.visible = false;
  current = id;
  const m = id === "field" ? COUNTRY : (built[id] ??= BUILD[id]());
  countryside.visible = id === "field";
  if (m.group) m.group.visible = true;
  Object.assign(land, COUNTRY.land, m.land);
  Object.assign(HOME, m.home);
  Object.assign(EB, m.enemy);
  setSolids(m.solids);
  placeHippos(m.hippos);
  scene.background.setHex(m.sky);
  scene.fog.color.setHex(m.sky);
  [scene.fog.near, scene.fog.far] = m.fog;
  hemi.groundColor.setHex(m.below);
  buildTargets();
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

const BUILD = { city, sea };

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
  scene.add(group);
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
          h = tall
            ? rnd(180, 460) * Math.max(0.6, 1.1 - dist * 0.5)
            : rnd(40, 110);
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

  // A flyer about to fly into a tower turns for the clearest way round it,
  // the one nearest where it was going; and none climbs into the cloud.
  // `to` is where it wants to go (ai.js), changed in place. Streets are
  // narrow for a plane, so City flyers also turn twice as hard (`agile`).
  const ahead = (pos, dx, dz, far) => {
    for (let s = 30; s <= far; s += 30)
      if (height(pos.x + dx * s, pos.z + dz * s) > pos.y - 25) return s;
    return 0;
  };
  const TURNS = [0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4];
  function avoid(pos, f, to) {
    const l = Math.hypot(f.x, f.z) || 1,
      fx = f.x / l,
      fz = f.z / l;
    if (ahead(pos, fx, fz, 240)) {
      const tl = Math.hypot(to.x, to.z) || 1;
      let best = null,
        score = -Infinity;
      for (const a of TURNS) {
        const c = Math.cos(a),
          s = Math.sin(a),
          dx = fx * c - fz * s,
          dz = fx * s + fz * c,
          hit = ahead(pos, dx, dz, 240),
          v = hit ? hit / 1000 : 1 + (dx * to.x + dz * to.z) / tl;
        if (v > score) {
          score = v;
          best = [dx, dz];
        }
      }
      const L = Math.max(200, tl);
      to.set(best[0] * L, Math.min(to.y, 0), best[1] * L);
    }
    if (pos.y > ceil - 70)
      to.y = Math.min(to.y, -Math.hypot(to.x, to.z) * 0.15);
  }

  // A team game: room cleared round each team's field (whole blocks of
  // towers put away), a park, its runway and its hangar.
  function field(f, c) {
    for (const t of towers)
      if (Math.abs(t.x - f.x) < f.hl + 260 && Math.abs(t.z - f.z) < 260)
        t.gone = true;
    drawTowers();
    put(f.g, flat(f.hl * 2 + 400, 460, 0x6ea648, -3), 0, 0.12, 0);
    runway({ x: 0, z: 0, hl: f.hl, hw: f.hw }, c.plane[2], f.g);
    hangar(-120, -70, c.plane[1], false, f.g);
    return [{ x: f.x - 120, z: f.z - 70, r: 17, h: 12.5 }];
  }
  function unfield() {
    if (!towers.some((t) => t.gone)) return;
    for (const t of towers) t.gone = false;
    drawTowers();
  }

  group.visible = false;
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
    },
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
const ISLES = [
  [1050, 380, 90],
  [520, -620, 60],
  [2100, 700, 120],
  [3700, -900, 80],
  [-700, 600, 70],
];
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
    return { r: 28, h: 14, hp: 8, pts: 250, name: "Destroyer" };
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
    return { r: 32, h: 14, hp: 6, pts: 200, name: "Cargo ship" };
  },
  patrol(g) {
    put(g, box(28, 4, 7, 0x8a8e96), 0, 1, 0);
    put(g, box(8, 4, 5, 0x9aa0a8), -2, 5, 0);
    put(g, box(9, 0.6, 6, 0xb03aa0), -2, 7.3, 0);
    put(g, box(3, 2, 3, 0x5a5e66), 9, 4, 0);
    g.add(foam(38, 12));
    return { r: 13, h: 7.5, hp: 3, pts: 100, name: "Patrol boat" };
  },
};

function sea() {
  const rand = seeded(1805),
    rnd = (a, b) => a + rand() * (b - a);
  const group = new THREE.Group();
  scene.add(group);
  const home = { ...COUNTRY.home, hl: SEA.hl, hw: SEA.hw },
    enemy = { ...COUNTRY.enemy, hl: SEA.hl, hw: SEA.hw };

  // Water: faceted, each triangle its own shade of blue, gently rolling.
  const g = new THREE.PlaneGeometry(14000, 14000, 120, 120).toNonIndexed(),
    p = g.attributes.position;
  for (let i = 0; i < p.count; i++)
    p.setZ(i, Math.sin(p.getX(i) * 0.02) * Math.cos(p.getY(i) * 0.017));
  const pal = [0x2a6fa8, 0x2f78b0, 0x2868a2, 0x3380b8, 0x2c73ab].map(
    (c) => new THREE.Color(c),
  );
  const col = new Float32Array(p.count * 3);
  for (let t = 0; t < p.count / 3; t++) {
    const c = pal[(rand() * pal.length) | 0];
    for (let k = 0; k < 3; k++) c.toArray(col, (t * 3 + k) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const water = new THREE.Mesh(
    g,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  water.rotation.x = -PI / 2;
  put(group, water, CX, -1.2, 0);

  // The carriers: the two sides', and in a team game each team's.
  const decks = [home, enemy];
  for (const [R, trim, roof] of [
    [home, 0x55ffff, 0x2fc6d6],
    [enemy, 0xff55ff, 0xb03aa0],
  ])
    put(group, carrier(trim, roof), R.x, 0, R.z);

  // Islands: a sand bar, a green hill, palms.
  for (const [x, z, r] of ISLES) {
    put(
      group,
      new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.75, r, 6, 9),
        M(0xe3cf8f),
      ),
      x,
      0.5,
      z,
    );
    put(
      group,
      new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.15, r * 0.6, r * 0.35, 7),
        M(0x5f9a40),
      ),
      x,
      3.5 + r * 0.175,
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

  // The ground: a deck (and its island) is solid down to the water; an
  // island is a sand bar with a hill on it.
  function onDeck(x, z) {
    for (const d of decks)
      if (Math.abs(x - d.x) < SEA.hl && Math.abs(z - d.z) < SEA.hw) return d;
    return null;
  }
  const isle = (x, z) =>
    ISLES.find(([ix, iz, r]) => Math.hypot(x - ix, z - iz) < r);
  function height(x, z) {
    const d = onDeck(x, z);
    if (d) {
      const [ix, iz, hx, hz, ih] = ISLAND;
      return Math.abs(x - d.x - ix) < hx && Math.abs(z - d.z - iz) < hz
        ? SEA.deck + ih
        : SEA.deck;
    }
    const i = isle(x, z);
    if (!i) return 0;
    const [ix, iz, r] = i,
      e = Math.hypot(x - ix, z - iz);
    return e > r * 0.6
      ? 3.5
      : 3.5 + r * 0.35 * Math.min(1, (r * 0.6 - e) / (r * 0.45));
  }
  function crash(p) {
    if (onDeck(p.x, p.z)) return "Flew into the carrier";
    if (isle(p.x, p.z)) return "Flew into an island";
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

  group.visible = false;
  return {
    group,
    land: {
      height,
      floor: () => 0,
      crash,
      brake: SEA.brake,
      deck: true,
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
