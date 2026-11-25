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

// fake-server.js — the match server and the other players, played by a test.
//
// Installs a stand-in WebSocket on the game's window. jsdom has no WebRTC,
// so every pair settles on the server relay, and every message to the other
// players arrives here as {t:"g", m, to?}. The test answers as the server
// (`server()`) or as the player in a seat (`from()`).

export function fakeServer(w, { seat = 0, peers = [], code = "ABCD" } = {}) {
  const self = { ws: null, opened: [] };
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.bufferedAmount = 0;
      this.sent = [];
      self.ws = this;
      self.opened.push(url);
      setTimeout(() => this.recv({ t: "room", code, seat, peers }), 0);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      this.readyState = 3;
    }
    recv(m) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify(m) });
    }
  }
  w.WebSocket = FakeWS;
  delete w.RTCPeerConnection;
  self.server = (m) => self.ws.recv(m);
  self.from = (s, m) => self.ws.recv({ t: "g", m, from: s });
  // What the game has sent the other players, oldest first: the messages,
  // or (`withTo`) {m, to} with `to` the seats named (undefined: everyone).
  self.sent = (t, withTo = false) =>
    self.ws.sent
      .filter((x) => x.t === "g" && (!t || x.m.t === t))
      .map((x) => (withTo ? { m: x.m, to: x.to } : x.m));
  self.clear = () => (self.ws.sent.length = 0);
  return self;
}

export const tick = (ms) => new Promise((r) => setTimeout(r, ms));

export const hash = (c) => c.repeat(64);

// A plane's state update, as protocol.js packs it.
export const state = (p, extra = {}) => ({
  t: "s",
  p,
  q: [0, 0, 0, 1],
  v: 60,
  h: 1,
  a: 1,
  g: 0,
  d: 0,
  sc: 0,
  k: 0,
  l: 3,
  ...extra,
});
