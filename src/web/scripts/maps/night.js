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

// maps/night.js — the Night raid: the Countryside after dark. A moon and
// stars, the town's windows lit, the runways only their edge lights; and
// searchlights sweeping the sky by the town. Caught in a beam, the flak
// batteries under it fire up it at you until you break out.

import { targets, fields, countryside } from "../world.js";

// [x, z] of each searchlight, among the town's buildings.
const LIGHTS = [
  [1050, 110],
  [1400, -120],
  [1750, 120],
  [2100, -110],
  [2600, 120],
];
const BEAM = { length: 1100, half: 0.09, hold: 3, rate: 0.15 };
const EDGES = [0x55ffff, 0xff55ff]; // the runway edge lights' colours

export default function build(kit) {
  const { THREE, put, box, M, P, say, flakAt } = kit;
  const group = new THREE.Group();

  // Moon and stars, on a dome the fog does not reach.
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(90, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false }),
  );
  put(group, moon, 1400 - 2600, 2400, -4200);
  const rand = kit.seeded(31),
    star = [];
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2,
      e = 0.08 + rand() * 1.4,
      r = 5200;
    star.push(
      1400 + Math.cos(a) * Math.cos(e) * r,
      Math.sin(e) * r,
      Math.sin(a) * Math.cos(e) * r,
    );
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.Float32BufferAttribute(star, 3));
  group.add(
    new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 2,
        sizeAttenuation: false,
        fog: false,
      }),
    ),
  );

  // The searchlights: a lamp on a stand, and a pale beam that sweeps. Each
  // beam is a cone pointing along its group's +y, turned in tick.
  const beamGeo = new THREE.ConeGeometry(
    Math.tan(BEAM.half) * BEAM.length,
    BEAM.length,
    16,
    1,
    true,
  ).translate(0, -BEAM.length / 2, 0);
  beamGeo.rotateX(Math.PI); // apex at the lamp, opening upward along +y
  // Bright at the lamp, fading to nothing at the far end: added light, so
  // black is none.
  const bp = beamGeo.attributes.position,
    shade = [];
  for (let i = 0; i < bp.count; i++) {
    const k = 1 - bp.getY(i) / BEAM.length;
    shade.push(k, k * 0.95, k * 0.7);
  }
  beamGeo.setAttribute("color", new THREE.Float32BufferAttribute(shade, 3));
  const lights = LIGHTS.map(([x, z], i) => {
    put(group, box(4, 3, 4, 0x3a3a40), x, 1.5, z);
    const pivot = new THREE.Group();
    put(group, pivot, x, 4, z);
    const beam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    pivot.add(beam);
    put(pivot, box(2.4, 2.4, 2.4, 0xfff3b0), 0, 0, 0).material.emissive.setHex(
      0xfff3b0,
    );
    return {
      at: new THREE.Vector3(x, 4, z),
      pivot,
      az: i * 1.3,
      el: 0.9,
      t: i * 2.1,
      caught: 0,
      cd: 0,
    };
  });

  // Where a beam points, from its azimuth and elevation.
  const dir = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0),
    to = new THREE.Vector3();
  function aim(l) {
    dir.set(
      Math.cos(l.el) * Math.cos(l.az),
      Math.sin(l.el),
      Math.cos(l.el) * Math.sin(l.az),
    );
    l.pivot.quaternion.setFromUnitVectors(up, dir);
  }
  lights.forEach(aim);

  // Is the player in this beam?
  function inBeam(l) {
    if (!P.alive || P.ghost) return false;
    to.copy(P.pos).sub(l.at);
    const d = to.length();
    if (d > BEAM.length || d < 20) return false;
    aim(l);
    return to.divideScalar(d).dot(dir) > Math.cos(BEAM.half);
  }

  function sweep(l, dt) {
    if (inBeam(l)) l.caught = BEAM.hold;
    if (l.caught > 0) {
      // Locked on: the beam follows the plane, and the flak opens up.
      l.caught -= dt;
      to.copy(P.pos).sub(l.at);
      l.az = Math.atan2(to.z, to.x);
      l.el = Math.atan2(to.y, Math.hypot(to.x, to.z));
      if ((l.cd -= dt) <= 0 && flakAt(l.at, BEAM.length, 0.03)) {
        l.cd = BEAM.rate;
        say("Searchlight! Break out of the beam", 0.8);
      }
    } else {
      l.t += dt;
      l.az += 0.25 * dt;
      l.el = 0.75 + 0.35 * Math.sin(l.t * 0.4);
    }
    aim(l);
  }

  // Lit windows on the town's buildings, dark once a building is wrecked.
  const lamp = M(0xffd27a);
  lamp.emissive.setHex(0xffb84a);
  function windows() {
    for (const t of targets) {
      const g = t.g;
      if (t.alive && !g.userData.lit && t.kind !== "flag") {
        g.userData.lit = [];
        for (let k = 0; k < 6; k++) {
          const w = put(
            g,
            new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.3), lamp),
            -6 + (k % 3) * 6,
            3 + Math.floor(k / 3) * 4,
            t.r * 0.6,
          );
          g.userData.lit.push(w);
        }
      }
      if (!t.alive && g.userData.lit) {
        for (const w of g.userData.lit) w.removeFromParent();
        g.userData.lit = null;
      }
    }
  }

  // The runways' edge lights glow, the Countryside's and any team's.
  const glowing = new Set();
  function glow(root) {
    root.traverse((o) => {
      const c = o.material?.color?.getHex();
      if (o.isMesh && EDGES.includes(c) && !glowing.has(o.material)) {
        o.material.emissive.setHex(c);
        glowing.add(o.material);
      }
    });
  }

  return {
    country: true,
    group,
    land: {
      tick(dt) {
        for (const l of lights) sweep(l, dt);
        windows();
        for (const f of fields) glow(f.g);
      },
    },
    sky: 0x0b1026,
    fog: [400, 2600],
    below: 0x101820,
    light: [0.22, 0.16],
    enter() {
      glow(countryside);
      windows();
    },
    leave() {
      for (const m of glowing) m.emissive.setHex(0);
      glowing.clear();
    },
  };
}
