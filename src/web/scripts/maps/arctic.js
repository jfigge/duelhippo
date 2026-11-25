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

// maps/arctic.js — the Arctic: a frozen fjord between mountains, rolling
// snowfields beyond. Both runways are swept strips on the fjord's ice, where
// a plane slides a long way before it stops (so the ice runs on past each
// strip's ends). The enemy's supply convoy drives up and down the fjord to
// be bombed, blizzards drift over the hills, and the hippos, improbably,
// have found a meadow on the shore.

import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { targets } from "../world.js";

// The fjord: flat ice at y = 0 for |z| < hw, from x0 to x1, its ends rounded.
export const FJORD = { x0: -700, x1: 3600, hw: 175 };
// The convoy's line on the ice: north of the runways, clear of the hangars
// on the south side, and its speed (m/s).
export const CONVOY = { z: 70, speed: 8 };
// The blizzards' home spots ([x, z, radius]); each drifts round its own on a
// slow circle (DRIFT m, once every PERIOD s). `blizzards` is where they are.
const STORMS = [
  [1650, 0, 420],
  [500, -950, 330],
  [2450, 1150, 380],
];
const DRIFT = 140,
  PERIOD = 300;
export const blizzards = STORMS.map(([x, z, r], i) => ({
  x,
  z,
  r,
  x0: x,
  z0: z,
  ph: (i * 2 * Math.PI) / 3,
}));
// The fog inside one ([near, far]), and how fast it closes in and lifts (a
// share of the way per second).
const WHITEOUT = [60, 350],
  CLOSE = 0.7;
// Braking on the ice strips, throttle idle (7 on dry ground): a roll-out
// slides about twice as far.
const BRAKE = 2.5;

// The ground mesh: CELLS × CELLS cells, STEP m square, centred on the play
// area with 700 m to spare: 56,448 triangles, inside a phone's budget. Past
// it, a flat snowfield.
const STEP = 50,
  CELLS = 168,
  X0 = 1400 - (CELLS * STEP) / 2, // about CX
  Z0 = -(CELLS * STEP) / 2,
  ROW = CELLS + 1;

const SNOW = [0xdde5ec, 0xd5dee6, 0xe4ebf1, 0xcfd9e2],
  ROCK = [0x7a7f88, 0x6c717a, 0x868a92, 0x8f8a86],
  ICE = [0xa6d0e4, 0x9ccadf, 0xb0d7e9, 0x94c2d9],
  STRIP = 0xe6f3f9,
  PAINT = 0x4f7591;

// Out on the fjord's ice (or within a metre of its shore).
const onIce = (x, z) =>
  Math.hypot(x - Math.min(FJORD.x1, Math.max(FJORD.x0, x)), z) <= FJORD.hw + 1;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// The convoy's vehicles (world.js makeTarget), built along +x, in winter
// white with the enemy's magenta on top.
const KINDS = {
  truck(g, { THREE, box, put, M }) {
    put(g, box(3.2, 3, 3, 0xd9dcd6), 4.6, 2.3, 0);
    put(g, box(0.2, 1.2, 2.6, 0x4a5a6a), 6.25, 2.9, 0);
    put(g, box(7.4, 0.6, 3, 0x5a5d58), -0.6, 1.1, 0);
    put(g, box(6.6, 3.2, 3.2, 0x8f957d), -1.2, 3, 0);
    put(g, box(5, 0.3, 2.4, 0xb03aa0), -1.2, 4.75, 0);
    wheels(g, THREE, put, M, [4.4, -1, -3.4], 1.7, 0.75);
    return { r: 7, h: 5, hp: 3, pts: 120, name: "Truck" };
  },
  halftrack(g, { THREE, box, put, M }) {
    put(g, box(7.5, 2.2, 3, 0xcfd3cb), 0, 2.1, 0);
    put(g, box(2.6, 1.4, 2.6, 0xbfc4ba), 3.4, 3.2, 0);
    put(g, box(3.4, 0.6, 2.4, 0xb03aa0), -1.6, 3.5, 0);
    put(g, box(1.6, 0.4, 0.4, 0x333333), -0.6, 4, 0).rotation.z = 0.15;
    for (const s of [-1, 1])
      put(g, box(4.6, 1.3, 0.8, 0x3a3a3a), -1.4, 0.75, s * 1.35);
    wheels(g, THREE, put, M, [2.8], 1.4, 0.6);
    return { r: 7, h: 4.5, hp: 4, pts: 150, name: "Half-track" };
  },
  sled(g, { THREE, box, put, M }) {
    // A small tracked tractor towing a sledge with a fuel tank on it.
    put(g, box(3, 1.8, 2.6, 0xd9dcd6), 5, 1.4, 0);
    put(g, box(1.6, 1.2, 2, 0xb03aa0), 4.6, 2.9, 0);
    for (const s of [-1, 1]) {
      put(g, box(3.2, 0.9, 0.6, 0x3a3a3a), 5, 0.45, s * 1.25);
      put(g, box(8, 0.3, 0.3, 0x5a5d58), -2.5, 0.15, s * 1.2);
    }
    put(g, box(1.6, 0.3, 0.3, 0x5a5d58), 2.6, 0.5, 0);
    put(g, box(7.6, 0.4, 2.8, 0x7a5a3a), -2.5, 0.6, 0);
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.3, 7, 10),
      M(0xc23b3b),
    );
    tank.rotation.z = Math.PI / 2;
    put(g, tank, -2.5, 2.1, 0);
    put(g, box(1, 2.7, 2.7, 0xb03aa0), -2.5, 2.1, 0);
    return { r: 8, h: 3.5, hp: 2, pts: 100, name: "Fuel sled" };
  },
};
function wheels(g, THREE, put, M, xs, sz, r) {
  const wg = new THREE.CylinderGeometry(r, r, 0.4, 10);
  for (const x of xs)
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wg, M(0x222222));
      w.rotation.x = Math.PI / 2;
      put(g, w, x, r, s * sz);
    }
}
// Nose to tail, 40 m apart, heading up the fjord from its middle.
const COLUMN = [
  "halftrack",
  "truck",
  "sled",
  "truck",
  "sled",
  "truck",
  "sled",
  "halftrack",
];
const LEAD = 1700,
  TOWN = COLUMN.map((k, i) => [k, LEAD - i * 40, null, CONVOY.z]);

// Where the column is `T` s after the game began: how far it has driven
// from where it started (`off`, m) and the way its vehicles face (`yaw`).
// It drives up the fjord first; when its lead nears the head it turns round
// together, and again when its tail nears the foot, so it never drives
// through itself; each turn takes 1.2 rad/s. A function of time, not of
// the frames flown, so in a team game every machine has it in one place.
const UP = FJORD.x1 - 30 - LEAD,
  DOWN = FJORD.x0 + 30 - (LEAD - (COLUMN.length - 1) * 40),
  RUN = UP - DOWN;
export function convoyAt(T, out = {}) {
  const p = (((CONVOY.speed * T - DOWN) % (2 * RUN)) + 2 * RUN) % (2 * RUN),
    up = p < RUN,
    turned = Math.min(Math.PI, (1.2 * (up ? p : p - RUN)) / CONVOY.speed);
  out.off = DOWN + (up ? p : 2 * RUN - p);
  out.yaw = up ? Math.PI - turned : turned;
  return out;
}

export default function build(kit) {
  const { THREE, P, put, flat, M, scene } = kit;
  const rand = kit.seeded(1912),
    rnd = (a, b) => a + rand() * (b - a);
  const group = new THREE.Group();
  const home = { ...kit.COUNTRY.home },
    enemy = { ...kit.COUNTRY.enemy };

  // ── The ground ──────────────────────────────────────────────────────────
  // Peaks either side of the fjord ([x, z, rx, rz, top]), in two ranks:
  // the front rank's rise straight from the shore, the back rank's behind
  // them. Both stand back, and lower, by the enemy's field, where its
  // flyers start and circle (ai.js: within 300 m of the fjord's line, at
  // 220 m and up). A range closes the fjord's head.
  const peaks = [];
  for (const s of [-1, 1])
    for (const [near, far, lo, hi] of [
      [330, 470, 240, 370],
      [600, 780, 170, 300],
    ])
      for (let x = -760; x <= 3700; x += rnd(220, 300)) {
        const nearEB = Math.abs(x - enemy.x) < 650;
        peaks.push([
          x + rnd(-40, 40),
          s * (nearEB ? rnd(near, far) + 190 : rnd(near, far)),
          rnd(200, 300),
          rnd(170, 230),
          nearEB ? rnd(lo, hi) * 0.75 : rnd(lo, hi),
        ]);
      }
  for (const z of [-420, 0, 420])
    peaks.push([rnd(4050, 4250), z + rnd(-60, 60), 320, 260, rnd(260, 340)]);

  // The ground before any levelling: ice in the fjord, a snow bank round
  // it, rolling hills beyond, and the mountains; easing down to nothing at
  // the mesh's edge, where the flat snowfield takes over.
  function raw(x, z) {
    const fx = Math.min(FJORD.x1, Math.max(FJORD.x0, x)),
      d = Math.hypot(x - fx, z) - FJORD.hw;
    if (d <= 0) return 0;
    let h =
      (40 +
        26 * Math.sin(x * 0.0023 + 0.7) * Math.cos(z * 0.0019 - 0.4) +
        12 * Math.sin(x * 0.0051 + z * 0.0037 + 2.1)) *
      smooth(d / 70);
    const bank = smooth(d / 50);
    for (const [px, pz, rx, rz, top] of peaks) {
      if (Math.abs(x - px) > rx || Math.abs(z - pz) > rz) continue;
      const q = 1 - Math.hypot((x - px) / rx, (z - pz) / rz);
      if (q > 0)
        h = Math.max(
          h,
          top * (0.5 * q + 0.5 * q * q * (3 - 2 * q)) * bank +
            9 * q * Math.sin(x * 0.031) * Math.cos(z * 0.027),
        );
    }
    const edge = Math.min(
      x - X0,
      X0 + CELLS * STEP - x,
      z - Z0,
      Z0 + CELLS * STEP - z,
    );
    return h * smooth((edge - 50) / 500);
  }

  // Levelled ground ({x, z, hx, hz, y, b}): flat at y over the rectangle,
  // blending back to the land over b metres. The hippos' meadow, and in a
  // team game each team's pad.
  const meadow = { x: 1050, z: 225, hx: 150, hz: 35, y: 3, b: 110 },
    flats = [meadow];
  function level(x, z) {
    let h = raw(x, z);
    if (onIce(x, z)) return h;
    for (const f of flats) {
      const e = Math.hypot(
        Math.max(0, Math.abs(x - f.x) - f.hx),
        Math.max(0, Math.abs(z - f.z) - f.hz),
      );
      if (e === 0) h = f.y;
      else if (e < f.b) h += (f.y - h) * smooth(1 - e / f.b);
    }
    return h;
  }

  // The ground's heights at the grid's corners; between them, the very
  // triangles the mesh draws, so what you see is what you hit.
  // A team field marks them `stale` and they are surveyed again when next
  // asked for, so eight fields cost one survey, not eight.
  const H = new Float32Array(ROW * ROW);
  let stale = false;
  function survey() {
    stale = false;
    for (let j = 0; j < ROW; j++)
      for (let i = 0; i < ROW; i++)
        H[j * ROW + i] = level(X0 + i * STEP, Z0 + j * STEP);
  }
  survey();
  function height(x, z) {
    if (stale) survey();
    const u = (x - X0) / STEP,
      v = (z - Z0) / STEP;
    if (!(u >= 0 && v >= 0 && u < CELLS && v < CELLS)) return 0;
    const i = u | 0,
      j = v | 0,
      fu = u - i,
      fv = v - j,
      k = j * ROW + i,
      a = H[k],
      d = H[k + 1],
      b = H[k + ROW],
      c = H[k + ROW + 1];
    return fu + fv <= 1
      ? a + fu * (d - a) + fv * (b - a)
      : c + (1 - fu) * (b - c) + (1 - fv) * (d - c);
  }

  // One mesh, a shade per triangle: ice where the fjord is flat, rock where
  // the mountainside is too steep to hold snow, snow everywhere else.
  const nTri = CELLS * CELLS * 2,
    pos = new Float32Array(nTri * 9),
    col = new Float32Array(nTri * 9),
    shade = Float32Array.from({ length: nTri }, () => rand()),
    geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  terrain.name = "arctic-terrain";
  group.add(terrain);
  const tc = new THREE.Color();
  function draw() {
    if (stale) survey();
    let t = 0;
    const tri = (i0, j0, i1, j1, i2, j2) => {
      const o = t * 9;
      let lo = Infinity,
        hi = -Infinity;
      for (const [k, i, j] of [
        [0, i0, j0],
        [1, i1, j1],
        [2, i2, j2],
      ]) {
        const y = H[j * ROW + i];
        pos[o + k * 3] = X0 + i * STEP;
        pos[o + k * 3 + 1] = y;
        pos[o + k * 3 + 2] = Z0 + j * STEP;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      const cx = X0 + ((i0 + i1 + i2) / 3) * STEP,
        cz = Z0 + ((j0 + j1 + j2) / 3) * STEP,
        pal =
          hi === 0 && onIce(cx, cz)
            ? ICE
            : hi - lo > 42 && hi > 40
              ? ROCK
              : SNOW;
      tc.setHex(pal[(shade[t] * pal.length) | 0]);
      for (let k = 0; k < 3; k++) tc.toArray(col, o + k * 3);
      t++;
    };
    for (let j = 0; j < CELLS; j++)
      for (let i = 0; i < CELLS; i++) {
        tri(i, j, i, j + 1, i + 1, j);
        tri(i, j + 1, i + 1, j + 1, i + 1, j);
      }
    geo.attributes.position.needsUpdate =
      geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }
  draw();
  put(group, flat(16000, 16000, SNOW[1], 0), 1400, -0.3, 0);

  // Snow-laden pines on the gentler slopes, out of the way of the ice and
  // the meadow (and, put away while a team game lasts, the team pads).
  const woods = [];
  for (let n = 0; n < 2600 && woods.length < 520; n++) {
    const x = rnd(-2100, 4900),
      z = rnd(-3400, 3400),
      h = raw(x, z);
    if (h < 6 || h > 140 || Math.abs(raw(x + 20, z) - h) > 14) continue;
    if (Math.abs(z) < FJORD.hw + 60 && x > FJORD.x0 - 300) continue;
    woods.push([x, z, rnd(0.8, 1.6), rnd(0, 6.3)]);
  }
  const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(4, 11, 6),
      M(0x2f5a3c),
      woods.length,
    ),
    caps = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.4, 4.5, 6),
      M(0xeef3f7),
      woods.length,
    ),
    mx = new THREE.Matrix4(),
    at = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    sc = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0);
  function plant() {
    woods.forEach(([x, z, s, a], i) => {
      const gone = flats.some(
        (f) => Math.abs(x - f.x) < f.hx + f.b && Math.abs(z - f.z) < f.hz + f.b,
      );
      const y = height(x, z);
      sc.setScalar(gone ? 0 : s);
      q.setFromAxisAngle(up, a);
      crowns.setMatrixAt(i, mx.compose(at.set(x, y + 5.5 * s, z), q, sc));
      caps.setMatrixAt(i, mx.compose(at.set(x, y + 9.6 * s, z), q, sc));
    });
    crowns.instanceMatrix.needsUpdate = caps.instanceMatrix.needsUpdate = true;
  }
  plant();
  group.add(crowns, caps);

  // ── The airfields ───────────────────────────────────────────────────────
  // A swept strip on the ice, painted, its edge lights in the side's colour.
  function strip(R, edge, into, y = 0) {
    put(into, flat(R.hl * 2, R.hw * 2, STRIP, -2), R.x, y + 0.05, R.z);
    const dash = [],
      bars = [];
    for (let x = -R.hl + 30; x < R.hl - 30; x += 32) dash.push([R.x + x, R.z]);
    for (const s of [-1, 1])
      for (let i = 0; i < 5; i++)
        bars.push([R.x + s * (R.hl - 12), R.z - 12 + i * 6]);
    into.add(kit.decals(dash, 13, 1.2, PAINT, -4, y + 0.06));
    into.add(kit.decals(bars, 14, 2, PAINT, -4, y + 0.06));
    const lights = [];
    for (let x = -R.hl; x <= R.hl; x += 46)
      for (const s of [-1, 1])
        lights.push(
          new THREE.BoxGeometry(1, 0.7, 1).translate(
            R.x + x,
            y + 0.35,
            R.z + s * (R.hw + 1.5),
          ),
        );
    into.add(new THREE.Mesh(mergeGeometries(lights), M(edge)));
    for (const g of lights) g.dispose();
  }
  strip(home, 0x55ffff, group);
  strip(enemy, 0xff55ff, group);
  kit.dressing(group);

  // The convoy's tracks down the fjord, and snow drifted on the ice, off
  // the strips.
  for (const s of [-1.4, 1.4])
    put(
      group,
      flat(FJORD.x1 - FJORD.x0, 0.8, 0x8fb5c8, -3),
      (FJORD.x0 + FJORD.x1) / 2,
      0.04,
      CONVOY.z + s,
    );
  const drifts = [];
  while (drifts.length < 70) {
    const x = rnd(FJORD.x0, FJORD.x1),
      z = rnd(-FJORD.hw + 30, FJORD.hw - 30);
    if (Math.abs(z) < 40 || Math.abs(z - CONVOY.z) < 12) continue;
    drifts.push([x, z]);
  }
  group.add(kit.decals(drifts.slice(0, 35), 34, 9, 0xe8eff4, -1, 0.02));
  group.add(kit.decals(drifts.slice(35), 18, 6, 0xc4e1ee, -1, 0.02));

  // A team game: each team's field is a pad of ice levelled into the hills
  // at the height of the ground where it falls, with a strip and a hangar.
  // The level runs a whole grid cell past the strip and the hangar, so
  // every triangle under them is flat.
  // The ground and its pines are drawn again once the fields are all down
  // (settle: the game's start, or its first frame), not once a field.
  let undrawn = false;
  function settle() {
    if (!undrawn) return;
    undrawn = false;
    draw();
    plant();
  }
  function field(f, c) {
    const y = raw(f.x, f.z);
    flats.push({ x: f.x, z: f.z, hx: f.hl + 80, hz: 130, y, b: 180 });
    stale = undrawn = true;
    put(f.g, flat(f.hl * 2 + 160, 260, ICE[0], -1), 0, y + 0.03, 0);
    strip({ x: 0, z: 0, hl: f.hl, hw: f.hw }, c.plane[2], f.g, y);
    kit.hangar(-120, -70, c.plane[1], false, f.g).position.y = y;
    return [{ x: f.x - 120, z: f.z - 70, r: 17, h: y + 12.5 }];
  }
  // The fields gone: the ground at once (surveyed when next asked), the
  // mesh when the map is next shown or played (enter, start).
  function unfield() {
    if (flats.length > 1) {
      flats.length = 1;
      stale = undrawn = true;
    }
  }

  // ── Blizzards ───────────────────────────────────────────────────────────
  // Seen from outside: a squall of pale cloud standing on the hills. Inside:
  // the fog shuts in and snow streams past.
  const PER = 18,
    squall = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({
        color: 0xf2f5f8,
        flatShading: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
      STORMS.length * PER,
    );
  squall.frustumCulled = false;
  const puffs = blizzards.flatMap((b) =>
    Array.from({ length: PER }, () => {
      const a = rnd(0, 2 * Math.PI),
        d = Math.sqrt(rand()) * b.r * 0.85;
      return [
        Math.cos(a) * d,
        rnd(60, 420),
        Math.sin(a) * d,
        rnd(70, 140),
        rnd(40, 80),
      ];
    }),
  );
  group.add(squall);
  function drift(time) {
    for (let k = 0; k < blizzards.length; k++) {
      const b = blizzards[k],
        a = (time / PERIOD) * 2 * Math.PI + b.ph;
      b.x = b.x0 + Math.cos(a) * DRIFT;
      b.z = b.z0 + Math.sin(a) * DRIFT;
      for (let n = 0; n < PER; n++) {
        const [dx, y, dz, w, h] = puffs[k * PER + n];
        sc.set(w, h, w * 0.8);
        squall.setMatrixAt(
          k * PER + n,
          mx.compose(at.set(b.x + dx, y, b.z + dz), q.identity(), sc),
        );
      }
    }
    squall.instanceMatrix.needsUpdate = true;
  }
  drift(0);

  // The snow round the player: flakes in a box that follows them, blown
  // along and wrapping round, shown only in a blizzard.
  const FLAKES = 1500,
    BOX = [160, 90, 160],
    flakes = Float32Array.from({ length: FLAKES * 3 }, (_, i) =>
      rnd(0, BOX[i % 3]),
    ),
    shown = new Float32Array(FLAKES * 3),
    snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute("position", new THREE.BufferAttribute(shown, 3));
  // A flake is a round dot, not a square (no 2D canvas under the tests:
  // squares there).
  let dot = null;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 16;
  const c2 = cv.getContext("2d");
  if (c2) {
    c2.fillStyle = "#ffffff";
    c2.beginPath();
    c2.arc(8, 8, 7, 0, 2 * Math.PI);
    c2.fill();
    dot = new THREE.CanvasTexture(cv);
  }
  const snow = new THREE.Points(
    snowGeo,
    new THREE.PointsMaterial({
      color: 0xffffff,
      map: dot,
      size: 0.3,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  snow.frustumCulled = false;
  snow.visible = false;
  group.add(snow);
  const WIND = [16, -9, 6];
  function blow(dt, k) {
    snow.visible = k > 0.02;
    if (!snow.visible) return;
    snow.material.opacity = 0.9 * k;
    const p = P.pos;
    snow.position.copy(p);
    for (let i = 0; i < FLAKES * 3; i += 3)
      for (let a = 0; a < 3; a++) {
        const n = (flakes[i + a] =
          (flakes[i + a] + WIND[a] * dt + BOX[a]) % BOX[a]);
        // Wrapped about the player, so the box never runs out of snow.
        const c = p.getComponent(a);
        shown[i + a] = ((((n - c) % BOX[a]) + BOX[a]) % BOX[a]) - BOX[a] / 2;
      }
    snowGeo.attributes.position.needsUpdate = true;
  }

  // In play: drift the blizzards, close the fog in round a player inside
  // one (and tell them), and drive the convoy.
  const own = {
      near: 0,
      far: 0,
      fog: new THREE.Color(),
      sky: new THREE.Color(),
    },
    white = new THREE.Color(0xe4eaee);
  // `time` is since the game began (start): the blizzards and the convoy
  // go by it.
  let time = 0,
    thick = 0,
    inside = false;
  function weather(dt) {
    drift(time);
    let now = false;
    for (const b of blizzards)
      if (Math.hypot(P.pos.x - b.x, P.pos.z - b.z) < b.r) now = true;
    if (now && !inside) kit.say("Blizzard!", 2);
    inside = now;
    thick = Math.min(1, Math.max(0, thick + (now ? CLOSE : -CLOSE) * dt));
    fogTo(thick);
    blow(dt, thick);
  }
  function fogTo(k) {
    scene.fog.near = own.near + (WHITEOUT[0] - own.near) * k;
    scene.fog.far = own.far + (WHITEOUT[1] - own.far) * k;
    scene.fog.color.copy(own.fog).lerp(white, k);
    scene.background.copy(own.sky).lerp(white, k);
  }
  // The convoy where convoyAt has it; a wreck stays where it stopped. A
  // town built again mid-game comes out where the column has got to.
  const column = {};
  function convoy() {
    const { off, yaw } = convoyAt(time, column);
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t.alive || !KINDS[t.kind]) continue;
      t.g.userData.x0 ??= t.x;
      t.x = t.g.userData.x0 + off;
      t.z = CONVOY.z;
      t.g.position.set(t.x, t.y, t.z);
      t.g.rotation.y = yaw;
    }
  }

  // Flyers steer round the mountains (kit.avoider). A flyer diving on its
  // quarry pulls out only once it is under 100 m (ai.js), which is room
  // enough over the ice but not where the shore rises under it: so a dive
  // toward rising ground pulls out early.
  const steer = kit.avoider(height, 0);
  function avoid(pos, f, to) {
    steer(pos, f, to);
    if (f.y > -0.3) return;
    const l = Math.hypot(f.x, f.z) || 1,
      ahead = height(pos.x + (f.x / l) * 120, pos.z + (f.z / l) * 120);
    if (pos.y - ahead < 160 && ahead > height(pos.x, pos.z))
      to.y = Math.max(to.y, Math.hypot(to.x, to.z) * 0.7);
  }

  return {
    group,
    land: {
      height,
      floor: height,
      crash: (p) =>
        height(p.x, p.z) < 0.5 && onIce(p.x, p.z)
          ? "Crashed on the ice"
          : "Flew into a mountain",
      brake: BRAKE,
      dust: 0xeef3f7,
      avoid,
      town: TOWN,
      kinds: Object.fromEntries(
        Object.entries(KINDS).map(([k, f]) => [k, (g) => f(g, kit)]),
      ),
      tick(dt) {
        settle();
        time += dt;
        weather(dt);
        convoy();
      },
      field,
      unfield,
    },
    home,
    enemy,
    solids: kit.COUNTRY.solids,
    hippos: [
      [1000, 225, meadow.y],
      [1050, 232, meadow.y],
      [1100, 218, meadow.y],
    ],
    sky: 0xd3e4ee,
    fog: [550, 3000],
    below: 0xb8c4cc,
    light: [0.85, 0.8],
    enter() {
      settle();
      own.near = scene.fog.near;
      own.far = scene.fog.far;
      own.fog.copy(scene.fog.color);
      own.sky.copy(scene.background);
      thick = 0;
      inside = false;
    },
    // A new game: the clock from nought (so the convoy sets off up the
    // fjord from its start, and the blizzards from theirs), clear air.
    start() {
      settle();
      time = thick = 0;
      inside = false;
      fogTo(0);
      snow.visible = false;
      drift(0);
      convoy();
    },
    leave() {
      thick = 0;
      inside = false;
      fogTo(0);
      snow.visible = false;
    },
  };
}
