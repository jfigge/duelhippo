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

// link.js — this player's connections to everyone else in the room.
//
// There is no host. The match server (src/server/) seats up to nine players
// in a room and carries a WebRTC handshake between every pair; each pair
// then talks peer-to-peer over two data channels — "fast" (unordered, never
// resent: the 20-a-second state updates, where a late one is worthless) and
// "sure" (ordered, reliable: shots, hits, crashes). A pair whose direct
// connection does not open within a few seconds (a strict NAT, a carrier
// network, a browser without WebRTC) goes through the server's WebSocket
// instead: one copy up, and the server fans it out to every relayed peer.
// The game cannot tell which path a message took; the lobby shows them.
//
// Each side of a pair decides its path on its own and need not agree: it
// sends on the data channel when that is open and through the server
// otherwise, and reads both. The lower seat makes the WebRTC offer, so two
// never cross.

const ICE = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];
const DIRECT_WITHIN_MS = 7000;

// Close codes from src/server/room.js, as words.
const CLOSE_TEXT = {
  4004: "No game with that code. Check it with your friends.",
  4003: "That game is full.",
};

export class Mesh {
  // `base` is the server's ws(s):// address; with `code` this joins that
  // room, without it makes a new one. Resolves once the room is confirmed.
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
        if (m.t === "room" && Number.isInteger(m.seat))
          resolve(new Mesh(ws, m, relayOnly));
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

  constructor(ws, room, relayOnly) {
    this.ws = ws;
    this.seat = room.seat;
    this.code = room.code;
    this.relayOnly = relayOnly;
    this.first = (room.peers || []).filter(Number.isInteger);
    this.peers = new Map(); // seat → Peer
    this.closed = false;
    // Set by the owner:
    this.onmessage = () => {}; // (message, from seat)
    this.onpeer = () => {}; // (seat): someone is here
    this.onpath = () => {}; // (seat, "direct" | "relay")
    this.onleft = () => {}; // (seat): they went
    this.onclose = () => {}; // (why): the server connection is gone
    ws.onmessage = (e) => this.fromServer(parse(e.data));
    ws.onclose = (e) => {
      for (const p of this.peers.values()) p.drop();
      this.closed = true;
      this.onclose(
        CLOSE_TEXT[e.code] || "Lost the connection to the game server.",
      );
    };
  }

  // Called once the owner's handlers are in place: the players already in
  // the room are met now.
  start() {
    for (const s of this.first) this.meet(s);
  }

  // To everyone, or to the seats in `to`.
  send(msg, fast = false, to = null) {
    const text = JSON.stringify(msg);
    const relay = [];
    for (const p of this.peers.values()) {
      if (to && !to.includes(p.seat)) continue;
      if (!p.sendDirect(text, fast)) relay.push(p.seat);
    }
    if (!relay.length || this.ws.readyState !== 1) return;
    // A relayed state update is not worth queueing behind a slow socket.
    if (fast && this.ws.bufferedAmount > 32 * 1024) return;
    const all = !to && relay.length === this.peers.size;
    this.ws.send(
      JSON.stringify(all ? { t: "g", m: msg } : { t: "g", m: msg, to: relay }),
    );
  }

  // How each peer is reached: { direct, relay, connecting } counts.
  paths() {
    const n = { direct: 0, relay: 0, connecting: 0 };
    for (const p of this.peers.values()) n[p.path]++;
    return n;
  }

  get settled() {
    return [...this.peers.values()].every((p) => p.path !== "connecting");
  }

  close() {
    this.onclose = this.onleft = this.onpath = () => {};
    for (const p of this.peers.values()) p.drop();
    this.peers.clear();
    this.closed = true;
    try {
      this.ws.close(1000);
    } catch {
      // Already closed.
    }
  }

  fromServer(m) {
    if (!m) return;
    if (m.t === "g" && Number.isInteger(m.from)) this.deliver(m.m, m.from);
    else if (m.t === "sig" && Number.isInteger(m.from))
      (this.peers.get(m.from) || this.meet(m.from)).signal(m);
    else if (m.t === "peer" && Number.isInteger(m.seat)) this.meet(m.seat);
    else if (m.t === "left" && Number.isInteger(m.seat)) {
      const p = this.peers.get(m.seat);
      if (!p) return;
      p.drop();
      this.peers.delete(m.seat);
      this.onleft(m.seat);
    }
  }

  meet(seat) {
    if (seat === this.seat) return null;
    let p = this.peers.get(seat);
    if (p) return p;
    p = new Peer(this, seat);
    this.peers.set(seat, p);
    this.onpeer(seat);
    p.start();
    return p;
  }

  deliver(m, from) {
    if (m && typeof m === "object" && this.peers.has(from))
      this.onmessage(m, from);
  }

  toServer(m) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
}

// One other player: their data channels, or the server relay.
class Peer {
  constructor(mesh, seat) {
    this.mesh = mesh;
    this.seat = seat;
    this.path = "connecting"; // → "direct" | "relay"
    this.pc = null;
    this.ch = {};
    this.pending = [];
    this.timer = 0;
  }

  start() {
    if (this.mesh.relayOnly || typeof window.RTCPeerConnection !== "function")
      return this.settle("relay");
    const offerer = this.mesh.seat < this.seat;
    const pc = (this.pc = new window.RTCPeerConnection({ iceServers: ICE }));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sig({ c: e.candidate.toJSON() });
    };
    pc.ondatachannel = (e) => this.attach(e.channel);
    if (offerer) {
      this.attach(
        pc.createDataChannel("fast", { ordered: false, maxRetransmits: 0 }),
      );
      this.attach(pc.createDataChannel("sure", { ordered: true }));
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => this.sig({ d: pc.localDescription.toJSON() }))
        .catch(() => this.settle("relay"));
    }
    this.timer = setTimeout(() => {
      if (this.path === "connecting") this.settle("relay");
    }, DIRECT_WITHIN_MS);
  }

  sendDirect(text, fast) {
    const ch = this.ch[fast ? "fast" : "sure"];
    if (!ch || ch.readyState !== "open") return false;
    try {
      ch.send(text);
      return true;
    } catch {
      return false;
    }
  }

  async signal(m) {
    const pc = this.pc;
    if (!pc) return;
    try {
      if (m.d) {
        await pc.setRemoteDescription(m.d);
        if (m.d.type === "offer") {
          await pc.setLocalDescription(await pc.createAnswer());
          this.sig({ d: pc.localDescription.toJSON() });
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
    ch.onmessage = (e) => this.mesh.deliver(parse(e.data), this.seat);
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
    this.mesh.onpath(this.seat, path);
  }

  drop() {
    this.dropRtc();
    this.path = "relay";
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

  sig(m) {
    this.mesh.toServer({ t: "sig", to: this.seat, ...m });
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
