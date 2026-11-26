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

// constants.js — the world's fixed numbers, unchanged from the prototype.
//
// DESIGN.md (features/prototype/) is where these are explained; the values
// are pinned to the prototype's until the requirements say otherwise.

export const G = 9.8; // gravity, m/s²
export const STALL = 32; // m/s
export const THR = 24; // full-throttle thrust, m/s²
export const DRAG = 24 / (88 * 88); // v² drag: top level speed ≈ 88 m/s
export const GEAR = 1.95; // height of the plane's origin above the wheels
export const CX = 1400; // centre of the flat play area along +X
export const FLAT = 2700; // half-width of the flat area; hills beyond

// Runways: centre x/z, half-length, half-width.
export const HOME = { x: 0, z: 0, hl: 230, hw: 18 };
export const EB = { x: 2850, z: 0, hl: 230, hw: 18 };

// Classic-mode lane bounds along X.
export const LANE = { min: -700, max: 3600 };

// The enemy town: [kind, x] along the lane.
export const TDEF = [
  ["tanks", 850],
  ["factory", 1200],
  ["hangar", 1550],
  ["tanks", 1900],
  ["hq", 2200],
  ["factory", 2450],
  ["hangar", 3250],
  ["tanks", 3450],
];

export const SKY = 0x8fd3ff;

export const BEST_KEY = "duelhippo.best";

// ── Maps ────────────────────────────────────────────────────────────────────
// Not part of the prototype. The Countryside is the prototype's own world;
// the others are built by maps.js, for Free flight and team games (Classic
// is always the Countryside). Picked on the title screen, or by the
// organiser of a team game.
export const MAPS = {
  field: "Countryside",
  sky: "Sky islands",
  arctic: "Arctic",
  zeppelin: "Zeppelins",
  volcano: "Volcano",
  city: "City",
  sea: "Sea",
  storm: "Storm",
  night: "Night raid",
  canyon: "Canyon",
};
export const MAP_KEY = "duelhippo.map";

// ── Weather ─────────────────────────────────────────────────────────────────
// Not part of the prototype. T steps through these on any map but two: the
// Storm is always stormy and the Sea always foggy (`weather` on the map, in
// maps.js). Sunny is each map as it is; in a team game the organiser picks.
// weather.js says what each does to a map's sky.
export const WEATHERS = ["sunny", "foggy", "stormy", "snowy"];
export const WEATHER_NAMES = {
  sunny: "Sunny",
  foggy: "Foggy",
  stormy: "Stormy",
  snowy: "Snowy",
};
// The touch screen's weather button shows the weather in a word that fits.
export const WEATHER_TAGS = {
  sunny: "SUN",
  foggy: "FOG",
  stormy: "RAIN",
  snowy: "SNOW",
};
export const WEATHER_KEY = "duelhippo.weather";
// The maps whose weather never changes, and what it is.
export const FIXED_WEATHER = { storm: "stormy", sea: "foggy" };

// ── Repair in flight ────────────────────────────────────────────────────────
// Not part of the prototype. F, once a flight, on a plane hurt but still
// flying: a countdown from `count`, `tick` s a number, then a run of number
// keys to press, `per` s each; or, started from the touch screen's FIX
// button, a run of moves of the phone, `move` s each (a shake takes longer
// than a key). The run is `min` keys on a scratched plane,
// one more for every `step` % of damage (to the nearest), `max` at most.
// Got right, the damage is gone (not the fuel or the rounds). While it runs
// no other plane's fire can touch the plane (repair.js).
export const REPAIR = {
  count: 3,
  tick: 0.5,
  per: 1.75,
  move: 3,
  min: 4,
  step: 25,
  max: 8,
};

// What counts as a move of the phone (motion.js), in m/s² of the phone's own
// acceleration, gravity taken out. A shake is `turns` + 1 swings, each past
// `shake`, alternating, within `window` s, along one line, and at least
// `dominant` times stronger than along the other two: a hand's firm shake is
// 15–30 m/s², the wobble of holding a phone a few. Held upright, gravity lies
// along the phone's long side: more than `upright` of it.
export const MOTION = {
  shake: 8,
  turns: 2,
  window: 0.8,
  dominant: 1.6,
  upright: 0.8,
};

// Maps are earned: each opens once the best one-player score (any mode) is
// more than its number, 1,000 more than the one before. The Countryside is
// always open. The hardest flying comes last: the Sea's fog, the Storm, the
// Night raid's searchlights and the Canyon's flak.
export const UNLOCK = Object.fromEntries(
  Object.keys(MAPS).map((id, i) => [id, i * 1000]),
);

// ── The obstacle course ─────────────────────────────────────────────────────
// Not part of the prototype. `rings` rings over the Countryside, flown in
// order against the clock, every ring's hole `r` m across the middle. Three
// levels, each its own course, the same every time: the rings closer
// together (`gap`, m) and the turns between them tighter (`turn`, rad, at
// most; `climb`, rad, at most) as they go. Harder levels score more a ring
// (`pts`), and finishing one opens the next. Each level has a time limit:
// `slack` times a perfect run's time (course.js LIMITS). Finishing adds a
// time bonus: `bonus` points a second left, times the level's `pts` / 100.
export const COURSE = {
  rings: 30,
  r: 18,
  levels: [
    {
      name: "Easy",
      gap: [380, 480],
      turn: 0.52,
      climb: 0.12,
      pts: 100,
    },
    {
      name: "Tight",
      gap: [260, 340],
      turn: 0.8,
      climb: 0.17,
      pts: 200,
    },
    {
      name: "Twisting",
      gap: [170, 240],
      turn: 1.05,
      climb: 0.22,
      pts: 300,
    },
  ],
  slack: 2,
  bonus: 10,
};
// v2: the levels' layouts changed, so scores flown on the old rings are
// dropped rather than ranked against the new ones.
export const COURSE_KEY = "duelhippo.course.v2";

// The City: a grid of blocks `pitch` m apart, each `block` m square (so the
// streets are 90 m wide), its towers up to 460 m tall under a solid cloud
// ceiling at `ceil` m.
export const CITY = { pitch: 230, block: 140, ceil: 250 };

// The Sea: each side's runway is a carrier's flight deck, `deck` m above the
// water and hl × hw (half-length, half-width) — 280 m long, about 60% of a
// runway. Its arrester wires stop a plane at `brake` m/s² with the throttle
// idle (a runway's is 7).
export const SEA = { deck: 16, hl: 140, hw: 22, brake: 16 };

// Game speed: the factor every simulated second is scaled by. Not part of the
// prototype; 1 is the prototype's own pace and the default.
export const SPEEDS = [0.25, 0.5, 0.75, 1];
export const SPEED_KEY = "duelhippo.speed";

// Inverted pitch (the prototype's I key), remembered between sessions.
export const INVERT_KEY = "duelhippo.invert";

// The desktop app's automatic update check (updates.js): "1" for on. Off
// unless the player turns it on, as in the other hippos; Help ▸ Check for
// Updates… works either way.
export const UPDATES_KEY = "duelhippo.updates";

// Auto-level: let go of the touch stick and the plane eases back to straight
// and level flight. Not part of the prototype, and keyboard play never uses
// it. Each axis corrects in proportion to its error (gain, per second),
// capped at a gentle turn rate (rad/s), then scaled by airspeed authority
// like every other control input.
export const LEVEL = { roll: 1, rollMax: 0.6, pitch: 0.8, pitchMax: 0.35 };

// Aim down the sights (Free flight): Shift held, or Caps Lock on. Not part of
// the prototype. The camera moves onto the gun line and narrows from the
// scene's 60° to `fov`, easing at `ease` per second. The zoom magnifies every
// turn by 60/26 ≈ 2.3 on screen, so the controls slow by more than that:
// pitch, roll and rudder turn at `rate` of their usual speed and the banking
// turn at `bank` (on screen, about 0.4 and 0.75 as fast), and
// the stick eases in at `ramp` per second, so a tap nudges the nose instead
// of jerking it.
export const ADS = { fov: 26, ease: 12, rate: 0.165, bank: 0.33, ramp: 3 };

// ── Plane types ─────────────────────────────────────────────────────────────
// Not part of the prototype. Four planes, picked on the home runway while
// stopped (flight.js pickPlane). The Kite is the prototype's own plane: every
// number in it is the literal flight.js, weapons.js and DESIGN.md ("Rules &
// numbers") had, so a Kite game is the prototype's, number for number. The
// others trade strengths for something to master:
//
//   torque   a rotary engine (Free flight): under power the plane rolls and
//            yaws left (rad/s at full throttle), and the gyroscope makes
//            turns quicker to the right and slower to the left (`gyro`,
//            a fraction of the turn rate, scaled by throttle)
//   snap     snap stalls: a pull harder than `pull` below `v` × stall speed,
//            held 0.2 s, flicks the plane into a spin. Out takes a push,
//            idle throttle and (Free flight) opposite rudder or stick, held
//            together for `spinExit` seconds
//   landing  `sink` (m/s), `bankLand` (|right.y|) and `along` (|forward.z|,
//            Free flight) are the touchdown limits
//   missiles homing missiles (MSL below); the Kite carries none
//
// `burn` is fuel per second per unit of (0.12 + throttle); `armour` the
// damage a round does; `cadence` the gun's interval (s); `muzzle` the speed a
// round adds to the plane's (m/s); `top` the level speed at full throttle.
export const PLANES = [
  {
    id: "kite",
    name: "Kite",
    role: "Forgiving all-rounder",
    blurb: "The trainer. Lands anywhere, never spins. No missiles.",
    stall: 32,
    thr: 24,
    top: 88,
    pitch: 1.25,
    roll: 2.3,
    yaw: 0.55,
    bank: 1.05,
    cpitch: 1.5,
    sink: 6.5,
    bankLand: 0.26,
    along: 0.35,
    burn: 0.42,
    ammo: 300,
    bombs: 6,
    cadence: 0.075,
    muzzle: 420,
    armour: 6,
    missiles: 0,
    torque: 0,
    gyro: 0,
    snap: null,
    spinExit: 0,
  },
  {
    id: "hornet",
    name: "Hornet",
    role: "Turn fighter",
    blurb:
      "Out-turns anything. The rotary pulls it left; pull hard when slow and it spins.",
    stall: 30,
    thr: 24,
    top: 84,
    pitch: 1.7,
    roll: 3.3,
    yaw: 0.8,
    bank: 1.4,
    cpitch: 2,
    sink: 6.5,
    bankLand: 0.26,
    along: 0.35,
    burn: 0.5,
    ammo: 260,
    bombs: 2,
    cadence: 0.06,
    muzzle: 420,
    armour: 8,
    missiles: 2,
    torque: 0.2,
    gyro: 0.4,
    snap: { v: 1.3, pull: 0.6 },
    spinExit: 0.8,
  },
  {
    id: "lancer",
    name: "Lancer",
    role: "Fast interceptor",
    blurb:
      "The fastest, with four missiles. Turns wide, stalls high, lands on a knife edge.",
    stall: 40,
    thr: 30,
    top: 108,
    pitch: 1,
    roll: 2.6,
    yaw: 0.5,
    bank: 0.85,
    cpitch: 1.25,
    sink: 4.5,
    bankLand: 0.15,
    along: 0.22,
    burn: 0.55,
    ammo: 240,
    bombs: 2,
    cadence: 0.075,
    muzzle: 480,
    armour: 7,
    missiles: 4,
    torque: 0,
    gyro: 0,
    snap: { v: 1.15, pull: 0.6 },
    spinExit: 1,
  },
  {
    id: "brute",
    name: "Brute",
    role: "Armoured bomber",
    blurb:
      "Shrugs off rounds and carries twelve bombs. Slow, heavy, and slow out of a spin.",
    stall: 36,
    thr: 20,
    top: 78,
    pitch: 0.9,
    roll: 1.6,
    yaw: 0.45,
    bank: 0.8,
    cpitch: 1.1,
    sink: 5,
    bankLand: 0.2,
    along: 0.3,
    burn: 0.4,
    ammo: 400,
    bombs: 12,
    cadence: 0.09,
    muzzle: 400,
    armour: 4,
    missiles: 2,
    torque: 0,
    gyro: 0,
    snap: { v: 1.1, pull: 0.9 },
    spinExit: 1.8,
  },
];
// Drag from the top speed, as DRAG is from 88 m/s: thrust = drag at the top.
// For the Kite this is DRAG's own expression, so the value is the same.
for (const p of PLANES) p.drag = p.thr / (p.top * p.top);
export const PLANE_KEY = "duelhippo.plane";

// A spin (PLANES `snap`): the plane turns about the vertical at `yaw` rad/s
// with its nose held `nose` rad below the horizon and a wing down by `bank`
// rad, easing into that attitude at `ease` per second; its stick keeps
// `authority` of its effect, and the stalled wing holds the speed under
// `speed` × stall.
export const SPIN = {
  yaw: 2.6,
  nose: 1.05,
  bank: 0.5,
  ease: 4,
  authority: 0.2,
  speed: 0.8,
  hold: 0.2,
};

// Homing missiles (Free flight: they need the sights). Hold the sights on an
// enemy plane within `cone` (rad) and `range` (m) for `lock` seconds; a gap of
// more than `grace` s starts the lock again. A missile leaves at the plane's
// speed + `boost`, climbs to `speed` at `accel`, turns at most `turn` rad/s
// (less than a plane in a hard turn can, so a break turn can beat it), sees
// only within `seeker` (rad) of its nose, flies `life` s and goes off within
// `fuse` m, for `dmg` damage. Service loads one every `rearm` s.
export const MSL = {
  lock: 3,
  cone: 0.0524, // 3°
  range: 1000,
  grace: 0.3,
  boost: 40,
  speed: 180,
  accel: 60,
  turn: 1.2,
  seeker: 1.05,
  life: 8,
  fuse: 8,
  dmg: 40,
  rearm: 1.5,
};
