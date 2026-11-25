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

// maps/volcano.js — the Volcano: one big tropical island in the sea. Both
// runways and the town lie on its coastal plain along z = 0; a volcano
// stands north of the lane. Its ash plume chokes an engine, the vents on
// its flanks lift a plane, and the sea all round is where a short glide
// ends.
//
// The island is a disc about CX big enough to hold the team fields' ring
// (net/teams.js RING, 1900 m) on its flat plain, beach and all: the
// volcano and the few hills stand inside the ring, clear of the lane.

import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CX, TDEF, LANE } from "../constants.js";
// `land.power` is the shared rules object's; the map's own copy of `land`
// is only read once, when it is picked.
import { land } from "../world.js";

// The coastal plain stands a few metres above the sea.
const PLAIN = 3;
// The coast: a ragged circle about (CX, 0), its radius wavering by angle.
// The beach runs BEACH metres inland from it, down to the water.
const COAST = 2650,
  COAST_MAX = COAST + 215,
  BEACH = 150;
const coastAt = (a) =>
  COAST +
  110 * Math.sin(3 * a + 1) +
  70 * Math.sin(5 * a + 2.3) +
  35 * Math.sin(11 * a + 0.4);
// The volcano: a concave cone up to its rim, a crater in its top whose
// flat floor holds a lava lake.
const VX = 1400,
  VZ = -900,
  BASE = 650,
  RIM = 110,
  PIT = 55,
  TOP = 600,
  FLOOR = 480;
// The other high ground, [x, z, radius, height]: all inside the ring and
// at least 400 m off the lane.
const HILLS = [
  [950, 1150, 320, 170],
  [1950, 1050, 280, 130],
  [2450, -650, 250, 150],
  [350, -800, 250, 120],
];
// The lagoon the hippos wallow in, near the south shore: [x, z, radius].
const LAGOON = [1000, 2210, 110];
// The ash plume rises from the crater to PLUME.top, leaning downwind
// (away from the lane) and widening as it goes.
const PLUME = { base: 520, top: 1200, lean: 450, wx: 0.6, wz: -0.8 };
const plumeR = (s) => 60 + 160 * s;
const ASH = 2.5; // seconds without power after the ash
// The vents' updrafts: within UP.r of one and below UP.top, a plane rises.
const UP = { r: 80, top: 400, rate: 15 };

const smooth = (f) => f * f * (3 - 2 * f);

// The volcano's own height, or 0 off it. Gullies run down its flanks
// (the sine of the bearing), fading out at the rim and the foot.
function cone(x, z) {
  const d = Math.hypot(x - VX, z - VZ);
  if (d >= BASE) return 0;
  if (d < PIT) return FLOOR;
  if (d < RIM) return FLOOR + (TOP - FLOOR) * ((d - PIT) / (RIM - PIT)) ** 1.4;
  const t = (BASE - d) / (BASE - RIM),
    a = Math.atan2(z - VZ, x - VX);
  return (
    PLAIN +
    (TOP - PLAIN) *
      t ** 1.6 *
      (1 + 0.06 * Math.sin(7 * a + 0.5) * Math.sin(Math.PI * t))
  );
}
function hill(x, z) {
  let h = 0;
  for (const [hx, hz, r, top] of HILLS) {
    const dx = x - hx,
      dz = z - hz;
    if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
    const f = 1 - Math.hypot(dx, dz) / r;
    if (f > 0) h = Math.max(h, top * smooth(f));
  }
  return h;
}
// The island without its volcano: sea (0), beach, lagoon, plain and hills.
function lowland(x, z) {
  const r = Math.hypot(x - CX, z);
  if (r > COAST_MAX) return 0;
  let h = PLAIN;
  if (r > COAST - 215 - BEACH) {
    const R = coastAt(Math.atan2(z, x - CX));
    if (r >= R) return 0;
    if (r > R - BEACH) h = PLAIN * smooth((R - r) / BEACH);
  }
  const e = Math.hypot(x - LAGOON[0], z - LAGOON[1]);
  if (e < LAGOON[2]) return 0;
  if (e < LAGOON[2] + 50) h = Math.min(h, (PLAIN * (e - LAGOON[2])) / 50);
  return h + hill(x, z);
}
const height = (x, z) => Math.max(lowland(x, z), cone(x, z));

// The volcano's mesh: rings round the crater, finer near the top.
const SEGS = 64,
  rings = [0, 30, PIT, 75, 95, RIM];
for (let u = 1; u <= 24; u++) rings.push(RIM + (BASE - RIM) * (u / 24) ** 1.25);
const ringAt = (d) =>
  rings.reduce(
    (b, r, i) => (Math.abs(r - d) < Math.abs(rings[b] - d) ? i : b),
    0,
  );
// A point on the mesh: ring i, `s` segments round (fractions lie on the
// edge between two segments, so on the mesh itself).
const onCone = (i, s, lift = 0) => {
  const j = Math.floor(s),
    f = s - j,
    p = (k) => {
      const a = ((k % SEGS) / SEGS) * Math.PI * 2,
        x = VX + rings[i] * Math.cos(a),
        z = VZ + rings[i] * Math.sin(a);
      return [x, cone(x, z) + lift, z];
    },
    A = p(j),
    B = p(j + 1);
  return A.map((v, k) => v + (B[k] - v) * f);
};

// The vents: on the flanks at four bearings (segments round the cone).
const ventRing = ringAt(380),
  vents = [10, 25, 38, 55].map((s) => {
    const [x, y, z] = onCone(ventRing, s);
    return { x, y, z, s };
  });

export default function build(kit) {
  const { THREE, seeded, avoider, water, dressing, runway, hangar } = kit;
  const { M, put, flat, COUNTRY, P, say, puff } = kit;
  const rand = seeded(1883),
    rnd = (a, b) => a + rand() * (b - a),
    pick = (pal) => pal[(rand() * pal.length) | 0];
  const group = new THREE.Group();
  const home = COUNTRY.home,
    enemy = COUNTRY.enemy;

  water(group, rand);

  // ── The island: one faceted mesh, no triangles out at sea ──────────────
  // (the water shows through, as it does in the lagoon), nor under the
  // volcano, which is its own mesh.
  {
    const STEP = 40,
      N = Math.ceil((COAST_MAX + 60) / STEP),
      n = N * 2 + 1,
      hs = new Float32Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        hs[i * n + j] = lowland(CX + (i - N) * STEP, (j - N) * STEP);
    const pos = [],
      col = [],
      c = new THREE.Color();
    const SAND = [0xe3cf8f, 0xd9c37f, 0xe8d69a],
      GRASS = [0x5f9a40, 0x6ea648, 0x528a36, 0x77a044, 0x5c8e3c],
      SLOPE = [0x6f8f45, 0x5f8a3c, 0x7d8a52],
      ROCK = [0x8a8a6a, 0x7d8a58, 0x9a9180];
    const vert = (i, j) => {
      const h = hs[i * n + j];
      pos.push(CX + (i - N) * STEP, h > 0 ? h : -4, (j - N) * STEP);
    };
    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < n - 1; j++) {
        const q = [
          hs[i * n + j],
          hs[(i + 1) * n + j],
          hs[i * n + j + 1],
          hs[(i + 1) * n + j + 1],
        ];
        const x = CX + (i - N + 0.5) * STEP,
          z = (j - N + 0.5) * STEP;
        if (Math.hypot(x - VX, z - VZ) < BASE - 60) continue;
        const top = Math.max(...q),
          mean = (q[0] + q[1] + q[2] + q[3]) / 4;
        c.setHex(
          pick(
            mean > 90
              ? ROCK
              : mean > PLAIN + 4
                ? SLOPE
                : top < PLAIN - 0.01 || mean < PLAIN - 0.5
                  ? SAND
                  : GRASS,
          ),
        );
        for (const [a, b, d] of [
          [
            [i, j],
            [i, j + 1],
            [i + 1, j],
          ],
          [
            [i + 1, j],
            [i, j + 1],
            [i + 1, j + 1],
          ],
        ]) {
          if (
            hs[a[0] * n + a[1]] <= 0 &&
            hs[b[0] * n + b[1]] <= 0 &&
            hs[d[0] * n + d[1]] <= 0
          )
            continue;
          vert(...a);
          vert(...b);
          vert(...d);
          for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    group.add(
      new THREE.Mesh(
        g,
        new THREE.MeshLambertMaterial({
          vertexColors: true,
          flatShading: true,
        }),
      ),
    );
  }

  // ── The volcano ────────────────────────────────────────────────────────
  {
    const pos = [],
      col = [],
      c = new THREE.Color();
    const PITC = [0x2e2624, 0x3a2c28],
      WALL = [0x4a3f3a, 0x55483f],
      BARE = [0x5c534d, 0x675d55, 0x4f4742],
      ASHY = [0x7d6e60, 0x8a7a68, 0x736558],
      SCRUB = [0x6f7f45, 0x7d8a52, 0x5f7a3c],
      JUNGLE = [0x4f8a3a, 0x5f9a40, 0x467f33];
    for (let i = 0; i < rings.length - 1; i++)
      for (let j = 0; j < SEGS; j++) {
        const a = onCone(i, j),
          b = onCone(i, j + 1),
          d = onCone(i + 1, j),
          e = onCone(i + 1, j + 1);
        const h = (a[1] + b[1] + d[1] + e[1]) / 4,
          r = (rings[i] + rings[i + 1]) / 2;
        c.setHex(
          pick(
            r < PIT
              ? PITC
              : r < RIM
                ? WALL
                : h > 430
                  ? BARE
                  : h > 220
                    ? ASHY
                    : h > 90
                      ? SCRUB
                      : JUNGLE,
          ),
        );
        pos.push(...a, ...e, ...d, ...a, ...b, ...e);
        for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    // Its foot lies on the plain: the offset keeps the cone in front.
    group.add(
      new THREE.Mesh(
        g,
        new THREE.MeshLambertMaterial({
          vertexColors: true,
          flatShading: true,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      ),
    );
  }

  // ── Lava: the crater's lake, the vents, and rivers down the flanks ────
  // Each vent is a mound of dark rock with lava welling out of it.
  {
    const lava = [],
      rock = [];
    const prep = (g) => {
      const ng = g.index ? g.toNonIndexed() : g;
      ng.deleteAttribute("uv");
      return ng;
    };
    lava.push(
      prep(
        new THREE.CircleGeometry(PIT + 4, 16)
          .rotateX(-Math.PI / 2)
          .translate(VX, FLOOR + 1, VZ),
      ),
    );
    for (const v of vents) {
      rock.push(
        prep(
          new THREE.CylinderGeometry(7, 24, 12, 7).translate(v.x, v.y + 3, v.z),
        ),
      );
      lava.push(
        prep(new THREE.IcosahedronGeometry(6, 0).translate(v.x, v.y + 9, v.z)),
      );
    }
    // A river: down from ring `from` to `to`, wandering a little round
    // segment `s`, a few metres over the mesh, widening as it cools.
    const river = (s, from, to) => {
      const pos = [],
        k = rand() * 6;
      let last = null;
      for (let i = from; i <= to; i++) {
        const w = ((4 + (i - from) * 0.5) * SEGS) / (2 * Math.PI * rings[i]),
          m = s + 0.25 * Math.sin(i * 0.9 + k),
          L = onCone(i, m - w, 1.2),
          R = onCone(i, m + w, 1.2);
        if (last)
          pos.push(...last[0], ...R, ...last[1], ...last[0], ...L, ...R);
        last = [L, R];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    };
    for (const v of vents) lava.push(river(v.s, ventRing, rings.length - 3));
    // and two overflowing the rim, that cool before the foot
    for (const s of [3, 46])
      lava.push(river(s, rings.indexOf(RIM), ventRing + 2));
    const glow = new THREE.MeshLambertMaterial({
      color: 0xff7a1a,
      emissive: 0xff4a00,
      flatShading: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    group.add(
      new THREE.Mesh(mergeGeometries(lava), glow),
      new THREE.Mesh(mergeGeometries(rock), M(0x3a3230)),
    );
    for (const g of [...lava, ...rock]) g.dispose();
  }

  // ── The ash plume: dark blobs rising up the column, round and round ───
  const plumeAt = (s, out) => {
    const l = PLUME.lean * s ** 1.6;
    out.x = VX + PLUME.wx * l;
    out.y = PLUME.base + s * (PLUME.top - PLUME.base);
    out.z = VZ + PLUME.wz * l;
    return out;
  };
  const BLOBS = 110,
    blobs = [];
  for (let i = 0; i < BLOBS; i++)
    blobs.push({
      s: i / BLOBS,
      a: rnd(0, Math.PI * 2),
      o: rnd(0, 0.5),
      k: rnd(0.4, 0.6),
    });
  const plume = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    M(0xffffff),
    BLOBS,
  );
  plume.material.emissive.setHex(0x1c1917);
  const grey = new THREE.Color();
  for (let i = 0; i < BLOBS; i++)
    plume.setColorAt(
      i,
      grey.setHex(pick([0x4b4643, 0x5a5450, 0x3d3937, 0x66605a])),
    );
  const mx = new THREE.Matrix4(),
    at = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    sc = new THREE.Vector3(),
    c0 = {};
  let clock = 0;
  function drawPlume() {
    blobs.forEach((b, i) => {
      const s = (b.s + clock * 0.02) % 1,
        R = plumeR(s),
        a = b.a + clock * 0.05;
      plumeAt(s, c0);
      at.set(c0.x + Math.cos(a) * R * b.o, c0.y, c0.z + Math.sin(a) * R * b.o);
      sc.set(R * b.k, R * b.k * 0.7, R * b.k);
      plume.setMatrixAt(i, mx.compose(at, q, sc));
    });
    plume.instanceMatrix.needsUpdate = true;
  }
  drawPlume();
  group.add(plume);
  // Is a point in the ash? Inside the column's width at its height, from
  // the crater floor up to the plume's top.
  function inAsh(p) {
    if (p.y < FLOOR - 10 || p.y > PLUME.top + plumeR(1) * 0.4) return false;
    const s = Math.min(
      1,
      Math.max(0, (p.y - PLUME.base) / (PLUME.top - PLUME.base)),
    );
    plumeAt(s, c0);
    return Math.hypot(p.x - c0.x, p.z - c0.z) < plumeR(s) * 0.95;
  }

  // ── Palms on the plain and jungle on the volcano's foot ───────────────
  const palms = [];
  for (let i = 0; i < 1400 && palms.length < 520; i++) {
    const r = Math.sqrt(rand()) * (COAST - 120),
      a = rnd(0, Math.PI * 2),
      x = CX + r * Math.cos(a),
      z = r * Math.sin(a),
      h = height(x, z),
      d = Math.hypot(x - VX, z - VZ);
    if (h < PLAIN - 0.5) continue; // beach and water
    if (Math.abs(z) < 140 && x > LANE.min + 200 && x < enemy.x + 600) continue;
    if (d < BASE && h > 160) continue;
    if (Math.hypot(x - LAGOON[0], z - LAGOON[1]) < LAGOON[2] + 50) continue;
    palms.push([x, h, z, rnd(0.8, 1.4), rnd(0, Math.PI * 2)]);
  }
  // A palm: a leaning trunk and a crown of drooping fronds.
  const fronds = [];
  for (let k = 0; k < 6; k++) {
    const ay = (k / 6) * Math.PI * 2;
    fronds.push(
      new THREE.BoxGeometry(7, 0.3, 1.8)
        .translate(3.2, 0, 0)
        .rotateZ(-0.35)
        .rotateY(ay)
        .translate(0, 12, 0),
    );
  }
  const crownG = mergeGeometries(fronds);
  for (const g of fronds) g.dispose();
  const crowns = new THREE.InstancedMesh(crownG, M(0x3d8a35), palms.length),
    trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.4, 0.6, 12, 5).translate(0, 6, 0),
      M(0x7a5a3a),
      palms.length,
    );
  const palmM = palms.map(([x, y, z, s, ay]) => {
    q.setFromEuler(new THREE.Euler(0, ay, rnd(-0.12, 0.12)));
    return mx.compose(at.set(x, y, z), q, sc.set(s, s, s)).clone();
  });
  q.identity();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  // Palms in the way of a team's field are put away while it stands.
  function showPalms(hide = () => false) {
    palms.forEach(([x, , z], i) => {
      const m = hide(x, z) ? zero : palmM[i];
      crowns.setMatrixAt(i, m);
      trunks.setMatrixAt(i, m);
    });
    crowns.instanceMatrix.needsUpdate =
      trunks.instanceMatrix.needsUpdate = true;
  }
  showPalms();
  group.add(crowns, trunks);

  // ── The plain's airfields, road and town, a few metres up ─────────────
  const plain = new THREE.Group();
  plain.position.y = PLAIN;
  put(
    plain,
    flat(LANE.max - LANE.min + 600, 9, 0xb9a47c, -1),
    (LANE.min + LANE.max) / 2,
    0.03,
    0,
  );
  runway(home, 0x55ffff, plain);
  runway(enemy, 0xff55ff, plain);
  dressing(plain);
  group.add(plain);
  // On the lagoon's sand, where the hippos come down to the water.
  const lily = [];
  for (let i = 0; i < 14; i++) {
    const a = rnd(0, Math.PI * 2),
      d = rnd(20, LAGOON[2] - 15);
    lily.push([LAGOON[0] + Math.cos(a) * d, LAGOON[1] + Math.sin(a) * d]);
  }
  group.add(kit.decals(lily, 5, 5, 0x3d8a35, -3, 0));

  // ── Rules ─────────────────────────────────────────────────────────────
  const avoid = avoider(height, 0);
  function crash(p) {
    if (cone(p.x, p.z) > PLAIN + 1) return "Flew into the volcano";
    const h = lowland(p.x, p.z);
    if (h < 0.5) return "Ditched in the sea";
    if (h > PLAIN + 1) return "Flew into the island";
    return "Crashed — land on a runway";
  }

  let ashT = 0,
    smokeT = 0,
    ventT = 0,
    craterT = 0;
  const tv = new THREE.Vector3();
  function tick(dt) {
    clock += dt;
    drawPlume();
    // Smoke from the crater now and then, and heat off the vents.
    if ((craterT -= dt) <= 0) {
      craterT = 0.5 + Math.random() * 0.8;
      puff(
        tv.set(
          VX + (Math.random() - 0.5) * 60,
          FLOOR + 30,
          VZ + (Math.random() - 0.5) * 60,
        ),
        0x6a6460,
        1,
        4,
        14,
        6,
        14,
      );
    }
    if ((ventT -= dt) <= 0) {
      ventT = 0.35;
      const v = vents[(Math.random() * vents.length) | 0];
      puff(tv.set(v.x, v.y + 12, v.z), 0xffa040, 1, 4, 2.5, 1.2, 16);
      puff(tv, 0x9a8f86, 1, 3, 6, 3, 20);
    }
    if (!P.alive || P.grounded) {
      // A fresh plane (or a dead one) has a clean engine.
      ashT = 0;
      land.power = 1;
      return;
    }
    if (inAsh(P.pos)) {
      ashT = ASH;
      say("Ash in the engine!", 1.5);
    }
    if (ashT > 0) {
      ashT -= dt;
      land.power = ashT > 0 ? 0 : 1;
      if ((smokeT -= dt) <= 0) {
        smokeT = 0.05;
        puff(P.pos, 0x2e2a28, 1, 2, 1.6, 1.4, 1);
      }
    }
    if (P.pos.y < UP.top)
      for (const v of vents)
        if (Math.hypot(P.pos.x - v.x, P.pos.z - v.z) < UP.r) {
          P.pos.y += UP.rate * dt;
          P.sink = 0;
          say("Updraft!", 0.8);
          break;
        }
  }

  // A team game: the ring's spots all lie on the flat plain, so a field is
  // just its runway and hangar, the palms cleared off it.
  const standing = [];
  function field(f, c) {
    const g = new THREE.Group();
    g.position.y = PLAIN;
    runway({ x: 0, z: 0, hl: f.hl, hw: f.hw }, c.plane[2], g);
    hangar(-120, -70, c.plane[1], false, g);
    f.g.add(g);
    standing.push(f);
    showPalms((x, z) =>
      standing.some(
        (s) => Math.abs(x - s.x) < s.hl + 70 && Math.abs(z - s.z) < 110,
      ),
    );
    return [{ x: f.x - 120, z: f.z - 70, r: 17, h: 12.5 + PLAIN }];
  }
  function unfield() {
    standing.length = 0;
    showPalms();
  }

  return {
    group,
    vents,
    land: {
      height,
      floor: height,
      crash,
      avoid,
      dust: 0x8a7e70,
      town: TDEF,
      tick,
      field,
      unfield,
    },
    home,
    enemy,
    // The airfields' buildings stand on the plain.
    solids: COUNTRY.solids.map((s) => ({ ...s, h: s.h + PLAIN })),
    hippos: [
      [LAGOON[0] - 40, LAGOON[1] - 10, -1.6],
      [LAGOON[0], LAGOON[1] + 15, -1.8],
      [LAGOON[0] + 40, LAGOON[1] - 5, -1.5],
    ],
    sky: 0x9fdcf5,
    fog: [900, 4400],
    below: 0x4f7f50,
    enter() {
      ashT = 0;
    },
    leave() {
      ashT = 0;
      land.power = 1;
    },
  };
}

// For the tests: where things are.
export const VOLCANO = {
  VX,
  VZ,
  BASE,
  RIM,
  TOP,
  PLAIN,
  PLUME,
  UP,
  LAGOON,
  HILLS,
  vents,
};
