/* node notan/test-solvable.cjs [--seeds N]
 * Every board a player can be dealt must have exactly one answer that logic
 * alone reaches, checked here by a solver that shares no code with
 * engine.js:
 *   - the 53 ramp pictures and the 20 New Game+ pictures
 *   - Quick play at 5, 8, 10, 12 and 15: N seeds the page deals (100000 to
 *     999999) and N seeds an old share link can open (1 to 99999) per size,
 *     dealt the way the page deals them (the next seed if one gives nothing)
 * A board passes when the clues have exactly one answer, it is the stored
 * picture, and row-by-row line logic (with single-square contradiction
 * probing if line logic stalls) finishes it from a blank grid. The default
 * N is 300; the full audit sampled 100000 to 900000 seeds per size. */
'use strict';
const E = require('./engine.js');
const LEVELS = require('./levels.js');
const PLUS = require('./plus-levels.js');

/* ---------- an independent solver ---------- */
function runs(a) { const o = []; let r = 0; for (const v of a) { if (v === 1) r++; else if (r) { o.push(r); r = 0; } } if (r) o.push(r); return o; }
/* Can the clue still fit? fit over (block, start) from the right. */
function fits(cells, clue) {
  const n = cells.length;
  let next = new Uint8Array(n + 2), ink = 0;
  next[n] = 1;
  for (let p = n - 1; p >= 0; p--) { if (cells[p] === 1) ink = 1; next[p] = ink ? 0 : 1; }
  for (let j = clue.length - 1; j >= 0; j--) {
    const len = clue[j], cur = new Uint8Array(n + 2);
    for (let p = n - 1; p >= 0; p--) {
      if (cells[p] !== 1 && cur[p + 1]) { cur[p] = 1; continue; }
      if (p + len > n) continue;
      let open = true;
      for (let i = p; i < p + len; i++) if (cells[i] === 0) { open = false; break; }
      if (!open) continue;
      if (p + len === n ? next[n] : cells[p + len] !== 1 && next[p + len + 1]) cur[p] = 1;
    }
    next = cur;
  }
  return next[0] === 1;
}
/* Complete line logic: try every open square both ways. */
function line(cells, clue) {
  if (!fits(cells, clue)) return null;
  const out = cells.slice();
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== -1) continue;
    out[i] = 1; const a = fits(out, clue);
    out[i] = 0; const b = fits(out, clue);
    out[i] = a && b ? -1 : a ? 1 : 0;
  }
  return out;
}
function propagate(rows, cols, w, h, g) {
  g = Int8Array.from(g);
  for (let changed = true; changed;) {
    changed = false;
    for (let li = 0; li < h + w; li++) {
      const isRow = li < h, k = isRow ? li : li - h, n = isRow ? w : h, at = (t) => (isRow ? k * w + t : t * w + k);
      const cells = Array.from({ length: n }, (_, t) => g[at(t)]);
      if (!cells.includes(-1)) { if (runs(cells).join() !== (isRow ? rows : cols)[k].join()) return null; continue; }
      const res = line(cells, (isRow ? rows : cols)[k]);
      if (!res) return null;
      for (let t = 0; t < n; t++) if (res[t] !== cells[t]) { g[at(t)] = res[t]; changed = true; }
    }
  }
  return g;
}
function probe(rows, cols, w, h, g) {
  g = propagate(rows, cols, w, h, g);
  for (let progress = true; g && progress && g.includes(-1);) {
    progress = false;
    for (let i = 0; i < g.length && !progress; i++) {
      if (g[i] !== -1) continue;
      for (const v of [1, 0]) {
        const t = Int8Array.from(g); t[i] = v;
        if (propagate(rows, cols, w, h, t)) continue;
        t[i] = 1 - v;
        g = propagate(rows, cols, w, h, t);
        progress = true;
        break;
      }
    }
  }
  return g;
}
function count(rows, cols, w, h, g, cap, found) {
  g = propagate(rows, cols, w, h, g);
  if (!g) return;
  const i = g.indexOf(-1);
  if (i < 0) { found.push(g); return; }
  for (const v of [1, 0]) { if (found.length >= cap) return; const t = Int8Array.from(g); t[i] = v; count(rows, cols, w, h, t, cap, found); }
}
/* Why a board fails, or null when it passes. */
function verdict(sol, w, h) {
  const rows = [], cols = [];
  for (let r = 0; r < h; r++) rows.push(runs(Array.from({ length: w }, (_, c) => sol[r * w + c])));
  for (let c = 0; c < w; c++) cols.push(runs(Array.from({ length: h }, (_, r) => sol[r * w + c])));
  const blank = new Int8Array(w * h).fill(-1), found = [];
  count(rows, cols, w, h, blank, 2, found);
  if (found.length !== 1) return found.length ? 'more than one answer' : 'no answer';
  if (found[0].some((v, i) => v !== sol[i])) return 'its one answer is not the stored picture';
  const g = probe(rows, cols, w, h, blank);
  if (!g || g.includes(-1)) return 'logic stalls; a player has to guess';
  return null;
}

/* ---------- the boards ---------- */
const arg = process.argv.indexOf('--seeds');
const N = arg > 0 ? Number(process.argv[arg + 1]) : 300;
let fail = 0, checked = 0;
const bad = (msg) => { fail++; console.log('  FAIL ' + msg); };

for (const [name, list] of [['ramp', LEVELS], ['New Game+', PLUS]]) {
  list.forEach((L, i) => {
    const { w, h, sol } = E.fromArt(L.art);
    const why = verdict(sol, w, h);
    if (why) bad(`${name} ${i + 1} ${L.id}: ${why}`);
    checked++;
  });
}

// what notan.js endless() deals for a seed: the first board from it on
function dealt(seed, n) {
  for (let s = seed, t = 0; t < 20; s++, t++) { const g = E.generate(s, n, n); if (g) return { g, s }; }
  return null;
}
for (const n of [5, 8, 10, 12, 15]) {
  for (const [lo, hi] of [[E.FREE_SEED, 1000000], [1, E.FREE_SEED]]) {
    for (let k = 0; k < N; k++) {
      const seed = lo + Math.floor((k * (hi - lo)) / N);
      const d = dealt(seed, n);
      if (!d) { bad(`Quick play ${n}x${n} seed ${seed}: no board within 20 seeds`); continue; }
      const why = verdict(d.g.sol, n, n);
      if (why) bad(`Quick play ${n}x${n} seed ${d.s}: ${why}`);
      checked++;
    }
  }
}
console.log(fail ? `${fail} failure(s) in ${checked} boards` : `solvable: all ${checked} boards have one answer that logic reaches`);
process.exit(fail ? 1 : 0);
