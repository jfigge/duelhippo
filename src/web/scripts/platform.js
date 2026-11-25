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

// platform.js — which shell the game is running in: electron, ios or web.
//
// The game code itself is shell-agnostic; this is the one place that asks.
// Electron's preload exposes `window.duelhippo`; Capacitor's native runtime
// injects `window.Capacitor` before any page script runs. Anything else is a
// browser. The answer is mirrored onto <html data-platform> so CSS can adapt
// without JavaScript.

export function detectPlatform(w = window) {
  if (w.duelhippo && w.duelhippo.platform === "electron") return "electron";
  const cap = w.Capacitor;
  if (
    cap &&
    typeof cap.isNativePlatform === "function" &&
    cap.isNativePlatform()
  )
    return cap.getPlatform ? cap.getPlatform() : "ios";
  return "web";
}

export const platform = detectPlatform();
document.documentElement.dataset.platform = platform;
