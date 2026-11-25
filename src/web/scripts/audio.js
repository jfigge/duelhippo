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

// audio.js — synthesized 8-bit sound, Web Audio only, no asset files.
//
// The prototype's (DESIGN.md, "8-bit audio"), plus the missiles' tones: the
// lock building and made, the launch, and the warning to the plane being
// locked or chased. Nothing makes a sound until init() runs from a user
// gesture (the start buttons), which is what browsers, Electron and iOS's
// WKWebView all require before an AudioContext may play.

import { clamp } from "./util.js";

export const sfx = (() => {
  let ac = null,
    mast = null,
    eng = null,
    nbuf = null,
    muted = false;
  function init() {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    mast = ac.createGain();
    mast.gain.value = 0.5;
    mast.connect(ac.destination);
    // crunchy noise: sample-and-hold, quantised to 4 bits
    const len = ac.sampleRate * 1.5;
    nbuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = nbuf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) {
      if (i % 6 === 0) v = Math.round((Math.random() * 2 - 1) * 7) / 7;
      d[i] = v;
    }
    // engine: two square waves, gated by a square LFO = putt-putt-putt
    const o1 = ac.createOscillator(),
      o2 = ac.createOscillator(),
      lfo = ac.createOscillator();
    o1.type = o2.type = lfo.type = "square";
    o2.detune.value = -1193;
    const gate = ac.createGain();
    gate.gain.value = 0.5;
    const lfoG = ac.createGain();
    lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(gate.gain);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    const vol = ac.createGain();
    vol.gain.value = 0;
    o1.connect(gate);
    o2.connect(gate);
    gate.connect(lp).connect(vol).connect(mast);
    o1.start();
    o2.start();
    lfo.start();
    eng = { o1, o2, lfo, lp, vol };
  }
  function engine(thr, spd, on) {
    if (!eng) return;
    const t = ac.currentTime,
      s = Math.min(spd, 120);
    const f = 46 + thr * 44 + s * 0.35;
    eng.o1.frequency.setTargetAtTime(f, t, 0.12);
    eng.o2.frequency.setTargetAtTime(f, t, 0.12);
    eng.lfo.frequency.setTargetAtTime(6 + thr * 15 + s * 0.06, t, 0.12);
    eng.lp.frequency.setTargetAtTime(450 + thr * 900 + s * 4, t, 0.2);
    eng.vol.gain.setTargetAtTime(
      on && !muted ? 0.03 + thr * 0.055 + s * 0.0004 : 0,
      t,
      0.15,
    );
  }
  function blip(f0, f1, dur, vol, type = "square") {
    if (!ac || muted || vol < 0.003) return;
    const t = ac.currentTime,
      o = ac.createOscillator(),
      g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(mast);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, cut, rate = 1) {
    if (!ac || muted || vol < 0.003) return;
    const t = ac.currentTime,
      s = ac.createBufferSource();
    s.buffer = nbuf;
    s.playbackRate.value = rate;
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(cut, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(70, cut * 0.12), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(mast);
    s.start(t, Math.random() * 0.4);
    s.stop(t + dur + 0.05);
  }
  return {
    init,
    engine,
    // Any state but running: iOS leaves the context "interrupted" after a
    // call or another app's audio, not "suspended". A closed one is gone.
    resume() {
      if (ac && ac.state !== "running" && ac.state !== "closed")
        ac.resume()?.catch?.(() => {});
    },
    gun() {
      blip(1250, 230, 0.05, 0.06);
      noise(0.035, 0.05, 4200);
    },
    egun(d) {
      blip(820, 190, 0.05, 0.045 * clamp(1 - d / 700, 0, 1));
    },
    hit() {
      blip(320, 80, 0.09, 0.08);
      noise(0.06, 0.06, 2000);
    },
    tick() {
      blip(660, 990, 0.05, 0.03);
    },
    lockTick() {
      blip(1400, 1400, 0.06, 0.03);
    },
    lock() {
      blip(1900, 1900, 0.3, 0.045);
    },
    launch() {
      noise(0.6, 0.12, 3000, 0.7);
      blip(400, 1200, 0.3, 0.05);
    },
    warn() {
      blip(980, 700, 0.12, 0.05);
    },
    boom(big, d = 0) {
      const k = clamp(1 - d / 1800, 0.12, 1);
      noise(
        big ? 1.0 : 0.5,
        (big ? 0.5 : 0.32) * k,
        big ? 1600 : 2600,
        big ? 0.55 : 0.9,
      );
      blip(big ? 150 : 230, 38, big ? 0.55 : 0.28, 0.14 * k);
    },
    // falling-bomb whistle, pitch drops till impact
    whistle(dur) {
      if (!ac || muted) return null;
      const t = ac.currentTime,
        o = ac.createOscillator(),
        g = ac.createGain(),
        lp = ac.createBiquadFilter();
      o.type = "square";
      lp.type = "lowpass";
      lp.frequency.value = 2400;
      o.frequency.setValueAtTime(1500, t);
      o.frequency.exponentialRampToValueAtTime(330, t + Math.max(0.4, dur));
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.3);
      o.connect(lp).connect(g).connect(mast);
      o.start(t);
      o.stop(t + Math.max(0.4, dur) + 4);
      return {
        stop() {
          const n = ac.currentTime;
          g.gain.cancelScheduledValues(n);
          g.gain.setTargetAtTime(0.0001, n, 0.02);
          o.stop(n + 0.12);
        },
      };
    },
    toggle() {
      muted = !muted;
      if (muted && eng) eng.vol.gain.value = 0;
      return muted;
    },
  };
})();
