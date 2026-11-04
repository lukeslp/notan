/* Independent nonogram solvers for the tests (node only). Shares no code
 * with engine.js. countSolutions proves a board has exactly one answer by
 * line logic that enumerates every placement plus backtracking, so it does
 * not trust any solver the game uses. lineSimple and linePack are the same
 * human rules zoom.js grades boards with, kept here as a separate copy so
 * test-gen.cjs can check each board's band from outside the page.
 *
 * A board is w x h, row-major. A working grid is an Int8Array: -1 unknown,
 * 0 empty, 1 ink. Lines are rows 0..h-1 then columns 0..w-1.
 *
 *   cluesOf(sol, w, h)                 clues from a solution
 *   lineFull(cells, clue)              complete line logic by enumerating every
 *                                      block placement (null on contradiction)
 *   linePack(cells, clue)              leftmost/rightmost packing that respects
 *                                      both ink and empty squares, plus the
 *                                      simple rules (intermediate human level)
 *   lineSimple(cells, clue)            human basics only: zero/complete lines,
 *                                      count fill, too-small gaps, simple boxes
 *                                      and spaces (blocks slid against marks
 *                                      only), edge glue from both ends
 *   countSolutions(b, given, limit)    backtracking + full line propagation,
 *                                      stops at `limit` solutions
 *   rounds(b, given, lineFn)           synchronous rounds (every line against
 *                                      the previous round's grid), as a person
 *                                      sweeping rows then columns would
 */
'use strict';

function runs(vals) {
  const out = [];
  let r = 0;
  for (const v of vals) {
    if (v === 1) r++;
    else if (r) { out.push(r); r = 0; }
  }
  if (r) out.push(r);
  return out;
}

function linesOf(w, h) {
  const lines = [];
  for (let r = 0; r < h; r++) lines.push(Array.from({ length: w }, (_, c) => r * w + c));
  for (let c = 0; c < w; c++) lines.push(Array.from({ length: h }, (_, r) => r * w + c));
  return lines;
}

function cluesOf(sol, w, h) {
  return linesOf(w, h).map((ix) => runs(ix.map((i) => sol[i])));
}

class Contradiction extends Error {}

/* ---------- full line logic: enumerate every placement ---------- */

const cache = new Map();
function lineFull(cells, clue) {
  const key = clue.join(',') + '|' + cells.map((v) => (v < 0 ? '?' : v)).join('');
  const hit = cache.get(key);
  if (hit !== undefined) return hit && hit.slice();
  const n = cells.length, k = clue.length;
  const canFill = new Uint8Array(n), canEmpty = new Uint8Array(n);
  const starts = new Array(k);
  let count = 0;
  const tail = new Array(k + 1).fill(0); // room the blocks after j need
  for (let j = k - 1; j >= 0; j--) tail[j] = tail[j + 1] + clue[j] + (j < k - 1 ? 1 : 0);
  function rec(j, pos) {
    if (j === k) {
      for (let i = pos; i < n; i++) if (cells[i] === 1) return;
      count++;
      const line = new Uint8Array(n);
      for (let b = 0; b < k; b++) for (let i = starts[b]; i < starts[b] + clue[b]; i++) line[i] = 1;
      for (let i = 0; i < n; i++) { if (line[i]) canFill[i] = 1; else canEmpty[i] = 1; }
      return;
    }
    const len = clue[j];
    const restAfter = tail[j] - len; // gap plus the later blocks
    for (let s = pos; s + len + restAfter <= n; s++) {
      if (s > pos && cells[s - 1] === 1) break; // cannot step over ink
      let ok = true;
      for (let i = s; i < s + len; i++) if (cells[i] === 0) { ok = false; break; }
      if (!ok) continue;
      if (s + len < n && cells[s + len] === 1) continue;
      starts[j] = s;
      rec(j + 1, s + len + 1);
    }
  }
  rec(0, 0);
  let out = null;
  if (count) {
    out = cells.slice();
    for (let i = 0; i < n; i++) {
      if (canFill[i] && !canEmpty[i]) out[i] = 1;
      else if (canEmpty[i] && !canFill[i]) out[i] = 0;
    }
  }
  if (cache.size > 400000) cache.clear();
  cache.set(key, out);
  return out && out.slice();
}

/* ---------- human basics ---------- */

function lineSimple(cells0, clue) {
  try { return simpleCore(cells0, clue, false); } catch (e) { if (e instanceof Contradiction) return null; throw e; }
}
function linePack(cells0, clue) {
  try { return simpleCore(cells0, clue, true); } catch (e) { if (e instanceof Contradiction) return null; throw e; }
}

function simpleCore(cells0, clue, pack) {
  const n = cells0.length, k = clue.length;
  const c = cells0.slice();
  const sum = clue.reduce((a, b) => a + b, 0);
  let changed = true;
  const set = (i, v) => {
    if (i < 0 || i >= n) return;
    if (c[i] === -1) { c[i] = v; changed = true; } else if (c[i] !== v) throw new Contradiction();
  };
  for (let guard = 0; changed && guard < 64; guard++) {
    changed = false;
    // zero line
    if (k === 0) { for (let i = 0; i < n; i++) set(i, 0); break; }
    let filled = 0, unk = 0;
    for (const v of c) { if (v === 1) filled++; else if (v === -1) unk++; }
    if (!unk) break;
    // complete line: all ink is down, the rest is empty
    if (filled === sum) { for (let i = 0; i < n; i++) if (c[i] === -1) set(i, 0); continue; }
    // count fill: exactly enough open squares left
    if (filled + unk === sum) { for (let i = 0; i < n; i++) if (c[i] === -1) set(i, 1); continue; }
    if (filled > sum || filled + unk < sum) throw new Contradiction();
    // gaps between marks too small for the smallest block
    const minB = Math.min(...clue);
    for (let i = 0; i < n;) {
      if (c[i] === 0) { i++; continue; }
      let e = i;
      while (e < n && c[e] !== 0) e++;
      if (e - i < minB) for (let q = i; q < e; q++) set(q, 0);
      i = e;
    }
    // simple boxes and spaces: slide every block left and right against
    // the marks only (ink is ignored, which keeps this sound but weak)
    const ls = new Array(k), rs = new Array(k);
    const hasZero = (a, b) => { for (let i = a; i <= b; i++) if (c[i] === 0) return true; return false; };
    let pos = 0;
    for (let j = 0; j < k; j++) {
      let s = pos;
      while (s + clue[j] <= n && hasZero(s, s + clue[j] - 1)) s++;
      if (s + clue[j] > n) throw new Contradiction();
      ls[j] = s; pos = s + clue[j] + 1;
    }
    pos = n - 1;
    for (let j = k - 1; j >= 0; j--) {
      let e = pos;
      while (e - clue[j] + 1 >= 0 && hasZero(e - clue[j] + 1, e)) e--;
      if (e - clue[j] + 1 < 0) throw new Contradiction();
      rs[j] = e - clue[j] + 1; pos = rs[j] - 2;
    }
    for (let j = 0; j < k; j++) {
      if (rs[j] < ls[j]) throw new Contradiction();
      for (let i = rs[j]; i <= ls[j] + clue[j] - 1; i++) set(i, 1);
    }
    const cover = new Uint8Array(n);
    for (let j = 0; j < k; j++) for (let i = ls[j]; i <= rs[j] + clue[j] - 1; i++) cover[i] = 1;
    for (let i = 0; i < n; i++) if (!cover[i]) set(i, 0);
    // edge glue: the first ink from an end belongs to the first block
    glue(c, clue, ls[0], set, false);
    {
      const rc = c.slice().reverse(), rclue = clue.slice().reverse();
      const rls0 = n - 1 - (rs[k - 1] + clue[k - 1] - 1);
      glue(rc, rclue, rls0, (i, v) => set(n - 1 - i, v), true);
    }
    if (pack) packStep(c, clue, set);
  }
  return c;
}

function glue(c, clue, ls0, set) {
  const n = c.length, len = clue[0];
  let p = -1;
  for (let i = 0; i < n; i++) if (c[i] === 1) { p = i; break; }
  if (p < 0) return;
  // The first ink seen belongs to the first block only when that block
  // (plus its gap) cannot fit somewhere before it, between the marks.
  for (let s = ls0; s + len - 1 <= p - 2; s++) {
    let ok = true;
    for (let i = s; i < s + len; i++) if (c[i] === 0) { ok = false; break; }
    if (ok) return;
  }
  let q = p;
  while (q + 1 < n && c[q + 1] === 1) q++;
  const lo = Math.max(ls0, q - len + 1), hi = p; // where block 1 can start
  if (lo > hi) throw new Contradiction();
  for (let i = hi; i <= lo + len - 1; i++) set(i, 1);
  for (let i = 0; i < lo; i++) set(i, 0);
  if (lo === hi) { set(lo - 1, 0); set(lo + len, 0); }
}

/* Leftmost valid placement of every block, respecting ink and marks. */
function leftmost(c, clue) {
  const n = c.length, k = clue.length, st = new Array(k);
  function rec(j, pos) {
    if (j === k) { for (let i = pos; i < n; i++) if (c[i] === 1) return false; return true; }
    const len = clue[j];
    for (let s = pos; s + len <= n; s++) {
      if (s > pos && c[s - 1] === 1) return false;
      let ok = true;
      for (let i = s; i < s + len; i++) if (c[i] === 0) { ok = false; break; }
      if (!ok || (s + len < n && c[s + len] === 1)) continue;
      st[j] = s;
      if (rec(j + 1, s + len + 1)) return true;
    }
    return false;
  }
  return rec(0, 0) ? st : null;
}
function packStep(c, clue, set) {
  const n = c.length, k = clue.length;
  const L = leftmost(c, clue);
  const rr = leftmost(c.slice().reverse(), clue.slice().reverse());
  if (!L || !rr) throw new Contradiction();
  const R = new Array(k);
  for (let j = 0; j < k; j++) R[j] = n - 1 - (rr[k - 1 - j] + clue[j] - 1);
  // same block covers the cell in both: ink
  for (let j = 0; j < k; j++) for (let i = R[j]; i <= L[j] + clue[j] - 1; i++) set(i, 1);
  // same gap in both: empty
  const gapIdx = (S) => {
    const g = new Int16Array(n).fill(-1);
    let j = 0;
    for (let i = 0; i < n; i++) {
      while (j < k && S[j] + clue[j] - 1 < i) j++;
      if (j < k && i >= S[j]) continue; // covered
      g[i] = j; // number of blocks wholly before i
    }
    return g;
  };
  const gl = gapIdx(L), gr = gapIdx(R);
  for (let i = 0; i < n; i++) if (gl[i] >= 0 && gl[i] === gr[i]) set(i, 0);
}

/* ---------- whole boards ---------- */

function board(sol, w, h) {
  const lines = linesOf(w, h);
  const clues = lines.map((ix) => runs(ix.map((i) => sol[i])));
  const of = Array.from({ length: w * h }, () => []);
  lines.forEach((ix, li) => ix.forEach((i) => of[i].push(li)));
  return { w, h, lines, clues, of };
}

/* Queue propagation with full line logic. Mutates g. False on contradiction. */
function propagate(b, g) {
  const q = b.lines.map((_, i) => i), inQ = new Uint8Array(b.lines.length).fill(1);
  while (q.length) {
    const li = q.pop();
    inQ[li] = 0;
    const ix = b.lines[li];
    const cells = ix.map((i) => g[i]);
    const res = lineFull(cells, b.clues[li]);
    if (!res) return false;
    for (let t = 0; t < ix.length; t++) if (res[t] !== cells[t]) {
      g[ix[t]] = res[t];
      for (const l2 of b.of[ix[t]]) if (l2 !== li && !inQ[l2]) { inQ[l2] = 1; q.push(l2); }
    }
  }
  return true;
}

function countSolutions(b, given, limit, maxNodes) {
  limit = limit || 2; maxNodes = maxNodes || 200000;
  const sols = [];
  let nodes = 0, aborted = false;
  const start = given ? Int8Array.from(given) : new Int8Array(b.w * b.h).fill(-1);
  const stack = [start];
  while (stack.length && sols.length < limit) {
    if (++nodes > maxNodes) { aborted = true; break; }
    const g = stack.pop();
    if (!propagate(b, g)) continue;
    const i = g.indexOf(-1);
    if (i < 0) { sols.push(Uint8Array.from(g)); continue; }
    const a = Int8Array.from(g); a[i] = 0;
    const z = Int8Array.from(g); z[i] = 1;
    stack.push(a, z);
  }
  return { count: sols.length, sols, nodes, aborted };
}

function rounds(b, given, lineFn) {
  let g = given ? Int8Array.from(given) : new Int8Array(b.w * b.h).fill(-1);
  const free = Math.max(1, g.filter((v) => v < 0).length);
  let n = 0, opening = 0;
  const perRound = [];
  for (;;) {
    const next = Int8Array.from(g);
    let changed = 0;
    for (let li = 0; li < b.lines.length; li++) {
      const ix = b.lines[li];
      const cells = ix.map((i) => g[i]);
      if (!cells.includes(-1)) continue;
      const res = lineFn(cells, b.clues[li]);
      if (!res) return { solved: false, contradiction: true, rounds: n, opening, left: g.filter((v) => v < 0).length, perRound };
      for (let t = 0; t < ix.length; t++) if (res[t] !== cells[t] && next[ix[t]] === -1) { next[ix[t]] = res[t]; changed++; }
    }
    if (!changed) break;
    n++;
    perRound.push(changed);
    if (n === 1) opening = changed / free;
    g = next;
  }
  const left = g.filter((v) => v < 0).length;
  return { solved: left === 0, rounds: n, opening, left, free, perRound, grid: g };
}

/* Per synchronous round, how many lines make progress. */
function productiveLines(b, given, lineFn) { return roundsDetail(b, given, lineFn).map((r) => r.lines); }
/* A bottleneck: a round in which at most `k` lines make progress while at
 * least a quarter of the open squares are still undecided. */
function bottlenecks(b, given, lineFn, k) {
  return roundsDetail(b, given, lineFn).filter((r) => r.lines <= (k || 2) && r.open >= 0.25 * r.free).length;
}
function roundsDetail(b, given, lineFn) {
  let g = given ? Int8Array.from(given) : new Int8Array(b.w * b.h).fill(-1);
  const free = g.filter((v) => v < 0).length;
  const out = [];
  for (;;) {
    const next = Int8Array.from(g);
    let lines = 0;
    for (let li = 0; li < b.lines.length; li++) {
      const ix = b.lines[li];
      const cells = ix.map((i) => g[i]);
      if (!cells.includes(-1)) continue;
      const res = lineFn(cells, b.clues[li]);
      if (!res) return out;
      let moved = false;
      for (let t = 0; t < ix.length; t++) if (res[t] !== cells[t]) { moved = true; if (next[ix[t]] === -1) next[ix[t]] = res[t]; }
      if (moved) lines++;
    }
    if (!lines) break;
    out.push({ lines, open: g.filter((v) => v < 0).length, free });
    g = next;
  }
  return out;
}

module.exports = { productiveLines, bottlenecks, roundsDetail, runs, cluesOf, linesOf, lineFull, lineSimple, linePack, board, propagate, countSolutions, rounds, leftmost };
