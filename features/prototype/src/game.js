/* Duel Hippo — 3D biplane dogfighter in the spirit of Sopwith (1984).
   One flight model, two modes:
     classic — side-on lane like the original (pitch, loop, flip), strip map
     free    — full 3D chase-cam flight with banking turns and radar        */
(() => {
'use strict';
const V = THREE.Vector3, Q = THREE.Quaternion, PI = Math.PI;
const $ = id => document.getElementById(id);
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrapA = a => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
const UP = new V(0, 1, 0), AX = new V(1, 0, 0), AY = new V(0, 1, 0), AZ = new V(0, 0, 1);
const tq = new Q(), tm = new THREE.Matrix4(), tv = new V(), tv2 = new V();
const rotLocal = (q, a, ang) => { tq.setFromAxisAngle(a, ang); q.multiply(tq); };
const rotWorld = (q, a, ang) => { tq.setFromAxisAngle(a, ang); q.premultiply(tq); };
const Q_FACE = new Q().setFromAxisAngle(AY, -PI / 2);           // model faces -Z; this turns it to +X
function qSide(q, th, ph) {                                       // classic-mode orientation
  q.setFromAxisAngle(AZ, th); q.multiply(Q_FACE); tq.setFromAxisAngle(AZ, ph); q.multiply(tq); return q;
}
function basis(q, o) {
  o = o || { f: new V(), u: new V(), r: new V() };
  o.f.set(0, 0, -1).applyQuaternion(q); o.u.set(0, 1, 0).applyQuaternion(q); o.r.set(1, 0, 0).applyQuaternion(q);
  return o;
}
const segD2 = (a, b, p) => {                                      // squared distance from p to segment ab
  tv.copy(b).sub(a); const l = tv.lengthSq();
  const t = l ? clamp(tv2.copy(p).sub(a).dot(tv) / l, 0, 1) : 0;
  return tv.multiplyScalar(t).add(a).distanceToSquared(p);
};

// ---------- world constants ----------
const G = 9.8, STALL = 32, THR = 24, DRAG = 24 / (88 * 88), GEAR = 1.95, CX = 1400, FLAT = 2700;
const HOME = { x: 0, z: 0, hl: 230, hw: 18 }, EB = { x: 2850, z: 0, hl: 230, hw: 18 };
const LANE = { min: -700, max: 3600 };
const isTouch = matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window);
let mode = 'classic';
function groundY(x, z) {
  const d = Math.max(Math.abs(x - CX), Math.abs(z));
  return d <= FLAT ? 0 : (d - FLAT) * 0.24 * (0.65 + 0.35 * Math.sin(x * 0.004 + 1) * Math.cos(z * 0.005));
}
const onRun = (p, R) => Math.abs(p.x - R.x) < R.hl && Math.abs(p.z - R.z) < R.hw;

// ---------- 8-bit sound ----------
const sfx = (() => {
  let ac = null, mast = null, eng = null, nbuf = null, muted = false;
  function init() {
    if (ac) return;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    mast = ac.createGain(); mast.gain.value = 0.5; mast.connect(ac.destination);
    // crunchy noise: sample-and-hold, quantised to 4 bits
    const len = ac.sampleRate * 1.5; nbuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = nbuf.getChannelData(0); let v = 0;
    for (let i = 0; i < len; i++) { if (i % 6 === 0) v = Math.round((Math.random() * 2 - 1) * 7) / 7; d[i] = v; }
    // engine: two square waves, gated by a square LFO = putt-putt-putt
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), lfo = ac.createOscillator();
    o1.type = o2.type = lfo.type = 'square'; o2.detune.value = -1193;
    const gate = ac.createGain(); gate.gain.value = 0.5;
    const lfoG = ac.createGain(); lfoG.gain.value = 0.5; lfo.connect(lfoG).connect(gate.gain);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const vol = ac.createGain(); vol.gain.value = 0;
    o1.connect(gate); o2.connect(gate); gate.connect(lp).connect(vol).connect(mast);
    o1.start(); o2.start(); lfo.start();
    eng = { o1, o2, lfo, lp, vol };
  }
  function engine(thr, spd, on) {
    if (!eng) return;
    const t = ac.currentTime, s = Math.min(spd, 120);
    const f = 46 + thr * 44 + s * 0.35;
    eng.o1.frequency.setTargetAtTime(f, t, 0.12); eng.o2.frequency.setTargetAtTime(f, t, 0.12);
    eng.lfo.frequency.setTargetAtTime(6 + thr * 15 + s * 0.06, t, 0.12);
    eng.lp.frequency.setTargetAtTime(450 + thr * 900 + s * 4, t, 0.2);
    eng.vol.gain.setTargetAtTime(on && !muted ? 0.03 + thr * 0.055 + s * 0.0004 : 0, t, 0.15);
  }
  function blip(f0, f1, dur, vol, type = 'square') {
    if (!ac || muted || vol < 0.003) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(mast); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, cut, rate = 1) {
    if (!ac || muted || vol < 0.003) return;
    const t = ac.currentTime, s = ac.createBufferSource(); s.buffer = nbuf; s.playbackRate.value = rate;
    const f = ac.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(cut, t); f.frequency.exponentialRampToValueAtTime(Math.max(70, cut * 0.12), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(mast); s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.05);
  }
  return {
    init, engine,
    resume() { if (ac && ac.state === 'suspended') ac.resume(); },
    gun() { blip(1250, 230, 0.05, 0.06); noise(0.035, 0.05, 4200); },
    egun(d) { blip(820, 190, 0.05, 0.045 * clamp(1 - d / 700, 0, 1)); },
    hit() { blip(320, 80, 0.09, 0.08); noise(0.06, 0.06, 2000); },
    tick() { blip(660, 990, 0.05, 0.03); },
    boom(big, d = 0) {
      const k = clamp(1 - d / 1800, 0.12, 1);
      noise(big ? 1.0 : 0.5, (big ? 0.5 : 0.32) * k, big ? 1600 : 2600, big ? 0.55 : 0.9);
      blip(big ? 150 : 230, 38, big ? 0.55 : 0.28, 0.14 * k);
    },
    whistle(dur) {                                              // falling-bomb whistle, pitch drops till impact
      if (!ac || muted) return null;
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
      o.type = 'square'; lp.type = 'lowpass'; lp.frequency.value = 2400;
      o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(330, t + Math.max(0.4, dur));
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.3);
      o.connect(lp).connect(g).connect(mast); o.start(t); o.stop(t + Math.max(0.4, dur) + 4);
      return { stop() { const n = ac.currentTime; g.gain.cancelScheduledValues(n); g.gain.setTargetAtTime(0.0001, n, 0.02); o.stop(n + 0.12); } };
    },
    toggle() { muted = !muted; if (muted && eng) eng.vol.gain.value = 0; return muted; },
  };
})();

// ---------- renderer ----------
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
catch (e) { $('titleBody').innerHTML = '<h2>3D graphics are switched off</h2><p>Duel Hippo needs WebGL. Try another browser or turn on hardware acceleration.</p>'; return; }
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.tabIndex = 0;
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene(), SKY = 0x8fd3ff;
scene.background = new THREE.Color(SKY); scene.fog = new THREE.Fog(SKY, 700, 3400);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 7000);
scene.add(new THREE.HemisphereLight(0xe8f6ff, 0x58743a, 0.8));
const sun = new THREE.DirectionalLight(0xfff4e0, 0.75); sun.position.set(400, 700, 300); scene.add(sun);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
const M = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c));
const put = (parent, m, x, y, z) => { m.position.set(x, y, z); parent.add(m); return m; };
const flat = (w, d, c, off) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color: c, polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off }));
  m.rotation.x = -PI / 2; return m;
};

// ---------- ground: one patchwork mesh, flat play area, hills at the edges ----------
{
  const GS = 9000, GN = 56, g = new THREE.PlaneGeometry(GS, GS, GN, GN).toNonIndexed(), p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) p.setZ(i, groundY(p.getX(i) + CX, -p.getY(i)));
  const pal = [0x5f9a40, 0x6ea648, 0x528a36, 0x96a64f, 0xb8a656, 0x77a044, 0x5c8e3c].map(c => new THREE.Color(c));
  const lo = new THREE.Color(0x5b8a3a), hi = new THREE.Color(0x9a8a66), c = new THREE.Color();
  for (let q = 0; q < p.count / 6; q++) {
    let h = 0; for (let k = 0; k < 6; k++) h += p.getZ(q * 6 + k);
    h /= 6;
    if (h > 0.5) c.copy(lo).lerp(hi, clamp(h / 260, 0, 1)); else c.copy(pal[(Math.random() * pal.length) | 0]);
    for (let k = 0; k < 6; k++) c.toArray(col, (q * 6 + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  m.rotation.x = -PI / 2; m.position.x = CX; scene.add(m);
  // the dirt road the classic lane follows
  put(scene, flat(LANE.max - LANE.min + 600, 9, 0xb9a47c, -1), (LANE.min + LANE.max) / 2, 0.03, 0);
}

function runway(R, edge) {
  put(scene, flat(R.hl * 2, R.hw * 2, 0x8d8371, -2), R.x, 0.05, R.z);
  for (let x = -R.hl + 30; x < R.hl - 30; x += 32) put(scene, flat(13, 1.2, 0xf4f1e6, -4), R.x + x, 0.06, R.z);
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) put(scene, flat(14, 2, 0xf4f1e6, -4), R.x + s * (R.hl - 12), 0.06, R.z - 12 + i * 6);
  for (let x = -R.hl; x <= R.hl; x += 46) for (const s of [-1, 1]) put(scene, box(1, 0.7, 1, edge), R.x + x, 0.35, R.z + s * (R.hw + 1.5));
}
runway(HOME, 0x55ffff); runway(EB, 0xff55ff);

// solids you can fly into (free mode reaches the off-lane buildings)
const solids = [];
function hangar(x, z, roof, solid = true) {
  const g = new THREE.Group();
  put(g, box(30, 10, 24, 0x8a6e52), 0, 5, 0); put(g, box(32, 2.4, 26, roof), 0, 11.2, 0);
  put(g, box(16, 8, 0.4, 0x3b2c22), 0, 4, 12.1);
  g.position.set(x, 0, z); scene.add(g);
  if (solid) solids.push({ x, z, r: 17, h: 12.5 });
  return g;
}
{ // home base dressing (behind the lane, visible as backdrop in classic)
  hangar(-110, -60, 0x2fc6d6); hangar(-150, -95, 0x2fc6d6);
  const tw = new THREE.Group(); put(tw, box(6, 16, 6, 0xd9d2c0), 0, 8, 0); put(tw, box(9, 4, 9, 0x55ffff), 0, 18, 0);
  tw.position.set(140, 0, -55); scene.add(tw); solids.push({ x: 140, z: -55, r: 6, h: 20 });
  put(scene, box(0.4, 12, 0.4, 0xeeeeee), 120, 6, -28); put(scene, box(5, 3, 0.15, 0x55ffff), 122.7, 10.5, -28);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5, 8, 1, true), M(0xff8a2a)); sock.rotation.z = PI / 2; put(scene, sock, 166, 9, -30);
  put(scene, box(0.3, 9, 0.3, 0xdddddd), 163.5, 4.5, -30);
  for (let i = 0; i < 6; i++) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 8), M(i % 2 ? 0xc23b3b : 0x2b6fb3)); put(scene, d, -60 + (i % 3) * 2.1, 0.9 + (i > 2 ? 1.8 : 0), -40); }
  // enemy airfield dressing
  hangar(EB.x - 120, -70, 0xb03aa0); hangar(EB.x + 120, -70, 0xb03aa0);
}

// ---------- trees (instanced) and clouds ----------
const TDEF = [['tanks', 850], ['factory', 1200], ['hangar', 1550], ['tanks', 1900], ['hq', 2200], ['factory', 2450], ['hangar', 3250], ['tanks', 3450]];
{
  const N = 900, crown = new THREE.InstancedMesh(new THREE.ConeGeometry(4, 10, 6), M(0x3d7a35), N);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 0.7, 3, 5), M(0x6b4a2a), N);
  const m = new THREE.Matrix4(), s = new V(), p = new V(), q = new Q();
  const bad = (x, z) => {
    if (x > LANE.min - 200 && x < LANE.max + 200 && z > -30 && z < 160) return true;   // keep the lane & classic camera clear
    for (const R of [HOME, EB]) if (Math.abs(x - R.x) < R.hl + 70 && Math.abs(z - R.z) < 110) return true;
    return Math.abs(x - CX) > 4300 || Math.abs(z) > 4300;
  };
  let i = 0, tries = 0;
  while (i < N && tries++ < 20000) {
    const cx = rnd(CX - 3600, CX + 3600), cz = rnd(-3600, 3600), n = 6 + (Math.random() * 20 | 0);
    for (let k = 0; k < n && i < N; k++) {
      const x = cx + rnd(-90, 90), z = cz + rnd(-90, 90);
      if (bad(x, z)) continue;
      const sc = rnd(0.7, 1.6), y = groundY(x, z);
      q.setFromAxisAngle(AY, rnd(0, 6.3));
      m.compose(p.set(x, y + 8 * sc, z), q, s.set(sc, sc, sc)); crown.setMatrixAt(i, m);
      m.compose(p.set(x, y + 1.5 * sc, z), q, s.set(sc, sc, sc)); trunk.setMatrixAt(i, m);
      i++;
    }
  }
  crown.count = trunk.count = i; scene.add(crown, trunk);

  const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.93 });
  const cg = new THREE.IcosahedronGeometry(1, 0);
  for (let c = 0; c < 60; c++) {
    const grp = new THREE.Group(), n = 3 + (Math.random() * 4 | 0);
    for (let j = 0; j < n; j++) { const b = new THREE.Mesh(cg, cm); b.scale.set(rnd(24, 44), rnd(11, 19), rnd(18, 32)); b.position.set(j * 27 - n * 13 + rnd(-8, 8), rnd(-5, 5), rnd(-10, 10)); grp.add(b); }
    const behind = c < 30;   // half the clouds form the classic-mode backdrop
    grp.position.set(behind ? rnd(LANE.min - 400, LANE.max + 400) : rnd(CX - 3800, CX + 3800), rnd(behind ? 300 : 380, 700), behind ? rnd(-1100, -160) : rnd(-3800, 3800));
    if (!behind && Math.abs(grp.position.z) < 90) grp.position.z += 400;
    scene.add(grp);
  }
}

// ---------- planes ----------
function makePlane(body, wing, trim, dark) {
  const g = new THREE.Group(), strut = 0x3a2a1a;
  put(g, box(1.4, 1.4, 6.4, body), 0, 0, 0.2);
  put(g, box(1.7, 1.7, 1.1, 0x2b2b2b), 0, 0, -3.4);
  put(g, box(10.5, 0.16, 1.7, wing), 0, 1.7, -1.3);
  put(g, box(9.4, 0.16, 1.6, wing), 0, -0.65, -1.0);
  for (const sx of [-3.6, 3.6]) put(g, box(0.12, 2.35, 0.12, strut), sx, 0.52, -1.15);
  for (const sx of [-0.6, 0.6]) put(g, box(0.1, 1.1, 0.1, strut), sx, 1.15, -1.6);
  put(g, box(3.8, 0.12, 1.2, wing), 0, 0.25, 3.1);
  put(g, box(0.12, 1.5, 1.2, dark), 0, 0.95, 3.25);
  put(g, box(1.45, 0.3, 2.2, dark), 0, 0.72, -0.2);          // cockpit coaming
  const wg = new THREE.CylinderGeometry(0.48, 0.48, 0.3, 10);
  for (const sx of [-0.95, 0.95]) { const w = new THREE.Mesh(wg, M(0x222222)); w.rotation.z = PI / 2; put(g, w, sx, -1.47, -1.8); put(g, box(0.1, 0.9, 0.1, strut), sx * 0.7, -1.05, -1.8); }
  put(g, box(0.15, 0.5, 0.15, strut), 0, -0.85, 3.3);
  const rg = new THREE.CircleGeometry(0.62, 16);
  for (const sx of [-3.7, 3.7]) { const c = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: trim })); c.rotation.x = -PI / 2; put(g, c, sx, 1.79, -1.3); }
  g.userData.prop = put(g, box(0.22, 2.8, 0.08, 0x6b4a2a), 0, 0, -4.0);
  return g;
}
function blob() {
  const m = new THREE.Mesh(new THREE.CircleGeometry(5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  m.rotation.x = -PI / 2; scene.add(m); return m;
}
function syncShadow(sh, pos, on) {
  const gy = groundY(pos.x, pos.z), alt = pos.y - gy;
  sh.visible = on && alt < 300;
  sh.position.set(pos.x, gy + 0.2, pos.z); sh.material.opacity = 0.32 * clamp(1 - alt / 300, 0, 1); sh.scale.setScalar(1 + alt / 150);
}

// ---------- targets & hippos ----------
const targets = [];
function makeTarget(kind, x) {
  const g = new THREE.Group(); let r, h, hp, pts, name;
  if (kind === 'hangar') { put(g, box(30, 10, 24, 0x8a6e52), 0, 5, 0); put(g, box(32, 2.4, 26, 0xb03aa0), 0, 11.2, 0); r = 17; h = 12.5; hp = 6; pts = 150; name = 'Hangar'; }
  else if (kind === 'factory') {
    put(g, box(26, 14, 18, 0xa0523d), 0, 7, 0); put(g, box(27, 1.2, 19, 0x6e3428), 0, 14.4, 0);
    put(g, new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 20, 8), M(0x5a3a2a)), 8, 17, -4);
    r = 15; h = 16; hp = 8; pts = 200; name = 'Factory';
  } else if (kind === 'tanks') {
    for (const sx of [-6, 6]) put(g, new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 7, 12), M(0xd8d8d8)), sx, 3.5, 0);
    r = 12; h = 7; hp = 4; pts = 100; name = 'Fuel depot';
  } else {
    put(g, box(20, 12, 20, 0xc9b48a), 0, 6, 0); put(g, box(22, 1.5, 22, 0xb03aa0), 0, 12.7, 0);
    put(g, box(0.3, 10, 0.3, 0xeeeeee), 0, 18, 0); put(g, box(4, 2.4, 0.12, 0xff55ff), 2.1, 21.6, 0);
    r = 12; h = 13; hp = 6; pts = 250; name = 'Headquarters';
  }
  g.position.set(x, 0, 0); scene.add(g);
  return { g, kind, name, x, z: 0, r, h, hp, pts, alive: true, smokeT: rnd(1) };
}
function buildTargets() { for (const t of targets) scene.remove(t.g); targets.length = 0; for (const d of TDEF) targets.push(makeTarget(d[0], d[1])); }
function hurtTarget(t, n, pos) {
  if (!t.alive) return;
  t.hp -= n;
  if (t.hp > 0) { puff(pos, 0xffd27a, 3, 8, 0.8, 0.35, 2); return; }
  t.alive = false; t.g.scale.y = 0.18;
  t.g.traverse(o => { if (o.material && o.material.color) o.material.color.setHex(0x3b3530); });
  boom(tv2.set(t.x, t.h * 0.5, t.z).clone(), true);
  S.score += t.pts; say(t.name + ' destroyed  +' + t.pts, 1.8);
  if (targets.every(t => !t.alive)) { S.score += 1000; S.wave++; say('Enemy town flattened!  +1000', 4); S.rebuildT = 30; }
}

const hippos = [];
function makeHippo(x) {
  const g = new THREE.Group(), c = 0x9a95b8;
  put(g, box(4.4, 2.6, 2.6, c), 0, 2.4, 0); put(g, box(2, 1.9, 2.2, c), 2.9, 2.6, 0); put(g, box(1.2, 1.3, 2.3, 0xb4afcf), 4.2, 2.2, 0);
  for (const sz of [-0.7, 0.7]) put(g, box(0.4, 0.5, 0.4, 0xff9ec7), 2.6, 3.75, sz);
  for (const sx of [-1.5, 1.5]) for (const sz of [-0.85, 0.85]) put(g, box(0.8, 1.2, 0.8, 0x7d7898), sx, 0.6, sz);
  g.position.set(x, 0, 0); scene.add(g);
  return { g, x0: x, x, z: 0, alive: true, dir: 1, t: rnd(5) };
}
for (const x of [520, 1050, 1720]) hippos.push(makeHippo(x));

// ---------- effects: particles, bullets, bombs ----------
const parts = [], pGeo = new THREE.IcosahedronGeometry(1, 0);
function puff(pos, color, n, spd, size, life, rise = 0) {
  for (let i = 0; i < n; i++) {
    let p = parts.find(p => !p.on);
    if (!p) { if (parts.length > 360) return; p = { m: new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })), v: new V() }; scene.add(p.m); parts.push(p); }
    p.on = true; p.m.visible = true; p.m.material.color.setHex(color);
    p.m.position.copy(pos).add(tv.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)));
    p.v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(spd * rnd(0.3, 1)); p.v.y += rise;
    if (mode === 'classic') p.v.z *= 0.3;
    p.s0 = size * rnd(0.5, 1.1); p.t = 0; p.life = life * rnd(0.7, 1.2);
  }
}
function boom(pos, big) {
  puff(pos, 0xffb030, big ? 16 : 10, big ? 20 : 14, big ? 2.8 : 1.8, 0.6);
  puff(pos, 0xfff27a, big ? 6 : 4, 10, 1.4, 0.35);
  puff(pos, 0x4a4a4a, big ? 12 : 7, 7, big ? 3.4 : 2.2, 1.9, 5);
  sfx.boom(big, camera.position.distanceTo(pos));
}

const bullets = [], bGeo = new THREE.BoxGeometry(0.32, 0.32, 4.5);
const bMatP = new THREE.MeshBasicMaterial({ color: 0xfff27a }), bMatE = new THREE.MeshBasicMaterial({ color: 0xff55ff });
function fire(pos, dir, spd, own) {
  let b = bullets.find(b => !b.on);
  if (!b) { if (bullets.length > 240) return; b = { m: new THREE.Mesh(bGeo, bMatP), v: new V(), p0: new V() }; scene.add(b.m); bullets.push(b); }
  b.on = true; b.own = own; b.m.material = own === 'p' ? bMatP : bMatE; b.m.visible = true;
  b.m.position.copy(pos); b.v.copy(dir).multiplyScalar(spd); b.life = 1.4;
  b.m.lookAt(tv.copy(pos).add(dir));
}
const bombs = [];
function dropBomb() {
  if (state !== 'play' || paused || !P.alive || P.grounded || P.bombs < 1 || P.bombCd > 0 || P.dmg >= 100) return;
  P.bombs--; P.bombCd = 0.45;
  let b = bombs.find(b => !b.on);
  if (!b) { const m = new THREE.Group(); put(m, box(0.55, 0.55, 1.6, 0x2e2e2e), 0, 0, 0); put(m, box(1.1, 0.08, 0.4, 0x2e2e2e), 0, 0, 0.75); put(m, box(0.08, 1.1, 0.4, 0x2e2e2e), 0, 0, 0.75); scene.add(m); b = { m, v: new V() }; bombs.push(b); }
  basis(P.q, PB);
  b.on = true; b.m.visible = true; b.m.position.copy(P.pos).addScaledVector(PB.u, -2.2); b.v.copy(P.vel);
  const h = Math.max(1, b.m.position.y - groundY(b.m.position.x, b.m.position.z)), vd = Math.max(0, -b.v.y);
  b.snd = sfx.whistle((-vd + Math.sqrt(vd * vd + 2 * G * h)) / G);
}

// ---------- state ----------
const S = { score: 0, kills: 0, wave: 0, lives: 3, rebuildT: 0, spawnT: 0, best: 0 };
try { S.best = +localStorage.getItem('duelhippo.best') || 0; } catch (e) {}
let state = 'title', paused = false, camZoom = 0, respawnT = 0;
const opt = { invert: false };
const PB = basis(new Q());

const P = { pos: new V(), q: new Q(), vel: new V(), speed: 0, sink: 0, thr: 0, fuel: 100, ammo: 300, bombs: 6, dmg: 0, alive: false, grounded: true, gunCd: 0, bombCd: 0, side: 1, th: 0, ph: 0, phT: 0, svc: 0 };
P.obj = makePlane(0xf2f2ea, 0x3fd8e8, 0x55ffff, 0x14a0b4); scene.add(P.obj); P.shadow = blob();
const crashAt = new V();

function resetPlayer() {
  P.pos.set(HOME.x - 190, GEAR, 0); P.th = 0; P.ph = P.phT = 0; qSide(P.q, 0, 0);
  P.vel.set(0, 0, 0); P.speed = 0; P.sink = 0; P.thr = 0; P.fuel = 100; P.ammo = 300; P.bombs = 6; P.dmg = 0;
  P.alive = true; P.grounded = true; P.obj.visible = true; touch.thr = null;
}

const enemies = [];
for (let i = 0; i < 6; i++) {
  const o = makePlane(0x3a2a40, 0xe055d0, 0xff55ff, 0x7a1f70); o.visible = false; scene.add(o);
  enemies.push({ obj: o, shadow: blob(), pos: new V(), q: new Q(), up: new V(0, 1, 0), alive: false, hp: 3, speed: 58, cd: 0, burst: 0, t: 0, ph0: i * 1.05, th: 0, ph: 0, phT: 0, turn: 0.75 });
}
function spawnEnemy() {
  const e = enemies.find(e => !e.alive); if (!e) return;
  e.alive = true; e.hp = 3; e.speed = 58; e.cd = 1.5; e.burst = 0; e.turn = 0.7 + Math.min(0.35, S.wave * 0.06 + S.kills * 0.01);
  e.pos.set(EB.x + rnd(-250, 350), rnd(220, 380), mode === 'classic' ? 0 : rnd(-300, 300));
  e.th = PI; e.ph = e.phT = PI; e.up.set(0, 1, 0);
  if (mode === 'classic') qSide(e.q, e.th, e.ph); else e.q.setFromAxisAngle(AY, PI / 2 + rnd(-0.5, 0.5));
  e.obj.visible = true;
}
function killEnemy(e, scored) {
  boom(e.pos, false); e.alive = false; e.obj.visible = false; e.shadow.visible = false;
  if (scored) { S.score += 100; S.kills++; say('Enemy down!  +100', 1.4); }
}

// ---------- input ----------
const key = {}, touch = { pitch: 0, roll: 0, fire: false, thr: null };
const PREVENT = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
addEventListener('keydown', e => {
  if (PREVENT.includes(e.code)) e.preventDefault();
  if (!key[e.code]) press(e.code);
  key[e.code] = true;
});
addEventListener('keyup', e => { key[e.code] = false; });
addEventListener('blur', () => { for (const k in key) key[k] = false; });
function press(code) {
  if (code === 'KeyM') { $('bMute').textContent = sfx.toggle() ? 'SOUND OFF' : 'SOUND ON'; return; }
  if (code === 'KeyF') { toggleFull(); return; }
  if (state !== 'play') { if (code === 'Enter') startGame(mode); return; }
  if (code === 'KeyP' || code === 'Escape') { setPause(!paused); return; }
  if (paused) return;
  if (code === 'KeyB') dropBomb();
  if (code === 'KeyC') camZoom = (camZoom + 1) % 2;
  if (code === 'KeyI') { opt.invert = !opt.invert; say(opt.invert ? 'Pitch inverted' : 'Pitch normal', 1.2); }
  if (code === 'KeyH') $('help').classList.toggle('hidden');
  if (mode === 'classic' && (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'KeyX')) flip();
}
function flip() {
  if (!P.alive || P.dmg >= 100) return;
  if (P.grounded) {
    if (P.speed < 4) { P.th = wrapA(P.th + PI); P.ph = P.phT = wrapA(P.ph + PI); say('Turned around', 0.8); }
    return;
  }
  P.phT = Math.abs(wrapA(P.phT)) < 0.1 ? PI : 0;
}
function readInput() {
  let pitch = (key.ArrowDown ? 1 : 0) - (key.ArrowUp ? 1 : 0) + touch.pitch;
  if (opt.invert) pitch = -pitch;
  const roll = mode === 'classic' ? 0 : (key.ArrowLeft ? 1 : 0) - (key.ArrowRight ? 1 : 0) + touch.roll;
  const yaw = mode === 'classic' ? 0 : (key.KeyA ? 1 : 0) - (key.KeyD ? 1 : 0);
  return { pitch: clamp(pitch, -1, 1), roll: clamp(roll, -1, 1), yaw, fire: !!(key.Space || touch.fire) };
}

// ---------- player update ----------
function updPlayer(dt) {
  const inp = readInput();
  if (key.KeyW) P.thr += 0.7 * dt;
  if (key.KeyS) P.thr -= 0.7 * dt;
  if (touch.thr !== null) P.thr = touch.thr;
  const dead = P.dmg >= 100;
  P.thr = (P.fuel <= 0 || dead) ? 0 : clamp(P.thr, 0, 1);
  P.fuel = Math.max(0, P.fuel - (0.12 + P.thr) * 0.42 * dt);
  P.gunCd -= dt; P.bombCd -= dt;
  let b = basis(P.q, PB);
  const ctrl = clamp(P.speed / STALL, 0.1, 1.2) * (dead ? 0.15 : 1);

  // orientation
  if (mode === 'classic') {
    if (!P.grounded) {
      P.th += inp.pitch * 1.5 * ctrl * Math.cos(P.ph) * dt;
      if (P.speed < STALL) { const k = (1 - P.speed / STALL) * 1.6 * dt; P.th += clamp(wrapA(-PI / 2 - P.th), -k, k); }
      if (dead) P.th += clamp(wrapA(-PI / 2 - P.th), -0.5 * dt, 0.5 * dt);
      const outL = P.pos.x < LANE.min && Math.cos(P.th) < 0, outR = P.pos.x > LANE.max && Math.cos(P.th) > 0;
      if (outL || outR) { P.th += 1.3 * Math.cos(P.ph) * dt; say('Turn back!', 0.6); }
    }
    P.ph += clamp(wrapA(P.phT - P.ph), -5 * dt, 5 * dt);
    qSide(P.q, P.th, P.ph); P.th = wrapA(P.th);
  } else if (!P.grounded) {
    rotLocal(P.q, AX, inp.pitch * 1.25 * ctrl * dt);
    rotLocal(P.q, AZ, inp.roll * 2.3 * ctrl * dt);
    rotLocal(P.q, AY, inp.yaw * 0.55 * ctrl * dt);
    rotWorld(P.q, AY, b.r.y * 1.05 * ctrl * dt);                  // banking turns the plane
    if (P.speed < STALL && b.f.y > -0.85) rotLocal(P.q, AX, -(1 - P.speed / STALL) * 1.4 * dt);
    if (dead) { rotLocal(P.q, AX, -0.35 * dt); rotLocal(P.q, AZ, 0.6 * dt); }
    tv.set(P.pos.x - CX, 0, P.pos.z);
    if (Math.max(Math.abs(tv.x), Math.abs(tv.z)) > 3500) {
      const s = Math.sign(tv2.copy(b.f).cross(tv.negate()).y) || 1;
      rotWorld(P.q, AY, s * 0.9 * dt); say('Edge of the map — turning back', 0.6);
    }
    P.q.normalize();
  }
  b = basis(P.q, PB);

  // speed, lift, sink
  P.speed += (P.thr * THR - DRAG * P.speed * P.speed - G * b.f.y) * dt;
  P.speed = clamp(P.speed, 0, 140);
  const lift = Math.min(1, (P.speed / STALL) ** 2) * Math.max(0, 0.55 + 0.45 * b.u.y);
  P.sink += (Math.min(45, G * (1 - lift) * 2.2) - P.sink) * Math.min(1, dt * 1.6);
  if (P.grounded) P.sink = 0;
  P.vel.copy(b.f).multiplyScalar(P.speed); P.vel.y -= P.sink;
  P.pos.addScaledVector(P.vel, dt);
  if (mode === 'classic') P.pos.z = 0;

  // ground contact
  const gy = groundY(P.pos.x, P.pos.z) + GEAR, onHome = onRun(P.pos, HOME), onRw = onHome || onRun(P.pos, EB);
  if (!P.grounded && P.pos.y <= gy) {
    const vs = -P.vel.y, along = mode === 'classic' || Math.abs(b.f.z) < 0.35;
    if (onRw && !dead && vs < 6.5 && Math.abs(b.r.y) < 0.26 && b.f.y > -0.2 && b.u.y > 0.85 && along) {
      P.grounded = true;
      if (mode === 'classic') { P.th = Math.cos(P.th) >= 0 ? 0 : PI; P.ph = P.phT = P.th; }
      say(onHome ? 'Touchdown! Roll to a stop to refuel' : 'Landed on enemy turf. Cheeky.', 2.5);
    } else return crash(P.pos, dead ? 'Shot down!' : onRw ? 'Too hard! Wings level, sink under 6 m/s' : 'Crashed — land on a runway');
  }
  if (P.grounded) {
    if (mode !== 'classic') {
      let hd = Math.atan2(-b.f.x, -b.f.z);
      hd += (inp.roll + inp.yaw) * 0.7 * clamp(P.speed / 12, 0.25, 1) * dt;
      P.q.setFromAxisAngle(AY, hd);
    }
    P.pos.y = gy;
    P.speed = Math.max(0, P.speed - (onRw ? (P.thr < 0.05 ? 7 : 0.6) : 9) * dt);
    if (!onRw && P.speed > 22) return crash(P.pos, 'Ran off the runway');
    if (P.speed > STALL * 1.05 && (inp.pitch > 0.2 || P.speed > STALL * 1.45)) {
      P.grounded = false; P.pos.y += 0.4;
      if (mode === 'classic') P.th += 0.1 * Math.cos(P.ph); else rotLocal(P.q, AX, 0.1);
    }
    if (onHome && P.speed < 3 && P.thr < 0.1) service(dt); else $('svc').classList.add('hidden');
  } else $('svc').classList.add('hidden');

  // obstacles
  for (const t of targets) if (P.pos.y < t.h + 1.5 && Math.hypot(P.pos.x - t.x, P.pos.z - t.z) < t.r) return crash(P.pos, t.alive ? 'Flew into the ' + t.name.toLowerCase() : 'Flew into the rubble');
  for (const s of solids) if (P.pos.y < s.h + 1.5 && Math.hypot(P.pos.x - s.x, P.pos.z - s.z) < s.r) return crash(P.pos, 'Flew into a building');
  for (const h of hippos) if (h.alive && P.pos.y < 5.5 && Math.hypot(P.pos.x - h.x, P.pos.z - h.z) < 4.5) return crash(P.pos, 'You hit a hippo. The hippo is fine.');

  // guns
  if (inp.fire && P.gunCd <= 0 && !dead) {
    if (P.ammo >= 1) {
      P.gunCd = 0.075; P.ammo--; P.side = -P.side;
      tv2.copy(P.pos).addScaledVector(b.f, 4.6).addScaledVector(b.r, 0.55 * P.side).addScaledVector(b.u, 0.6);
      fire(tv2, b.f, P.speed + 420, 'p'); sfx.gun();
    } else { P.gunCd = 0.6; say('Out of ammo — land at home to rearm', 1.2); }
  }
  if (P.dmg > 45 && Math.random() < dt * P.dmg / 5) puff(tv2.copy(P.pos).addScaledVector(b.f, 2), 0x555555, 1, 2, 1.1, 1.3, 3);

  P.obj.position.copy(P.pos); P.obj.quaternion.copy(P.q);
  P.obj.userData.prop.rotation.z += (P.thr * 55 + (P.speed > 1 ? 6 : 0)) * dt;
}
function service(dt) {
  const was = P.fuel + P.ammo + P.bombs - P.dmg;
  P.fuel = Math.min(100, P.fuel + 22 * dt); P.ammo = Math.min(300, P.ammo + 90 * dt); P.dmg = Math.max(0, P.dmg - 25 * dt);
  P.svc += dt; if (P.svc > 0.9 && P.bombs < 6) { P.bombs++; P.svc = 0; sfx.tick(); }
  const full = P.fuel >= 100 && P.ammo >= 300 && P.bombs >= 6 && P.dmg <= 0;
  $('svc').textContent = full ? 'Ready! Throttle up to take off' : 'Servicing: fuel, guns, bombs, repairs…';
  $('svc').classList.remove('hidden');
  if (!full && was !== P.fuel + P.ammo + P.bombs - P.dmg && Math.random() < dt * 3) sfx.tick();
}
function crash(pos, why) {
  crashAt.copy(pos); boom(pos, true); puff(pos, 0x333333, 10, 5, 3, 3, 7);
  P.alive = false; P.obj.visible = false; P.shadow.visible = false; S.lives--; respawnT = 3.2;
  say(why, 3);
}

// ---------- enemy AI ----------
const EB_ = basis(new Q());
function updEnemy(e, dt) {
  const hunting = P.alive && !P.grounded;
  let tgt;
  if (hunting) { const d = P.pos.distanceTo(e.pos); tgt = tv2.copy(P.pos).addScaledVector(P.vel, clamp(d / 440, 0, 1.2)); }
  else { e.t += dt * 0.25; tgt = tv2.set(EB.x + Math.cos(e.t + e.ph0) * 420, 270 + Math.sin(e.t * 1.7 + e.ph0) * 40, mode === 'classic' ? 0 : Math.sin(e.t + e.ph0) * 420); }
  const to = tv.copy(tgt).sub(e.pos);
  const alt = e.pos.y - groundY(e.pos.x, e.pos.z);
  let b = basis(e.q, EB_);
  if (mode === 'classic') {
    to.z = 0;
    if (alt < 100) to.set(Math.cos(e.th) * 60, 140, 0);
    if (e.pos.x < LANE.min + 100) to.set(200, 40, 0); else if (e.pos.x > LANE.max + 100) to.set(-200, 40, 0);
    const want = Math.atan2(to.y, to.x), k = e.turn * 1.4 * dt;
    e.th = wrapA(e.th + clamp(wrapA(want - e.th), -k, k));
    const c = Math.cos(e.th); if (c < -0.2) e.phT = PI; else if (c > 0.2) e.phT = 0;
    e.ph += clamp(wrapA(e.phT - e.ph), -4 * dt, 4 * dt);
    qSide(e.q, e.th, e.ph);
  } else {
    if (alt < 100) to.y = to.length() * 0.7;
    const des = to.normalize(), ang = Math.acos(clamp(b.f.dot(des), -1, 1));
    const nf = tv2.copy(b.f);
    if (ang > 1e-4) nf.applyAxisAngle(tv.copy(b.f).cross(des).normalize(), Math.min(ang, e.turn * dt));
    nf.y = clamp(nf.y, -0.7, 0.7); nf.normalize();
    const lat = des.dot(b.r);
    e.up.lerp(tv.copy(UP).addScaledVector(b.r, clamp(lat * 3, -1.6, 1.6)).normalize(), 1 - Math.exp(-dt * 3)).normalize();
    tm.lookAt(e.pos, tv.copy(e.pos).add(nf), e.up); e.q.setFromRotationMatrix(tm);
  }
  b = basis(e.q, EB_);
  e.speed += ((58 - b.f.y * 18) - e.speed) * Math.min(1, dt);
  e.pos.addScaledVector(b.f, e.speed * dt);
  if (mode === 'classic') e.pos.z = 0;

  e.cd -= dt;
  if (hunting && e.cd <= 0) {
    tv.copy(P.pos).sub(e.pos); const d = tv.length();
    if (d < 420 && b.f.dot(tv.divideScalar(d)) > 0.982) {
      const dir = tv.copy(b.f).add(tv2.set(rnd(-0.025, 0.025), rnd(-0.025, 0.025), mode === 'classic' ? 0 : rnd(-0.025, 0.025))).normalize();
      fire(tv2.copy(e.pos).addScaledVector(b.f, 5), dir, e.speed + 380, 'e'); sfx.egun(camera.position.distanceTo(e.pos));
      e.burst++; e.cd = e.burst > 7 ? (e.burst = 0, 1.3) : 0.11;
    }
  }
  if (e.pos.y < groundY(e.pos.x, e.pos.z) + 2) return killEnemy(e, false);
  if (P.alive && P.pos.distanceTo(e.pos) < 6.5) { killEnemy(e, true); return crash(P.pos, 'Mid-air collision!'); }
  if (e.hp <= 1 && Math.random() < dt * 18) puff(e.pos, 0x555555, 1, 2, 1, 1.2, 3);
  e.obj.position.copy(e.pos); e.obj.quaternion.copy(e.q); e.obj.userData.prop.rotation.z += 50 * dt;
  syncShadow(e.shadow, e.pos, true);
}

// ---------- world update ----------
function update(dt) {
  if (P.alive) updPlayer(dt);
  else if ((respawnT -= dt) <= 0) { if (S.lives > 0) { resetPlayer(); say('New plane on the runway', 2); } else return gameOver(); }
  syncShadow(P.shadow, P.pos, P.alive && camZoom + (mode === 'classic' ? 0 : 0) >= 0);

  const maxE = Math.min(5, 2 + Math.floor(S.kills / 4) + S.wave);
  S.spawnT -= dt;
  if (S.spawnT <= 0 && enemies.filter(e => e.alive).length < maxE) { spawnEnemy(); S.spawnT = 5; }
  for (const e of enemies) if (e.alive) updEnemy(e, dt);
  if (S.rebuildT > 0 && (S.rebuildT -= dt) <= 0) { buildTargets(); say('The enemy rebuilt their town!', 2.5); }

  for (const b of bullets) {
    if (!b.on) continue;
    b.p0.copy(b.m.position); b.m.position.addScaledVector(b.v, dt); b.life -= dt;
    const p = b.m.position; let hit = false;
    if (b.own === 'p') {
      for (const e of enemies) if (e.alive && segD2(b.p0, p, e.pos) < 40) {
        hit = true; e.hp--; puff(e.pos, 0xfff27a, 3, 8, 0.7, 0.3); sfx.hit();
        if (e.hp <= 0) killEnemy(e, true);
        break;
      }
      if (!hit) for (const t of targets) if (t.alive && p.y < t.h && Math.hypot(p.x - t.x, p.z - t.z) < t.r) { hit = true; hurtTarget(t, 1, p.clone()); break; }
      if (!hit) for (const h of hippos) if (h.alive && p.y < 4.5 && Math.hypot(p.x - h.x, p.z - h.z) < 4) { hit = true; scareHippo(h); break; }
    } else if (P.alive && segD2(b.p0, p, P.pos) < 22) {
      hit = true; P.dmg = Math.min(100, P.dmg + 6); sfx.hit(); puff(P.pos, 0xff55ff, 3, 6, 0.6, 0.3);
      if (P.dmg >= 100) say('Engine hit! Going down…', 2.5);
    }
    if (!hit && p.y < groundY(p.x, p.z)) { hit = true; puff(p, 0xb9a47c, 2, 4, 0.8, 0.5, 2); }
    if (hit || b.life <= 0) { b.on = false; b.m.visible = false; }
  }

  for (const b of bombs) {
    if (!b.on) continue;
    b.v.y -= G * dt; b.m.position.addScaledVector(b.v, dt); b.m.lookAt(tv.copy(b.m.position).add(b.v));
    const p = b.m.position;
    if (p.y <= groundY(p.x, p.z) + 0.3) {
      b.on = false; b.m.visible = false; if (b.snd) b.snd.stop();
      boom(p, true);
      for (const t of targets) if (t.alive && Math.hypot(p.x - t.x, p.z - t.z) < t.r + 12) hurtTarget(t, 12, p.clone());
      for (const h of hippos) if (h.alive && Math.hypot(p.x - h.x, p.z - h.z) < 14) scareHippo(h);
    }
  }

  for (const t of targets) if (t.alive && t.kind === 'factory' && (t.smokeT -= dt) <= 0) { t.smokeT = 0.35; puff(tv2.set(t.x + 8, 28, -4), 0x8a8a8a, 1, 1.5, 2, 4, 4); }
  for (const h of hippos) {
    if (!h.alive) { if ((h.t -= dt) <= 0) { h.alive = true; h.g.visible = true; } continue; }
    h.t += dt; if (Math.sin(h.t * 0.4) > 0.96) h.dir = -h.dir;
    h.x = clamp(h.x + h.dir * 1.2 * dt, h.x0 - 30, h.x0 + 30); h.g.position.x = h.x; h.g.rotation.y = h.dir > 0 ? 0 : PI;
  }

  for (const p of parts) {
    if (!p.on) continue;
    p.t += dt; const k = p.t / p.life;
    if (k >= 1) { p.on = false; p.m.visible = false; continue; }
    p.m.position.addScaledVector(p.v, dt); p.v.multiplyScalar(1 - 1.5 * dt);
    p.m.scale.setScalar(p.s0 * (1 + k * 2)); p.m.material.opacity = (1 - k) * 0.9;
  }
}
function scareHippo(h) {
  h.alive = false; h.g.visible = false; h.t = 25; S.score = Math.max(0, S.score - 50);
  puff(tv2.set(h.x, 3, h.z), 0x9a95b8, 8, 10, 1, 0.8, 4); say('Leave the hippos alone!  −50', 1.8);
}

// ---------- camera ----------
let orbitT = 0;
function updCamera(dt) {
  if (state !== 'play') {
    orbitT += dt * 0.07;
    camera.up.set(0, 1, 0);
    camera.position.set(HOME.x - 100 + Math.cos(orbitT) * 150, 42, Math.sin(orbitT) * 150 + 40);
    camera.lookAt(HOME.x - 160, 6, 0); return;
  }
  if (!P.alive) { camera.lookAt(crashAt); return; }
  const b = basis(P.q, PB);
  P.obj.visible = true;
  if (mode === 'classic') {
    const dist = camZoom ? 120 : 56;
    const k = 1 - Math.exp(-dt * 5);
    camera.position.x += (P.pos.x + P.vel.x * 0.3 - camera.position.x) * k;
    camera.position.y += (Math.max(P.pos.y + 4, 16) - camera.position.y) * Math.min(1, k * 2.5);
    camera.position.z += (dist - camera.position.z) * k;
    camera.up.set(0, 1, 0);
    camera.lookAt(camera.position.x, camera.position.y - 5, 0);
    return;
  }
  if (camZoom === 1) {                                             // cockpit view
    camera.position.copy(P.pos).addScaledVector(b.u, 2.25).addScaledVector(b.f, -0.4);
    camera.quaternion.copy(P.q); P.obj.visible = false; return;
  }
  const want = tv.copy(P.pos).addScaledVector(b.f, -21).addScaledVector(b.u, 4); want.y += 3.5;
  camera.position.lerp(want, 1 - Math.exp(-dt * 6));
  const gy = groundY(camera.position.x, camera.position.z) + 1.2; if (camera.position.y < gy) camera.position.y = gy;
  camera.up.copy(b.u).lerp(UP, 0.55).normalize();
  camera.lookAt(tv.copy(P.pos).addScaledVector(b.f, 18));
}

// ---------- HUD ----------
let msgT = 0, hudT = 0;
function say(text, t = 2.5) { $('msg').textContent = text; $('msg').classList.add('on'); msgT = t; }
const rc = $('radar').getContext('2d'), sc = $('strip').getContext('2d');
function hud(dt) {
  if ((msgT -= dt) <= 0) $('msg').classList.remove('on');
  if (state !== 'play') return;
  if (P.alive) {
    tv.copy(P.pos).addScaledVector(basis(P.q, PB).f, 260).project(camera);
    const r = $('ret'); r.style.display = tv.z < 1 ? 'block' : 'none';
    r.style.transform = `translate(${(tv.x * 0.5 + 0.5) * innerWidth}px,${(-tv.y * 0.5 + 0.5) * innerHeight}px)`;
  } else $('ret').style.display = 'none';
  if ((hudT -= dt) > 0) return; hudT = 0.1;
  const alt = Math.max(0, P.pos.y - groundY(P.pos.x, P.pos.z) - GEAR);
  $('hScore').textContent = S.score; $('hLives').textContent = Math.max(0, S.lives); $('hKills').textContent = S.kills;
  $('hSpd').textContent = Math.round(P.speed * 3.6); $('hAlt').textContent = Math.round(alt);
  $('hAmmo').textContent = Math.floor(P.ammo); $('hBombs').textContent = P.bombs;
  $('bThr').style.width = P.thr * 100 + '%'; $('bFuel').style.width = P.fuel + '%'; $('bDmg').style.width = P.dmg + '%';
  $('thrFill').style.height = P.thr * 100 + '%';
  let w = '';
  if (P.alive) {
    if (P.fuel <= 0) w = 'OUT OF FUEL — glide home';
    else if (P.fuel < 25) w = 'LOW FUEL — return to base';
    else if (!P.grounded && P.speed < STALL) w = 'STALL — nose down';
    else if (P.dmg >= 70 && P.dmg < 100) w = 'HEAVY DAMAGE';
  }
  $('warn').textContent = w; $('warn').classList.toggle('on', !!w);
  if (mode === 'classic') drawStrip(); else drawRadar();
}
function drawRadar() {
  const c = $('radar'), W = c.width, R = W / 2, range = 2400; rc.clearRect(0, 0, W, W);
  rc.fillStyle = 'rgba(6,8,18,.66)'; rc.beginPath(); rc.arc(R, R, R - 2, 0, 7); rc.fill();
  rc.strokeStyle = 'rgba(85,255,255,.35)'; rc.lineWidth = 2; for (const k of [0.33, 0.66, 1]) { rc.beginPath(); rc.arc(R, R, (R - 4) * k, 0, 7); rc.stroke(); }
  const f = basis(P.q, PB).f, fl = Math.hypot(f.x, f.z) || 1, fx = f.x / fl, fz = f.z / fl;
  const dot = (x, z, col, s) => {
    const dx = x - P.pos.x, dz = z - P.pos.z, sx = (dx * -fz + dz * fx) / range * (R - 6), sy = -(dx * fx + dz * fz) / range * (R - 6);
    const d = Math.hypot(sx, sy), k = d > R - 8 ? (R - 8) / d : 1;
    rc.fillStyle = col; rc.fillRect(R + sx * k - s / 2, R + sy * k - s / 2, s, s);
  };
  dot(HOME.x, HOME.z, '#55ffff', 14); dot(EB.x, EB.z, '#ff55ff', 10);
  for (const t of targets) if (t.alive) dot(t.x, t.z, '#ffff55', 7);
  for (const e of enemies) if (e.alive) dot(e.pos.x, e.pos.z, '#ff55ff', 9);
  rc.fillStyle = '#fff'; rc.beginPath(); rc.moveTo(R, R - 10); rc.lineTo(R - 7, R + 8); rc.lineTo(R + 7, R + 8); rc.fill();
}
function drawStrip() {   // the original's ground map, along the bottom
  const c = $('strip'), W = c.width, H = c.height, x0 = LANE.min - 100, x1 = LANE.max + 100;
  const X = x => (x - x0) / (x1 - x0) * W, Y = y => H - 8 - clamp(y / 800, 0, 1) * (H - 16);
  sc.clearRect(0, 0, W, H); sc.fillStyle = 'rgba(6,8,18,.66)'; sc.fillRect(0, 0, W, H);
  sc.fillStyle = '#3c6e2c'; sc.fillRect(0, H - 8, W, 8);
  sc.fillStyle = '#55ffff'; sc.fillRect(X(HOME.x - HOME.hl), H - 8, X(HOME.x + HOME.hl) - X(HOME.x - HOME.hl), 4);
  sc.fillStyle = '#ff55ff'; sc.fillRect(X(EB.x - EB.hl), H - 8, X(EB.x + EB.hl) - X(EB.x - EB.hl), 4);
  sc.fillStyle = '#ffff55'; for (const t of targets) if (t.alive) sc.fillRect(X(t.x) - 3, H - 16, 6, 8);
  sc.fillStyle = '#b4afcf'; for (const h of hippos) if (h.alive) sc.fillRect(X(h.x) - 2, H - 12, 5, 4);
  sc.fillStyle = '#ff55ff'; for (const e of enemies) if (e.alive) sc.fillRect(X(e.pos.x) - 4, Y(e.pos.y) - 4, 8, 8);
  if (P.alive) { sc.fillStyle = '#fff'; sc.fillRect(X(P.pos.x) - 5, Y(P.pos.y) - 5, 10, 10); }
}

// ---------- game flow ----------
function startGame(m) {
  mode = m; sfx.init(); sfx.resume();
  document.body.dataset.mode = mode;
  Object.assign(S, { score: 0, kills: 0, wave: 0, lives: 3, rebuildT: 0, spawnT: 3 });
  for (const e of enemies) { e.alive = false; e.obj.visible = false; e.shadow.visible = false; }
  for (const b of bullets) { b.on = false; b.m.visible = false; }
  for (const b of bombs) { b.on = false; b.m.visible = false; if (b.snd) b.snd.stop(); }
  for (const h of hippos) { h.alive = true; h.g.visible = true; }
  buildTargets(); resetPlayer(); camZoom = 0;
  camera.position.set(P.pos.x, 20, 90);
  state = 'play'; setPause(false);
  for (const id of ['title', 'over']) $(id).classList.add('hidden');
  $('hud').classList.remove('off'); $('touchui').classList.toggle('hidden', !isTouch);
  say(isTouch ? 'Push the throttle up, then pull back on the stick to lift off' : 'W to throttle up, then Down arrow to lift off', 4.5);
  renderer.domElement.focus();
}
function gameOver() {
  state = 'over'; P.obj.visible = false;
  if (S.score > S.best) { S.best = S.score; try { localStorage.setItem('duelhippo.best', S.best); } catch (e) {} }
  $('oScore').textContent = S.score; $('oKills').textContent = S.kills; $('best').textContent = $('oBest').textContent = S.best;
  $('over').classList.remove('hidden'); $('hud').classList.add('off'); $('touchui').classList.add('hidden');
}
function setPause(v) { paused = v; $('pause').classList.toggle('hidden', !v); if (v) for (const k in key) key[k] = false; }
function toggleFull() {
  try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); } catch (e) {}
}

// buttons
document.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => {
  if (isTouch && !document.fullscreenElement) toggleFull();
  startGame(b.dataset.start);
}));
$('resume').addEventListener('click', () => setPause(false));
$('quit').addEventListener('click', () => { setPause(false); S.lives = 0; gameOver(); });
$('bMute').addEventListener('click', () => { sfx.init(); $('bMute').textContent = sfx.toggle() ? 'SOUND OFF' : 'SOUND ON'; });
$('best').textContent = S.best;
document.body.classList.toggle('touch', isTouch);

// touch controls
{
  const stick = $('stick'), knob = $('knob'); let sid = null;
  const move = e => {
    const r = stick.getBoundingClientRect(), R = r.width / 2;
    let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    knob.style.transform = `translate(${dx * R * 0.6}px,${dy * R * 0.6}px)`;
    touch.pitch = Math.abs(dy) < 0.12 ? 0 : dy; touch.roll = Math.abs(dx) < 0.12 ? 0 : -dx;
  };
  stick.addEventListener('pointerdown', e => { sid = e.pointerId; stick.setPointerCapture(sid); move(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) move(e); });
  const end = e => { if (e.pointerId !== sid) return; sid = null; touch.pitch = touch.roll = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);

  const thr = $('thr'); let tid = null;
  const tmove = e => { const r = thr.getBoundingClientRect(); touch.thr = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); };
  thr.addEventListener('pointerdown', e => { tid = e.pointerId; thr.setPointerCapture(tid); tmove(e); });
  thr.addEventListener('pointermove', e => { if (e.pointerId === tid) tmove(e); });
  const tend = e => { if (e.pointerId === tid) { tid = null; touch.thr = null; } };
  thr.addEventListener('pointerup', tend); thr.addEventListener('pointercancel', tend);

  const fb = $('bFire');
  fb.addEventListener('pointerdown', e => { fb.setPointerCapture(e.pointerId); touch.fire = true; });
  for (const ev of ['pointerup', 'pointercancel']) fb.addEventListener(ev, () => { touch.fire = false; });
  $('bBomb').addEventListener('pointerdown', dropBomb);
  $('bFlip').addEventListener('pointerdown', flip);
  $('bCam').addEventListener('click', () => { camZoom = (camZoom + 1) % 2; });
  $('bPause').addEventListener('click', () => setPause(!paused));
}
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') setPause(true); });

// pixel-hippo pilot for the title card (original art)
{
  const art = ['..11......11..', '.1221....1221.', '.111111111111.', '11113311331111', '11113311331111', '11111111111111', '.111111111111.', '.144111111441.', '.111111111111.', '..1111111111..', '...55555555...', '....55..55....'];
  const pal = { 1: '#9a95b8', 2: '#ff9ec7', 3: '#55ffff', 4: '#3a3550', 5: '#ff5555' };
  let s = '';
  art.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) s += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${pal[ch]}"/>`; }));
  $('mascot').innerHTML = `<svg viewBox="0 0 14 12" shape-rendering="crispEdges" aria-hidden="true">${s}</svg>`;
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const live = state === 'play' && !paused;
  if (live) update(dt);
  sfx.engine(P.thr, P.speed, live && P.alive);
  if (!paused) updCamera(dt);
  renderer.render(scene, camera);
  hud(dt);
}
requestAnimationFrame(frame);
window.__duel = { P, S, enemies, targets, get state() { return state; }, get mode() { return mode; }, startGame };
})();
