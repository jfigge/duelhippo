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

// rude.js — three-letter initials the one-player board will not show.
//
// The board is public, so the App Store counts its initials as content other
// players make (Guideline 1.2) and wants the objectionable kind filtered.
// Three letters A–Z leave little room, but enough for the obvious: swearing,
// sexual words and slurs, and their usual misspellings. The game refuses
// them when they are typed (scores.js); the server refuses them in a
// submission and hides any already on the board (server/board.js imports
// this file, so the two cannot drift).
//
// Names and plain words that only look rude in bad faith (NIK, ANU, NAZ,
// GAY, JEW, POO) stay allowed: a list that turns away real initials, or who
// people are, is worse than one that misses a joke.
//
// Imports nothing: the server bundles it too.

export const RUDE = new Set(
  `ASS AZZ ANL
   FUK FUC FUQ FUX FCK FKU FKN
   CUM CUN CNT KNT KUM
   COK KOK DIK DIC DIQ DIX DCK PNS VAG TIT JIZ JIS
   SEX XXX PRN SHT PIS PSS
   FAG FGT FGS
   NIG NGR NGA NGG
   KKK NZI SPK KYK WOG GOK JAP
   HOR HOE WHR SLT SLU
   KYS KMS WTF GFY`.split(/\s+/),
);

// True for initials the board will neither take nor show. Whether they are
// three letters at all is for the callers to check.
export const isRude = (n) => RUDE.has(String(n ?? "").toUpperCase());
