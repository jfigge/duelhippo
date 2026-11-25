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

// make-icons.mjs — every app icon, rasterised from the one drawing of record,
// icons/duelhippo.svg. `make icons` runs it under Electron, not plain Node:
//
//   electron tools/make-icons.mjs [--preview out.png]
//
// The approach is the herd's (hippoherd's scripts/make-icons.mjs, after Chip
// Hippo's): draw the SVG onto a canvas in a hidden Chromium window, which
// keeps the alpha channel end to end. macOS' own rasterisers flatten SVG
// transparency onto white, which would fill the icon's corners and margin.
//
// One source, drawn four ways:
//   on the macOS icon grid, with a transparent   → icons/mac.png (the .icns)
//   margin round it, as every Dock icon has
//   edge to edge                                 → icons/icon.ico, icons/linux/
//   full bleed and opaque, no rounded corners    → the iOS app icon, and the
//   (iOS masks the corners itself, and App          web's apple-touch-icon
//   Store Connect rejects an alpha channel)
//   small, centred on the game's night colour    → the iOS launch screen
//                                                   (Capacitor's Splash images)
//   as is                                        → web/public/favicon.svg
//
// Outputs are committed; electron-builder and Xcode read them as they are.

import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = path.join(SRC, "icons");
const MARK = path.join(ICONS, "duelhippo.svg");
const IOS_ICON = path.join(
  SRC,
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
);
const SPLASH = path.join(SRC, "ios/App/App/Assets.xcassets/Splash.imageset");
const PUBLIC = path.join(SRC, "web/public");

// The launch screen fills the display (scaleAspectFill), so the mark sits in
// the middle of a 2732² square on the colour behind the title screen, and a
// phone crops the edges away, not the mark.
const splashVariant = (svg) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732">' +
  '<rect width="2732" height="2732" fill="#05060C"/>' +
  `<svg x="1110" y="1110" width="512" height="512" viewBox="0 0 512 512">${inner(svg)}</svg></svg>`;

const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [256, 128, 64, 48, 32, 24, 16];

const inner = (svg) =>
  svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

// The macOS app-icon grid: the rounded square fills a centred 826×826 of the
// 1024 canvas (Big Sur's 824 with a 100 px margin, one pixel larger each way),
// exactly as the rest of the herd's Mac icons sit, so they line up in the Dock.
const macVariant = (svg) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">' +
  `<g transform="translate(99,99) scale(1.61328125)">${inner(svg)}</g></svg>`;

// Full bleed: the tile's corners squared off, so the system's own mask is the
// only rounding.
const squareVariant = (svg) =>
  svg.replace(
    /<rect width="512" height="512" rx="114"/,
    '<rect width="512" height="512"',
  );

let win = null;
async function render(svgText, size, { opaque = false } = {}) {
  if (!win) {
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL("about:blank");
  }
  const b64 = Buffer.from(svgText, "utf8").toString("base64");
  const out = await win.webContents.executeJavaScript(
    `new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = ${size};
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        resolve(${opaque}
          ? Array.from(ctx.getImageData(0, 0, ${size}, ${size}).data)
          : c.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("SVG decode failed"));
      img.src = "data:image/svg+xml;base64,${b64}";
    })`,
    true,
  );
  return opaque ? rgbPng(size, out) : Buffer.from(out.split(",")[1], "base64");
}

// A canvas always encodes RGBA, and an iOS icon must have no alpha channel
// at all, so the opaque variants are written here as 8-bit RGB PNGs.
function rgbPng(size, rgba) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1); // filter byte 0, then RGB
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      raw[row + 1 + x * 3] = rgba[i];
      raw[row + 2 + x * 3] = rgba[i + 1];
      raw[row + 3 + x * 3] = rgba[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// A Vista-style .ico: a header, a directory entry per image, then the PNGs.
function ico(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = head.length + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, dir, ...entries.map((e) => e.png)]);
}

// A contact sheet for checking the drawing by eye: the Mac icon on a light
// and a dark Dock, then the small sizes, where a motif lives or dies.
function previewSheet(svg) {
  const m = inner(macVariant(svg));
  const at = (x, y, s) =>
    `<svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="0 0 1024 1024">${m}</svg>`;
  const small = [128, 64, 32, 16]
    .map(
      (s, i) =>
        at(560 + i * 150, 120 - s / 2, s) + at(560 + i * 150, 380 - s / 2, s),
    )
    .join("");
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">' +
    '<rect width="1200" height="260" fill="#ECECEC"/><rect y="260" width="1200" height="940" fill="#1E1E1E"/>' +
    `<svg x="600" y="560" width="600" height="600" viewBox="0 0 512 512">${inner(svg)}</svg>` +
    at(20, 10, 240) +
    at(20, 270, 240) +
    at(280, 60, 140) +
    at(280, 320, 140) +
    small +
    "</svg>"
  );
}

const rel = (p) => path.relative(SRC, p);

app.whenReady().then(async () => {
  try {
    const svg = readFileSync(MARK, "utf8");
    const i = process.argv.indexOf("--preview");
    if (i !== -1) {
      writeFileSync(process.argv[i + 1], await render(previewSheet(svg), 1200));
      console.log(`  preview → ${process.argv[i + 1]}`);
      return app.exit(0);
    }

    writeFileSync(
      path.join(ICONS, "mac.png"),
      await render(macVariant(svg), 1024),
    );
    console.log("  icons/mac.png  1024², on the macOS grid");

    const cache = new Map();
    const at = async (s) => {
      if (!cache.has(s)) cache.set(s, await render(svg, s));
      return cache.get(s);
    };
    mkdirSync(path.join(ICONS, "linux"), { recursive: true });
    for (const s of LINUX_SIZES)
      writeFileSync(path.join(ICONS, "linux", `${s}x${s}.png`), await at(s));
    console.log(`  icons/linux/  ${LINUX_SIZES.join(", ")}`);
    const entries = [];
    for (const s of ICO_SIZES) entries.push({ size: s, png: await at(s) });
    writeFileSync(path.join(ICONS, "icon.ico"), ico(entries));
    console.log(`  icons/icon.ico  ${ICO_SIZES.join(", ")}`);

    const square = squareVariant(svg);
    writeFileSync(IOS_ICON, await render(square, 1024, { opaque: true }));
    console.log(`  ${rel(IOS_ICON)}  1024², opaque`);
    const splash = await render(splashVariant(svg), 2732, { opaque: true });
    for (const f of [
      "splash-2732x2732.png",
      "splash-2732x2732-1.png",
      "splash-2732x2732-2.png",
    ])
      writeFileSync(path.join(SPLASH, f), splash);
    console.log(`  ${rel(SPLASH)}/  2732², the launch screen`);
    mkdirSync(PUBLIC, { recursive: true });
    writeFileSync(
      path.join(PUBLIC, "apple-touch-icon.png"),
      await render(square, 180, { opaque: true }),
    );
    writeFileSync(path.join(PUBLIC, "favicon.svg"), svg);
    console.log("  web/public/favicon.svg, web/public/apple-touch-icon.png");
    app.exit(0);
  } catch (err) {
    console.error("make-icons failed:", err.message);
    app.exit(1);
  }
});
