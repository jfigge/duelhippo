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

// core-ground.test.js — the simulation's rules on maps whose ground is more
// than the ground: a rolling plane meets a step as a wall and a drop as an
// edge, a roof in a runway's rect is no runway, a hippo up high is not hit
// from under it, a target's own shape (`hit`), the title camera over a
// raised runway, a flyer with nobody to hunt, and what a rebuilt town frees.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPort } from "./harness.js";

const game = await loadPort(5);
const { w, duel } = game;
const P = duel.P;
const $ = (id) => w.document.getElementById(id);
const THREE = await import("three");
const world = await import("../world.js");
const { land, groundY, hippos, targets, buildTargets, hurtTarget } = world;
const { HOME, GEAR, SEA } = await import("../constants.js");
const { camera } = await import("../scene.js");
const { updCamera } = await import("../camera.js");
const { fire, bullets, dropBomb } = await import("../weapons.js");
const { enemies, updEnemy } = await import("../ai.js");
const { net } = await import("../net/bus.js");
const msg = () => $("msg").textContent;
duel.S.best = 1e6; // every map earned
(await import("../game.js")).showMaps();
const pick = (id) => w.document.querySelector(`[data-map="${id}"]`).click();
const UP = new THREE.Vector3(0, 1, 0);

// Airborne at (x, y, z), level, nose along +x, at `speed`.
function flyAt(x, y, z, speed, thr = 0.5) {
  game.poke((P) => {
    P.grounded = false;
    P.pos.set(x, y, z);
    P.q.setFromAxisAngle(UP, -Math.PI / 2);
    P.speed = speed;
    P.thr = thr;
    P.sink = 0;
  });
}
// On the ground at (x, z), rolling at `speed` with the nose at `yaw` (0 is
// −z, −π/2 is +x, π is +z), at throttle `thr`.
function rollAt(x, z, speed, yaw, thr = 0) {
  game.poke((P) => {
    P.grounded = true;
    P.pos.set(x, groundY(x, z) + GEAR, z);
    P.q.setFromAxisAngle(UP, yaw);
    P.speed = speed;
    P.thr = thr;
    P.sink = 0;
  });
}

test("title: the orbit is over the home runway, raised or not", () => {
  assert.equal(duel.state, "title");
  updCamera(0.016);
  assert.equal(camera.position.y, 42, "the Countryside's, as it was");
  pick("sky");
  updCamera(0.016);
  const top = groundY(HOME.x, HOME.z);
  assert.ok(top > 200, `HOME's island at ${top}`);
  assert.equal(camera.position.y, top + 42, "above the island, not under it");
});

test("Sea: taxiing into the carrier's island is a crash, not a climb", () => {
  pick("sea");
  game.start("free");
  // Across the deck towards the island (z 12.5–21.5 at x 3–37).
  rollAt(HOME.x + 20, 6, 6, Math.PI, 0.2);
  let top = 0;
  for (let i = 0; i < 40 && P.alive; i++) {
    game.run(50);
    top = Math.max(top, P.pos.y);
  }
  assert.equal(P.alive, false);
  assert.match(msg(), /Flew into the carrier/);
  assert.ok(top < SEA.deck + GEAR + 0.01, `never on the roof (${top})`);
});

test("Sea: a gentle touchdown on the island's roof is no landing", () => {
  game.start("free");
  flyAt(HOME.x + 10, SEA.deck + 26 + GEAR + 0.8, 17, 30, 0);
  game.poke((P) => (P.sink = 2));
  game.run(2000);
  assert.equal(P.alive, false, "not grounded on the roof");
  assert.match(msg(), /Flew into the carrier/);
});

test("Sea: off the bow at flying speed the plane flies on", () => {
  game.start("free");
  rollAt(HOME.x + SEA.hl - 15, 0, 40, -Math.PI / 2, 1);
  game.run(600);
  assert.ok(P.alive, msg());
  assert.equal(P.grounded, false);
});

test("Sky: taxiing off the runway onto the island's grass is fine", () => {
  pick("sky");
  game.start("free");
  const top = groundY(HOME.x, HOME.z);
  rollAt(HOME.x, HOME.hw - 2, 12, Math.PI);
  game.run(3000);
  assert.ok(P.alive, msg());
  assert.ok(P.grounded, "on the grass");
  assert.ok(P.pos.z > HOME.hw, `off the runway, at z ${P.pos.z}`);
  assert.equal(P.pos.y, top + GEAR);
  assert.ok(P.speed < 0.5);
});

test("Sky: rolling slowly off the island's edge falls", () => {
  game.start("free");
  const top = groundY(HOME.x, HOME.z);
  let z = HOME.hw;
  while (groundY(HOME.x, z) === top) z += 1;
  rollAt(HOME.x, z - 6, 15, Math.PI);
  game.run(1500);
  assert.equal(P.alive, false);
  assert.match(msg(), /Rolled off the edge/);
});

test("Sky: a hippo up high is not hit from under it", () => {
  game.start("free");
  // A hippo in open air, 200 m up, over nothing but cloud.
  const h = hippos[0],
    x = 1400,
    z = -1800;
  assert.equal(groundY(x, z), 0, "open air there");
  const put = () => {
    h.x0 = h.x = x;
    h.z = z;
    h.alive = true;
    h.g.visible = true;
    h.g.position.set(x, 200, z);
  };
  put();
  // A plane flying under it.
  flyAt(x - 60, 60, z, 50);
  game.run(2500);
  assert.ok(P.alive, msg());
  assert.ok(h.alive, "the plane passed under");
  // A round passing under it, and one at its height.
  put();
  fire(new THREE.Vector3(x - 50, 140, z), new THREE.Vector3(1, 0, 0), 400, "p");
  game.run(300);
  assert.ok(h.alive, "the round passed under");
  fire(new THREE.Vector3(x - 50, 202, z), new THREE.Vector3(1, 0, 0), 400, "p");
  game.run(300);
  assert.equal(h.alive, false, "a round at its height scares it");
  // A bomb that bursts on the cloud far below it.
  put();
  flyAt(x, 120, z, 50);
  game.poke((P) => {
    P.bombCd = 0;
    P.bombs = 3;
  });
  dropBomb();
  flyAt(x + 600, 300, z + 600, 50);
  game.run(5000);
  assert.ok(h.alive, "a bomb bursting 200 m below is not heard");
  for (const b of bullets) b.on = false;
});

test("a target's own shape (hit) decides what meets it", () => {
  pick("field");
  game.start("free");
  // A floating box 10 m across and 10 m high, in a 30 m cylinder.
  land.kinds.probe = (g) => {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10)));
    return {
      r: 30,
      h: 30,
      hp: 3,
      pts: 10,
      name: "Probe",
      hit: (t, p, pad = 0) =>
        Math.abs(p.x - t.x) < 5 + pad &&
        Math.abs(p.z - t.z) < 5 + pad &&
        p.y > t.y - pad &&
        p.y < t.y + 10 + pad,
    };
  };
  try {
    buildTargets([["probe", 1000, null, 0, 100]]);
    const t = targets[0];
    assert.equal(typeof t.hit, "function", "copied onto the target");
    // Through the cylinder but over the box: no crash.
    flyAt(960, 125, 0, 50);
    game.run(1500);
    assert.ok(P.alive, msg());
    // A round over the box, then one into it.
    fire(new THREE.Vector3(980, 125, 0), new THREE.Vector3(1, 0, 0), 400, "p");
    game.run(200);
    assert.equal(t.hp, 3, "over it: no hit");
    fire(new THREE.Vector3(980, 105, 0), new THREE.Vector3(1, 0, 0), 400, "p");
    game.run(200);
    assert.equal(t.hp, 2, "into it: a hit");
    // A bomb into it bursts there, and wrecks it.
    flyAt(1000, 140, 0, 0);
    game.poke((P) => {
      P.vel.set(0, 0, 0);
      P.bombCd = 0;
      P.bombs = 3;
    });
    dropBomb();
    flyAt(-400, 300, 600, 50);
    game.run(3000);
    assert.equal(t.alive, false, "the bomb's blast");
    // Flying into it (alive or not) is a crash.
    buildTargets([["probe", 1000, null, 0, 100]]);
    flyAt(960, 105, 0, 50);
    game.run(1500);
    assert.equal(P.alive, false);
    assert.match(msg(), /Flew into the probe/);
  } finally {
    delete land.kinds.probe;
  }
});

test("a rebuilt town frees what the old one owned, not what is shared", () => {
  game.start("free");
  const shared = new THREE.MeshLambertMaterial({ color: 0x123456 });
  shared.userData.shared = true;
  const sharedGeo = new THREE.BoxGeometry(1, 1, 1);
  sharedGeo.userData.shared = true;
  targets[0].g.add(new THREE.Mesh(sharedGeo, shared));
  const freed = new Set();
  const own = [];
  for (const t of targets)
    t.g.traverse((o) => {
      for (const x of [o.geometry, o.material]) {
        if (!x) continue;
        x.addEventListener("dispose", () => freed.add(x));
        if (x !== shared && x !== sharedGeo) own.push(x);
      }
    });
  sharedGeo.addEventListener("dispose", () => freed.add(sharedGeo));
  shared.addEventListener("dispose", () => freed.add(shared));
  buildTargets();
  assert.ok(own.length > 20);
  assert.ok(
    own.every((x) => freed.has(x)),
    "every geometry and material it owned",
  );
  assert.ok(!freed.has(shared) && !freed.has(sharedGeo), "nothing shared");
});

test("a wreck darkens its own materials, not a shared or a glowing one", () => {
  game.start("free");
  const t = targets[0];
  const shared = new THREE.MeshLambertMaterial({ color: 0x123456 });
  shared.userData.shared = true;
  const lit = new THREE.MeshLambertMaterial({ color: 0xffd27a });
  lit.emissive.setHex(0xffb84a);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  t.g.add(new THREE.Mesh(geo, shared), new THREE.Mesh(geo, lit));
  const own = t.g.children[0].material;
  hurtTarget(t, 100, new THREE.Vector3(t.x, t.y, t.z));
  assert.equal(t.alive, false);
  assert.equal(own.color.getHex(), 0x3b3530, "its own: dark");
  assert.equal(shared.color.getHex(), 0x123456, "shared: untouched");
  assert.equal(lit.color.getHex(), 0xffd27a, "glowing: untouched");
});

test("Endless enemies: a flyer with only a ghost up holds its fire", () => {
  game.start("free");
  const e = enemies[0];
  const shots = () => bullets.filter((b) => b.on && b.own === "e").length;
  // The player airborne at 300 m, a flyer 150 m behind, nose on it.
  function chase() {
    for (const b of bullets) b.on = false;
    flyAt(1000, 300, 0, 50);
    game.poke((P) => P.vel.set(50, 0, 0));
    e.alive = true;
    e.hp = 3;
    e.cd = 0;
    e.burst = 0;
    e.speed = 58;
    e.pos.set(850, 300, 0);
    e.q.setFromAxisAngle(UP, -Math.PI / 2);
    e.up.set(0, 1, 0);
    for (let i = 0; i < 10 && e.alive; i++) updEnemy(e, 1 / 60);
    return shots();
  }
  const was = { on: net.on, seat: net.seat };
  try {
    net.on = true;
    net.seat = 0;
    assert.ok(chase() > 0, "a real plane is fired at");
    P.ghost = true;
    assert.equal(chase(), 0, "a ghost is not");
  } finally {
    net.on = was.on;
    net.seat = was.seat;
    P.ghost = false;
    e.alive = false;
    e.obj.visible = false;
    for (const b of bullets) b.on = false;
  }
});
