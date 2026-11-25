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

// fake-server.js — the match server and the other player, played by a test.
//
// Installs a stand-in WebSocket on the game's window. jsdom has no WebRTC,
// so the game's link settles on the server relay, and every message to the
// other player arrives here as {t:"g", m}. The test answers as the server
// (`server()`) or as the other player (`peer()`).

export function fakeServer(w, { role, code = "ABCD" }) {
  const self = { ws: null, opened: [] };
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.bufferedAmount = 0;
      this.sent = [];
      self.ws = this;
      self.opened.push(url);
      setTimeout(() => this.recv({ t: "room", code, role }), 0);
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
  self.peer = (m) => self.ws.recv({ t: "g", m });
  // What the game has sent the other player, oldest first.
  self.toPeer = (t) =>
    self.ws.sent
      .filter((x) => x.t === "g" && (!t || x.m.t === t))
      .map((x) => x.m);
  self.clear = () => (self.ws.sent.length = 0);
  return self;
}

export const tick = (ms) => new Promise((r) => setTimeout(r, ms));
