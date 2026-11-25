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

// maps/sky.js — Sky islands: no ground at all, only a sea of cloud (y = 0,
// and touching it is the end) with rock islands floating over it. Each
// runway lies on a big island's flat grassy top; the town stands on a chain
// of small ones between them; the rest are scattered to fly round, under and
// between.
//
// An island is real rock with air under it: under its tapered underside
// groundY is the cloud floor (or a lower island), inside the rock it is the
// island's top. So rounds, bombs and planes pass beneath an island and meet
// its rock from the side or below, with no new code elsewhere.

import { CX } from "../constants.js";
import { fieldSpots } from "../net/teams.js";

// The runways' islands. EB's sits lower than HOME's: enemy flyers appear
// anywhere 220–380 m over the box round EB (ai.js spawnEnemy), so its rock
// must stay under 218 m or some would be born inside it.
const HOME_TOP = 280,
  EB_TOP = 210;
// A team field's island, by team: under the 260 m floor Endless enemies'
// flyers appear at (ai.js hostEnemy).
const FIELD_TOP = [200, 225, 250];
// Scattered islands keep off the lane the runways and the town lie on
// (|z| < LANE) unless a plane landing can pass under them (their rock all
// above HIGH); and well off EB, where the enemy flyers patrol.
const LANE = 260,
  HIGH = 450,
  EB_CLEAR = 1100;
// Where Endless enemies' flyers appear (ai.js hostEnemy): x, z and the
// height band no island there may reach into.
const SPAWN = { x0: 200, x1: 2600, z: 1200, lo: 250, hi: 430 };

// The town, on the chain: [x, z, half-x, half-z, top], and what stands on
// each ([kind, x, side, z]).
const CHAIN = [
  [850, 15, 90, 75, 150],
  [1195, -25, 145, 90, 170],
  [1560, 35, 85, 75, 130],
  [1905, -5, 135, 95, 160],
  [2235, 20, 115, 85, 120],
];
const TOWN = [
  ["tanks", 850, null, 15],
  ["factory", 1150, null, -35],
  ["hangar", 1240, null, -15],
  ["tanks", 1560, null, 35],
  ["hq", 1875, null, -15],
  ["tanks", 1950, null, 25],
  ["factory", 2205, null, 30],
  ["hangar", 2268, null, 5],
];
// The hippos' island, off the lane north of the town.
const PASTURE = [720, 560, 115, 90, 185];

const GRASS = [0x6fb44a, 0x7cc152, 0x63a843, 0x86c45a, 0x74b84e];
const EARTH = [0x8a6a48, 0x7d5f40, 0x94744f];
const ROCK = [
  [0.3, [0xa69584, 0x9c8b7b, 0xb0a08e]],
  [0.65, [0x8c7c6e, 0x857566, 0x93837a]],
  [Infinity, [0x74665a, 0x6b5f54, 0x7c6d60]],
];
const CLOUD = [0xf6f9fc, 0xedf2f8, 0xe3e9f1, 0xffffff, 0xe8edf5];

// An island's outline is an ellipse (half-sizes ax, az) with a ragged edge;
// `r` is how far out a point is, 1 at the edge, and `th` its angle, both in
// the ellipse's own frame.
const edge = (I, th) => {
  let e = 1;
  for (const [k, a, p] of I.bump) e += a * Math.cos(k * th + p);
  return e;
};
// The rock's underside at (r, th): `lip` below the top at the edge, down
// to `depth` at the middle, craggy round the way and in steps on the way in.
function under(I, r, th) {
  let c = 0;
  for (const [k, a, p] of I.crag) c += a * Math.cos(k * th + p);
  return (
    I.top -
    I.lip -
    (I.depth - I.lip) * (1 - r) * (1 + c * r + 0.06 * Math.sin(9 * r + I.ph))
  );
}
// The ground this island makes at (x, z), seen from height y: its top (or
// what stands on it) if y is in its rock or above it; -1 if not under it.
function at(I, x, z, y) {
  if (Math.abs(x - I.x) > I.rx || Math.abs(z - I.z) > I.rz) return -1;
  const dx = (x - I.x) / I.ax,
    dz = (z - I.z) / I.az,
    th = Math.atan2(dz, dx),
    r = Math.hypot(dx, dz) / edge(I, th);
  if (r >= 1 || y < under(I, r, th)) return -1;
  for (const b of I.blocks)
    if (x > b[0] && x < b[1] && z > b[2] && z < b[3]) return I.top + b[4];
  return I.top;
}
const inside = (I, x, z) => {
  const dx = (x - I.x) / I.ax,
    dz = (z - I.z) / I.az;
  return Math.hypot(dx, dz) / edge(I, Math.atan2(dz, dx));
};

export default function build(kit) {
  const { THREE, seeded, put, box, flat, hangar, runway } = kit;
  const rand = seeded(1783),
    rnd = (a, b) => a + rand() * (b - a);
  const group = new THREE.Group();
  const home = { ...kit.COUNTRY.home },
    enemy = { ...kit.COUNTRY.enemy };

  // An island's shape: `rough` is how ragged its outline is.
  function shape(r, x, z, ax, az, top, depth, rough) {
    const I = { x, z, ax, az, top, depth, blocks: [] };
    I.lip = 6 + r() * 8;
    I.ph = r() * 6.3;
    I.bump = [0, 1, 2].map((i) => [
      2 + i * 2 + ((r() * 2) | 0),
      (rough * (0.4 + r() * 0.6)) / (i + 1),
      r() * 6.3,
    ]);
    I.crag = [0, 1, 2].map((i) => [
      4 + i * 3 + ((r() * 3) | 0),
      (0.35 * (0.4 + r() * 0.6)) / (i + 1),
      r() * 6.3,
    ]);
    size(I);
    return I;
  }
  // Its reach, for quick rejection; and the lowest its rock goes.
  function size(I) {
    const amp = I.bump.reduce((s, b) => s + b[1], 0);
    I.rx = I.ax * (1 + amp) + 1;
    I.rz = I.az * (1 + amp) + 1;
    I.R = Math.max(I.rx, I.rz);
    I.low = I.top - I.depth * 1.12;
  }
  // Grows an island until its flat top holds every point given, with room.
  function cover(I, pts) {
    while (pts.some(([x, z]) => inside(I, x, z) > 0.9)) {
      I.ax *= 1.04;
      I.az *= 1.04;
    }
    size(I);
  }
  // Points round a rect [x0, x1, z0, z1], every 20 m.
  function rim([x0, x1, z0, z1]) {
    const pts = [];
    for (let x = x0; x <= x1; x += 20) pts.push([x, z0], [x, z1]);
    for (let z = z0; z <= z1; z += 20) pts.push([x0, z], [x1, z]);
    return pts;
  }

  // ── The islands ───────────────────────────────────────────────────────────
  const isles = [];
  const runwayIsle = (R, top) => {
    const I = shape(
      rand,
      R.x,
      R.z,
      400,
      175,
      top,
      Math.min(230, (top - 30) / 1.12),
      0.05,
    );
    const m = 40;
    cover(I, [
      ...rim([R.x - R.hl - m, R.x + R.hl + m, R.z - R.hw - m, R.z + R.hw + m]),
      ...rim([R.x - 170, R.x + 150, R.z - 110, R.z - 45]),
    ]);
    isles.push(I);
    return I;
  };
  const HI = runwayIsle(home, HOME_TOP),
    EI = runwayIsle(enemy, EB_TOP);
  // The airfields' hangars and tower stand on their islands as ground, as
  // the City's towers do (the Countryside's solids reach down to y = 0).
  HI.blocks.push(
    [-126, -94, -73, -47, 12.5],
    [-166, -134, -108, -82, 12.5],
    [135.5, 144.5, -59.5, -50.5, 20],
  );
  for (const dx of [-120, 120])
    EI.blocks.push([enemy.x + dx - 16, enemy.x + dx + 16, -83, -57, 12.5]);
  for (const [x, z, ax, az, top] of CHAIN)
    isles.push(shape(rand, x, z, ax, az, top, ax * 0.9, 0.08));
  const [px, pz, pax, paz, ptop] = PASTURE,
    pasture = shape(rand, px, pz, pax, paz, ptop, 120, 0.08);
  isles.push(pasture);

  // Scattered: many sizes and heights, kept off the lane, EB, every place a
  // team field can go (net/teams.js, 2–8 teams) and its approaches, and the
  // band Endless enemies' flyers appear in, unless high enough to pass under.
  const spots = [];
  for (let n = 2; n <= 8; n++) spots.push(...fieldSpots(n));
  const fixed = isles.length;
  function fits(I) {
    const { x, z, R, top } = I;
    if (Math.abs(x - CX) + R > 3300 || Math.abs(z) + R > 3300) return false;
    if (Math.hypot(x - enemy.x, z - enemy.z) < EB_CLEAR + R) return false;
    if (Math.abs(z) < LANE + R && x > -1400 - R && x < 4300 + R && I.low < HIGH)
      return false;
    for (const s of spots) {
      const dx = Math.abs(x - s.x) - R,
        dz = Math.abs(z - s.z) - R;
      if (dz < 200 && (dx < 400 || (dx < 1000 && top > 110 && I.low < HIGH)))
        return false;
    }
    if (
      x > SPAWN.x0 - R &&
      x < SPAWN.x1 + R &&
      Math.abs(z) < SPAWN.z + R &&
      I.top > SPAWN.lo &&
      I.low < SPAWN.hi
    )
      return false;
    // One may float over another, but nothing over a runway, the town or
    // the hippos: what stands there takes its height from the top.
    for (const [k, J] of isles.entries())
      if (
        Math.hypot(x - J.x, z - J.z) < R + J.R + 60 &&
        (k < fixed || !(J.low > I.top + 120 || I.low > J.top + 120))
      )
        return false;
    return true;
  }
  // Every other try is in the middle of the map, where the fighting is:
  // low there, or high enough to fly under at any height a flyer appears.
  for (let tries = 0; tries < 8000 && isles.length < fixed + 36; tries++) {
    const mid = tries % 2 === 0,
      r = 45 + 230 * rand() ** 1.6,
      high = rand() < 0.5,
      top = mid ? (high ? rnd(480, 600) : rnd(100, 240)) : rnd(100, 600),
      depth = Math.min(
        (top - 20) / 1.12,
        r * rnd(0.8, 1.5),
        mid && high ? (top - SPAWN.hi - 10) / 1.12 : Infinity,
      ),
      I = shape(
        rand,
        mid ? rnd(CX - 1700, CX + 1700) : rnd(CX - 3300, CX + 3300),
        mid ? rnd(-1500, 1500) : rnd(-3300, 3300),
        r * rnd(0.8, 1.25),
        r * rnd(0.8, 1.25),
        top,
        depth,
        0.14,
      );
    if (fits(I)) isles.push(I);
  }

  // A grid of 250 m cells, each listing the islands over it, so groundY
  // looks at two or three at most.
  const CELL = 250,
    grid = new Map(),
    key = (i, j) => (i + 100) * 1000 + j + 100;
  for (const I of isles)
    for (
      let i = Math.floor((I.x - I.rx) / CELL);
      i <= Math.floor((I.x + I.rx) / CELL);
      i++
    )
      for (
        let j = Math.floor((I.z - I.rz) / CELL);
        j <= Math.floor((I.z + I.rz) / CELL);
        j++
      ) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(I);
      }
  const fieldIsles = [];
  function height(x, z, y = Infinity) {
    let h = 0;
    const c = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (c)
      for (const I of c) {
        const t = at(I, x, z, y);
        if (t > h) h = t;
      }
    for (const I of fieldIsles) {
      const t = at(I, x, z, y);
      if (t > h) h = t;
    }
    return h;
  }
  function crash(p) {
    for (const I of [...isles, ...fieldIsles])
      if (at(I, p.x, p.z, p.y + 5) > 0)
        return p.y > I.top + 1 ? "Flew into a building" : "Flew into an island";
    return "Lost in the clouds";
  }

  // ── Drawing them: one faceted mesh, flat-shaded ───────────────────────────
  function tri(out, a, b, c, hex, up) {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    if (n[0] * up[0] + n[1] * up[1] + n[2] * up[2] < 0) [b, c] = [c, b];
    out.pos.push(...a, ...b, ...c);
    out.col.push(hex, hex, hex);
  }
  // An island into `out`, offset by (ox, oz) for a team field's own group.
  function carve(I, out, r, ox = 0, oz = 0) {
    const S = Math.max(
        14,
        Math.min(56, Math.round((Math.PI * (I.ax + I.az)) / 28)),
      ),
      ths = Array.from({ length: S + 1 }, (_, i) => (i / S) * Math.PI * 2),
      pt = (rr, th, y) => {
        const e = rr * edge(I, th);
        return [
          I.x - ox + I.ax * e * Math.cos(th),
          y,
          I.z - oz + I.az * e * Math.sin(th),
        ];
      },
      rp = (pal) => pal[(r() * pal.length) | 0],
      UP = [0, 1, 0],
      DOWN = [0, -1, 0];
    const tops = I.R > 220 ? [0, 0.3, 0.6, 0.85, 1] : [0, 0.5, 1];
    for (let j = 1; j < tops.length; j++)
      for (let i = 0; i < S; i++) {
        const a0 = pt(tops[j - 1], ths[i], I.top),
          a1 = pt(tops[j - 1], ths[i + 1], I.top),
          b0 = pt(tops[j], ths[i], I.top),
          b1 = pt(tops[j], ths[i + 1], I.top);
        tri(out, a0, b0, b1, rp(GRASS), UP);
        if (j > 1) tri(out, a0, b1, a1, rp(GRASS), UP);
      }
    for (let i = 0; i < S; i++) {
      const out0 = [Math.cos(ths[i]), 0, Math.sin(ths[i])],
        a0 = pt(1, ths[i], I.top),
        a1 = pt(1, ths[i + 1], I.top),
        b0 = pt(1, ths[i], I.top - I.lip),
        b1 = pt(1, ths[i + 1], I.top - I.lip),
        c = rp(EARTH);
      tri(out, a0, b0, b1, c, out0);
      tri(out, a0, b1, a1, c, out0);
    }
    const rings = [1, 0.82, 0.64, 0.46, 0.28, 0.12, 0];
    for (let j = 1; j < rings.length; j++)
      for (let i = 0; i < S; i++) {
        const q = (r0, th) => pt(r0, th, under(I, r0, th)),
          a0 = q(rings[j - 1], ths[i]),
          a1 = q(rings[j - 1], ths[i + 1]),
          b0 = q(rings[j], ths[i]),
          b1 = q(rings[j], ths[i + 1]),
          share = (I.top - (a0[1] + b1[1]) / 2) / I.depth,
          pal = ROCK.find(([s]) => share < s)[1];
        tri(out, a0, b0, b1, rp(pal), DOWN);
        if (rings[j]) tri(out, a0, b1, a1, rp(pal), DOWN);
      }
  }
  function mesh(out) {
    const g = new THREE.BufferGeometry(),
      col = new Float32Array(out.col.length * 3),
      c = new THREE.Color();
    out.col.forEach((hex, i) => c.setHex(hex).toArray(col, i * 3));
    g.setAttribute("position", new THREE.Float32BufferAttribute(out.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(
      g,
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
  }
  const rock = { pos: [], col: [] };
  for (const I of isles) carve(I, rock, rand);
  group.add(mesh(rock));

  // The airfields, on their islands' tops.
  const deck = (y) => put(group, new THREE.Group(), 0, y, 0);
  const hd = deck(HOME_TOP),
    ed = deck(EB_TOP);
  runway(home, 0x55ffff, hd);
  runway(enemy, 0xff55ff, ed);
  hangar(-110, -60, 0x2fc6d6, false, hd);
  hangar(-150, -95, 0x2fc6d6, false, hd);
  put(hd, box(6, 16, 6, 0xd9d2c0), 140, 8, -55);
  put(hd, box(9, 4, 9, 0x55ffff), 140, 18, -55);
  hangar(enemy.x - 120, -70, 0xb03aa0, false, ed);
  hangar(enemy.x + 120, -70, 0xb03aa0, false, ed);

  // A stream off HOME's island: a pond, and a waterfall down to the clouds.
  const wth = 1.25,
    we = edge(HI, wth),
    wx = HI.x + HI.ax * we * Math.cos(wth),
    wz = HI.z + HI.az * we * Math.sin(wth),
    pondZ = wz - 70;
  put(hd, flat(46, 32, 0x4aa3d8, -3), wx - 10, 0.1, pondZ);
  put(hd, flat(9, wz - pondZ + 4, 0x5ab4e4, -4), wx, 0.12, (wz + pondZ) / 2);
  const fall = new THREE.Mesh(
    new THREE.PlaneGeometry(12, HOME_TOP + 10),
    new THREE.MeshBasicMaterial({
      color: 0xe4f4ff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  put(group, fall, wx, (HOME_TOP - 10) / 2, wz + 2);

  // Trees on the tops, clear of the runways, the town, the hippos and the
  // stream.
  const clear = (x, z) =>
    [home, enemy].some(
      (R) => Math.abs(x - R.x) < R.hl + 45 && Math.abs(z - R.z) < R.hw + 50,
    ) ||
    [HI, EI].some((I) =>
      I.blocks.some(
        (b) => x > b[0] - 12 && x < b[1] + 12 && z > b[2] - 12 && z < b[3] + 12,
      ),
    ) ||
    TOWN.some(([, tx, , tz]) => Math.hypot(x - tx, z - tz) < 32) ||
    (Math.abs(x - px) < 75 && Math.abs(z - pz) < 30) ||
    (Math.abs(x - wx) < 40 && z > pondZ - 30);
  const woods = [];
  for (const I of isles) {
    const n = Math.min(14, Math.round((I.ax * I.az) / 2500));
    for (let k = 0, tries = 0; k < n && tries < n * 4; tries++) {
      const a = rnd(0, Math.PI * 2),
        d = Math.sqrt(rand()) * 0.75,
        x = I.x + I.ax * d * edge(I, a) * Math.cos(a),
        z = I.z + I.az * d * edge(I, a) * Math.sin(a);
      if (clear(x, z)) continue;
      woods.push([x, I.top, z, rnd(1.1, 2.2)]);
      k++;
    }
  }
  const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(4, 10, 6),
      kit.M(0x3d7a35),
      woods.length,
    ),
    trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.6, 0.7, 3, 5),
      kit.M(0x6b4a2a),
      woods.length,
    ),
    mx = new THREE.Matrix4(),
    v = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    sc = new THREE.Vector3();
  woods.forEach(([x, y, z, s], i) => {
    sc.set(s, s, s);
    crowns.setMatrixAt(i, mx.compose(v.set(x, y + 8 * s, z), q, sc));
    trunks.setMatrixAt(i, mx.compose(v.set(x, y + 1.5 * s, z), q, sc));
  });
  group.add(crowns, trunks);

  // ── The cloud sea, and cloud drifting between the islands ─────────────────
  kit.water(group, rand, CLOUD).position.y = -1.5;
  const puffMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: 0x8d97a3,
    flatShading: true,
  });
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const floorPuffs = new THREE.InstancedMesh(ico, puffMat, 650);
  for (let i = 0; i < 650; i++) {
    v.set(rnd(CX - 4200, CX + 4200), rnd(-6, 10), rnd(-4200, 4200));
    sc.set(rnd(40, 120), rnd(10, 26), rnd(40, 120));
    floorPuffs.setMatrixAt(i, mx.compose(v, q, sc));
  }
  group.add(floorPuffs);
  // Clusters of three to five puffs, off the runways' approaches.
  const drift = new THREE.Group(),
    wisps = [];
  for (let c = 0; wisps.length < 260 && c < 400; c++) {
    const x = rnd(CX - 3600, CX + 3600),
      z = rnd(-3600, 3600),
      y = rnd(60, 420);
    if (Math.abs(z) < 400 && x > -1500 && x < 4300) continue;
    if (height(x, z, y + 30) > y - 30) continue;
    const n = 3 + ((rand() * 3) | 0);
    for (let j = 0; j < n; j++)
      wisps.push([
        x + j * 30 - n * 15 + rnd(-8, 8),
        y + rnd(-6, 6),
        z + rnd(-12, 12),
        rnd(26, 48),
        rnd(12, 20),
        rnd(20, 36),
      ]);
  }
  const wispMesh = new THREE.InstancedMesh(ico, puffMat, wisps.length);
  wisps.forEach(([x, y, z, a, b, c], i) =>
    wispMesh.setMatrixAt(i, mx.compose(v.set(x, y, z), q, sc.set(a, b, c))),
  );
  drift.add(wispMesh);
  group.add(drift);
  let t = 0;
  function tick(dt) {
    t += dt;
    drift.position.set(
      Math.sin(t * 0.02) * 220,
      Math.sin(t * 0.05) * 6,
      Math.cos(t * 0.013) * 140,
    );
  }

  // ── Team fields: a floating island each, its top flat round the runway ────
  let fieldMeshes = [];
  function field(f, c) {
    const top = FIELD_TOP[f.team % FIELD_TOP.length],
      r = seeded(9100 + f.team),
      I = shape(r, f.x, f.z, 360, 150, top, (top - 30) / 1.12, 0.05);
    cover(I, [
      ...rim([
        f.x - f.hl - 30,
        f.x + f.hl + 30,
        f.z - f.hw - 30,
        f.z + f.hw + 30,
      ]),
      ...rim([f.x - 150, f.x - 90, f.z - 100, f.z - 45]),
      [f.x + 60, f.z + 70],
    ]);
    I.blocks.push([f.x - 136, f.x - 104, f.z - 83, f.z - 57, 12.5]);
    fieldIsles.push(I);
    const out = { pos: [], col: [] };
    carve(I, out, r, f.x, f.z);
    const m = mesh(out);
    fieldMeshes.push(m);
    f.g.add(m);
    const d = put(f.g, new THREE.Group(), 0, top, 0);
    runway({ x: 0, z: 0, hl: f.hl, hw: f.hw }, c.plane[2], d);
    hangar(-120, -70, c.plane[1], false, d);
    return [];
  }
  function unfield() {
    fieldIsles.length = 0;
    for (const m of fieldMeshes) m.geometry.dispose();
    fieldMeshes = [];
  }

  return {
    group,
    isles,
    land: {
      height,
      floor: () => 0,
      crash,
      dust: 0xe6ebf0,
      // The careful avoider (side probes, the way it wants checked too): a
      // flyer skirting an island's edge at a shallow angle otherwise sees
      // the rock only on some frames, and turns back into it.
      avoid: kit.avoider(height, 0, Infinity, 10),
      town: TOWN,
      field,
      unfield,
      tick,
    },
    home,
    enemy,
    solids: [],
    hippos: [
      [px - 25, pz - 10, ptop],
      [px + 5, pz + 12, ptop],
      [px + 30, pz - 4, ptop],
    ],
    sky: 0xcfe7fa,
    fog: [800, 3900],
    below: 0xeef2f7,
    light: [1.15, 1],
  };
}
