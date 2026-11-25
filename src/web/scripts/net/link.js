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

// link.js — one connection to the other player.
//
// The match server (src/server/) puts the two players in a room and carries
// a WebRTC handshake between them. Once that succeeds the game talks
// peer-to-peer over two data channels — "fast" (unordered, never resent: the
// 20-a-second state updates, where a late one is worthless) and "sure"
// (ordered, reliable: shots, hits, crashes) — and the server is idle. When
// it does not succeed within a few seconds (a strict NAT, a carrier network,
// a browser without WebRTC), the same messages go through the server's
// WebSocket instead, which is slower but always works. The game cannot tell
// which it has; the lobby shows it.
//
// The two sides decide independently and need not agree: each sends on its
// data channel when that is open and on the WebSocket otherwise, and reads
// both.

const ICE = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];
const DIRECT_WITHIN_MS = 7000;

// Close codes from src/server/room.js, as words.
const CLOSE_TEXT = {
  4004: "No game with that code. Check it with your friend.",
  4003: "That game already has two players.",
  4000: "The host left.",
};

export class Link {
  // `base` is the server's ws(s):// address; with `code` this joins that
  // room, without it hosts a new one. Resolves once the room is confirmed.
  static open(base, code = null, { relayOnly = false } = {}) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new window.WebSocket(base + (code ? `/join/${code}` : "/host"));
      } catch {
        return reject(new Error("Can't reach the game server."));
      }
      let done = false;
      ws.onmessage = (e) => {
        const m = parse(e.data);
        if (!m || done) return;
        done = true;
        if (m.t === "room") resolve(new Link(ws, m.role, m.code, relayOnly));
        else reject(new Error(m.text || "The game server said no."));
      };
      ws.onclose = (e) => {
        if (!done) {
          done = true;
          reject(
            new Error(CLOSE_TEXT[e.code] || "Can't reach the game server."),
          );
        }
      };
    });
  }

  constructor(ws, role, code, relayOnly) {
    this.ws = ws;
    this.role = role;
    this.code = code;
    this.relayOnly = relayOnly;
    this.path = "waiting"; // → "connecting" → "direct" | "relay"
    this.pc = null;
    this.ch = {};
    this.pending = [];
    // Set by the owner:
    this.onmessage = () => {};
    this.onpeer = () => {}; // the other player is here (host: a guest joined)
    this.onpath = () => {}; // "direct" or "relay" decided
    this.onleft = () => {}; // the other player went
    this.onclose = () => {}; // the server connection is gone
    ws.onmessage = (e) => this.fromServer(parse(e.data));
    ws.onclose = (e) => {
      this.dropRtc();
      this.path = "closed";
      this.onclose(
        CLOSE_TEXT[e.code] || "Lost the connection to the game server.",
      );
    };
  }

  // Called once the owner's handlers are in place: a guest's host is
  // already there, so its connection starts now.
  start() {
    if (this.role === "guest") this.peerArrived();
  }

  send(msg, fast = false) {
    const ch = this.ch[fast ? "fast" : "sure"];
    const text = JSON.stringify(msg);
    if (ch && ch.readyState === "open") return ch.send(text);
    if (this.ws.readyState !== 1) return;
    // A relayed state update is not worth queueing behind a slow socket.
    if (fast && this.ws.bufferedAmount > 32 * 1024) return;
    this.ws.send(JSON.stringify({ t: "g", m: msg }));
  }

  close() {
    this.onclose = this.onleft = () => {};
    this.dropRtc();
    try {
      this.ws.close(1000);
    } catch {
      // Already closed.
    }
  }

  fromServer(m) {
    if (!m) return;
    if (m.t === "g") this.onmessage(m.m);
    else if (m.t === "sig") this.signal(m);
    else if (m.t === "peer") this.peerArrived();
    else if (m.t === "left") {
      this.dropRtc();
      this.path = "waiting";
      this.onleft();
    }
  }

  peerArrived() {
    this.path = "connecting";
    this.onpeer();
    if (this.relayOnly || typeof window.RTCPeerConnection !== "function")
      return this.settle("relay");
    this.startRtc(this.role === "host");
  }

  // ── WebRTC ────────────────────────────────────────────────────────────────
  startRtc(offerer) {
    const pc = (this.pc = new window.RTCPeerConnection({ iceServers: ICE }));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.toPeer({ t: "sig", c: e.candidate.toJSON() });
    };
    pc.ondatachannel = (e) => this.attach(e.channel);
    if (offerer) {
      this.attach(
        pc.createDataChannel("fast", { ordered: false, maxRetransmits: 0 }),
      );
      this.attach(pc.createDataChannel("sure", { ordered: true }));
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => this.toPeer({ t: "sig", d: pc.localDescription.toJSON() }))
        .catch(() => this.settle("relay"));
    }
    this.timer = setTimeout(() => {
      if (this.path === "connecting") this.settle("relay");
    }, DIRECT_WITHIN_MS);
  }

  async signal(m) {
    const pc = this.pc;
    if (!pc) return;
    try {
      if (m.d) {
        await pc.setRemoteDescription(m.d);
        if (m.d.type === "offer") {
          await pc.setLocalDescription(await pc.createAnswer());
          this.toPeer({ t: "sig", d: pc.localDescription.toJSON() });
        }
        for (const c of this.pending.splice(0)) await pc.addIceCandidate(c);
      } else if (m.c) {
        if (pc.remoteDescription) await pc.addIceCandidate(m.c);
        else this.pending.push(m.c);
      }
    } catch {
      this.settle("relay");
    }
  }

  attach(ch) {
    this.ch[ch.label] = ch;
    ch.onopen = () => {
      if (
        this.ch.fast?.readyState === "open" &&
        this.ch.sure?.readyState === "open"
      )
        this.settle("direct");
    };
    ch.onmessage = (e) => {
      const m = parse(e.data);
      if (m) this.onmessage(m);
    };
    // A direct link that drops mid-game falls back to the server.
    ch.onclose = () => {
      if (this.path === "direct") this.settle("relay");
    };
  }

  settle(path) {
    clearTimeout(this.timer);
    if (path === "relay") this.dropRtc();
    if (this.path === path) return;
    this.path = path;
    this.onpath(path);
  }

  dropRtc() {
    clearTimeout(this.timer);
    for (const ch of Object.values(this.ch)) {
      ch.onclose = ch.onmessage = ch.onopen = null;
      try {
        ch.close();
      } catch {
        // Already closed.
      }
    }
    this.ch = {};
    if (this.pc) {
      this.pc.onicecandidate = this.pc.ondatachannel = null;
      this.pc.close();
      this.pc = null;
    }
    this.pending = [];
  }

  toPeer(m) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
}

function parse(text) {
  try {
    const m = JSON.parse(text);
    return m && typeof m === "object" ? m : null;
  } catch {
    return null;
  }
}
