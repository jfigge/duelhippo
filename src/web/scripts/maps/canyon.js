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

// maps/canyon.js — the Canyon: a sandstone plateau cut by a winding river
// gorge. The two airfields lie in basins on the gorge floor, the enemy town
// stands along the river between them, three natural arches span the gorge,
// and flak batteries on the rim guard the town.
//
// The ground is one height grid, drawn as exactly the triangles groundY
// interpolates, so a wall is where it looks to be. It is fine across the
// gorge and coarse on the open plateau, to stay inside a phone's budget.
// Buttes and arches are meshes of their own with analytic heights: an arch
// has room under it, so below its vault the ground is the gorge floor.

import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CX, TDEF } from "../constants.js";
import { targets } from "../world.js";

// The plateau's height, and the gorge: straight through both basins, and
// winding in three bends between X1 and X2 (its centreline's z there is
// A·sin(3πu)·sin(πu), which leaves both runways' approaches straight). It
// heads in box canyons at XW and XE, inside where a plane turns back.
const PLATEAU = 250;
// The height grid reaches this far from (CX, 0), past where a plane turns
// back (3500 m).
const EDGE = 3700;
const X1 = 500,
  X2 = 2350,
  A = 210,
  XW = -1300,
  XE = 4250;
// The basins the runways lie in, [x, z, half-x, half-z]. The enemy's holds
// where its flyers appear (ai.js spawnEnemy: EB.x −250…+350, z ±300) below
// the rim.
const BASINS = [
  [0, 0, 620, 300],
  [2850, 0, 680, 410],
];
// Side canyons off the gorge, [x where they leave it, end x, end z].
const GULLIES = [
  [820, 700, 820],
  [1440, 1560, -900],
  [2120, 2280, 760],
];
// The arches: [x on the gorge, top, height of the vault, thickness].
const ARCHES = [
  [1040, 120, 72, 36],
  [1720, PLATEAU - 4, 150, 46],
  [2050, 190, 108, 40],
];
// Flak batteries on the rim: [x, side of the gorge].
const FLAK = [
  [1300, -1],
  [1620, 1],
  [1980, -1],
  [2300, 1],
];
// A burst of five, 0.12 s apart, 1.5 s between bursts, within 600 m.
const BURST = { n: 5, gap: 0.12, rest: 1.5, range: 600, spread: 0.03 };
// The river runs this far off the centreline, on the side away from the
// airfields' hangars, so the town on the centreline stands on dry ground.
const RIVER = 52;

const STRATA = [
  0xc0623a, 0xd27a45, 0xb4532f, 0xe09a5e, 0xc96d3e, 0xa94a2c, 0xd8874f,
  0xe6ad72,
];
const TOPS = [0xd9a76a, 0xd19c5f, 0xdcb078, 0xc99358, 0xc4a465];
const SAND = [0xdcb682, 0xd4ab74, 0xe0bd8a, 0xcfa56c];

export default function build(kit) {
  const { THREE, seeded, put, box, M, COUNTRY } = kit;
  const rand = seeded(1869),
    rnd = (a, b) => a + rand() * (b - a);
  const group = new THREE.Group();
  const home = { ...COUNTRY.home },
    enemy = { ...COUNTRY.enemy };
  const ph = [rnd(0, 6), rnd(0, 6), rnd(0, 6), rnd(0, 6)];

  // ── The gorge, as a shape ─────────────────────────────────────────────────
  const L = X2 - X1;
  const cz = (x) => {
    if (x <= X1 || x >= X2) return 0;
    const u = (x - X1) / L;
    return A * Math.sin(3 * Math.PI * u) * Math.sin(Math.PI * u);
  };
  const slope = (x) => cz(x + 0.5) - cz(x - 0.5);
  const floorW = (x) => 110 + 14 * Math.sin(x / 290 + ph[0]);
  const wallW = (x) => 85 + 22 * Math.sin(x / 180 + ph[1]);
  // A wall's profile, 0 at its foot to 1 at the rim: a talus, a cliff, a
  // ledge, and an upper cliff.
  const PROFILE = [
    [0, 0],
    [0.15, 0.08],
    [0.42, 0.52],
    [0.55, 0.58],
    [0.85, 0.96],
    [1, 1],
  ];
  const profile = (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let k = 1;
    while (PROFILE[k][0] < t) k++;
    const [t0, h0] = PROFILE[k - 1],
      [t1, h1] = PROFILE[k];
    return h0 + ((t - t0) / (t1 - t0)) * (h1 - h0);
  };
  const segDist = (x, z, ax, az, bx, bz) => {
    const dx = bx - ax,
      dz = bz - az,
      t = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)),
      );
    return [Math.hypot(x - ax - dx * t, z - az - dz * t), t];
  };
  // How far (m) a point is outside the gorge floor, a basin or a side
  // canyon: 0 on the floor.
  function outside(x, z) {
    let e;
    if (x < XW) e = Math.hypot(x - XW, z) - floorW(XW);
    else if (x > XE) e = Math.hypot(x - XE, z) - floorW(XE);
    else {
      const s = slope(x);
      e = Math.abs(z - cz(x)) / Math.sqrt(1 + s * s) - floorW(x);
    }
    for (const [bx, bz, a, b] of BASINS)
      e = Math.min(e, (Math.hypot((x - bx) / a, (z - bz) / b) - 1) * b);
    for (const [gx, ex, ez] of GULLIES) {
      const [d, t] = segDist(x, z, gx, cz(gx), ex, ez);
      e = Math.min(e, d - (40 - 26 * t));
    }
    return Math.max(0, e);
  }
  // The plateau rolls a little, but not at the rim, nor at the grid's edge
  // (EDGE), where the flat plateau beyond it begins.
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function base(x, z) {
    const t = outside(x, z) / wallW(x),
      edge = EDGE - Math.max(Math.abs(x - CX), Math.abs(z)),
      wob =
        3.5 * Math.sin(x / 210 + ph[2]) * Math.cos(z / 260 + ph[3]) +
        1.5 * Math.sin((x + z) / 97);
    return (
      profile(t) * PLATEAU +
      wob * clamp01((t - 0.85) / 0.15) * clamp01(edge / 400)
    );
  }

  // ── The height grid ───────────────────────────────────────────────────────
  // Spacing [from, to, about]: 35 × 25 m over the gorge, coarser beyond.
  const axis = (parts) => {
    const out = [parts[0][0]];
    for (const [a, b, s] of parts) {
      const n = Math.round((b - a) / s);
      for (let k = 1; k <= n; k++) out.push(a + ((b - a) * k) / n);
    }
    return Float64Array.from(out);
  };
  const xs = axis([
      [CX - EDGE, -1700, 75],
      [-1700, 4500, 35],
      [4500, CX + EDGE, 75],
    ]),
    zs = axis([
      [-EDGE, -800, 80],
      [-800, 800, 25],
      [800, EDGE, 80],
    ]);
  const nx = xs.length,
    nz = zs.length;
  // Which cell a coordinate is in, quickly: a 5 m table, then a step or two.
  const lookup = (a) => {
    const t = new Int32Array(Math.ceil((a[a.length - 1] - a[0]) / 5) + 1);
    let i = 0;
    for (let k = 0; k < t.length; k++) {
      while (i < a.length - 2 && a[i + 1] <= a[0] + k * 5) i++;
      t[k] = i;
    }
    return (v) => {
      let i = t[Math.floor((v - a[0]) / 5)];
      while (i < a.length - 2 && a[i + 1] <= v) i++;
      return i;
    };
  };
  const cellX = lookup(xs),
    cellZ = lookup(zs);
  const H0 = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) H0[j * nx + i] = base(xs[i], zs[j]);
  const H = H0.slice();

  // The grid's height at (x, z), on the very triangle drawn there.
  function gridAt(x, z) {
    if (x <= xs[0] || x >= xs[nx - 1] || z <= zs[0] || z >= zs[nz - 1])
      return PLATEAU;
    const i = cellX(x),
      j = cellZ(z),
      u = (x - xs[i]) / (xs[i + 1] - xs[i]),
      v = (z - zs[j]) / (zs[j + 1] - zs[j]),
      k = j * nx + i,
      h00 = H[k],
      h10 = H[k + 1],
      h01 = H[k + nx],
      h11 = H[k + nx + 1];
    return u >= v
      ? h00 + u * (h10 - h00) + v * (h11 - h10)
      : h00 + v * (h01 - h00) + u * (h11 - h01);
  }

  // ── Buttes: tall stepped towers of rock out on the plateau ────────────────
  // Beyond the ring the team fields stand round (net/teams.js RING, 1900 m),
  // and clear of where a flyer in Endless enemies appears.
  const buttes = [];
  for (let tries = 0; buttes.length < 7 && tries < 400; tries++) {
    const r = rnd(90, 170),
      a = rnd(0, Math.PI * 2),
      d = rnd(2450 + r * 1.4, 3250),
      x = CX + Math.cos(a) * d,
      z = Math.sin(a) * d;
    if (Math.abs(x - CX) > 3350 || Math.abs(z) > 3350) continue;
    if (Math.abs(z) < r * 1.4 + 700) continue; // the gorge, and its heads
    if (buttes.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r + 300))
      continue;
    const top = rnd(360, 470),
      rise = top - PLATEAU;
    // [radius, height], from the foot in: a talus, a cliff, a ledge, a
    // cliff and the cap.
    const prof = [
      [r * 1.4, PLATEAU - 12],
      [r * 1.25, PLATEAU + rise * 0.1],
      [r * 1.02, PLATEAU + rise * 0.18],
      [r * 0.96, PLATEAU + rise * 0.55],
      [r * 0.84, PLATEAU + rise * 0.6],
      [r * 0.78, top - 4],
      [r * 0.7, top],
      [0, top + 2],
    ];
    buttes.push({ x, z, r, reach: r * 1.4, prof });
  }
  function butteAt(b, x, z) {
    const d = Math.hypot(x - b.x, z - b.z),
      p = b.prof;
    if (d >= p[0][0]) return -Infinity;
    let k = 1;
    while (p[k][0] > d) k++;
    const [r0, h0] = p[k - 1],
      [r1, h1] = p[k];
    return h0 + ((r0 - d) / (r0 - r1)) * (h1 - h0);
  }

  // The bare ground: the grid, and the buttes on it.
  function floor(x, z) {
    let h = gridAt(x, z);
    for (const b of buttes)
      if (Math.abs(x - b.x) < b.reach && Math.abs(z - b.z) < b.reach)
        h = Math.max(h, butteAt(b, x, z));
    return h;
  }

  // ── Arches ────────────────────────────────────────────────────────────────
  // Each is a slab of rock across the gorge, square to it, [lx, y] profiles
  // across (lx is along (sin θ, −cos θ), θ the gorge's heading): its top,
  // and the vault under it, which meets the floor at ±open.
  const arches = ARCHES.map(([x, top, vault, T]) => {
    const z = cz(x),
      th = Math.atan(slope(x)),
      F = floorW(x),
      span = F + wallW(x) + 40,
      open = F + 0.3 * wallW(x),
      N = 22,
      tops = [],
      vaults = [[-open, 0]];
    for (let k = 0; k <= N; k++) {
      const lx = -span + (2 * span * k) / N,
        q = lx / span;
      tops.push([lx, top + 6 * (1 - q * q) + rnd(-2, 2)]);
    }
    for (let k = 1; k < N; k++) {
      const lx = -open + (2 * open * k) / N,
        q = lx / open;
      vaults.push([lx, vault * Math.pow(1 - q * q, 0.45) + rnd(-3, 3)]);
    }
    vaults.push([open, 0]);
    return {
      x,
      z,
      T,
      span,
      open,
      tops,
      vaults,
      c: Math.cos(th),
      s: Math.sin(th),
      th,
      reach: span + T,
    };
  });
  const along = (pts, v) => {
    let k = 1;
    while (k < pts.length - 1 && pts[k][0] < v) k++;
    const [a0, b0] = pts[k - 1],
      [a1, b1] = pts[k];
    return b0 + ((v - a0) / (a1 - a0)) * (b1 - b0);
  };
  // Where (x, z) is on an arch's slab, [lx], or null if it is not on one.
  function onArch(a, x, z, margin = 0) {
    if (Math.abs(x - a.x) > a.reach || Math.abs(z - a.z) > a.reach) return null;
    const dx = x - a.x,
      dz = z - a.z,
      lz = dx * a.c + dz * a.s,
      lx = dx * a.s - dz * a.c;
    if (Math.abs(lz) > a.T / 2 + margin || Math.abs(lx) > a.span + margin)
      return null;
    return lx;
  }

  // The ground under (x, z) at or below y: under a vault, the floor; in
  // the rock, or over it, the arch's top.
  function height(x, z, y = Infinity) {
    let h = floor(x, z);
    for (const a of arches) {
      const lx = onArch(a, x, z);
      if (lx === null) continue;
      if (Math.abs(lx) < a.open && y <= along(a.vaults, lx)) continue;
      h = Math.max(h, along(a.tops, Math.max(-a.span, Math.min(a.span, lx))));
    }
    return h;
  }

  // ── Drawing the ground ────────────────────────────────────────────────────
  const hash = (i, j, k) =>
    (((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) >>> 0) / 4294967296;
  const col = new THREE.Color();
  // A triangle's colour: sand on the floor, the rock's bands up the walls,
  // the plateau's top; `ny` is how level it lies.
  function shade(h, ny, n) {
    if (h < 2.5 && ny > 0.97) col.setHex(SAND[(n * SAND.length) | 0]);
    else if (h > PLATEAU - 14 && ny > 0.9)
      col.setHex(TOPS[(n * TOPS.length) | 0]);
    else col.setHex(STRATA[Math.floor((h + 7) / 26) % STRATA.length]);
    return col.multiplyScalar(0.94 + 0.1 * ((n * 7.31) % 1));
  }
  const quads = (nx - 1) * (nz - 1),
    pos = new Float32Array(quads * 18),
    cols = new Float32Array(quads * 18);
  const ground = new THREE.BufferGeometry();
  ground.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  ground.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  const va = new THREE.Vector3(),
    vb = new THREE.Vector3(),
    vc = new THREE.Vector3();
  function drawGround() {
    let o = 0;
    const tri = (i, j, k, p) => {
      va.fromArray(p, 0);
      vb.fromArray(p, 3);
      vc.fromArray(p, 6);
      vb.sub(va);
      vc.sub(va);
      const n = vb.cross(vc).normalize(),
        h = (p[1] + p[4] + p[7]) / 3;
      shade(h, n.y, hash(i, j, k));
      for (let v = 0; v < 3; v++) {
        pos.set(p.slice(v * 3, v * 3 + 3), o);
        col.toArray(cols, o);
        o += 3;
      }
    };
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const k = j * nx + i,
          p00 = [xs[i], H[k], zs[j]],
          p10 = [xs[i + 1], H[k + 1], zs[j]],
          p01 = [xs[i], H[k + nx], zs[j + 1]],
          p11 = [xs[i + 1], H[k + nx + 1], zs[j + 1]];
        // Split on the 00–11 diagonal, as gridAt reads it, wound to face up.
        tri(i, j, 0, [...p00, ...p11, ...p10]);
        tri(i, j, 1, [...p00, ...p01, ...p11]);
      }
    ground.attributes.position.needsUpdate = true;
    ground.attributes.color.needsUpdate = true;
    ground.computeVertexNormals();
    ground.computeBoundingSphere();
  }
  drawGround();
  const rock = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
  });
  group.add(new THREE.Mesh(ground, rock));

  // The plateau beyond the grid, out to the haze.
  {
    const x0 = xs[0],
      x1 = xs[nx - 1],
      z0 = zs[0],
      z1 = zs[nz - 1],
      far = 9000,
      gs = [
        [CX - far, x0, -far, far],
        [x1, CX + far, -far, far],
        [x0, x1, -far, z0],
        [x0, x1, z1, far],
      ].map(([a, b, c, d]) =>
        new THREE.PlaneGeometry(b - a, d - c)
          .rotateX(-Math.PI / 2)
          .translate((a + b) / 2, PLATEAU, (c + d) / 2),
      );
    group.add(new THREE.Mesh(mergeGeometries(gs), M(TOPS[0])));
    for (const g of gs) g.dispose();
  }

  // Colours a non-indexed geometry's triangles by height, as the walls are.
  function band(g, cap) {
    g = g.index ? g.toNonIndexed() : g;
    const p = g.attributes.position,
      c = new Float32Array(p.count * 3);
    for (let t = 0; t < p.count / 3; t++) {
      const ys = [p.getY(t * 3), p.getY(t * 3 + 1), p.getY(t * 3 + 2)],
        h = (ys[0] + ys[1] + ys[2]) / 3,
        flatTop = Math.max(...ys) - Math.min(...ys) < 1.5;
      if (flatTop && cap) col.setHex(cap);
      else col.setHex(STRATA[Math.floor((h + 7) / 26) % STRATA.length]);
      col.multiplyScalar(0.94 + 0.1 * rand());
      for (let k = 0; k < 3; k++) col.toArray(c, (t * 3 + k) * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  }

  // The buttes, turned from their profiles; a circle's worth of sides, so
  // their walls stand within a few metres of where the height says.
  {
    const gs = buttes.map((b) =>
      band(
        new THREE.LatheGeometry(
          b.prof.map(([r, h]) => new THREE.Vector2(r, h)),
          14,
        ),
        0xc8804a,
      ).translate(b.x, 0, b.z),
    );
    if (gs.length) group.add(new THREE.Mesh(mergeGeometries(gs), rock));
  }

  // The arches: each profile extruded through its thickness and turned
  // square to the gorge.
  {
    const gs = arches.map((a) => {
      const sh = new THREE.Shape();
      sh.moveTo(-a.span, -15);
      for (const [lx, y] of a.tops) sh.lineTo(lx, y);
      sh.lineTo(a.span, -15);
      sh.lineTo(a.open, -15);
      for (let k = a.vaults.length - 1; k >= 0; k--)
        sh.lineTo(a.vaults[k][0], a.vaults[k][1]);
      sh.lineTo(-a.open, -15);
      const g = new THREE.ExtrudeGeometry(sh, {
        depth: a.T,
        bevelEnabled: false,
      });
      g.translate(0, 0, -a.T / 2);
      // local x → (sin θ, −cos θ), local z → (cos θ, sin θ), as onArch
      g.rotateY(Math.PI / 2 - a.th);
      g.translate(a.x, 0, a.z);
      return band(g, null);
    });
    group.add(new THREE.Mesh(mergeGeometries(gs), rock));
  }

  // ── The river, and what grows by it ───────────────────────────────────────
  // A point `off` metres across the gorge from its centreline at x.
  const across = (x, off) => {
    const s = slope(x),
      l = Math.sqrt(1 + s * s);
    return [x - (s / l) * off, cz(x) + off / l];
  };
  {
    const p = [];
    let last = null;
    for (let x = XW - 60; x <= XE + 60; x += 15) {
      const a = across(x, RIVER - 11),
        b = across(x, RIVER + 11);
      if (last)
        p.push(
          ...[last[0][0], 0.15, last[0][1]],
          ...[b[0], 0.15, b[1]],
          ...[last[1][0], 0.15, last[1][1]],
          ...[last[0][0], 0.15, last[0][1]],
          ...[a[0], 0.15, a[1]],
          ...[b[0], 0.15, b[1]],
        );
      last = [a, b];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    group.add(
      new THREE.Mesh(
        g,
        new THREE.MeshLambertMaterial({
          color: 0x4a9fb4,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        }),
      ),
    );
  }

  const runwayNear = (x, z) =>
    [home, enemy].some(
      (R) => Math.abs(x - R.x) < R.hl + 60 && Math.abs(z - R.z) < 60,
    );
  // Hippos on the far bank, where the gorge runs straight.
  const hippos = [400, 1425, 2450].map((x) => [...across(x, 82), 0]);
  // Cottonwoods along the far bank, sage scrub on the floor and plateau.
  {
    const trees = [],
      scrub = [];
    for (let x = XW; x < XE; x += rnd(20, 70)) {
      const [tx, tz] = across(x, rnd(72, 98));
      if (runwayNear(tx, tz) || hippos.some(([hx]) => Math.abs(hx - tx) < 45))
        continue;
      if (floor(tx, tz) < 3) trees.push([tx, tz, rnd(1.2, 2)]);
    }
    for (let i = 0; scrub.length < 420 && i < 6000; i++) {
      const x = rnd(-1400, 4300),
        z = rnd(-2600, 2600),
        h = floor(x, z),
        r = Math.hypot(x - CX, z);
      if (runwayNear(x, z) || (r > 1450 && r < 2350)) continue;
      // On the floor: clear of the town on the centreline, and the river.
      const off = (z - cz(x)) / Math.hypot(1, slope(x));
      if (h < 0.5 && Math.abs(off) > 25 && Math.abs(off - RIVER) > 18)
        scrub.push([x, h, z]);
      else if (h > PLATEAU - 6 && rand() < 0.4) scrub.push([x, h, z]);
    }
    const mx = new THREE.Matrix4(),
      at = new THREE.Vector3(),
      q = new THREE.Quaternion(),
      sc = new THREE.Vector3();
    const crowns = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0),
        M(0x6f9a3e),
        trees.length,
      ),
      trunks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.5, 0.7, 1, 5),
        M(0x6b4a2a),
        trees.length,
      );
    trees.forEach(([x, z, s], i) => {
      crowns.setMatrixAt(
        i,
        mx.compose(at.set(x, 7 * s, z), q, sc.set(4 * s, 3.6 * s, 4 * s)),
      );
      trunks.setMatrixAt(
        i,
        mx.compose(at.set(x, 2.5 * s, z), q, sc.set(s, 5 * s, s)),
      );
    });
    const bush = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      M(0x8d9a55),
      scrub.length,
    );
    scrub.forEach(([x, h, z], i) =>
      bush.setMatrixAt(
        i,
        mx.compose(
          at.set(x, h + 0.6, z),
          q,
          sc.set(rnd(2.5, 5), rnd(1.4, 2.6), rnd(2.5, 5)),
        ),
      ),
    );
    group.add(crowns, trunks, bush);
  }

  // ── Airfields ─────────────────────────────────────────────────────────────
  kit.runway(home, 0x55ffff, group);
  kit.runway(enemy, 0xff55ff, group);
  kit.dressing(group);

  // ── The town, and its flak ────────────────────────────────────────────────
  // A battery on the rim: just back from the edge, so it can see down into
  // the gorge, and the rim shields whatever is close under it.
  const batteries = FLAK.map(([x, side]) => {
    let d = floorW(x);
    while (d < 400 && gridAt(...across(x, side * d)) < PLATEAU - 4) d += 2;
    return [...across(x, side * (d + 4))];
  });
  const town = [
    ...TDEF.map(([kind, x]) => [kind, x, null, cz(x)]),
    ...batteries.map(([x, z]) => ["flak", x, null, z]),
  ];
  const kinds = {
    flak(g) {
      put(
        g,
        new THREE.Mesh(
          new THREE.CylinderGeometry(6.5, 7, 2.2, 10, 1, true),
          new THREE.MeshLambertMaterial({
            color: 0xa8915e,
            flatShading: true,
            side: THREE.DoubleSide,
          }),
        ),
        0,
        1.1,
        0,
      );
      put(g, box(5, 1.2, 5, 0x6f6a5e), 0, 0.6, 0);
      put(g, box(2.4, 2.2, 2.4, 0x4a4a50), 0, 2.2, 0);
      put(g, box(3, 0.4, 3, 0xb03aa0), 0, 3.5, 0);
      for (const s of [-0.5, 0.5]) {
        const b = put(g, box(0.35, 0.35, 5, 0x2e2e33), s, 4.2, 1.6);
        b.rotation.x = -0.7;
      }
      return { r: 8, h: 5, hp: 3, pts: 150, name: "Flak battery" };
    },
  };
  const muzzle = new THREE.Vector3();
  function tick(dt) {
    for (const t of targets) {
      if (t.kind !== "flak" || !t.alive) continue;
      t.flak ??= { cd: Math.random() * BURST.rest, n: 0 };
      const f = t.flak;
      if ((f.cd -= dt) > 0) continue;
      muzzle.set(t.x, t.y + 5, t.z);
      if (kit.flakAt(muzzle, BURST.range, BURST.spread)) {
        f.cd = ++f.n >= BURST.n ? ((f.n = 0), BURST.rest) : BURST.gap;
        kit.puff(muzzle, 0x555555, 1, 2, 1, 0.6, 3);
      } else {
        f.n = 0;
        f.cd = 0.25;
      }
    }
  }

  // ── Crashes ───────────────────────────────────────────────────────────────
  const pads = [];
  const onPad = (x, z) =>
    pads.some((f) => Math.abs(x - f.x) < f.hl + 90 && Math.abs(z - f.z) < 160);
  function crash(p) {
    if (arches.some((a) => onArch(a, p.x, p.z, 6) !== null))
      return "Hit the arch";
    return floor(p.x, p.z) > 2.5 && !onPad(p.x, p.z)
      ? "Flew into the canyon wall"
      : "Crashed — land on a runway";
  }

  // ── Team fields ───────────────────────────────────────────────────────────
  // Each on a flat pad cut or built where its spot falls: the gorge floor
  // if that is under it, else the plateau. The pad is flat well past the
  // runway's cells (the grid is at most 81 m apart) and the hangar, and
  // blends back into the ground over 120 m.
  function field(f, c) {
    const y = base(f.x, f.z) > PLATEAU / 2 ? PLATEAU : 0,
      hx = f.hl + 90,
      hz = 160,
      blend = 120;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const e = Math.hypot(
          Math.max(0, Math.abs(xs[i] - f.x) - hx),
          Math.max(0, Math.abs(zs[j] - f.z) - hz),
        );
        if (e >= blend) continue;
        const s = e / blend,
          w = 1 - s * s * (3 - 2 * s),
          k = j * nx + i;
        H[k] += (y - H[k]) * w;
      }
    drawGround();
    pads.push(f);
    const on = new THREE.Group();
    on.position.y = y;
    f.g.add(on);
    kit.runway({ x: 0, z: 0, hl: f.hl, hw: f.hw }, c.plane[2], on);
    kit.hangar(-120, -70, c.plane[1], false, on);
    return [{ x: f.x - 120, z: f.z - 70, r: 17, h: y + 12.5 }];
  }
  function unfield() {
    if (!pads.length) return;
    pads.length = 0;
    H.set(H0);
    drawGround();
  }

  return {
    group,
    // for the tests: the gorge's centreline z(x), and what stands in it
    centre: cz,
    slope,
    arches,
    buttes,
    batteries,
    land: {
      height,
      floor,
      crash,
      dust: 0xc9a06a,
      avoid: kit.avoider(height, 0),
      town,
      kinds,
      tick,
      field,
      unfield,
    },
    home,
    enemy,
    solids: COUNTRY.solids,
    hippos,
    sky: 0xf0cfa2,
    fog: [650, 3300],
    below: 0xc07a45,
  };
}
