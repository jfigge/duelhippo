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

// worker.js — Duel Hippo's match server, on Cloudflare Workers.
//
//   GET /host         WebSocket: make a room; the reply names its code
//   GET /join/<code>  WebSocket: join that room
//   GET /             a line of text, to show the server is up
//
// Each room is a Durable Object named by its code, so both players reach the
// same one wherever in the world they connect from. It uses the WebSocket
// Hibernation API: between messages the object sleeps and costs nothing,
// which is what keeps a free game free. In a direct (WebRTC) match the room
// carries only the handshake; in a relayed one it carries the game too.
// room.js has the rules.

import { DurableObject } from "cloudflare:workers";
import {
  makeCode,
  normaliseCode,
  admit,
  other,
  acceptable,
  underLimit,
  CLOSE,
} from "./room.js";

const TEXT = { "content-type": "text/plain; charset=utf-8" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upgrade = request.headers.get("Upgrade") === "websocket";

    if (url.pathname === "/host" && upgrade) {
      // A random code, and another if a live room already has it.
      for (let tries = 0; tries < 8; tries++) {
        const code = makeCode();
        const res = await room(env, code).fetch(
          `https://room/${code}?as=host`,
          request,
        );
        if (res.status !== 409) return res;
      }
      return new Response("No free room code; try again.", {
        status: 503,
        headers: TEXT,
      });
    }

    const join = url.pathname.match(/^\/join\/([^/]+)$/);
    if (join && upgrade) {
      const code = normaliseCode(decodeURIComponent(join[1]));
      // A malformed code still gets a socket, so the player hears why.
      return room(env, code || "AAAA").fetch(
        `https://room/${code}?as=${code ? "guest" : "bad"}`,
        request,
      );
    }

    if (url.pathname === "/")
      return new Response("Duel Hippo match server\n", { headers: TEXT });
    return new Response("Not found\n", { status: 404, headers: TEXT });
  },
};

const room = (env, code) => env.ROOMS.get(env.ROOMS.idFromName(code));

export class Room extends DurableObject {
  // Message counters per socket; lost when the object hibernates, which is
  // fine for a flood guard.
  counters = new WeakMap();

  async fetch(request) {
    const url = new URL(request.url);
    const code = url.pathname.slice(1);
    const kind = url.searchParams.get("as");
    const present = new Set(
      this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()?.role),
    );

    // Taken: answered before any socket exists, so the worker can retry.
    const verdict =
      kind === "bad"
        ? { ok: false, close: CLOSE.nogame, text: "That isn't a room code." }
        : admit(kind, present);
    if (!verdict.ok && verdict.close === CLOSE.taken)
      return new Response("taken", { status: 409 });

    const [client, server] = Object.values(new WebSocketPair());
    if (!verdict.ok) {
      // Accepted only to say why, then closed.
      server.accept();
      server.send(
        JSON.stringify({ t: "error", code: verdict.close, text: verdict.text }),
      );
      server.close(verdict.close, verdict.text);
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server, [verdict.role]);
    server.serializeAttachment({ role: verdict.role });
    server.send(JSON.stringify({ t: "room", code, role: verdict.role }));
    if (verdict.role === "guest")
      this.to("host", JSON.stringify({ t: "peer" }));
    return new Response(null, { status: 101, webSocket: client });
  }

  // Everything a player sends goes to the other player, unread.
  webSocketMessage(ws, message) {
    if (!acceptable(message)) return;
    let counter = this.counters.get(ws);
    if (!counter) this.counters.set(ws, (counter = {}));
    if (!underLimit(counter)) return;
    const role = ws.deserializeAttachment()?.role;
    this.to(other(role), message);
  }

  // The host leaving ends the room; a guest leaving frees the seat.
  webSocketClose(ws) {
    const role = ws.deserializeAttachment()?.role;
    this.to(other(role), JSON.stringify({ t: "left" }));
    if (role === "host")
      for (const g of this.ctx.getWebSockets("guest"))
        g.close(CLOSE.ended, "The host left.");
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }

  to(role, message) {
    for (const ws of this.ctx.getWebSockets(role)) {
      try {
        ws.send(message);
      } catch {
        // Already closing.
      }
    }
  }
}
