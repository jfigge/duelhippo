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

// maps/zeppelin.js — Zeppelins: open sky over a sea of cloud. Each side's
// runway is the flight deck on top of a carrier airship; the targets are
// the enemy's airships, holding station along the lane and shooting back.
//
// As on the Sea, a deck is just higher ground to groundY. The difference is
// that there is air under it: the carrier's hull is solid from the deck down
// to its keel, and below the keel the ground is the cloud floor again, so a
// plane can fly under a carrier but not through it.

import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CX } from "../constants.js";
import { targets } from "../world.js";

// The carriers' decks: their height, half-length and half-width, and how
// hard the arrester wires stop a plane.
export const ZEP = { deck: 300, hl: 150, hw: 22, brake: 14 };

// The carrier's hull below the deck (relative to the deck's top): a capsule
// of radius R (RZ across), its straight part ±LC, its centre CY; the
// gondola under it, the fins at the stern and the four engine pods, each
// [x0, x1, half-z, z offset, bottom].
const R = 18,
  RZ = 21,
  LC = ZEP.hl - R,
  CY = -21,
  UNDER = [
    [-22, 22, 5, 0, -46],
    [-148, -122, 1, 0, -43],
    [-148, -122, 21, 0, -22],
    [-67, -53, 4, 15, -40],
    [-67, -53, 4, -15, -40],
    [53, 67, 4, 15, -40],
    [53, 67, 4, -15, -40],
  ];
// How far under the deck its hull reaches at (dx, dz) on the deck's rect.
function hullBottom(dx, dz) {
  let b = -3.2;
  const a = Math.max(0, Math.abs(dx) - LC),
    s = (a / R) ** 2 + (dz / RZ) ** 2;
  if (s < 1) b = Math.min(b, CY - R * Math.sqrt(1 - s));
  for (const [x0, x1, hz, oz, y] of UNDER)
    if (y < b && dx > x0 && dx < x1 && Math.abs(dz - oz) < hz) b = y;
  return b;
}

// The enemy's airships, where the Countryside's town stands: [kind, x,
// side, z, y]. Those near the enemy carrier fly above its flyers' patrol.
const FLEET = [
  ["airship", 800, null, 140, 330],
  ["airship", 1150, null, -120, 400],
  ["airship", 1450, null, 60, 280],
  ["airship", 1750, null, -70, 440],
  ["airship", 2050, null, 150, 310],
  ["airship", 2350, null, -100, 390],
  ["airship", 3250, null, -170, 430],
  ["airship", 3350, null, 90, 420],
];

const SKY = 0xa4dcff,
  CLOUD = [0xf4f8fc, 0xeaf1f8, 0xffffff, 0xe2ebf4, 0xf0f4fa],
  HULL = 0xd3d6dc,
  ENEMY = 0x9c97a6,
  MAGENTA = 0xb03aa0;

export default function build(kit) {
  const { THREE, seeded, put, P, puff, flakAt } = kit;
  const PI = Math.PI;
  const rand = seeded(1852),
    rnd = (a, b) => a + rand() * (b - a);
  const D = ZEP.deck;
  const group = new THREE.Group();
  const home = { ...kit.COUNTRY.home, hl: ZEP.hl, hw: ZEP.hw },
    enemy = { ...kit.COUNTRY.enemy, hl: ZEP.hl, hw: ZEP.hw };

  // Parts in their own colours, merged into one flat-shaded mesh: a
  // carrier or an airship is then one draw call, not forty.
  function parts() {
    const gs = [];
    return {
      add(g, color, x = 0, y = 0, z = 0) {
        const n = g.index ? g.toNonIndexed() : g;
        if (n !== g) g.dispose();
        n.deleteAttribute("uv");
        n.translate(x, y, z);
        const c = new THREE.Color(color),
          col = new Float32Array(n.attributes.position.count * 3);
        for (let i = 0; i < col.length; i += 3) c.toArray(col, i);
        n.setAttribute("color", new THREE.BufferAttribute(col, 3));
        gs.push(n);
      },
      box(w, h, d, color, x, y, z) {
        this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z);
      },
      geometry() {
        const g = mergeGeometries(gs);
        for (const p of gs) p.dispose();
        return g;
      },
    };
  }
  const shaded = (opts) =>
    new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      ...opts,
    });
  // A capsule along x: `len` end to end, radius r (rz across), centred.
  const capsule = (r, len, rz = r, seg = 14) =>
    new THREE.CapsuleGeometry(r, len - 2 * r, 4, seg)
      .rotateZ(PI / 2)
      .scale(1, 1, rz / r);
  // A band round a capsule's straight part, at x.
  const band = (r, rz, w, seg = 14) =>
    new THREE.CylinderGeometry(r * 1.015, r * 1.015, w, seg, 1, true)
      .rotateZ(PI / 2)
      .scale(1, 1, rz / r);

  // ── The carrier airship: its deck centred on the origin and along x, top
  // at D; the hull hangs beneath. One geometry per trim colour, shared.
  const carriers = new Map();
  function carrierGeometry(trim) {
    if (carriers.has(trim)) return carriers.get(trim);
    const p = parts(),
      { hl, hw } = ZEP;
    p.box(hl * 2, 2, hw * 2, 0x5c626d, 0, D - 1.2, 0);
    p.box(hl * 2 - 4, 0.4, hw * 2 - 6, 0x3d4148, 0, D - 0.2, 0);
    for (let x = -hl + 24; x < hl - 20; x += 22)
      p.box(11, 0.1, 1, 0xf4f1e6, x, D + 0.05, 0);
    for (const s of [-1, 1]) {
      p.box(hl * 2 - 10, 0.1, 0.6, 0xf4f1e6, 0, D + 0.05, s * 17.5);
      p.box(3, 0.1, hw * 2 - 8, trim, s * (hl - 4), D + 0.05, 0);
    }
    // the arrester wires, at the stern
    for (let i = 0; i < 4; i++)
      p.box(0.4, 0.3, hw * 2 - 6, 0xdddddd, -hl + 25 + i * 9, D + 0.15, 0);
    for (let x = -hl; x <= hl; x += 20)
      for (const s of [-1, 1])
        p.box(1, 0.7, 1, trim, x, D + 0.35, s * (hw + 0.5));
    // the gallery between deck and envelope, the envelope and its bands
    p.box(hl * 2 - 16, 3, 30, 0x4a4f58, 0, D - 1.7, 0);
    p.add(capsule(R, hl * 2, RZ, 16), HULL, 0, D + CY, 0);
    for (const x of [-105, -45, 45, 105])
      p.add(band(R, RZ, 4, 16), trim, x, D + CY, 0);
    // the gondola, its windows; the fins; the engine pods
    p.box(44, 8, 10, 0x8a8f99, 0, D - 42, 0);
    p.box(40, 1.6, 10.3, 0x2b3440, 0, D - 40.5, 0);
    p.box(26, 10, 1, trim, -135, D - 38, 0);
    p.box(26, 1, 42, trim, -135, D + CY, 0);
    for (const x of [-60, 60])
      for (const s of [-1, 1]) {
        p.add(
          new THREE.CylinderGeometry(2.2, 2.6, 13, 8).rotateZ(PI / 2),
          0x6a6e76,
          x,
          D - 36,
          s * 15,
        );
        p.box(1, 5, 1, 0x4a4f58, x, D - 32.5, s * 13.5);
      }
    // The propellers, as the blur of their discs.
    const q = parts();
    for (const x of [-60, 60])
      for (const s of [-1, 1])
        q.add(
          new THREE.CircleGeometry(4, 14).rotateY(PI / 2),
          0xe8e8e8,
          x + 6.8,
          D - 36,
          s * 15,
        );
    const made = [p.geometry(), q.geometry()];
    carriers.set(trim, made);
    return made;
  }
  const discs = shaded({
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const hullMat = shaded();
  function carrier(trim) {
    const g = new THREE.Group(),
      [body, blur] = carrierGeometry(trim);
    g.add(new THREE.Mesh(body, hullMat), new THREE.Mesh(blur, discs));
    return g;
  }

  // The carriers: the two sides', and in a team game each team's.
  const decks = [home, enemy];
  put(group, carrier(0x55ffff), home.x, 0, home.z);
  put(group, carrier(0xff55ff), enemy.x, 0, enemy.z);

  // ── The cloud sea: a faceted floor, whites and the palest blues, gently
  // heaving, and billows on it. Big enough to reach the camera's far plane
  // from anywhere a plane can fly, so the fog takes its edge.
  {
    const g = new THREE.PlaneGeometry(24000, 24000, 100, 100).toNonIndexed(),
      p = g.attributes.position;
    for (let i = 0; i < p.count; i++)
      p.setZ(
        i,
        Math.sin(p.getX(i) * 0.004) * Math.cos(p.getY(i) * 0.0035) * 3 - 3,
      );
    const cs = CLOUD.map((c) => new THREE.Color(c)),
      col = new Float32Array(p.count * 3);
    for (let t = 0; t < p.count / 3; t++) {
      const c = cs[(rand() * cs.length) | 0];
      for (let k = 0; k < 3; k++) c.toArray(col, (t * 3 + k) * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, shaded());
    m.rotation.x = -PI / 2;
    put(group, m, CX, 0, 0);
  }
  const mx = new THREE.Matrix4(),
    at = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    sc = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0);
  function puffs(n, detail, mat, place) {
    const m = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, detail),
      mat,
      n,
    );
    for (let i = 0; i < n; i++) {
      place(at, sc);
      q.setFromAxisAngle(up, rnd(0, PI * 2));
      m.setMatrixAt(i, mx.compose(at, q, sc));
    }
    return group.add(m);
  }
  const white = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    flatShading: true,
  });
  // billows on the floor, their tops a few metres up at most
  puffs(900, 0, white, (at, sc) => {
    at.set(CX + rnd(-5200, 5200), rnd(-12, -6), rnd(-5200, 5200));
    sc.set(rnd(40, 110), rnd(8, 14), rnd(40, 110));
  });
  // a heap of cloud for the hippos to lounge on
  puffs(12, 0, white, (at, sc) => {
    at.set(1000 + rnd(-40, 40), rnd(-8, -5), 435 + rnd(-30, 30));
    sc.set(rnd(18, 30), rnd(7, 9), rnd(18, 30));
  });
  // distant banks, a ring of towering cloud round the play area
  const banks = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: 0x2a3440,
    flatShading: true,
  });
  puffs(170, 1, banks, (at, sc) => {
    const a = rnd(0, PI * 2),
      d = rnd(4300, 5400);
    at.set(CX + Math.cos(a) * d, rnd(40, 260), Math.sin(a) * d);
    sc.set(rnd(250, 550), rnd(120, 300), rnd(200, 450));
  });
  // puffs drifting below the Countryside's clouds, clear of the carriers
  const drift = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    flatShading: true,
    transparent: true,
    opacity: 0.9,
  });
  puffs(140, 0, drift, (at, sc) => {
    do at.set(CX + rnd(-3600, 3600), rnd(60, 240), rnd(-3600, 3600));
    while (
      decks.some((d) => Math.abs(at.x - d.x) < 260 && Math.abs(at.z) < 90)
    );
    sc.set(rnd(24, 48), rnd(10, 20), rnd(18, 34));
  });

  // ── The ground: a deck is solid from its top down to its hull's bottom;
  // under that, and everywhere else, the cloud floor.
  function onDeck(x, z) {
    for (const d of decks)
      if (Math.abs(x - d.x) < ZEP.hl && Math.abs(z - d.z) < ZEP.hw) return d;
    return null;
  }
  function height(x, z, y = Infinity) {
    const d = onDeck(x, z);
    return d && y >= D + hullBottom(x - d.x, z - d.z) ? D : 0;
  }
  const crash = (p) =>
    onDeck(p.x, p.z) && p.y > D - 60
      ? "Flew into the airship"
      : "Lost in the clouds";

  // ── The enemy's airships, as targets (world.js makeTarget): built into
  // `g` along x, its origin at the gondola's keel. Each has its own
  // materials, since a wreck is darkened.
  let ship = null;
  function shipGeometry() {
    const p = parts();
    p.add(capsule(12, 120, 12, 12), ENEMY, 0, 17, 0);
    for (const x of [-30, 25]) p.add(band(12, 12, 5, 12), MAGENTA, x, 17, 0);
    p.add(
      new THREE.SphereGeometry(5.5, 10, 6).scale(1.2, 1, 1),
      MAGENTA,
      55.5,
      17,
      0,
    );
    p.box(26, 5, 7, 0x6a5f70, 0, 3, 0);
    p.box(24, 1.2, 7.2, 0x2b2b35, 0, 3.8, 0);
    p.box(4, 2, 1, 0x6a5f70, 0, 5.8, 0);
    // the guns, one each side
    for (const s of [-1, 1]) {
      p.box(1.6, 1.4, 1.6, 0x3a3a40, s * 8, 0.6, s * 3.8);
      p.box(4, 0.4, 0.4, 0x2a2a30, s * 8 + 2, 0.6, s * 4.4);
    }
    // the tail's cross of fins, tipped in the enemy's colour
    p.box(16, 22, 0.8, ENEMY, -52, 17, 0);
    p.box(16, 0.8, 22, ENEMY, -52, 17, 0);
    for (const s of [-1, 1]) {
      p.box(16, 3, 0.9, MAGENTA, -52, 17 + s * 10, 0);
      p.box(16, 0.9, 3, MAGENTA, -52, 17, s * 10);
    }
    // engine pods on outriggers, pushers
    for (const s of [-1, 1]) {
      p.add(
        new THREE.CylinderGeometry(1.4, 1.8, 7, 8).rotateZ(PI / 2),
        0x5a5560,
        -14,
        8,
        s * 13,
      );
      p.box(1, 0.5, 4, 0x5a5560, -14, 8.5, s * 10);
    }
    const blade = new THREE.BoxGeometry(0.3, 6, 0.6);
    ship = [p.geometry(), blade];
    return ship;
  }
  const kinds = {
    airship(g) {
      const [body, blade] = ship ?? shipGeometry();
      g.add(new THREE.Mesh(body, shaded()));
      const dark = new THREE.MeshLambertMaterial({ color: 0x3a3030 });
      g.userData.props = [-1, 1].map((s) =>
        put(g, new THREE.Mesh(blade, dark), -18, 8, s * 13),
      );
      return { r: 30, h: 30, hp: 14, pts: 300, name: "Airship" };
    },
  };

  // ── A frame of the map: the airships hold station, drifting a little,
  // their guns firing short bursts at a player within range; a wreck sinks
  // into the cloud.
  const gun = new THREE.Vector3(),
    smoke = new THREE.Vector3();
  function tick(dt) {
    for (const t of targets) {
      if (t.kind !== "airship") continue;
      const g = t.g,
        a = g.userData;
      if (a.t === undefined) {
        a.t = 0;
        a.x0 = t.x;
        a.z0 = t.z;
        a.ph = (t.x * 0.37) % (PI * 2);
        a.yaw = t.x % 700 < 350 ? 0 : PI;
        a.cd = 1 + Math.random() * 2;
        a.burst = 0;
        g.rotation.y = a.yaw;
      }
      a.t += dt;
      if (!t.alive) {
        if (!g.visible) continue;
        g.position.y -= 7 * dt;
        g.rotation.z += (-0.25 - g.rotation.z) * dt * 0.3;
        t.y = g.position.y;
        t.floor = t.y - 2;
        if (Math.random() < dt * 4)
          puff(
            smoke.set(t.x + (Math.random() - 0.5) * 60, t.y + 4, t.z),
            0x555555,
            1,
            1.5,
            3,
            4,
            5,
          );
        if (t.y < -30) {
          g.visible = false;
          t.y = t.floor = -1e4;
        }
        continue;
      }
      // About 45 m fore and aft, 20 m abeam, over two minutes or so.
      t.x = a.x0 + 45 * Math.sin(a.t * 0.055 + a.ph) - 45 * Math.sin(a.ph);
      t.z = a.z0 + 20 * Math.sin(a.t * 0.041);
      g.position.x = t.x;
      g.position.z = t.z;
      g.rotation.y = a.yaw + 0.06 * Math.sin(a.t * 0.03 + a.ph);
      for (const pr of a.props) pr.rotation.x += 30 * dt;
      // The gun on the side facing the player, in bursts of three.
      if ((a.cd -= dt) > 0) continue;
      const c = Math.cos(g.rotation.y),
        sn = Math.sin(g.rotation.y),
        s = (P.pos.z - t.z) * c + (P.pos.x - t.x) * sn > 0 ? 1 : -1,
        gx = s * 8 + 4,
        gz = s * 4.4;
      gun.set(t.x + gx * c + gz * sn, t.y + 0.6, t.z - gx * sn + gz * c);
      if (flakAt(gun, 500, 0.035)) {
        a.cd = ++a.burst < 3 ? 0.16 : 2.2 + Math.random() * 1.2;
        if (a.burst >= 3) a.burst = 0;
      } else {
        a.burst = 0;
        a.cd = 0.3;
      }
    }
  }

  // ── A team game: each team's carrier, its deck the team's runway.
  function field(f, c) {
    f.hl = ZEP.hl;
    f.hw = ZEP.hw;
    f.g.add(carrier(c.plane[2]));
    decks.push(f);
    return [];
  }

  return {
    group,
    land: {
      height,
      floor: () => 0,
      crash,
      avoid: kit.avoider(height, 0),
      brake: ZEP.brake,
      deck: true,
      dust: 0xf4f8fc,
      town: FLEET,
      kinds,
      tick,
      field,
      unfield: () => {
        decks.length = 2;
      },
      // A team's flag stands on its deck's edge, clear of the planes
      // rolling down the middle.
      flagAt: (f) => [f.x - 60, f.z + 16],
    },
    home,
    enemy,
    solids: [],
    // on a heap of cloud, out over the cloud sea
    hippos: [
      [1000, 435, 0.2],
      [1028, 422, 0.2],
      [975, 450, 0.2],
    ],
    sky: SKY,
    fog: [1200, 6000],
    below: 0xe6eef5,
    light: [1.1, 1.05],
  };
}
