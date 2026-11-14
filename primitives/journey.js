/* Nonogram Journey: the Nonogram Primitives lab folded into one game.
 * It is Notan's own ramp of hand-drawn pictures, 2x2 up to 15x15 (levels.js),
 * with a twist in each gap where the ramp jumps a size: the solved picture
 * shrinks into the next board (Merge), becomes the middle of a plate of
 * eight tiles (Patch), falls into a star (Gravity), or the next picture is
 * played with Mines rules. After the ramp come Notan's endless boards. The
 * line at the top opens a sheet with every board, the other games (Gravity,
 * Ring, Hole and Mines on their own) and the focus outline. Uses Notan's
 * engine (clues, line solver, generator).
 *
 * As in a plain nonogram, nothing starts locked but what a step carries
 * over from the last board. A generated picture is nudged, as Notan's
 * generator does, until the rules a person uses finish it from its clues
 * alone, so every board has one answer and needs no guessing.
 *
 *   plain    a fresh board, as in Notan.
 *   merge    the last picture merges 2x2 (3x3 from a Patch plate) into a
 *            locked seed off center in the next board.
 *   patch    eight 5x5 tiles around the last picture, shrunk to 5x5.
 *   gravity  the last picture falls into a star in the middle square,
 *            which gets heavier with every solve and pulls harder.
 *   ring     a lopsided ring around the last picture.
 *   mines    Merge, but filling a square that should stay empty hits a mine.
 *   hole     the last picture falls into a void that grows with its ink. */
(function () {
  'use strict';
  const E = window.InkEngine;
  const STORE = 'notan-journey.v3'; // localStorage name for saves
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const MODES = {
    journey: { name: 'Journey', blurb: '' },
    gravity: { name: 'Gravity', blurb: 'Each solve falls into the star. It gets heavier.' },
    ring: { name: 'Ring', blurb: 'Each solve grows a ring around it.' },
    hole: { name: 'Hole', blurb: 'Each solve falls in. The hole grows.' },
    mines: { name: 'Mines', blurb: 'Fill only what the numbers prove.' },
  };
  const ORDER = ['journey', 'gravity', 'ring', 'hole', 'mines'];
  /* What a journey step says the first time it appears, and its short name. */
  const STEP = {
    plain: { name: '', first: '' },
    merge: { name: 'merge', first: 'Your last picture shrank into this board.' },
    patch: { name: 'patch', first: 'Your last picture is the middle. Solve the eight tiles around it.' },
    gravity: { name: 'gravity', first: 'Your picture fell into a star. It pulls on the squares.' },
    ring: { name: 'ring', first: 'Bonus: a ring grows around your last picture.' },
    mines: { name: 'mines', first: 'Filling a square that should stay empty sets off a mine.' },
    hole: { name: 'hole', first: 'Bonus: your picture fell into a hole.' },
  };
  const WHERE = ['top left', 'top', 'top right', 'left', 'middle', 'right', 'bottom left', 'bottom', 'bottom right'];

  /* ---------- generation ----------
   * Pictures come from a few generators, so a chain is not one blob after
   * another: blobs, strokes, terrain, scatter, and the hole's swirl. Locked
   * cells (fixed >= 0) always keep their value, and each generator lets new
   * ink grow out of them, so the old picture runs on into the new one. */

  function freshSeed() { return (Math.random() * 2 ** 31) | 0; }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function overlay(g, fixed) {
    for (let i = 0; i < g.length; i++) if (fixed[i] >= 0) g[i] = fixed[i];
    return g;
  }
  function touchesFixed(fixed, w, h, r, c) {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < h && cc < w && fixed[rr * w + cc] >= 0) return true;
    }
    return false;
  }
  /* Majority passes over the free cells; with `near`, only those next to a
   * locked cell, which stitches a new picture onto the old one. */
  function smooth(g, w, h, fixed, rng, passes, near) {
    for (let p = 0; p < passes; p++) {
      const n = Uint8Array.from(g);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (fixed[i] >= 0 || (near && !touchesFixed(fixed, w, h, r, c))) continue;
        let ink = 0, tot = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
          tot++; ink += g[rr * w + cc];
        }
        n[i] = ink * 2 > tot ? 1 : ink * 2 < tot ? 0 : (rng() < 0.5 ? 1 : 0);
      }
      g = n;
    }
    return g;
  }
  function freeCount(fixed) { let n = 0; for (const v of fixed) if (v < 0) n++; return n; }

  // the eight steps, in order of angle (0 is east, then clockwise on screen)
  const DIRS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];

  const GEN = {
    /* Notan's endless pictures: noise mirrored left to right, then
     * smoothed, so a board reads as a mask, a creature or an emblem. */
    mirror(w, h, fixed, rng, dens) {
      const g = new Uint8Array(w * h);
      for (let r = 0; r < h; r++) for (let c = 0; c < Math.ceil(w / 2); c++) g[r * w + c] = g[r * w + w - 1 - c] = rng() < dens + 0.02 ? 1 : 0;
      return smooth(overlay(g, fixed), w, h, fixed, rng, 2);
    },
    /* Noise smoothed into shapes. */
    blobs(w, h, fixed, rng, dens) {
      const g = new Uint8Array(w * h);
      for (let i = 0; i < g.length; i++) g[i] = rng() < dens + 0.02 ? 1 : 0;
      return smooth(overlay(g, fixed), w, h, fixed, rng, 2);
    },
    /* Lines that wander out of the old picture's ink, sometimes two wide. */
    strokes(w, h, fixed, rng, dens) {
      const g = overlay(new Uint8Array(w * h), fixed);
      const target = Math.round(freeCount(fixed) * dens);
      let ink = 0, cy = 0, cx = 0, nf = 0;
      const starts = [];
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (fixed[i] < 0) continue;
        nf++; cy += r; cx += c;
        if (fixed[i] === 1 && touchesFree(r, c)) starts.push(i);
      }
      cy = nf ? cy / nf : (h - 1) / 2; cx = nf ? cx / nf : (w - 1) / 2;
      function touchesFree(r, c) {
        for (const [dr, dc] of DIRS) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < h && cc < w && fixed[rr * w + cc] < 0) return true;
        }
        return false;
      }
      function paint(r, c) {
        if (r < 0 || c < 0 || r >= h || c >= w) return;
        const j = r * w + c;
        if (fixed[j] < 0 && !g[j]) { g[j] = 1; ink++; }
      }
      for (let s = 0; s < 60 && ink < target; s++) {
        const i = starts.length && rng() < 0.75 ? starts[(rng() * starts.length) | 0] : (rng() * w * h) | 0;
        let r = Math.floor(i / w), c = i % w;
        // head away from the old picture, give or take
        const a = Math.atan2(r - cy, c - cx) + (rng() - 0.5) * 1.6;
        let d = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
        const thick = rng() < 0.35, len = 3 + ((rng() * Math.max(w, h)) | 0);
        for (let k = 0; k < len && ink < target; k++) {
          if (rng() < 0.28) d = (d + (rng() < 0.5 ? 1 : 7)) % 8;
          r += DIRS[d][0]; c += DIRS[d][1];
          if (r < 0 || c < 0 || r >= h || c >= w) break;
          paint(r, c);
          if (thick) paint(r + DIRS[(d + 2) % 8][0], c + DIRS[(d + 2) % 8][1]);
        }
      }
      return g;
    },
    /* A ground line seen from a random side, with an island or a cave. */
    terrain(w, h, fixed, rng, dens) {
      const side = (rng() * 4) | 0; // the side the ground sits on: bottom, top, left, right
      const along = side < 2 ? w : h, deep = side < 2 ? h : w;
      const heights = [];
      let y = deep * dens + (rng() - 0.5) * 2;
      for (let k = 0; k < along; k++) {
        y = clamp(y + (rng() - 0.5) * 2.4, 1, deep - 1);
        heights.push(Math.round(y));
      }
      const g = new Uint8Array(w * h);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const a = side < 2 ? c : r;
        const depth = [h - 1 - r, r, c, w - 1 - c][side]; // distance from the ground's own side
        g[r * w + c] = depth < heights[a] ? 1 : 0;
      }
      if (rng() < 0.6) {
        const r0 = rng() * h, c0 = rng() * w, rad = 1 + rng() * 1.4, v = rng() < 0.5 ? 1 : 0;
        for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (Math.hypot(r - r0, c - c0) <= rad) g[r * w + c] = v;
      }
      return smooth(overlay(g, fixed), w, h, fixed, rng, 1, true);
    },
    /* Small clumps dropped about: dots, bars, pluses and squares. */
    scatter(w, h, fixed, rng, dens) {
      const SHAPES = [[[0, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0]], [[0, 0], [0, 1], [1, 0], [1, 1]],
        [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]], [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 1], [1, 0]]];
      const g = overlay(new Uint8Array(w * h), fixed);
      const target = Math.round(freeCount(fixed) * dens);
      let ink = 0;
      for (let s = 0; s < 400 && ink < target; s++) {
        const r0 = (rng() * h) | 0, c0 = (rng() * w) | 0, sh = SHAPES[(rng() * SHAPES.length) | 0];
        for (const [dr, dc] of sh) {
          const r = r0 + dr, c = c0 + dc, j = r * w + c;
          if (r >= 0 && c >= 0 && r < h && c < w && fixed[j] < 0 && !g[j]) { g[j] = 1; ink++; }
        }
      }
      return g;
    },
    /* Arms that spiral in toward the hole, one way round, denser near it. */
    swirl(w, h, fixed, rng, dens, o) {
      const g = new Uint8Array(w * h);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (fixed[i] >= 0) continue;
        const dy = r - o.cy, dx = c - o.cx, d = Math.hypot(dx, dy);
        const arm = Math.cos(o.arms * (Math.atan2(dy, dx) - o.spin * 1.1 * Math.log(1 + d)) + o.phase);
        const fall = Math.exp(-(d - o.R) / 2.2);
        g[i] = rng() < dens - 0.16 + 0.3 * arm + 0.32 * fall ? 1 : 0;
      }
      // The void counts as ink while smoothing, so ink gathers at its edge
      // instead of being worn away from it.
      overlay(g, fixed);
      for (const i of o.cells) g[i] = 1;
      return overlay(smooth(g, w, h, fixed, rng, 1), fixed);
    },
  };

  /* A picture from one generator, with its free cells near the density asked for. */
  function makePicture(w, h, fixed, rng, spec) {
    spec = spec || {};
    const gen = GEN[spec.gen] || GEN.blobs, dens = spec.dens || 0.5;
    let best = null, bestErr = Infinity;
    for (let t = 0; t < 24; t++) {
      const g = gen(w, h, fixed, rng, dens, spec);
      let free = 0, ink = 0;
      for (let i = 0; i < g.length; i++) if (fixed[i] < 0) { free++; ink += g[i]; }
      // a picture the mode turns down counts as far off
      const err = (free ? Math.abs(ink / free - dens) : 0) + (spec.accept && !spec.accept(g) ? 1 : 0);
      if (err < 0.16) return g;
      if (err < bestErr) { best = g; bestErr = err; }
    }
    return best;
  }

  /* Which generator draws the next picture. The first boards are blobs, the
   * easiest to read; after that the pool mixes, never the same twice running. */
  function pickGen(pool, depth, last, rng) {
    if (depth < 2 && pool.includes('blobs')) return 'blobs';
    const opts = pool.length > 1 ? pool.filter((g) => g !== last) : pool;
    return opts[(rng() * opts.length) | 0];
  }

  /* ---------- the rules a person uses ----------
   * Notan's line solver (engine.js) tries every way a line's blocks can
   * fit, which is stronger than a person scanning a board. Boards are
   * graded and nudged with the rules people use instead:
   *   simple  a line with no numbers, or with all its ink down; an exact
   *           count; gaps too small for any block; the overlap of each block
   *           slid left and right against the marks; ink glued to an edge.
   *   pack    simple, plus the overlap of the leftmost and rightmost
   *           packings that respect ink as well as marks (from zoom 5 on).
   * Both are sound, so a board they finish has exactly one answer.
   * test-solve.cjs holds an independent copy of the same rules for the
   * tests, and counts answers with code that shares nothing with this. */
  const NOPE = new Error('contradiction');
  function humanLine(cells, clue, pack) {
    try { return humanCore(cells, clue, pack); } catch (e) { if (e === NOPE) return null; throw e; }
  }
  function humanCore(cells, clue, pack) {
    const n = cells.length, k = clue.length, c = cells.slice();
    const sum = clue.reduce((a, b) => a + b, 0);
    let changed = true;
    const set = (i, v) => {
      if (i < 0 || i >= n) return;
      if (c[i] === -1) { c[i] = v; changed = true; } else if (c[i] !== v) throw NOPE;
    };
    for (let guard = 0; changed && guard < 64; guard++) {
      changed = false;
      if (k === 0) { for (let i = 0; i < n; i++) set(i, 0); break; }
      let filled = 0, unk = 0;
      for (const v of c) { if (v === 1) filled++; else if (v === -1) unk++; }
      if (!unk) break;
      if (filled === sum) { for (let i = 0; i < n; i++) if (c[i] === -1) set(i, 0); continue; }
      if (filled + unk === sum) { for (let i = 0; i < n; i++) if (c[i] === -1) set(i, 1); continue; }
      if (filled > sum || filled + unk < sum) throw NOPE;
      // gaps between marks too small for the smallest block
      const minB = Math.min(...clue);
      for (let i = 0; i < n;) {
        if (c[i] === 0) { i++; continue; }
        let e = i;
        while (e < n && c[e] !== 0) e++;
        if (e - i < minB) for (let q = i; q < e; q++) set(q, 0);
        i = e;
      }
      // every block slid left and right against the marks only
      const ls = new Array(k), rs = new Array(k);
      const hasZero = (a, b) => { for (let i = a; i <= b; i++) if (c[i] === 0) return true; return false; };
      let pos = 0;
      for (let j = 0; j < k; j++) {
        let s = pos;
        while (s + clue[j] <= n && hasZero(s, s + clue[j] - 1)) s++;
        if (s + clue[j] > n) throw NOPE;
        ls[j] = s; pos = s + clue[j] + 1;
      }
      pos = n - 1;
      for (let j = k - 1; j >= 0; j--) {
        let e = pos;
        while (e - clue[j] + 1 >= 0 && hasZero(e - clue[j] + 1, e)) e--;
        if (e - clue[j] + 1 < 0) throw NOPE;
        rs[j] = e - clue[j] + 1; pos = rs[j] - 2;
      }
      for (let j = 0; j < k; j++) {
        if (rs[j] < ls[j]) throw NOPE;
        for (let i = rs[j]; i <= ls[j] + clue[j] - 1; i++) set(i, 1);
      }
      const cover = new Uint8Array(n);
      for (let j = 0; j < k; j++) for (let i = ls[j]; i <= rs[j] + clue[j] - 1; i++) cover[i] = 1;
      for (let i = 0; i < n; i++) if (!cover[i]) set(i, 0);
      // the first ink from each end belongs to the first block from that end
      glue(c, clue, ls[0], set);
      const rc = c.slice().reverse(), rclue = clue.slice().reverse();
      glue(rc, rclue, n - 1 - (rs[k - 1] + clue[k - 1] - 1), (i, v) => set(n - 1 - i, v));
      if (pack) packStep(c, clue, set);
    }
    return c;
  }
  function glue(c, clue, ls0, set) {
    const n = c.length, len = clue[0];
    let p = -1;
    for (let i = 0; i < n; i++) if (c[i] === 1) { p = i; break; }
    if (p < 0) return;
    // only if the first block cannot fit, with its gap, somewhere before it
    for (let s = ls0; s + len - 1 <= p - 2; s++) {
      let ok = true;
      for (let i = s; i < s + len; i++) if (c[i] === 0) { ok = false; break; }
      if (ok) return;
    }
    let q = p;
    while (q + 1 < n && c[q + 1] === 1) q++;
    const lo = Math.max(ls0, q - len + 1), hi = p;
    if (lo > hi) throw NOPE;
    for (let i = hi; i <= lo + len - 1; i++) set(i, 1);
    for (let i = 0; i < lo; i++) set(i, 0);
    if (lo === hi) { set(lo - 1, 0); set(lo + len, 0); }
  }
  /* The leftmost placement of every block that respects ink and marks. */
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
    const L = leftmost(c, clue), rr = leftmost(c.slice().reverse(), clue.slice().reverse());
    if (!L || !rr) throw NOPE;
    const R = new Array(k);
    for (let j = 0; j < k; j++) R[j] = n - 1 - (rr[k - 1 - j] + clue[j] - 1);
    // the same block covers a square in both packings: ink
    for (let j = 0; j < k; j++) for (let i = R[j]; i <= L[j] + clue[j] - 1; i++) set(i, 1);
    // the same gap holds a square in both: empty
    const gapIdx = (S) => {
      const g = new Int16Array(n).fill(-1);
      let j = 0;
      for (let i = 0; i < n; i++) {
        while (j < k && S[j] + clue[j] - 1 < i) j++;
        if (j < k && i >= S[j]) continue;
        g[i] = j;
      }
      return g;
    };
    const gl = gapIdx(L), gr = gapIdx(R);
    for (let i = 0; i < n; i++) if (gl[i] >= 0 && gl[i] === gr[i]) set(i, 0);
  }

  /* Grade a board from its locked squares, in rounds as a person sweeps it:
   * every row and column against what the last round knew. solver is
   * 'simple', 'pack' or 'full' (Notan's line solver). Returns whether it is
   * finished, the rounds, the share of open squares (and the ink squares)
   * decided in round one, how many lines move each round, and how many
   * rounds are bottlenecks: at most two lines move while a quarter or more
   * of the open squares are still undecided. */
  function gradeFrom(sol, w, h, fixed, solver) {
    const line = solver === 'full' ? E.solveLine : (cells, clue) => humanLine(cells, clue, solver === 'pack');
    const { rows, cols } = E.cluesOf(sol, w, h);
    let g = Int8Array.from(fixed);
    let free = 0;
    for (const v of g) if (v < 0) free++;
    const out = { solved: false, rounds: 0, opening: 0, firstInk: 0, lines: [], thin: 0, grid: g };
    let open = free;
    free = Math.max(1, free);
    for (;;) {
      const next = Int8Array.from(g);
      let changed = 0, moved = 0, ink = 0;
      for (let li = 0; li < h + w; li++) {
        const isRow = li < h, k = isRow ? li : li - h, n = isRow ? w : h;
        const cells = new Array(n);
        let unk = false;
        for (let t = 0; t < n; t++) { cells[t] = g[isRow ? k * w + t : t * w + k]; if (cells[t] < 0) unk = true; }
        if (!unk) continue;
        const res = line(cells, isRow ? rows[k] : cols[k]);
        if (!res) { out.contradiction = true; out.grid = g; return out; }
        let mv = false;
        for (let t = 0; t < n; t++) {
          if (res[t] === cells[t]) continue;
          mv = true;
          const i = isRow ? k * w + t : t * w + k;
          if (next[i] === -1) { next[i] = res[t]; changed++; if (res[t] === 1) ink++; }
        }
        if (mv) moved++;
      }
      if (!changed) break;
      out.rounds++;
      out.lines.push(moved);
      if (moved <= 2 && open >= 0.25 * free) out.thin++;
      if (out.rounds === 1) { out.opening = changed / free; out.firstInk = ink; }
      open -= changed;
      g = next;
    }
    out.grid = g;
    out.solved = !g.includes(-1);
    return out;
  }

  /* Nudge a picture until the solver finishes it from the locked squares
   * alone, as Notan's own generator does: while it stalls, flip one of the
   * squares it could not settle. Returns null if it does not get there.
   * Locked squares are never flipped. */
  function settle(sol, w, h, fixed, rng, solver, sym) {
    sol = Uint8Array.from(sol);
    for (let k = 0; k < w * h * 2; k++) {
      const m = gradeFrom(sol, w, h, fixed, solver || 'full');
      if (m.solved) return sol;
      const open = [];
      for (let i = 0; i < sol.length; i++) if (m.grid[i] === -1 && fixed[i] < 0) open.push(i);
      if (!open.length) return null;
      const i = open[(rng() * open.length) | 0], v = sol[i] ^ 1;
      sol[i] = v;
      // A mirrored picture flips the square's twin too, as Notan's do, while
      // there is still more than one open square to choose from.
      const t = i - (i % w) + w - 1 - (i % w);
      if (sym && t !== i && fixed[t] < 0 && open.length > 2) sol[t] = v;
    }
    return null;
  }

  /* Notan's difficulty score, started from the locked squares instead of a
   * blank grid: board size, rounds of row-then-column reasoning, and how
   * little the first round gives away. Null if the line solver stalls. */
  function scoreFrom(sol, w, h, fixed) {
    const m = gradeFrom(sol, w, h, fixed, 'full');
    return m.solved ? E.scoreOf({ depth: m.rounds, opening: m.opening }, w, h) : null;
  }
  /* The grade a person would see, plus Notan's score. For tests. */
  function measureFrom(sol, w, h, fixed, solver) {
    const m = gradeFrom(sol, w, h, fixed, solver || 'simple');
    return { solved: m.solved, depth: m.rounds, opening: m.opening, firstInk: m.firstInk, lines: m.lines, minLines: m.lines.length ? Math.min(...m.lines) : 0, thin: m.thin, score: scoreFrom(sol, w, h, fixed) };
  }

  /* The band a board must fall in, by how many boards into the chain it is:
   * which rules must finish it, in at most how many rounds, how many lines
   * must move every round (so there is always more than one place to look),
   * and how many rounds to aim for. A chain opens on boards a person
   * finishes in two quick sweeps and ramps up a band at a time. */
  const BAND = [
    { solver: 'simple', most: 3, lines: 3, aim: 2 },
    { solver: 'simple', most: 4, lines: 2, aim: 3 },
    { solver: 'simple', most: 4, lines: 2, aim: 3 },
    { solver: 'simple', most: 5, lines: 2, aim: 4 },
    { solver: 'simple', most: 6, lines: 2, aim: 4 },
    { solver: 'pack', most: 7, lines: 2, aim: 5 },
    { solver: 'pack', most: 7, lines: 2, aim: 5 },
    { solver: 'pack', most: 8, lines: 2, aim: 6 },
  ];
  function bandFor(d) { return BAND[clamp(d | 0, 0, BAND.length - 1)]; }
  /* A Patch tile: the simple rules, at most four rounds, from its locked edge. */
  const TILE_BAND = { solver: 'simple', most: 4, lines: 1 };

  function longestClue(rows, cols) { let n = 0; for (const x of rows.concat(cols)) n = Math.max(n, x.length); return n; }
  function fitsBand(m, band, rows, cols) {
    if (!m.solved || m.rounds > band.most) return false;
    if (m.lines.some((n) => n < (band.lines || 1))) return false;
    if (band.thin != null && m.thin > band.thin) return false;
    if (band.opening != null && m.opening < band.opening) return false;
    if (band.firstInk != null && m.firstInk < band.firstInk) return false;
    if (band.numbers != null && longestClue(rows, cols) > band.numbers) return false;
    return true;
  }

  /* A board, as in a plain nonogram: nothing starts locked but the squares
   * the mode carries over (Merge's seed, Pixel's middle, Hole's void,
   * Ring's core). The picture is nudged until the band's rules finish it
   * from its clues alone, so it has one answer. Like Notan, it turns down
   * boards that are too sparse or dense, have more than one empty line, or
   * mirror themselves. Of up to three boards that fall in the band it keeps
   * the one nearest the band's aim (ties to the lower Notan score), or for
   * Mines the easiest or the middle one. */
  function makePuzzle(w, h, fixed, rng, spec) {
    spec = spec || {};
    const gen = spec.gen || 'blobs', band = spec.band || bandFor(spec.depth);
    const ok = [];
    let loose = null;
    for (let t = 0; t < 120 && ok.length < 3; t++) {
      const s = settle(makePicture(w, h, fixed, rng, spec), w, h, fixed, rng, band.solver, gen === 'mirror');
      if (!s || (spec.accept && !spec.accept(s))) continue;
      const d = E.density(s);
      // a mirrored picture is the point of Notan's own; anything else that
      // mirrors itself looks like a mistake
      if (d < 0.32 || d > 0.74 || (gen !== 'mirror' && E.mirrored(s, w, h))) continue;
      const { rows, cols } = E.cluesOf(s, w, h);
      if (rows.concat(cols).filter((x) => !x.length).length > 1) continue;
      // Notan's own line solver must finish it too: the proof of one answer
      const score = scoreFrom(s, w, h, fixed);
      if (score === null) continue;
      const m = gradeFrom(s, w, h, fixed, band.solver);
      const cand = { sol: s, score, m };
      if (!loose) loose = cand;
      if (fitsBand(m, band, rows, cols)) ok.push(cand);
    }
    let best = null;
    if (ok.length) {
      const byScore = ok.slice().sort((a, b) => a.score - b.score);
      if (band.pick === 'easiest') best = byScore[0];
      else if (band.pick === 'middle') best = byScore[Math.floor(byScore.length / 2)];
      else {
        const off = (c) => Math.abs(c.m.rounds - band.aim);
        best = byScore.reduce((a, c) => (off(c) < off(a) ? c : a));
      }
    } else if (loose) best = Object.assign(loose, { fallback: true });
    else {
      // Rare: take any picture the clues alone solve, guards or not.
      for (let t = 0; t < 200 && !best; t++) {
        const s = settle(makePicture(w, h, fixed, rng, spec), w, h, fixed, rng, t < 100 ? band.solver : 'full');
        if (s) best = { sol: s, score: scoreFrom(s, w, h, fixed), m: gradeFrom(s, w, h, fixed, band.solver), fallback: true };
      }
    }
    return { w, h, sol: best.sol, given: Int8Array.from(fixed), cells: new Int8Array(w * h).fill(-1), region: null, gen, score: best.score, rounds: best.m.rounds, fallback: !!best.fallback };
  }

  function sliceOf(sol, W, r0, c0, n) {
    const out = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[r * n + c] = sol[(r0 + r) * W + c0 + c];
    return out;
  }

  /* Merge k x k blocks (the last row and column of blocks may be cut short).
   * A block is ink when more than half of it is; a tie goes either way with
   * rng, or to ink without it. */
  function down(sol, w, h, k, rng) {
    const W = Math.ceil(w / k), H = Math.ceil(h / k), out = new Uint8Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      let ink = 0, n = 0;
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
        const rr = r * k + a, cc = c * k + b;
        if (rr < h && cc < w) { n++; ink += sol[rr * w + cc]; }
      }
      out[r * W + c] = ink * 2 > n ? 1 : ink * 2 < n ? 0 : (rng ? (rng() < 0.5 ? 1 : 0) : 1);
    }
    return out;
  }

  function place(fixed, N, src, n, r0, c0, m) {
    m = m || n; // n rows of m
    for (let r = 0; r < n; r++) for (let c = 0; c < m; c++) fixed[(r0 + r) * N + c0 + c] = src[r * m + c];
  }

  /* Where a picture's ink leans, from -1 to 1 on each axis: [down, right]. */
  function leanOf(sol, w, h) {
    let n = 0, y = 0, x = 0;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (sol[r * w + c]) {
      n++; y += (r - (h - 1) / 2) / ((h - 1) / 2); x += (c - (w - 1) / 2) / ((w - 1) / 2);
    }
    return n ? [y / n, x / n] : [0, 0];
  }

  /* Merge and Mines: the last board merged 2x2 into a seed (half its sides,
   * rounded up), set in an N x N board away from where its ink leaned, so
   * the picture grows into open space, and never dead center. With `axis`
   * (the journey's mirrored boards) the seed sits on the middle column, or
   * as near as the sizes allow, and only moves up or down. `land` is where
   * the old board itself lies on the new one, for the camera. */
  function seedFrom(prev, N, rng, axis) {
    const fixed = new Int8Array(N * N).fill(-1);
    if (!prev) return { fixed, region: null, land: null };
    // two old squares to one, or three from a Patch plate or anything else
    // too big to leave room round the seed
    let f = 2;
    while (Math.ceil(Math.max(prev.w, prev.h) / f) > N - 2) f++;
    const kw = Math.ceil(prev.w / f), kh = Math.ceil(prev.h / f), sw = N - kw, sh = N - kh;
    const [ly, lx] = leanOf(prev.sol, prev.w, prev.h);
    let r0 = clamp(Math.round(sh / 2 - ly * sh + (rng() - 0.5)), 0, sh);
    let c0 = axis ? (sw % 2 ? (sw - 1) / 2 + (lx < 0 ? 1 : 0) : sw / 2) : clamp(Math.round(sw / 2 - lx * sw + (rng() - 0.5)), 0, sw);
    if (r0 * 2 === sh && (axis ? sh >= 2 : sh >= 2 && c0 * 2 === sw)) {
      if (axis || rng() < 0.5) r0 += ly > 0 || (!ly && rng() < 0.5) ? -1 : 1; else c0 += rng() < 0.5 ? -1 : 1;
    }
    place(fixed, N, down(prev.sol, prev.w, prev.h, f, rng), kh, r0, c0, kw);
    // The old board lands filling its seed, centered, rather than at exactly
    // f old squares to one: an odd board (3x3 into a 2x2 seed) otherwise
    // stopped one and a half squares wide in the seed's corner and swapped
    // for a seed that did not line up with it.
    const u = Math.min(kw / prev.w, kh / prev.h), lw = prev.w * u, lh = prev.h * u;
    return { fixed, region: { r: r0, c: c0, h: kh, w: kw }, land: { r: r0 + (kh - lh) / 2, c: c0 + (kw - lw) / 2, h: lh, w: lw } };
  }
  const MERGE_SIZES = [5, 6, 6, 7, 8];

  /* ---------- patch: tiles that lock each other's edges ---------- */

  const SIDES = { top: (i) => i < 5, bottom: (i) => i >= 20, left: (i) => i % 5 === 0, right: (i) => i % 5 === 4 };
  /* Lock one edge of a 5x5 tile to its answer. */
  function lockEdge(p, side) {
    for (let i = 0; i < 25; i++) if (SIDES[side](i)) p.given[i] = p.sol[i];
  }
  /* The side of tile a that faces its neighbor b. */
  function facing(a, b) { return b.tr < a.tr ? 'top' : b.tr > a.tr ? 'bottom' : b.tc < a.tc ? 'left' : 'right'; }
  function neighborsOf(tiles, a) { return tiles.filter((b) => Math.abs(b.tr - a.tr) + Math.abs(b.tc - a.tc) === 1); }

  function makeWorld(center, rng, depth, last, pool) {
    const W = 15, T = 5;
    const fixed = new Int8Array(W * W).fill(-1);
    place(fixed, W, center, T, T, T);
    // No terrain here: on a 15x15 picture its ground and sky fill whole
    // tiles solid or leave them blank.
    const gen = pickGen(pool || ['strokes', 'blobs', 'scatter'], depth, last, rng);
    // A tile that is blank, full or solved before you open it is no puzzle:
    // try other pictures until every tile is a real one.
    let best = null;
    for (let t = 0; t < 20; t++) {
      const sol = makePicture(W, W, fixed, rng, { gen, dens: 0.5 });
      const tiles = [];
      for (let tr = 0; tr < 3; tr++) for (let tc = 0; tc < 3; tc++) {
        if (tr === 1 && tc === 1) { tiles.push({ center: true, done: true, tr, tc }); continue; }
        const s = sliceOf(sol, W, tr * T, tc * T, T);
        tiles.push({ puzzle: { w: T, h: T, sol: s, given: new Int8Array(T * T).fill(-1), cells: new Int8Array(T * T).fill(-1), region: null }, done: false, tr, tc });
      }
      // The four edge tiles start with the edge they share with the old
      // picture locked, so it visibly runs on into them.
      const mid = tiles[4];
      let poor = 0;
      for (const tile of tiles) {
        if (tile.center) continue;
        const p = tile.puzzle;
        if (Math.abs(tile.tr - 1) + Math.abs(tile.tc - 1) === 1) lockEdge(p, facing(tile, mid));
        // Nudge the tile until the simple rules finish it from its clues and
        // that edge alone, and write it back into the big picture. No other
        // square is locked. A tile that takes more than four rounds is poor.
        const settled = settle(p.sol, T, T, p.given, rng, TILE_BAND.solver);
        if (!settled) { poor++; continue; }
        setTile(sol, W, tile, settled);
        if (!tileOk(p)) poor++;
      }
      // keep the try with the fewest poor tiles
      if (!best || poor < best.poor) best = { sol, tiles, poor };
      if (!poor) break;
    }
    // About one plate in two hundred still has a poor tile (blank, solid,
    // solved before it opens, or slow). Give each one a picture of its own,
    // keeping its locked edge, rather than throw the plate away.
    if (best.poor) for (const tile of best.tiles) if (!tile.center && !tileOk(tile.puzzle)) repairTile(best.sol, W, tile, rng);
    return { kind: 'world', W, T, sol: best.sol, tiles: best.tiles, gen };
  }
  /* A tile is a real puzzle: three to 22 ink squares, not solved before it
   * opens, and finished by the simple rules from its locked edge in at most
   * four rounds. */
  function tileOk(p) {
    let ink = 0;
    for (const v of p.sol) ink += v;
    if (ink < 3 || ink > 22 || isSolved(p)) return false;
    const { rows, cols } = E.cluesOf(p.sol, 5, 5);
    return fitsBand(gradeFrom(p.sol, 5, 5, p.given, TILE_BAND.solver), TILE_BAND, rows, cols);
  }
  function setTile(sol, W, tile, s) {
    const p = tile.puzzle;
    p.sol = s;
    for (let i = 0; i < 25; i++) sol[(tile.tr * 5 + Math.floor(i / 5)) * W + tile.tc * 5 + (i % 5)] = s[i];
    tile.done = isSolved(p);
  }
  function repairTile(sol, W, tile, rng) {
    const p = tile.puzzle;
    for (let t = 0; t < 80; t++) {
      const s = settle(makePicture(5, 5, p.given, rng, { gen: t % 2 ? 'scatter' : 'blobs', dens: 0.5 }), 5, 5, p.given, rng, TILE_BAND.solver);
      if (!s || !tileOk(Object.assign({}, p, { sol: s }))) continue;
      setTile(sol, W, tile, s);
      return true;
    }
    return false;
  }

  /* ---------- hole: a board that falls into the middle and adds mass ---------- */

  const HOLE_MAX = 13;
  /* The hole's radius in squares: its area grows with mass, a twelfth of a
   * square per square of ink that fell in, divided by the scale. It is a
   * void: its squares are locked empty, so a line through it splits in two,
   * and ink gathers round its edge. */
  function holeRadius(mass, scale) { return Math.sqrt((1 + mass / (12 * scale)) / Math.PI); }
  function holeReach(R) { return Math.floor(R + 0.35); }
  // two squares of board round the hole, so boards grow 5, 7, 9, 11, 13
  function holeBoard(R) { return 2 * holeReach(R) + 1 + 4; }
  /* Ink squares of a solved board outside its hole: what falls in next. */
  function fallen(p) {
    const inHole = new Set((p.hole && p.hole.cells) || []);
    let n = 0;
    for (let i = 0; i < p.sol.length; i++) if (p.sol[i] && !inHole.has(i)) n++;
    return n;
  }

  /* ---------- the journey: Notan, and then not quite ----------
   * The boards are Notan's own hand-drawn ramp (levels.js, a copy of
   * notan/levels.js), in Notan's order but for a few moved so the size only
   * creeps up. Every fifth board is a twist, built from the picture just
   * solved; the first three (5, 10, 15) bring in Merge, Patch and Gravity,
   * then Mines, and the four come round again in that order:
   *   merge    it shrinks two to one into a bigger, mirrored board
   *   patch    a 5x5 picture becomes the middle of a 15x15 plate
   *   gravity  it falls into a star on a picture whose middle is filled
   *   mines    the next picture, with Mines rules
   * Every board is fixed, so the level list can open any of them. Past the
   * last one the journey goes on with Notan's endless boards. */
  const ART = {};
  for (const l of window.InkLevels || []) ART[l.id] = Object.assign({ name: l.name }, E.fromArt(l.art));
  const JOURNEY = [
    'square', 'cup', 'plus', 'stairs',
    { k: 'merge', n: 4, band: 0 },
    'flag', 'tree', 'moon', 'mug',
    { k: 'patch' },
    'diamond', 'house', 'key', 'fish',
    { k: 'gravity', art: 'heart' },
    'ghost', 'hourglass', 'star', 'rook',
    { k: 'mines', art: 'umbrella' },
    'crown', 'car', 'cat', 'mushroom',
    { k: 'merge', n: 8, band: 2 },
    'pawn', 'spade', 'face', 'note',
    { k: 'patch' },
    'anchor', 'leaf-connected', 'camera', 'lock',
    { k: 'gravity', art: 'rocket' },
    'cactus', 'owl', 'apple', 'turtle',
    { k: 'mines', art: 'skull' },
    'sun', 'whale', 'elephant', 'vase',
    { k: 'merge', n: 11, band: 5 },
    'mountain-ridge', 'lantern', 'crab-raised', 'arrow',
    { k: 'patch' },
    'jellyfish-drift', 'lion-profile', 'moth', 'beetle-angled',
    { k: 'gravity', art: 'pine' },
    'alien-antenna', 'goggles-tilted', 'robot-wave',
  ].map((st) => (typeof st === 'string' ? { k: 'plain', art: st } : st));
  const ENDLESS = [10, 12];

  /* A hand-drawn picture as a fresh board. */
  function artBoard(id) {
    const a = ART[id];
    return { w: a.w, h: a.h, sol: Uint8Array.from(a.sol), given: new Int8Array(a.w * a.h).fill(-1), cells: new Int8Array(a.w * a.h).fill(-1), region: null, gen: 'art', art: id, name: a.name };
  }
  /* Journey board k (from 0), the same every time it is built. Merge and
   * Patch read the picture before them, which is built (once) the same way. */
  const solvedPics = new Map();
  function journeyPic(k) {
    if (!solvedPics.has(k)) solvedPics.set(k, picOf(journeyBoard(k)));
    return solvedPics.get(k);
  }
  function journeyBoard(k) {
    const st = JOURNEY[k], rng = E.mulberry32(0x6e6f74 + k * 7919);
    let next;
    if (st.k === 'merge') {
      const pic = journeyPic(k - 1), N = st.n;
      const { fixed, region, land } = seedFrom(pic, N, rng, true);
      next = makePuzzle(N, N, fixed, rng, { gen: 'mirror', dens: 0.52, band: bandFor(st.band) });
      next.region = region;
      next.land = land;
    } else if (st.k === 'patch') {
      const pic = journeyPic(k - 1);
      next = makeWorld(resample(pic, 5), rng, 0, null, ['blobs']);
      next.layers = [{ w: pic.w, h: pic.h, sol: pic.sol }];
    } else {
      next = artBoard(st.art);
      if (st.k === 'gravity') {
        const level = JOURNEY.slice(0, k + 1).filter((x) => x.k === 'gravity').length;
        const at = Math.floor(next.h / 2) * next.w + Math.floor(next.w / 2);
        next.given[at] = 1;
        next.grav = { level, mass: level * 40, spin: level % 2 ? 1 : -1, at };
        next.fresh = new Uint8Array(next.w * next.h); // the star is drawn over its square
      }
      if (st.k === 'mines') armMines(next);
    }
    next.step = st.k;
    return next;
  }
  /* Past the ramp: Notan's endless boards, a merge now and then, and a
   * Patch plate at most every fourth board. */
  function endlessKind(ch, rng) {
    const past = ch.kinds || [];
    let since = past.length;
    for (let k = past.length - 1; k >= 0; k--) if (past[k] === 'patch') { since = past.length - 1 - k; break; }
    if (since >= 4 && rng() < 0.25) return 'patch';
    return rng() < 0.4 ? 'merge' : 'plain';
  }

  /* The last picture as a plain board, whatever made it: a Patch plate is
   * its whole 15x15 picture. */
  function picOf(prev) {
    if (!prev) return null;
    return prev.kind === 'world' ? { w: 15, h: 15, sol: prev.sol, gen: prev.gen } : { w: prev.w, h: prev.h, sol: prev.sol, gen: prev.gen };
  }
  /* Shrink a picture to n x n: a new square is ink when at least half of
   * the old area under it is. */
  function resample(pic, n) {
    if (pic.w === n && pic.h === n) return Uint8Array.from(pic.sol);
    const out = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const y0 = r * pic.h / n, y1 = (r + 1) * pic.h / n, x0 = c * pic.w / n, x1 = (c + 1) * pic.w / n;
      let ink = 0, tot = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const a = (Math.min(y + 1, y1) - Math.max(y, y0)) * (Math.min(x + 1, x1) - Math.max(x, x0));
        tot += a; ink += a * pic.sol[y * pic.w + x];
      }
      out[r * n + c] = ink * 2 >= tot ? 1 : 0;
    }
    return out;
  }
  function inkOf(pic) { let n = 0; for (const v of pic.sol) n += v; return n; }

  /* Gravity: every solve falls into the middle square, which is locked and
   * counts as filled. It is a star that only gets heavier: each solve adds
   * a level, and the pull on the squares around it grows in strength and
   * reach. Boards are odd so the star sits dead center. */
  const GRAV_SIZES = [5, 5, 7, 7, 7, 9];

  function advance(mode, ch) {
    const rng = E.mulberry32((ch.seed + ch.depth * 7919) | 0);
    const prev = ch.cur, d = ch.depth, pic = picOf(prev);
    const mem = ch.mem || (ch.mem = {});
    const journey = mode === 'journey', scripted = journey && d < JOURNEY.length;
    const kind = scripted ? JOURNEY[d].k : journey ? endlessKind(ch, rng) : mode;
    let next;
    if (scripted) {
      next = journeyBoard(d);
      if (next.kind === 'world') ch.view = 'world';
    } else if (kind === 'plain') {
      // Notan's endless board: mirrored, and its line solver finishes it
      const N = ENDLESS[(rng() * ENDLESS.length) | 0], g = E.generate(1 + (((ch.seed >>> 0) + d * 7919) % 99998), N, N);
      next = g ? { w: N, h: N, sol: g.sol, given: new Int8Array(N * N).fill(-1), cells: new Int8Array(N * N).fill(-1), region: null, gen: 'mirror' }
        : makePuzzle(N, N, new Int8Array(N * N).fill(-1), rng, { gen: 'mirror', dens: 0.52, band: bandFor(7) });
    } else if (kind === 'merge' || kind === 'mines') {
      // The seed lands away from where the old picture's ink leans, so the
      // new board opens on the side it was growing toward.
      const N = journey ? 12 : (kind === 'mines' ? MINES.sizes : MERGE_SIZES)[Math.min(d, (kind === 'mines' ? MINES.sizes : MERGE_SIZES).length - 1)];
      const { fixed, region, land } = seedFrom(pic, N, rng, journey);
      const gen = journey ? 'mirror' : pickGen(['blobs', 'strokes', 'terrain', 'scatter'], d, prev && prev.gen, rng);
      next = makePuzzle(N, N, fixed, rng, kind === 'mines' ? minesSpec(N, gen) : { gen, dens: 0.5, depth: d });
      next.region = region;
      if (land) next.land = land;
      if (kind === 'mines') armMines(next);
    } else if (kind === 'gravity') {
      const g = mem.grav || { level: 0, mass: 0, spin: rng() < 0.5 ? 1 : -1, n: 0 };
      const level = prev ? g.level + 1 : 0, mass = g.mass + (pic ? inkOf(pic) : 0);
      const N = GRAV_SIZES[Math.min(g.n, GRAV_SIZES.length - 1)];
      const mid = (N - 1) / 2, at = mid * N + mid, fixed = new Int8Array(N * N).fill(-1);
      fixed[at] = 1;
      const b = bandFor(g.n), band = Object.assign({}, b, { aim: Math.min(b.aim, N <= 5 ? 3 : 5) });
      const gen = pickGen(['blobs', 'strokes', 'scatter'], g.n, prev && prev.gen, rng);
      next = makePuzzle(N, N, fixed, rng, { gen, dens: 0.5, band });
      next.grav = { level, mass, spin: g.spin, at };
      next.fresh = new Uint8Array(N * N); // the star is drawn over its square
      mem.grav = { level, mass, spin: g.spin, n: g.n + 1 };
    } else if (kind === 'hole') {
      const ph = mem.hole;
      const spin = ph ? ph.spin : (rng() < 0.5 ? 1 : -1);
      const arms = ph ? ph.arms : (rng() < 0.6 ? 2 : 3);
      const mass = (ph ? ph.mass : 0) + (prev ? (prev.hole ? fallen(prev) : inkOf(pic)) : 0);
      let scale = ph ? ph.scale : 1, R = holeRadius(mass, scale), collapsed = false;
      // Past the largest board, every square holds three times the mass.
      while (holeBoard(R) > HOLE_MAX) { scale *= 3; R = holeRadius(mass, scale); collapsed = true; }
      const N = holeBoard(R), k = holeReach(R), mid = (N - 1) / 2;
      const fixed = new Int8Array(N * N).fill(-1), cells = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (Math.hypot(r - mid, c - mid) <= R + 0.35) { fixed[r * N + c] = 0; cells.push(r * N + c); }
      }
      // Every line through the hole has some ink, or it would read 0.
      const lines = [...new Set(cells.map((i) => Math.floor(i / N)))];
      const accept = (g) => lines.every((a) => {
        let row = 0, col = 0;
        for (let b = 0; b < N; b++) { row += g[a * N + b]; col += g[b * N + a]; }
        return row && col;
      });
      // The band moves up one row a board, but never into new rules on a
      // board that just grew: a bigger board and packing at once is a step.
      const pr = prev ? (prev.bandRow != null ? prev.bandRow : d - 1) : -1;
      let row = Math.min(d, pr + 1);
      if (prev && N > prev.w && bandFor(row).solver !== bandFor(pr).solver) row = pr;
      next = makePuzzle(N, N, fixed, rng, { gen: 'swirl', dens: 0.5, cx: mid, cy: mid, R, spin, arms, cells, accept, phase: rng() * Math.PI * 2, depth: row });
      next.bandRow = row;
      next.hole = { mass, scale, spin, arms, cells, k, collapsed };
      next.fresh = new Uint8Array(N * N); // the hole is drawn over its squares, so none settle
      mem.hole = { mass, scale, spin, arms };
      if (prev) {
        next.region = { r: mid - k, c: mid - k, h: 2 * k + 1, w: 2 * k + 1 };
        next.thumbRect = next.region;
      }
    } else if (kind === 'ring') {
      const pr = mem.ring;
      let N, fixed, ring, spec, top = 0, left = 0, cw = 0;
      if (!prev) {
        const a = rng() * Math.PI * 2;
        N = 3; fixed = new Int8Array(N * N).fill(-1);
        ring = { n: 0, lean: [Math.sin(a), Math.cos(a)], year: 'dense' };
        spec = { gen: 'blobs', dens: 0.5, depth: d };
      } else {
        let core = pic.sol;
        cw = pic.w;
        const merged = cw + 2 > 13; // no room for even a thin ring
        if (merged) { core = down(pic.sol, pic.w, pic.h, 2, rng); cw = Math.ceil(pic.w / 2); }
        // The lean wanders a little each year; one side grows faster.
        const l0 = pr ? pr.lean : [0, 1];
        const a = Math.atan2(l0[0], l0[1]) + (rng() - 0.5) * 0.9;
        const lean = [Math.sin(a), Math.cos(a)];
        // t is how many squares the ring adds across, split between the two
        // sides: two or three for rings 1 to 3 (one each side, and an odd
        // one on the side it leans toward), up to four for rings 4 and 5,
        // then up to six. Short of a merge, a ring is never much more work
        // than the last board: at most 1.6 times its open squares, or 24 more.
        const n = (pr ? pr.n : 0) + 1;
        const most = n <= 3 ? 3 : n <= 5 ? 4 : 6;
        let t = Math.min(2 + Math.floor(rng() * (most - 1)), 13 - cw);
        if (!merged) {
          const before = prev.given ? freeCount(prev.given) : cw * cw;
          while (t > 2 && (cw + t) ** 2 - cw * cw > Math.max(1.6 * before, before + 24)) t--;
        }
        // every side grows at least one square, so the old board never sits on the edge
        const split = (l) => clamp(Math.round(t / 2 - l * t * 0.3 + (rng() - 0.5) * 0.8), 1, t - 1);
        top = split(lean[0]); left = split(lean[1]);
        N = cw + t;
        fixed = new Int8Array(N * N).fill(-1);
        place(fixed, N, core, cw, top, left);
        // Dense and sparse years tend to alternate.
        const year = pr && pr.year === 'dense' ? (rng() < 0.7 ? 'sparse' : 'dense') : (rng() < 0.7 ? 'dense' : 'sparse');
        ring = { n, lean, year, add: t, merged };
        spec = year === 'dense' ? { gen: rng() < 0.5 ? 'blobs' : 'strokes', dens: 0.62 } : { gen: rng() < 0.5 ? 'scatter' : 'strokes', dens: 0.36 };
        spec.depth = d;
      }
      next = makePuzzle(N, N, fixed, rng, spec);
      next.ring = ring;
      next.merged = !!ring.merged;
      mem.ring = { n: ring.n, lean: ring.lean, year: ring.year };
      if (prev) {
        next.region = { r: top, c: left, h: cw, w: cw };
        // a merged core holds the old board two squares to one
        if (ring.merged) next.land = { r: top, c: left, h: pic.h / 2, w: pic.w / 2 };
        // Only the squares you laid last time settle back; older locked
        // squares are already gray and stay put.
        if (!ring.merged && prev.given) {
          next.fresh = new Uint8Array(N * N);
          for (let r = 0; r < prev.h; r++) for (let c = 0; c < prev.w; c++) {
            if (prev.given[r * prev.w + c] < 0) next.fresh[(r + top) * N + c + left] = 1;
          }
        }
      }
    } else {
      // patch (the journey's endless boards): eight tiles around the last
      // picture, shrunk to the 5x5 middle
      const center = resample(pic, 5);
      next = makeWorld(center, rng, 6, prev.gen, ['blobs']);
      // The pictures under this one, newest first: shown as layers below.
      next.layers = [{ w: pic.w, h: pic.h, sol: pic.sol }].concat(prev.layers || []).slice(0, 4);
      ch.view = 'world';
    }
    next.step = kind;
    if (!(ch.met || (ch.met = [])).includes(kind)) { ch.met.push(kind); ch.firstOf = d + 1; }
    (ch.kinds || (ch.kinds = [])).push(kind);
    if (ch.kinds.length > 12) ch.kinds.shift();
    ch.cur = next;
    ch.depth++;
    ch.undo = [];
    if (journey) ch.best = Math.max(ch.best || 0, ch.depth);
  }
  /* The level list: open journey board n (from 1) as a fresh board. */
  function goTo(ch, n) {
    ch.depth = n - 1;
    advance('journey', ch);
  }
  /* Journey boards solved, by number, for the level list. */
  function noteSolved(ch) {
    if (ch !== S.chains.journey) return;
    const done = ch.solved || (ch.solved = []);
    if (!done.includes(ch.depth)) done.push(ch.depth);
  }

  /* A finished board kept to press into the next one, with the boards inside
   * it nested `keep` deep. */
  function trimThumb(t, keep) {
    if (!t) return null;
    const out = { w: t.w, h: t.h, sol: t.sol, thumb: null, thumbAt: t.thumbAt, thumbRect: t.thumbRect, holeCells: t.hole ? t.hole.cells : t.holeCells };
    if (keep > 0) out.thumb = trimThumb(t.thumb, keep - 1);
    return out;
  }

  function isSolved(p) {
    for (let i = 0; i < p.sol.length; i++) {
      const v = p.given[i] >= 0 ? p.given[i] : (p.cells[i] === 1 ? 1 : 0);
      if (v !== p.sol[i]) return false;
    }
    return true;
  }

  /* ---------- mines: filling a square that should stay empty ----------
   * Only fills are checked. Marks never are, like a Minesweeper flag: a
   * wrong mark costs nothing now but can mislead you later. A found mine
   * locks its square empty. Three mines lose that board only: the answer
   * is outlined and Another board deals a new picture at the same zoom.
   * Every Mines board passes the strictest gate: the simple rules finish
   * it in a few rounds, a good share opens at once, and no round leaves
   * only one or two lines to work on. Line logic only ever gains from what
   * you learn, so a careful player always has a square the numbers prove. */
  const MINES = { limit: 3, sizes: [5, 6, 7, 8], pool: ['blobs', 'strokes', 'terrain', 'scatter'] };
  /* Rules (Mines only): how many mines lose a board. One heart icon cycles
   * them, like difficulty icons: outline, half full, full and cracked. */
  const RULES = { relaxed: 5, careful: 3, perfect: 1 }, RULE_ORDER = ['relaxed', 'careful', 'perfect'];
  const RULE_NAME = { relaxed: 'Relaxed', careful: 'Careful', perfect: 'Perfect' };
  function rule() { return RULES[S && S.minesRule] ? S.minesRule : 'careful'; }
  function lim(p) { return (p && p.limit) || MINES.limit; }
  function minesSpec(N, gen) {
    return { gen, dens: 0.5, band: { solver: 'simple', most: N <= 6 ? 4 : 5, lines: 2, thin: 0, opening: 0.4, firstInk: 2, numbers: 3, pick: N === 5 ? 'easiest' : 'middle' } };
  }
  function armMines(p) {
    p.hit = new Uint8Array(p.w * p.h);
    p.hits = 0;
    p.lost = false;
    p.limit = RULES[rule()];
    p.tries = p.tries || 0;
    return p;
  }
  /* Commit a run of picks in order. v is 1 fill, 0 mark, -1 clear. Locked
   * squares and found mines are skipped, and so are squares you marked
   * empty when filling, as a flag guards a square; the first mine ends the
   * run, so a run costs one mine at most; a run that finishes the board
   * stops there. Pure: no drawing, so tests can call it. */
  function commitRun(p, cells, v, stroke) {
    const out = { done: 0, hit: -1, solved: false, lost: false };
    if (p.lost) return out;
    for (const i of cells) {
      if (p.given[i] >= 0 || p.hit[i] || p.cells[i] === v || (v === 1 && p.cells[i] === 0)) continue;
      if (v === 1 && !p.sol[i]) {
        p.hit[i] = 1; p.cells[i] = 0; p.hits++; out.hit = i;
        if (p.hits >= lim(p)) { p.lost = true; out.lost = true; }
        break;
      }
      stroke.push([i, p.cells[i]]);
      p.cells[i] = v;
      out.done++;
      if (v === 1 && isSolved(p)) { out.solved = true; break; }
    }
    return out;
  }
  /* Another board after a loss: the same size, locked squares and zoom, a
   * new picture, no mines hit. */
  function retryMines(ch) {
    const lost = ch.cur, tries = (lost.tries || 0) + 1;
    // a hand-drawn picture is dealt again as it was
    if (lost.gen === 'art') {
      ch.cur = Object.assign(journeyBoard(ch.depth - 1), { tries });
      ch.undo = [];
      return ch.cur;
    }
    const rng = E.mulberry32((ch.seed + (ch.depth - 1) * 7919 + tries * 104729) | 0);
    const gen = pickGen(MINES.pool, ch.depth - 1, lost.gen, rng);
    const next = makePuzzle(lost.w, lost.h, Int8Array.from(lost.given), rng, minesSpec(lost.w, gen));
    next.region = lost.region;
    if (lost.land) next.land = lost.land;
    next.tries = tries;
    armMines(next);
    ch.cur = next;
    ch.undo = [];
    return next;
  }
  /* Saves from before Mines, or with a field missing, still load. */
  function repairMines(p) {
    if (!p || !p.sol) return;
    if (!(p.hit instanceof Uint8Array) || p.hit.length !== p.w * p.h) p.hit = new Uint8Array(p.w * p.h);
    p.hits = p.hit.reduce((a, v) => a + v, 0);
    p.limit = p.limit || MINES.limit;
    p.lost = p.hits >= p.limit;
    p.tries = p.tries || 0;
  }

  /* ---------- saves ---------- */

  function enc(v) { return JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? { $t: x instanceof Uint8Array ? 'u' : 'i', a: Array.from(x) } : x)); }
  function dec(s) { return JSON.parse(s, (k, x) => (x && x.$t ? (x.$t === 'u' ? Uint8Array.from(x.a) : Int8Array.from(x.a)) : x)); }

  let S;
  function load() {
    try { const s = localStorage.getItem(STORE); if (s) S = dec(s); } catch (e) { S = null; }
    if (!S || !S.chains) S = { mode: 'journey', tool: 1, chains: {}, seen: {} };
    S.seen = S.seen || {};
    for (const m of ORDER) if (!S.chains[m]) S.chains[m] = newChain(m);
    if (!MODES[S.mode]) S.mode = 'journey';
    for (const m of ORDER) if (S.chains[m].cur.hit) repairMines(S.chains[m].cur);
  }
  function save() { try { localStorage.setItem(STORE, enc(S)); } catch (e) { /* private mode */ } }
  function newChain(m) {
    const ch = { seed: freshSeed(), depth: 0, cur: null, view: 'world', undo: [] };
    advance(m, ch);
    return ch;
  }

  /* ---------- drawing helpers ---------- */

  function tok(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /* Pixel's locked cell: a filled cell with the last board pressed into it.
   * The cell is ink (it counts as filled); the old board's empty squares
   * show through as a soft shade, and older boards nest the same way. */
  function drawPressed(ctx, x, y, w, h, pic, depth) {
    const cw = w / pic.w, chh = h / pic.h;
    if (cw < 1.2) return;
    // faint, so the square still reads as a locked filled one (or ink, joined)
    ctx.fillStyle = tok('--bg');
    ctx.globalAlpha = Math.max(0.07, 0.15 - depth * 0.03);
    for (let r = 0; r < pic.h; r++) for (let c = 0; c < pic.w; c++) {
      const i = r * pic.w + c;
      if (pic.sol[i]) continue;
      ctx.fillRect(x + c * cw, y + r * chh, cw, chh);
    }
    ctx.globalAlpha = 1;
    if (pic.thumb && pic.thumbAt != null) {
      const r = Math.floor(pic.thumbAt / pic.w), c = pic.thumbAt % pic.w;
      drawPressed(ctx, x + c * cw, y + r * chh, cw, chh, pic.thumb, depth + 1);
    }
  }

  function canvasFor(w, h, res) {
    const cv = document.createElement('canvas');
    const dpr = Math.min(3, window.devicePixelRatio || 1) * (res || 1);
    cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    return { cv, ctx };
  }

  /* Tile geometry shared by the board and the Patch picture, so a tile
   * zoomed into or out of lines up square for square. */
  function geom(cell) {
    return { in: Math.max(1, Math.round(cell * 0.06)), r: Math.max(1, Math.round(cell * 0.14)), seam: Math.max(1, Math.round(cell * 0.035)) };
  }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  /* One 5x5 tile of the Patch picture. state(i) is ink, held, open, sunk or gap. */
  function paintTile(ctx, t, state, well, sh) {
    sh = sh || 1;
    const c = t / 5, g = geom(c);
    const col = { ink: tok('--ink'), held: tok('--held'), open: tok('--tile'), sunk: tok('--sunk') };
    if (well) { ctx.fillStyle = tok('--well'); rr(ctx, 0, 0, t, t, g.r * 1.6); ctx.fill(); }
    for (let i = 0; i < 25; i++) {
      const st = state(i);
      if (st === 'gap') continue;
      const x = (i % 5) * c + g.in, y = Math.floor(i / 5) * c + g.in, w = c - 2 * g.in;
      ctx.save();
      if (st === 'ink') { ctx.shadowColor = tok('--shadow'); ctx.shadowBlur = c * 0.22 * sh; ctx.shadowOffsetY = c * 0.07 * sh; }
      ctx.fillStyle = col[st];
      rr(ctx, x, y, w, w, g.r);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ---------- camera ----------
   * One continuous move. The view on screen is lifted out of the page and
   * held where it is; the next view is laid out at its resting size. Then
   * both travel together, so rect A in the old view always lies exactly on
   * rect B in the new one: zooming out, B is the old board's place in the
   * new board; zooming in, A is a tile and B the board it opens into. */
  /* Slow and gentle (Luke, 2026-11-05: "way too fast", the fade "almost
   * nauseating"). The solve breathes, the finished picture holds two
   * seconds, then one long move that eases in and out evenly. The new board
   * fades in round the picture only once the move is half done, so large
   * squares never sweep across the screen, and its locked squares take over
   * from the picture before it lands. Only Mines keeps any drama. `fade` is
   * every opacity change on a board (the CSS reads it as --fade). Tests set
   * window.__zoomTiming to shorter values. */
  const TIMING = Object.assign({ pause: 2000, zoom: 2600, fade: 800 }, window.__zoomTiming || {});
  const EASE = 'cubic-bezier(.45,0,.55,1)';
  document.documentElement.style.setProperty('--fade', TIMING.fade + 'ms');

  let refocus = false; // the lifted view had focus: the next view takes it
  function liftOld() {
    const el = stage.querySelector('.pz:not(.leaving), .scene:not(.leaving)');
    if (!el) return null;
    // Moving the node below blurs it, so note the focus first.
    if (el.contains(document.activeElement)) refocus = true;
    const box = el.getBoundingClientRect(), sb = stage.getBoundingClientRect();
    // Moving a node restarts its CSS animations, so drop the entrance first.
    // Only Patch's fading overlay canvas is removed: on a board, .fresh marks
    // grid cells, and removing one would shift every later cell out of place.
    el.classList.remove('enter');
    el.querySelectorAll('canvas.fresh').forEach((n) => n.remove());
    el.classList.add('leaving');
    // It stays inside the stage, which clips it, so a zoom never spills over
    // the tabs or the buttons.
    Object.assign(el.style, { position: 'absolute', left: (box.left - sb.left) + 'px', top: (box.top - sb.top) + 'px', width: box.width + 'px', height: box.height + 'px', margin: '0' });
    stage.appendChild(el);
    // Moving the node drops its styles, so a CSS transition would not run
    // and the numbers would vanish in one frame: fade them out here.
    if (!reduced) el.querySelectorAll('.clue').forEach((c) => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: TIMING.fade, easing: 'ease' }));
    stage.querySelectorAll('.world-cap').forEach((c) => c.remove());
    return { el, box };
  }

  /* Clear the stage for a new view, keeping a lifted view that is still travelling. */
  function clearStage() {
    for (const n of Array.from(stage.children)) if (!n.classList.contains('leaving')) n.remove();
  }

  function mapTo(box, X, Y) {
    const s = Y.width / X.width;
    const tx = Y.left - box.left - s * (X.left - box.left);
    const ty = Y.top - box.top - s * (X.top - box.top);
    return `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  function camera(old, A, newEl, B, opts, done) {
    opts = opts || {};
    const finish = () => { if (old) old.el.remove(); if (newEl) newEl.classList.remove('arriving'); done(); };
    if (reduced || !old || !A || !B || !newEl) { finish(); return; }
    stage.classList.add('zooming');
    const nb = newEl.getBoundingClientRect();
    const from = mapTo(nb, B, A), to = mapTo(old.box, A, B);
    newEl.style.transformOrigin = old.el.style.transformOrigin = '0 0';
    // The first pose, set before any frame can show the new view at rest.
    newEl.style.transform = from;
    // Everything heavy (the next board, its squares, its canvases) is built
    // by now; give the browser two frames to lay it out, then move.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const t = { duration: TIMING.zoom, easing: EASE, fill: 'both' };
      const run = newEl.animate([{ transform: from }, { transform: 'none' }], t);
      newEl.style.transform = '';
      old.el.animate([{ transform: 'none' }, { transform: to }], t);
      if (opts.zoomIn) {
        // Zooming in, the world thins out early so the board grows through it.
        old.el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: TIMING.zoom, easing: 'linear', fill: 'both' });
      } else {
        // Zooming out: the new board's open squares and numbers come in round
        // the picture once the move is half done (earlier, they swept across
        // the screen at several times their size), then its locked squares
        // take over from the picture before it lands.
        const at = (f, fn) => setTimeout(fn, TIMING.zoom * f);
        at(0.45, () => { newEl.classList.add('arriving-seed'); newEl.classList.remove('arriving'); });
        at(0.68, () => newEl.classList.remove('arriving-seed'));
        old.el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.68 }, { opacity: 0, offset: 0.95 }, { opacity: 0 }], { duration: TIMING.zoom, easing: 'linear', fill: 'both' });
      }
      run.finished.then(() => {
        newEl.classList.remove('arriving', 'arriving-seed');
        run.cancel(); old.el.remove(); stage.classList.remove('zooming'); done();
      });
    }));
  }

  /* ---------- puzzle view ---------- */

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  let view = null; // { p, el, grid, cellEls, rowEls, colEls, clues, cursor, onSolved }
  let busy = false;

  function fitCell(w, h, maxR, maxC) {
    // 8 px spare across, 12 down: the cursor ring and the rounded backing
    // reach a little past the last row, and must clear the bar.
    const W = stage.clientWidth - 8, H = stage.clientHeight - 12;
    const sizes = (cell) => {
      const f = Math.max(10, Math.min(15, cell * 0.42));
      return { cell, f, cw: Math.ceil(maxR * f * 0.95 + f * 0.9), ch: Math.ceil(maxC * f * 1.2 + f * 0.6) };
    };
    let m = sizes(32);
    for (let k = 0; k < 3; k++) m = sizes(Math.max(12, Math.min(80, Math.floor(Math.min((W - m.cw) / w, (H - m.ch) / h)))));
    // The numbers grow with the squares, so the last guess can overshoot.
    while (m.cell > 12 && (m.cw + w * m.cell > W || m.ch + h * m.cell > H)) m = sizes(m.cell - 1);
    return m;
  }

  function renderPuzzle(p, onSolved, opts) {
    opts = opts || {};
    const hadFocus = stage.contains(document.activeElement) || refocus;
    refocus = false;
    clearStage();
    const clues = E.cluesOf(p.sol, p.w, p.h);
    const maxR = Math.max(1, ...clues.rows.map((x) => x.length || 1));
    const maxC = Math.max(1, ...clues.cols.map((x) => x.length || 1));
    const m = fitCell(p.w, p.h, maxR, maxC);
    const el = document.createElement('div');
    el.className = 'pz' + (opts.enter ? ' enter' : '') + (opts.arriving ? ' arriving' : '');
    el.style.setProperty('--cell', m.cell + 'px');
    el.style.setProperty('--f', m.f + 'px');
    el.style.setProperty('--cw', m.cw + 'px');
    el.style.setProperty('--ch', m.ch + 'px');
    const g = geom(m.cell);
    el.style.setProperty('--in', g.in + 'px');
    el.style.setProperty('--r', g.r + 'px');
    el.style.setProperty('--seam', g.seam + 'px');
    el.style.gridTemplateColumns = `var(--cw) repeat(${p.w}, var(--cell))`;
    el.style.gridTemplateRows = `var(--ch) repeat(${p.h}, var(--cell))`;
    el.setAttribute('role', 'grid');
    el.tabIndex = 0;
    el.setAttribute('aria-label', boardLabel(p));
    el.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight Space X Z');
    // Keyboard focus shows the square cursor at once, so the board needs no ring.
    el.addEventListener('focus', () => {
      if (!keyNav || !view || view.el !== el) return;
      if (view.cur < 0) { const i = p.given.findIndex((v) => v < 0); view.cur = i < 0 ? 0 : i; }
      placeCursor(true);
    });
    el.appendChild(document.createElement('div'));
    // Backing under the tiles: page-colored while you play, so nothing shows
    // through the seams mid-zoom; it becomes the well when the board is solved.
    const back = document.createElement('div');
    back.className = 'pz-bg';
    back.style.left = 'var(--cw)';
    back.style.top = 'var(--ch)';
    back.style.width = `calc(${p.w} * var(--cell))`;
    back.style.height = `calc(${p.h} * var(--cell))`;
    el.appendChild(back);
    const colEls = [], rowEls = [], cellEls = [];
    for (let c = 0; c < p.w; c++) {
      const d = document.createElement('div');
      d.className = 'clue cc';
      (clues.cols[c].length ? clues.cols[c] : [0]).forEach((n) => { const s = document.createElement('span'); s.textContent = n; d.appendChild(s); });
      el.appendChild(d); colEls.push(d);
    }
    for (let r = 0; r < p.h; r++) {
      const d = document.createElement('div');
      d.className = 'clue rc';
      (clues.rows[r].length ? clues.rows[r] : [0]).forEach((n) => { const s = document.createElement('span'); s.textContent = n; d.appendChild(s); });
      el.appendChild(d); rowEls.push(d);
      for (let c = 0; c < p.w; c++) {
        const i = r * p.w + c;
        const x = document.createElement('div');
        x.className = 'cell';
        x.dataset.i = i;
        if (c % 5 === 4 && c < p.w - 1) x.classList.add('g5r');
        if (c % 5 === 0 && c > 0) x.classList.add('g5l');
        if (r % 5 === 4 && r < p.h - 1) x.classList.add('g5b');
        if (r % 5 === 0 && r > 0) x.classList.add('g5t');
        if (p.given[i] >= 0) {
          x.classList.add('given');
          const g = p.region;
          const inRegion = g && r >= g.r && r < g.r + g.h && c >= g.c && c < g.c + g.w;
          if (p.fresh ? p.fresh[i] : inRegion) x.classList.add('fresh');
        }
        el.appendChild(x); cellEls.push(x);
      }
    }
    if (p.region && !p.hole && p.thumbAt == null) {
      const b = document.createElement('div');
      b.className = 'region';
      b.style.left = `calc(var(--cw) + ${p.region.c} * var(--cell))`;
      b.style.top = `calc(var(--ch) + ${p.region.r} * var(--cell))`;
      b.style.width = `calc(${p.region.w} * var(--cell))`;
      b.style.height = `calc(${p.region.h} * var(--cell))`;
      el.appendChild(b);
    }
    const cursor = document.createElement('div');
    cursor.className = 'cursor';
    el.appendChild(cursor);
    stage.appendChild(el);
    if (p.thumb && p.thumbAt != null) {
      const side = m.cell - 2 * g.in;
      const { cv, ctx } = canvasFor(side, side);
      rr(ctx, 0, 0, side, side, g.r);
      ctx.clip();
      drawPressed(ctx, 0, 0, side, side, p.thumb, 0);
      cv.className = 'thumb';
      cellEls[p.thumbAt].appendChild(cv);
      cellEls[p.thumbAt].classList.add('has-thumb');
    }
    if (p.hole) { el.appendChild(holeCanvas(p, m.cell)); pullCells(p, cellEls, m.cell); }
    if (p.grav) { el.appendChild(starCanvas(p, m.cell)); gravCells(p, cellEls, m.cell); }
    view = { p, el, cellEls, rowEls, colEls, clues, cursor, cur: view && view.p === p ? view.cur : -1, onSolved, region: el.querySelector('.region') };
    for (let i = 0; i < cellEls.length; i++) paintCell(i);
    paintJoined();
    for (let r = 0; r < p.h; r++) paintClue(r, true);
    for (let c = 0; c < p.w; c++) paintClue(c, false);
    placeCursor();
    if (isSolved(p)) el.classList.add('solved');
    if (p.lost) showLost();
    if (hadFocus) el.focus({ preventScroll: true });
  }
  function boardLabel(p) { return `${p.w} by ${p.h} board` + (p.hit ? `, mines hit ${p.hits} of ${lim(p)}` : ''); }

  /* The hole: its squares drawn as one hollow, inset like tiles only where
   * it meets the board and deepest at the middle. Every board that fell in
   * shows inside it, faint, its own hole holding the ones before. It sits
   * over its own locked squares and takes no clicks. */
  /* The hole: a round well under the board, darkest at the middle with a soft
   * rim, and faint dust on spiral arms that turns slowly the chain's way
   * round (denser as mass grows). Its own squares are locked empty and draw
   * nothing, so the well shows through them; it never takes a click. The
   * radius reaches half a square past the farthest void square's center,
   * so it reads as a circle, not the plus or diamond of squares under it. */
  function holeReachPx(p, cell) {
    const mid = (p.w - 1) / 2;
    let far = 0;
    for (const i of p.hole.cells) far = Math.max(far, Math.hypot(Math.floor(i / p.w) - mid, (i % p.w) - mid));
    return (far + 0.55) * cell;
  }
  function holeCanvas(p, cell) {
    const rho = holeReachPx(p, cell), pad = 4, side = Math.ceil(2 * (rho + pad)), c = side / 2;
    const { cv, ctx } = canvasFor(side, side);
    const grad = ctx.createRadialGradient(c, c, 0, c, c, rho);
    grad.addColorStop(0, tok('--void'));
    grad.addColorStop(0.82, tok('--well'));
    grad.addColorStop(1, tok('--well'));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(c, c, rho, 0, Math.PI * 2); ctx.fill();
    // dust on spiral arms, thinning outward; more of it as mass grows
    const h = p.hole, rng = E.mulberry32((h.mass * 7919 + h.arms * 31 + 7) | 0);
    const n = Math.min(260, 40 + Math.round(h.mass * 0.9));
    ctx.fillStyle = tok('--tile-hi');
    for (let k = 0; k < n; k++) {
      const u = Math.pow(rng(), 0.7), r = rho * (0.12 + 0.82 * u);
      const arm = (k % h.arms) * (Math.PI * 2 / h.arms);
      const th = arm + h.spin * 2.4 * Math.log(1 + 3 * u) + (rng() - 0.5) * 0.5;
      ctx.globalAlpha = 0.25 + 0.55 * (1 - u);
      const d = Math.max(1, cell * 0.05 * (1.2 - u));
      ctx.beginPath(); ctx.arc(c + r * Math.cos(th), c + r * Math.sin(th), d, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // a faint rim
    ctx.strokeStyle = tok('--mark'); ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(c, c, rho - 0.75, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    const mid = (p.w - 1) / 2;
    cv.className = 'hole ' + (h.spin < 0 ? 'ccw' : 'cw');
    cv.style.left = `calc(var(--cw) + ${mid + 0.5} * var(--cell) - ${c}px)`;
    cv.style.top = `calc(var(--ch) + ${mid + 0.5} * var(--cell) - ${c}px)`;
    cv.setAttribute('aria-hidden', 'true');
    return cv;
  }
  /* Squares near the hole lean toward it, shrink a little and turn with its
   * spin, more the closer they are, and drift in a slow wave that goes round
   * the hole. Only the drawing moves; each square keeps its place for taps. */
  function pullCells(p, cellEls, cell) {
    const mid = (p.w - 1) / 2, edge = holeReachPx(p, cell) / cell, span = 1.7;
    const inHole = new Set(p.hole.cells), spin = p.hole.spin;
    for (let i = 0; i < cellEls.length; i++) {
      if (inHole.has(i)) continue;
      const r = Math.floor(i / p.w), c = i % p.w, d = Math.hypot(r - mid, c - mid);
      const t = Math.max(0, Math.min(1, (edge + span - d) / span));
      if (!t) continue;
      const x = cellEls[i].style;
      x.setProperty('--dx', ((mid - c) / d).toFixed(3));
      x.setProperty('--dy', ((mid - r) / d).toFixed(3));
      x.setProperty('--a0', (t * cell * 0.05).toFixed(1) + 'px');
      x.setProperty('--a1', (t * cell * 0.13).toFixed(1) + 'px');
      x.setProperty('--r0', (spin * t * 2).toFixed(1) + 'deg');
      x.setProperty('--r1', (spin * t * 7).toFixed(1) + 'deg');
      x.setProperty('--s0', (1 - t * 0.07).toFixed(3));
      x.setProperty('--s1', (1 - t * 0.19).toFixed(3));
      // the wave goes round the hole the spin's way
      const ang = Math.atan2(r - mid, c - mid);
      x.setProperty('--dl', (-((spin * ang / (Math.PI * 2)) + 1) % 1 * 5).toFixed(2) + 's');
      cellEls[i].classList.add('pull');
    }
  }

  /* Gravity's star: a dark core in the middle square with a bright rim,
   * a lensing halo round it and dust on a slow spiral. Every level makes
   * the core a little bigger, the halo wider and brighter and the dust
   * thicker. It takes no clicks; its own square is locked and counts as
   * filled. */
  function starReach(level) { return Math.min(0.75 + 0.42 * level, 3.4); }
  function starCanvas(p, cell) {
    const g = p.grav, L = g.level, reach = starReach(L) * cell;
    const side = Math.ceil(2 * reach + 8), c = side / 2;
    const { cv, ctx } = canvasFor(side, side);
    const core = cell * Math.min(0.26 + 0.035 * L, 0.46);
    // lensing halo: light bent round the star, a soft ring outside the core
    const halo = ctx.createRadialGradient(c, c, core, c, c, reach);
    halo.addColorStop(0, tok('--star-glow'));
    halo.addColorStop(Math.min(0.5, 0.18 + 0.03 * L), tok('--star-halo'));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(c, c, reach, 0, Math.PI * 2); ctx.fill();
    // dust on two spiral arms, more of it every level
    const rng = E.mulberry32((g.mass * 131 + L * 17 + 3) | 0);
    const n = Math.min(320, 18 + L * 26 + Math.round(g.mass * 0.4));
    ctx.fillStyle = tok('--star-dust');
    for (let k = 0; k < n; k++) {
      const u = Math.pow(rng(), 0.8), r = core * 1.25 + (reach - core * 1.25) * u;
      const th = (k % 2) * Math.PI + g.spin * 3.2 * Math.log(1 + 2.5 * u) + (rng() - 0.5) * 0.7;
      ctx.globalAlpha = 0.2 + 0.6 * (1 - u);
      const dot = Math.max(0.8, cell * 0.035 * (1.3 - u));
      ctx.beginPath(); ctx.arc(c + r * Math.cos(th), c + r * Math.sin(th), dot, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // the core and its photon rim
    ctx.fillStyle = tok('--star-core');
    ctx.beginPath(); ctx.arc(c, c, core, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = tok('--star-rim'); ctx.lineWidth = Math.max(1, cell * (0.03 + 0.006 * Math.min(L, 8)));
    ctx.beginPath(); ctx.arc(c, c, core + ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
    // Centered on the star's own square. On an even board (Rocket, 10×10)
    // that square sits just off the middle point; centering on the middle
    // put the star between four squares, three of them open and covering it.
    const sr = Math.floor(g.at / p.w), sc = g.at % p.w;
    cv.className = 'star ' + (g.spin < 0 ? 'ccw' : 'cw');
    cv.style.left = `calc(var(--cw) + ${sc + 0.5} * var(--cell) - ${c}px)`;
    cv.style.top = `calc(var(--ch) + ${sr + 0.5} * var(--cell) - ${c}px)`;
    cv.style.setProperty('--spin', Math.max(12, 70 / (1 + 0.5 * L)).toFixed(1) + 's');
    cv.setAttribute('aria-hidden', 'true');
    return cv;
  }
  /* The star's pull: squares lean toward it, shrink and turn its way, in
   * the same slow wave as the hole. Both the reach and the strength grow
   * with the level, so a heavy star bends the whole board. Only the
   * drawing moves; each square keeps its place for taps. */
  function gravCells(p, cellEls, cell) {
    const L = p.grav.level, spin = p.grav.spin;
    // measured from the star's square, which is off the middle point on an even board
    const sr = Math.floor(p.grav.at / p.w), sc = p.grav.at % p.w;
    const edge = 0.5, span = Math.min(1.1 + 0.6 * L, p.w), k = Math.min(1, 0.35 + 0.13 * L);
    for (let i = 0; i < cellEls.length; i++) {
      if (i === p.grav.at) continue;
      const r = Math.floor(i / p.w), c = i % p.w, d = Math.hypot(r - sr, c - sc);
      const t = k * Math.max(0, Math.min(1, (edge + span - d) / span)) ** 1.4;
      if (t < 0.02) continue;
      const x = cellEls[i].style;
      x.setProperty('--dx', ((sc - c) / d).toFixed(3));
      x.setProperty('--dy', ((sr - r) / d).toFixed(3));
      x.setProperty('--a0', (t * cell * 0.06).toFixed(1) + 'px');
      x.setProperty('--a1', (t * cell * 0.15).toFixed(1) + 'px');
      x.setProperty('--r0', (spin * t * 3).toFixed(1) + 'deg');
      x.setProperty('--r1', (spin * t * 9).toFixed(1) + 'deg');
      x.setProperty('--s0', (1 - t * 0.06).toFixed(3));
      x.setProperty('--s1', (1 - t * 0.2).toFixed(3));
      const ang = Math.atan2(r - sr, c - sc);
      x.setProperty('--dl', (-((spin * ang / (Math.PI * 2)) + 1) % 1 * 4).toFixed(2) + 's');
      cellEls[i].classList.add('pull');
    }
    cellEls[p.grav.at].classList.add('star-sq');
  }

  function val(p, i) { return p.given[i] >= 0 ? p.given[i] : p.cells[i]; }
  function isHit(p, i) { return !!(p.hit && p.hit[i]); }
  const X_SVG = '<svg class="x" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>';
  const ANOTHER_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="7" width="13" height="13" rx="2"/><path d="M8 4h10a2 2 0 0 1 2 2v10"/></svg>';
  const LOST = 'This board is lost. Choose the button under it to play again.';
  const HEART = 'M12 20.2s-7.2-4.5-7.2-10.1A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.2 2.7c0 5.6-7.2 10.1-7.2 10.1Z';
  const RULE_SVG = {
    relaxed: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="${HEART}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    careful: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><clipPath id="heart-half"><rect width="12" height="24"/></clipPath><path d="${HEART}" fill="currentColor" clip-path="url(#heart-half)"/><path d="${HEART}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    perfect: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="${HEART}" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12.6 7.8 10.9 11l2.4 1.7-1.9 3.6" fill="none" stroke="var(--bg)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };

  /* Screen-reader messages. Clearing first lets the same message be read again. */
  let sayT = 0;
  function say(msg) {
    const l = $('live');
    clearTimeout(sayT);
    l.textContent = '';
    sayT = setTimeout(() => { l.textContent = msg; }, 60);
  }
  /* A message for everyone, not only screen readers: shown for a moment in
   * the line under the bar, for a press that would otherwise seem to do
   * nothing. */
  let noteT = 0;
  function note(msg) {
    say(msg);
    const k = $('keys');
    $('keys-text').textContent = msg;
    k.classList.add('note');
    clearTimeout(noteT);
    noteT = setTimeout(() => { k.classList.remove('note'); hud(); }, 2600);
  }
  function where(p, i) { return `row ${Math.floor(i / p.w) + 1}, column ${(i % p.w) + 1}`; }
  function cellWord(p, i) {
    if (p.given[i] >= 0) return p.given[i] ? 'locked, filled' : 'locked, empty';
    if (isHit(p, i)) return 'mine';
    return p.cells[i] === 1 ? 'filled' : p.cells[i] === 0 ? 'marked empty' : 'open';
  }

  function paintCell(i) {
    const p = view.p, v = val(p, i), x = view.cellEls[i], hit = isHit(p, i);
    x.classList.toggle('ink', v === 1);
    x.classList.toggle('mark', v === 0 && p.given[i] < 0 && !hit);
    x.classList.toggle('hit', hit);
    if (hit && !x.querySelector('.x')) x.insertAdjacentHTML('beforeend', X_SVG);
    x.classList.toggle('answer', !!p.lost && p.sol[i] === 1 && p.given[i] < 0 && p.cells[i] !== 1);
  }

  function paintClue(k, isRow) {
    const p = view.p;
    const line = isRow ? Array.from({ length: p.w }, (_, c) => val(p, k * p.w + c)) : Array.from({ length: p.h }, (_, r) => val(p, r * p.w + k));
    const clue = isRow ? view.clues.rows[k] : view.clues.cols[k];
    const el = isRow ? view.rowEls[k] : view.colEls[k];
    const spans = el.children;
    if (!clue.length) { spans[0].classList.toggle('done', !line.includes(1)); return; }
    const done = E.doneClues(line, clue);
    for (let j = 0; j < spans.length; j++) spans[j].classList.toggle('done', !!done[j]);
  }
  function paintAt(i) { paintCell(i); paintClue(Math.floor(i / view.p.w), true); paintClue(i % view.p.w, false); paintJoined(); }

  /* Locked filled squares that sit in one unbroken run, along a row or a
   * column, with at least one square you filled get .joined. */
  function paintJoined() {
    const p = view.p, w = p.w, h = p.h, on = new Uint8Array(w * h);
    const ink = (i) => val(p, i) === 1, mine = (i) => p.given[i] < 0 && p.cells[i] === 1;
    const scan = (idx, n) => {
      let run = [];
      const close = () => { if (run.some(mine)) for (const i of run) if (p.given[i] === 1) on[i] = 1; run = []; };
      for (let k = 0; k < n; k++) { const i = idx(k); if (ink(i)) run.push(i); else close(); }
      close();
    };
    for (let r = 0; r < h; r++) scan((c) => r * w + c, w);
    for (let c = 0; c < w; c++) scan((r) => r * w + c, h);
    for (let i = 0; i < w * h; i++) view.cellEls[i].classList.toggle('joined', !!on[i]);
  }

  /* Locked squares and found mines never change. */
  function setCell(i, v, stroke) {
    const p = view.p;
    if (p.given[i] >= 0 || isHit(p, i) || p.cells[i] === v) return;
    stroke.push([i, p.cells[i]]);
    p.cells[i] = v;
    if (v === 1) lastLaid = i;
    paintAt(i);
  }

  function pushUndo(item) {
    const u = chain().undo;
    u.push(item);
    if (u.length > 200) u.shift();
  }
  function endStroke(stroke) {
    if (!stroke.length) return;
    pushUndo(stroke);
    save();
    syncBar();
    if (isSolved(view.p)) solved();
  }

  /* A found mine never changes again, so older moves on its square are
   * dropped, and moves left with nothing in them go too. Undo then always
   * takes back something you can see. */
  function dropFromUndo(i) {
    const u = chain().undo;
    for (let k = u.length - 1; k >= 0; k--) {
      if (!Array.isArray(u[k])) continue;
      u[k] = u[k].filter(([j]) => j !== i);
      if (!u[k].length) u.splice(k, 1);
    }
  }
  /* Saves from before this kept a marker on the stack at each mine. */
  function dropMarkers(u) { while (u.length && !Array.isArray(u[u.length - 1]) && u[u.length - 1].mine != null) u.pop(); }

  /* What Undo and Clear board would do right now, so the bar can say. */
  function has(p) { return !!p && p.cells.some((v, i) => v !== -1 && p.given[i] < 0 && !isHit(p, i)); }
  function onPlate() { const ch = chain(); return ch.cur.kind === 'world' && ch.view === 'world'; }
  function boardMarks() {
    if (onPlate()) return chain().cur.tiles.some((t) => !t.done && !t.center && has(t.puzzle));
    return view && !view.p.lost ? has(view.p) : false;
  }
  function canUndo() {
    const u = chain().undo;
    dropMarkers(u);
    const top = u[u.length - 1];
    if (!top) return false;
    if (onPlate()) return !Array.isArray(top) && !!top.tiles;
    if (view && view.p.lost) return false;
    return Array.isArray(top);
  }
  function syncBar() {
    $('undo-btn').setAttribute('aria-disabled', String(!canUndo()));
    $('reset-btn').setAttribute('aria-disabled', String(!boardMarks()));
  }

  /* Undo takes back fills and marks, never a found mine: the mine stays
   * and the moves around it come back. A Clear tiles on the Patch plate
   * comes back whole. */
  function undo(fromButton) {
    if (busy) return;
    const ch = chain();
    if (view && view.p.lost && view.el.isConnected) { if (fromButton === true) note(LOST); else say(LOST); return; }
    if (!canUndo()) { if (fromButton === true) note('Nothing to undo.'); return; }
    const top = ch.undo.pop();
    if (!Array.isArray(top)) {
      let n = 0;
      for (const [k, cells] of top.tiles) {
        const t = ch.cur.tiles[k];
        if (t && t.puzzle && !t.done) { t.puzzle.cells.set(cells); n++; }
      }
      save(); render();
      say(`Marks back on ${n} ${n === 1 ? 'tile' : 'tiles'}.`);
      return;
    }
    if (!view) return;
    let n = 0;
    for (let k = top.length - 1; k >= 0; k--) {
      const [i, before] = top[k];
      if (isHit(view.p, i)) continue;
      view.p.cells[i] = before;
      paintAt(i);
      n++;
    }
    save(); syncBar();
    say(`Undid ${n} ${n === 1 ? 'square' : 'squares'}.` + (view.p.hits ? ' Found mines stay.' : ''));
  }

  /* A solve breathes: the picture's squares swell a little and settle in a
   * slow ring that spreads from the last square laid (after Hexsweeper's win
   * ripple, but soft enough that neighbors never overlap). */
  function ripple(from) {
    if (reduced || !view) return;
    const p = view.p, r0 = from >= 0 ? Math.floor(from / p.w) : (p.h - 1) / 2, c0 = from >= 0 ? from % p.w : (p.w - 1) / 2;
    view.cellEls.forEach((c, i) => {
      if (!c.classList.contains('ink')) return;
      const d = Math.hypot(Math.floor(i / p.w) - r0, (i % p.w) - c0);
      c.animate([{ scale: 1 }, { scale: 1.05, offset: 0.4 }, { scale: 1 }], { duration: 1000, delay: 60 + d * 70, easing: 'ease-in-out' });
    });
  }
  let lastLaid = -1;
  function solved() {
    busy = true;
    view.el.classList.add('solved');
    ripple(lastLaid);
    const p = view.p;
    say(!p.hit ? 'Solved.' : p.hits ? `Solved with ${p.hits} ${p.hits === 1 ? 'mine' : 'mines'} hit.` : 'Solved, no mines hit.');
    // a pause to look at the solved board before anything moves
    setTimeout(() => { const f = view.onSolved; f(); }, reduced ? Math.min(1200, TIMING.pause) : TIMING.pause);
  }

  function gridRect() {
    const a = view.cellEls[0].getBoundingClientRect(), b = view.cellEls[view.cellEls.length - 1].getBoundingClientRect();
    return new DOMRect(a.left, a.top, b.right - a.left, b.bottom - a.top);
  }

  /* ---------- mines on screen ---------- */

  /* Commit a run of picks and show what happened. */
  function applyRun(cells, v, touch) {
    const p = view.p, st = [];
    const out = commitRun(p, cells, v, st);
    for (const i of cells) paintAt(i);
    if (st.length) pushUndo(st);
    if (out.hit >= 0) {
      dropFromUndo(out.hit);
      const x = view.cellEls[out.hit];
      x.classList.add('now');
      setTimeout(() => x.classList.remove('now'), 400);
      if (!reduced) boom(out.hit);
      if (touch && navigator.vibrate) navigator.vibrate(30);
      view.el.setAttribute('aria-label', boardLabel(p));
    }
    save();
    hud();
    if (out.hit >= 0) {
      const at = out.done ? `Filled ${out.done}, then a mine at ${where(p, out.hit)}.` : `Mine at ${where(p, out.hit)}.`;
      if (out.lost) {
        say(`${at} ${lim(p) === 1 ? 'One mine' : lim(p) + ' mines'}: this board is lost. The answer is outlined. You stay at ${leadText(chain())}.`);
        showLost(true);
        syncBar();
      } else say(`${at}${out.done ? '' : ' It stays empty.'} Mines hit: ${p.hits} of ${lim(p)}.`);
      return;
    }
    if (out.solved) { lastLaid = cells[cells.length - 1]; solved(); }
  }

  /* A mine going off, after Hexsweeper Infinite's blast, kept to a board
   * you go on playing. For 160 ms the squares round it are drawn in (the
   * charge); then a shock front rolls out across the board at about 13
   * squares a second, pushing each square out and lifting it as it passes,
   * and the squares touching the mine are kicked on a damped spring and
   * turn. Everything is back at rest by 1.3 s, so no square is ever out of
   * place for long. Over that: a core glow, a split-color halo, two shock
   * rings, the mine's own tile breaking into four shards, sparks, smoke
   * and a short decaying shake of the board. Only the drawing moves.
   * Reduced motion skips all of it and shows only the scorched square. */
  const BLAST = { dur: 1300, charge: 160, speed: 0.0135 };
  function boom(i) {
    const p = view.p, el = view.el, c = view.cellEls[i], u = c.offsetWidth;
    const ex = c.offsetLeft + u / 2, ey = c.offsetTop + u / 2;
    const r0 = Math.floor(i / p.w), c0 = i % p.w;
    const rnd = E.mulberry32((i * 7919 + p.hits * 31) | 0);
    const { dur, charge, speed } = BLAST, STEPS = 44;
    for (let k = 0; k < view.cellEls.length; k++) {
      if (k === i) continue;
      const dr = Math.floor(k / p.w) - r0, dc = (k % p.w) - c0, d = Math.hypot(dr, dc), ux = dc / d, uy = dr / d;
      const lens = 1 / (1 + (d / 2.6) ** 2);
      const kick = d < 1.6 ? (0.3 + 0.12 * rnd()) * (1.75 - d) : 0;
      const spin = (rnd() - 0.5) * (kick ? 46 : 12);
      const frames = [];
      for (let s = 0; s <= STEPS; s++) {
        const t = (s / STEPS) * dur;
        let push = 0, sc = 1, rot = 0;
        if (t < charge) {
          const q = t / charge;
          push = -0.2 * q * q * lens;
          sc = 1 - 0.08 * q * lens;
        } else {
          const e = d - (t - charge + 20) * speed, near = Math.exp(-(e * e) / 1.1);
          const hit = Math.min(1, (t - charge) / 110);
          push = 0.46 * near * hit * (0.45 + 0.55 * lens);
          sc = 1 + 0.15 * near * hit;
          rot = spin * 0.25 * near;
          if (kick) {
            const tk = (t - charge) / 1000;
            push += kick * Math.exp(-tk * 5.5) * Math.sin(tk * 15);
            rot += spin * Math.exp(-tk * 4.2) * Math.sin(tk * 11);
          }
        }
        if (s === STEPS) { push = 0; sc = 1; rot = 0; }
        frames.push({ translate: `${(ux * push * u).toFixed(2)}px ${(uy * push * u).toFixed(2)}px`, rotate: `${rot.toFixed(2)}deg`, scale: sc.toFixed(3) });
      }
      view.cellEls[k].animate(frames, { duration: dur, easing: 'linear' });
    }
    const fx = document.createElement('div');
    fx.className = 'boom';
    fx.setAttribute('aria-hidden', 'true');
    fx.style.setProperty('--u', u + 'px');
    fx.style.left = ex + 'px';
    fx.style.top = ey + 'px';
    let html = '<i class="flash"></i>';
    // the mine's own tile breaks into four triangles, from its middle to each edge
    const tri = ['50% 50%, 0 0, 100% 0', '50% 50%, 100% 0, 100% 100%', '50% 50%, 100% 100%, 0 100%', '50% 50%, 0 100%, 0 0'];
    tri.forEach((poly, k) => {
      const a = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][k] + (rnd() - 0.5) * 0.5, v = 0.6 + rnd() * 0.45;
      html += `<i class="tri" style="clip-path:polygon(${poly});--tx:${(Math.cos(a) * v).toFixed(2)};--ty:${(Math.sin(a) * v).toFixed(2)};--rot:${Math.round((rnd() - 0.5) * 420)}deg"></i>`;
    });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + rnd() * 0.6, d = 0.6 + rnd() * 0.7;
      html += `<i class="shard" style="--tx:${(Math.cos(a) * d).toFixed(2)};--ty:${(Math.sin(a) * d).toFixed(2)};--rot:${Math.round((rnd() - 0.5) * 540)}deg"></i>`;
    }
    for (let k = 0; k < 16; k++) {
      const a = rnd() * Math.PI * 2, d = 1 + rnd() * 1.6;
      html += `<i class="spark" style="--tx:${(Math.cos(a) * d).toFixed(2)};--ty:${(Math.sin(a) * d).toFixed(2)};--dl:${Math.round(charge + rnd() * 60)}ms"></i>`;
    }
    for (let k = 0; k < 3; k++) html += `<i class="smoke" style="--tx:${((rnd() - 0.5) * 0.6).toFixed(2)};--dl:${220 + k * 90}ms"></i>`;
    fx.innerHTML = html;
    el.appendChild(fx);
    blastRings(el, ex, ey, u, p);
    // the shake starts at the shock and dies away
    const shake = [];
    for (let s = 0, a = Math.max(6, u * 0.32); s <= 10; s++, a *= 0.7) shake.push({ translate: s === 10 ? '0 0' : `${((rnd() - 0.5) * a).toFixed(1)}px ${((rnd() - 0.5) * a).toFixed(1)}px` });
    el.animate(shake, { duration: 460, delay: charge, easing: 'linear' });
    setTimeout(() => fx.remove(), 1600);
  }
  /* The blast's light, on a canvas over the board: a core glow that swells
   * through the charge and fades, a blue and a pink halo a pixel and a half
   * apart, and the shock front as two rings, the inner at 0.72 of the
   * outer, thinning and fading as they spread. */
  function blastRings(el, ex, ey, u, p) {
    const W = el.offsetWidth, H = el.offsetHeight;
    const { cv, ctx } = canvasFor(W, H);
    cv.className = 'blast';
    el.appendChild(cv);
    const far = Math.max(Math.hypot(ex, ey), Math.hypot(W - ex, ey), Math.hypot(ex, H - ey), Math.hypot(W - ex, H - ey));
    const fg = tok('--blast'), edge = tok('--blast-edge'), t0 = performance.now();
    const frame = (now) => {
      const t = now - t0;
      ctx.clearRect(0, 0, W, H);
      if (t < 900) {
        const grow = Math.min(1, t / BLAST.charge), out = t < BLAST.charge ? 1 : Math.max(0, 1 - (t - BLAST.charge) / 700);
        const R = u * (0.4 + 1.6 * grow);
        const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, R);
        g.addColorStop(0, fg); g.addColorStop(0.35, edge); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = out; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(ex, ey, R, 0, Math.PI * 2); ctx.fill();
      }
      if (t > 60 && t < 760) {
        const q = (t - 60) / 700, R = u * (1.1 + 3.6 * q);
        ctx.lineWidth = Math.max(1, u * 0.12 * (1 - q));
        ctx.globalAlpha = 0.35 * (1 - q);
        ctx.strokeStyle = 'rgb(70, 140, 255)'; ctx.beginPath(); ctx.arc(ex - 1.5, ey, R, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgb(255, 80, 170)'; ctx.beginPath(); ctx.arc(ex + 1.5, ey, R, 0, Math.PI * 2); ctx.stroke();
      }
      const waveR = Math.max(0, (t - BLAST.charge + 20) * BLAST.speed * u);
      const a = 1 - waveR / (far * 1.05);
      if (t > BLAST.charge && a > 0) {
        ctx.shadowColor = edge; ctx.shadowBlur = u * 0.5;
        ctx.strokeStyle = fg;
        for (const [k, m] of [[1, 1], [0.72, 0.5]]) {
          ctx.globalAlpha = 0.9 * a * m; ctx.lineWidth = Math.max(1, u * 0.2 * a * m);
          ctx.beginPath(); ctx.arc(ex, ey, waveR * k, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      if (t < BLAST.dur && cv.isConnected) requestAnimationFrame(frame); else cv.remove();
    };
    requestAnimationFrame(frame);
  }

  /* A lost board: the answer squares you had not filled are outlined, and
   * Another board deals a new picture at the same zoom. It ignores presses
   * for 600 ms after the loss, so a held key or a double tap cannot skip
   * the reveal. */
  let lostAt = 0;
  function showLost(fresh) {
    if (!view) return;
    view.el.classList.add('lost');
    for (let i = 0; i < view.cellEls.length; i++) paintCell(i);
    paintJoined();
    stage.querySelectorAll('.lost-cap').forEach((n) => n.remove());
    const cap = document.createElement('div');
    cap.className = 'lost-cap';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb';
    b.id = 'another-btn';
    b.innerHTML = ANOTHER_SVG + `<span class="tb-label">${view.p.gen === 'art' ? 'Try again' : 'Another board'}</span>`;
    b.addEventListener('click', anotherBoard);
    cap.append(b);
    stage.appendChild(cap);
    if (fresh) lostAt = performance.now();
  }
  function anotherBoard() {
    if (busy || performance.now() - lostAt < 600) return;
    const ch = chain();
    if (!ch.cur.lost) return;
    const p = retryMines(ch);
    save();
    render({ enter: true });
    say(`${p.gen === 'art' ? 'Same picture, fresh board' : `New ${p.w} by ${p.h} board`} at ${leadText(ch)}. Mines hit: 0 of ${lim(p)}.`);
  }

  /* pointer. A mouse acts at once: left does what the tool says, right the
   * other. A touch waits to tell a tap from a hold: a tap does what the
   * tool says when the finger lifts, a hold of HOLD_MS does the other, and
   * sliding to another square before then starts a drag that paints. A
   * drag paints every square it passes along its row or column, however
   * fast it moves. Only the finger that started a stroke paints it.
   *
   * Mines previews a pick while you hold and commits it only when you let
   * go, since a mine cannot be taken back. A drag starts only once the
   * pointer is half a square (at least 10 px) from where it went down, so
   * wobble on a tap never reaches the next square; it keeps to the row or
   * column it moves along (which can still change while it is one or two
   * squares long), stops at its first mine, and letting go more than a
   * square off the board cancels it. A hold only ever turns a fill into a
   * mark, the safe choice: a fill comes from a tap or drag in Filling mode,
   * a right-click, or a key. A second finger never moves or commits a run. */
  const HOLD_MS = 420, MINES_HOLD_MS = 300;
  let stroke = null, strokeVal = 0, hold = null, run = null, pid = null, last = -1;
  function beginStroke(i, tool) {
    strokeVal = view.p.cells[i] === tool ? -1 : tool;
    stroke = [];
    last = i;
    setCell(i, strokeVal, stroke);
  }
  /* Paint from the last square painted to j: every square between them when
   * they share a row or column, since a fast drag skips squares. */
  function paintTo(j) {
    const w = view.p.w, a = last;
    last = j;
    if (a < 0 || a === j) { setCell(j, strokeVal, stroke); return; }
    const ra = Math.floor(a / w), ca = a % w, rb = Math.floor(j / w), cb = j % w;
    if (ra !== rb && ca !== cb) { setCell(j, strokeVal, stroke); return; }
    const step = ra === rb ? (cb > ca ? 1 : -1) : (rb > ra ? w : -w);
    for (let k = a + step; ; k += step) { setCell(k, strokeVal, stroke); if (k === j) break; }
  }
  function cellAt(e) {
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const x = t && t.closest && t.closest('.cell');
    return x && view && view.el.contains(x) ? +x.dataset.i : -1;
  }
  function dropHold() { if (hold) { clearTimeout(hold.timer); hold = null; } }

  /* What a Mines pick does to square i: fill (1), mark (0) or clear (-1).
   * Picking what is already there clears it, and a fill on a square you
   * marked empty only clears the mark, the way a flag guards a square. */
  function minesV(i, tool) { const v = view.p.cells[i]; return v === tool || (tool === 1 && v === 0) ? -1 : tool; }
  function startRun(e, i) {
    const touch = e.pointerType !== 'mouse';
    const tool = e.button === 2 ? 1 - S.tool : S.tool;
    run = { start: i, axis: null, cells: [i], tool, touch, v: minesV(i, tool), timer: 0, pid: e.pointerId, x0: e.clientX, y0: e.clientY };
    try { view.el.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic event */ }
    // A hold turns a fill into a mark, never a mark into a fill.
    if (touch && tool === 1) {
      run.timer = setTimeout(() => {
        if (!run || run.axis) return;
        run.timer = 0;
        run.tool = 0;
        run.v = minesV(run.start, 0);
        showRun();
        if (navigator.vibrate) navigator.vibrate(12);
      }, MINES_HOLD_MS);
    }
    showRun();
  }
  function showRun() {
    if (!view) return;
    view.el.querySelectorAll('.cell.pend').forEach((c) => c.classList.remove('pend', 'pm'));
    if (!run) return;
    for (const i of run.cells) {
      if (view.p.given[i] >= 0 || isHit(view.p, i)) continue;
      const c = view.cellEls[i];
      c.classList.add('pend');
      if (run.v === 0) c.classList.add('pm');
    }
  }
  /* The run is the stretch from its first square toward the pointer, read
   * from how far the pointer has moved since it went down, not from square
   * edges, so a tap that wobbles near an edge stays one square. A square
   * joins once the pointer is past its middle; the first needs at least
   * 10 px. The row or column follows the main direction of the move while
   * the run is one or two squares long, then holds. */
  function runTo(e) {
    const p = view.p, g = gridRect(), cw = g.width / p.w, chh = g.height / p.h;
    const dx = e.clientX - run.x0, dy = e.clientY - run.y0;
    const r0 = Math.floor(run.start / p.w), c0 = run.start % p.w;
    const reach = (d, size) => (Math.abs(d) < Math.max(10, size / 2) ? 0 : Math.max(1, Math.round(Math.abs(d) / size)));
    if (!run.axis || run.cells.length <= 2) {
      const major = Math.abs(dx) >= Math.abs(dy) ? 'row' : 'col';
      if (!reach(major === 'row' ? dx : dy, major === 'row' ? cw : chh)) {
        if (run.axis) { run.axis = null; run.cells = [run.start]; showRun(); }
        return;
      }
      run.axis = major;
      if (run.timer) { clearTimeout(run.timer); run.timer = 0; }
    }
    const row = run.axis === 'row', d = row ? dx : dy, s = d < 0 ? -1 : 1;
    const room = row ? (s > 0 ? p.w - 1 - c0 : c0) : (s > 0 ? p.h - 1 - r0 : r0);
    const k = Math.min(reach(d, row ? cw : chh), room), cells = [];
    for (let j = 0; j <= k; j++) cells.push(row ? r0 * p.w + c0 + s * j : (r0 + s * j) * p.w + c0);
    run.cells = cells;
    showRun();
  }
  function endRun(e, cancel) {
    const r = run;
    run = null;
    if (r.timer) clearTimeout(r.timer);
    showRun();
    if (cancel || !view || !view.el.isConnected) return;
    if (e) {
      const g = gridRect(), m = g.width / view.p.w;
      if (e.clientX < g.left - m || e.clientX > g.right + m || e.clientY < g.top - m || e.clientY > g.bottom + m) return;
    }
    applyRun(r.cells, r.v, r.touch);
  }

  stage.addEventListener('contextmenu', (e) => { if (e.target.closest('.pz')) e.preventDefault(); });
  stage.addEventListener('pointerdown', (e) => {
    // touching the board means keep playing
    closeAsk(false);
    if (busy || !view || !view.el.isConnected) return;
    const x = e.target.closest('.cell');
    if (!x || !view.el.contains(x)) return;
    const i = +x.dataset.i, p = view.p;
    if (p.hit) {
      e.preventDefault();
      view.el.focus({ preventScroll: true });
      if (run) return;
      if (p.lost) { say(LOST); return; }
      if (p.hit[i]) { say(`${where(p, i).replace(/^r/, 'R')} is a mine. It stays empty.`); return; }
      if (p.given[i] >= 0) return;
      view.cur = i; placeCursor(false);
      startRun(e, i);
      return;
    }
    if (p.given[i] >= 0) return;
    e.preventDefault();
    // a second finger while one is painting is ignored
    if ((stroke || hold) && e.pointerId !== pid) return;
    // Focus the board, so Space and Enter fill squares rather than press
    // whichever button was clicked last.
    view.el.focus({ preventScroll: true });
    dropHold();
    finish();
    pid = e.pointerId;
    view.cur = i; placeCursor(false);
    try { view.el.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic event */ }
    if (e.pointerType === 'mouse' || e.button === 2) {
      beginStroke(i, e.button === 2 ? 1 - S.tool : S.tool);
      return;
    }
    hold = {
      i,
      timer: setTimeout(() => {
        if (!hold) return;
        const h = hold; hold = null;
        beginStroke(h.i, 1 - S.tool);
        if (navigator.vibrate) navigator.vibrate(12);
      }, HOLD_MS),
    };
  });
  stage.addEventListener('pointermove', (e) => {
    if (run) { if (e.pointerId === run.pid && view && view.el.isConnected) runTo(e); return; }
    if (e.pointerId !== pid) return;
    if (hold) {
      const j = cellAt(e);
      if (j < 0 || j === hold.i) return;
      const h = hold; dropHold();
      beginStroke(h.i, S.tool);
    }
    if (!stroke) return;
    const j = cellAt(e);
    if (j >= 0) paintTo(j);
  });
  function finish() { if (stroke) { const s = stroke; stroke = null; endStroke(s); } last = -1; }
  // On the window, so a stroke or run always ends wherever the pointer lifts.
  addEventListener('pointerup', (e) => {
    if (run) { if (e.pointerId === run.pid) endRun(e, false); return; }
    if (e.pointerId !== pid) return;
    pid = null;
    if (hold) { const h = hold; dropHold(); if (view && view.el.isConnected) beginStroke(h.i, S.tool); }
    finish();
  });
  addEventListener('pointercancel', (e) => {
    if (run) { if (e.pointerId === run.pid) endRun(null, true); return; }
    if (e.pointerId !== pid) return;
    pid = null;
    dropHold(); finish();
  });
  // A board redrawn mid-run (a resize, say) drops the capture: cancel the
  // run rather than leave it waiting or commit it on stale squares.
  document.addEventListener('lostpointercapture', (e) => {
    if (run && e.pointerId === run.pid && !(view && view.el.isConnected && view.el.contains(e.target))) endRun(null, true);
  });

  /* keys: arrows move (and say the square), Space or Enter fills, X marks,
   * Z or Backspace undoes. In Mines a key pick happens at once: a key press
   * is deliberate and the cursor shows where it lands. */
  function placeCursor(show) {
    if (!view || !view.cursor) return;
    const i = view.cur;
    if (i < 0) { view.cursor.classList.remove('on'); return; }
    const r = Math.floor(i / view.p.w), c = i % view.p.w;
    view.cursor.style.left = `calc(var(--cw) + ${c} * var(--cell))`;
    view.cursor.style.top = `calc(var(--ch) + ${r} * var(--cell))`;
    if (show !== undefined) view.cursor.classList.toggle('on', show);
  }
  document.addEventListener('keydown', (e) => {
    if (asking) {
      if (e.key === 'Escape') { e.preventDefault(); keepPlaying(); }
      return;
    }
    if (run && e.key === 'Escape') { e.preventDefault(); endRun(null, true); return; }
    const on = (sel) => e.target.closest && e.target.closest(sel);
    if ($('menu').open) return;
    // On a button, only Z (undo) reaches the board: arrows, X, Space and
    // Enter belong to the button.
    if (on('button, dialog') && e.key !== 'z' && e.key !== 'Backspace') return;
    const lost = !!(view && view.p.lost && view.el.isConnected);
    if (e.key === 'z' || e.key === 'Backspace') { e.preventDefault(); if (lost) say(LOST); else undo(); return; }
    if (busy || !view || !view.el.isConnected) return;
    const p = view.p;
    const mv = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (mv) {
      e.preventDefault();
      if (view.cur < 0) view.cur = 0;
      else {
        const r = Math.max(0, Math.min(p.h - 1, Math.floor(view.cur / p.w) + mv[0]));
        const c = Math.max(0, Math.min(p.w - 1, (view.cur % p.w) + mv[1]));
        view.cur = r * p.w + c;
      }
      placeCursor(true);
      say(`${where(p, view.cur).replace(/^r/, 'R')}, ${cellWord(p, view.cur)}`);
      return;
    }
    const fill = e.key === ' ' || e.key === 'Enter';
    if (!fill && e.key !== 'x' && e.key !== '.') return;
    if (lost) {
      e.preventDefault();
      if (!fill) say(LOST);
      else if (!e.repeat) anotherBoard();
      return;
    }
    if (view.cur < 0) return;
    e.preventDefault();
    const i = view.cur, tool = fill ? 1 : 0;
    if (p.hit) {
      if (p.hit[i]) say(`${where(p, i).replace(/^r/, 'R')} is a mine. It stays empty.`);
      else applyRun([i], minesV(i, tool), false);
      placeCursor(true);
      return;
    }
    const s = [];
    setCell(i, p.cells[i] === tool ? -1 : tool, s);
    placeCursor(true);
    endStroke(s);
  });

  /* ---------- patch world view ----------
   * The picture you are working on is a plate of nine tiles, seen tilted.
   * Its middle tile is a window: a shaft drops to the last picture, a layer
   * below, whose own middle is a window to the one before, and so on. Each
   * layer is a third the size and a third the depth of the one above, so
   * zooming out by three about the shaft's vanishing point turns every
   * layer into the one above it. */
  const TILT = 30;

  /* A layer is a finished picture drawn exactly as its plate looked (nine
   * tiles and their seams), only smaller, so the zoom that turns a plate
   * into a layer has nothing to swap. A 5x5 starter is one tile. */
  function paintLayer(ctx, it, ink, P) {
    const pic = it.pic, on = ink ? 'ink' : 'held';
    if (pic.w !== 15) { paintTile(ctx, it.L, (i) => (pic.sol[i] ? on : 'gap'), true, it.L / P.t); return; }
    const s = it.L / P.size;
    ctx.save();
    ctx.scale(s, s);
    for (let j = 0; j < 9; j++) {
      if (it.windowed && j === 4) continue;
      const tr = Math.floor(j / 3), tc = j % 3;
      const sl = sliceOf(pic.sol, 15, tr * 5, tc * 5, 5);
      ctx.save();
      ctx.translate(tc * (P.t + P.gap), tr * (P.t + P.gap));
      paintTile(ctx, P.t, (i) => (sl[i] ? on : 'gap'), true, s);
      ctx.restore();
    }
    ctx.restore();
  }
  function rrPath(ctx, x, y, w, h, r, ccw) {
    r = Math.min(r, w / 2, h / 2);
    if (!ccw) {
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    } else {
      ctx.moveTo(x + r, y); ctx.arcTo(x, y, x, y + h, r); ctx.arcTo(x, y + h, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x + w, y, r); ctx.arcTo(x + w, y, x, y, r);
    }
    ctx.closePath();
  }

  function shaft(stack, x, y, s, z0, h) {
    const walls = [
      ['top', x, y, s, h, '50% 0', 'rotateX(-90deg)'],
      ['bottom', x, y + s, s, h, '50% 0', 'rotateX(-90deg)'],
      ['left', x, y, h, s, '0 50%', 'rotateY(90deg)'],
      ['right', x + s, y, h, s, '0 50%', 'rotateY(90deg)'],
    ];
    for (const [side, l, t, w, hh, o, rot] of walls) {
      const d = document.createElement('div');
      d.className = 'wall ' + side;
      Object.assign(d.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: hh + 'px', transformOrigin: o, transform: `translateZ(${-z0}px) ${rot}` });
      stack.appendChild(d);
    }
  }

  function renderWorld(w, opts) {
    opts = opts || {};
    const hadFocus = stage.contains(document.activeElement) || refocus;
    refocus = false;
    clearStage();
    view = null;
    const avail = Math.min(stage.clientWidth, stage.clientHeight - 40);
    const c0 = Math.min(80, avail / 15), gap = Math.max(1, Math.round(c0 * 0.07));
    const t = Math.floor((avail - 2 * gap) / 3);
    const size = 3 * t + 2 * gap;
    const D = Math.round(t * 0.34), cz = 1.5 * D; // first drop, and the vanishing depth
    const scene = document.createElement('div');
    // The plate lies flat; the only depth is the hover parallax below.
    scene.className = 'scene flat' + (opts.enter ? ' enter' : '');
    scene.style.width = scene.style.height = size + 'px';
    const tilt = document.createElement('div');
    tilt.className = 'tilt';
    tilt.style.setProperty('--tilt', TILT + 'deg');
    const stack = document.createElement('div');
    stack.className = 'stack';
    stack.style.transformOrigin = `${size / 2}px ${size / 2}px ${-cz}px`;
    tilt.appendChild(stack);
    scene.appendChild(tilt);

    // layers below, deepest first
    const layers = w.layers || [];
    const ink = tok('--ink');
    // Layer k sits under a window of side W (the plate's middle tile, or the
    // middle of the layer above). A whole picture is the plate shrunk by
    // 3^(k+1), a touch wider than its window, so its edges tuck under.
    const P = { t, gap, size };
    let z = 0;
    const plan = layers.map((pic, k) => {
      const W = t / Math.pow(3, k), h = D / Math.pow(3, k);
      const L = pic.w === 15 ? size / Math.pow(3, k + 1) : W;
      const item = { pic, W, L, top: z, z: z + h, windowed: !!layers[k + 1] && pic.w === 15 };
      z += h;
      return item;
    });
    for (let k = plan.length - 1; k >= 0; k--) {
      const it = plan[k];
      const x = (size - it.L) / 2, wx = (size - it.W) / 2;
      shaft(stack, wx, wx, it.W, it.top, it.z - it.top);
      const lay = document.createElement('div');
      lay.className = 'layer';
      lay.style.setProperty('--d', String(k + 1));
      Object.assign(lay.style, { left: x + 'px', top: x + 'px', width: it.L + 'px', height: it.L + 'px', transform: `translateZ(${-it.z}px)` });
      // drawn at three times its size: the zoom shows it that big
      const a = canvasFor(it.L, it.L, 3);
      paintLayer(a.ctx, it, false, P);
      lay.appendChild(a.cv);
      if (k === 0 && opts.fresh) {
        // the picture you just finished lands in ink, then settles gray
        const f = canvasFor(it.L, it.L, 3);
        paintLayer(f.ctx, it, true, P);
        f.cv.className = 'fresh';
        // gone once it has faded, so a later move cannot replay it
        f.cv.addEventListener('animationend', () => f.cv.remove());
        lay.appendChild(f.cv);
      }
      stack.appendChild(lay);
    }

    const el = document.createElement('div');
    el.className = 'world';
    // The plate's base: page-colored under the tiles so nothing below shows
    // through the seams, with the window cut out of it. It lives in the same
    // flat plane as the tiles: a separate plane half a pixel below them lost
    // depth ties mid-zoom and blanked whole tiles.
    const base = document.createElement('div');
    base.className = 'base';
    const bc = canvasFor(size, size);
    bc.ctx.fillStyle = tok('--bg');
    bc.ctx.beginPath();
    bc.ctx.rect(0, 0, size, size);
    if (layers.length) rrPath(bc.ctx, t + gap, t + gap, t, t, geom(t / 5).r, true);
    bc.ctx.fill('evenodd');
    base.appendChild(bc.cv);
    el.appendChild(base);

    el.style.setProperty('--wgap', gap + 'px');
    el.style.setProperty('--wr', geom(t / 5).r + 'px');
    w.tiles.forEach((tile, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile' + (tile.center ? ' center' : '') + (tile.done ? ' done' : '');
      b.dataset.k = k;
      const { cv, ctx } = canvasFor(t, t);
      const pic = sliceOf(w.sol, 15, tile.tr * 5, tile.tc * 5, 5);
      if (tile.center) { if (!layers.length) paintTile(ctx, t, (i) => (pic[i] ? 'held' : 'gap'), true); }
      else if (tile.done) paintTile(ctx, t, (i) => (pic[i] ? 'ink' : 'gap'), true);
      else {
        const p = tile.puzzle;
        paintTile(ctx, t, (i) => (p.given[i] === 1 ? 'held' : p.given[i] === 0 ? 'gap' : p.cells[i] === 1 ? 'ink' : p.cells[i] === 0 ? 'sunk' : 'open'));
      }
      b.appendChild(cv);
      const where = ['top left', 'top', 'top right', 'left', 'middle', 'right', 'bottom left', 'bottom', 'bottom right'][k];
      b.setAttribute('aria-label', tile.center ? 'Middle: a window down to your last picture' : `${where} tile, ${tile.done ? 'solved' : 'open'}`);
      if (tile.center || tile.done) b.disabled = true;
      el.appendChild(b);
    });
    stack.appendChild(el);
    stage.appendChild(scene);
    // Parallax: with a mouse over the plate, the pictures under the window
    // shift a few pixels against the pointer, more the deeper they are.
    if (!reduced && matchMedia('(hover: hover) and (pointer: fine)').matches) {
      scene.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const b = scene.getBoundingClientRect();
        scene.style.setProperty('--px', (((e.clientX - b.left) / b.width) * 2 - 1).toFixed(3));
        scene.style.setProperty('--py', (((e.clientY - b.top) / b.height) * 2 - 1).toFixed(3));
      });
      scene.addEventListener('pointerleave', () => { scene.style.setProperty('--px', '0'); scene.style.setProperty('--py', '0'); });
    }
    if (opts.flat) { scene.classList.add('instant'); void scene.offsetWidth; scene.classList.remove('instant'); }
    const left = w.tiles.filter((x) => !x.done).length;
    const cap = document.createElement('p');
    cap.className = 'world-cap';
    cap.textContent = left ? `${8 - left} of 8 solved. Pick a tile.` : 'Picture complete.';
    stage.appendChild(cap);
    if (hadFocus) {
      const open = el.querySelector('.tile:not(:disabled)');
      if (open) open.focus({ preventScroll: true }); else refocus = true;
    }
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.tile');
      if (!b || busy || b.disabled) return;
      busy = true;
      const k = +b.dataset.k;
      // level the plate, then dive into the tile
      setFlat(scene, true, () => {
        const A = b.getBoundingClientRect();
        const old = liftOld();
        chain().view = k;
        chain().undo = [];
        save();
        render({ enter: true });
        camera(old, A, view.el, gridRect(), { zoomIn: true }, () => { busy = false; });
      });
    });
    return scene;
  }

  /* The plate no longer tilts: it stays level, so this only keeps it flat. */
  function setFlat(scene, flat, after) {
    if (scene) scene.classList.add('flat');
    after();
  }

  /* ---------- flow ---------- */

  function chain() { return S.chains[S.mode]; }

  function render(opts) {
    const ch = chain();
    const cur = ch.cur;
    // the bar and the keys line first, so the board is sized to the room left
    hud();
    if (cur.kind === 'world') {
      if (ch.view === 'world') renderWorld(cur, opts);
      else renderPuzzle(cur.tiles[ch.view].puzzle, () => tileSolved(ch.view), opts);
    } else renderPuzzle(cur, levelSolved, opts);
    hud();
  }

  /* The readout's lead: how far the chain has come. */
  function leadText(ch) {
    const cur = ch.cur;
    if (ch === S.chains.journey) {
      const st = STEP[cur.step] || STEP.plain;
      return `board ${ch.depth}` + (st.name ? ` · ${st.name}` : '');
    }
    if (cur.hole) return `mass ${cur.hole.mass}` + (cur.hole.scale > 1 ? ` · ×${cur.hole.scale}` : '');
    if (cur.grav) return cur.grav.level ? `level ${cur.grav.level}` : 'star';
    if (ch === S.chains.ring) return !cur.ring ? `ring ${ch.depth - 1}` : cur.ring.n ? `ring ${cur.ring.n} · ${cur.ring.year}` : 'core';
    return `zoom ${ch.depth - 1}`;
  }
  const KEYS = {
    fill: 'Tap fills · hold marks',
    mark: 'Tap marks · hold fills',
    minesFill: 'Tap fills · hold marks',
    minesMark: 'Tap or hold marks',
  };

  /* The line under the tabs: in the journey it names a step only the first
   * time that step turns up, then stays quiet. */
  function blurbText(ch) {
    if (S.mode !== 'journey') return MODES[S.mode].blurb;
    const st = ch.cur.step;
    return ch.firstOf === ch.depth ? (STEP[st] || STEP.plain).first : '';
  }
  function hud() {
    const ch = chain(), cur = ch.cur, name = MODES[S.mode].name, fill = S.tool !== 0, mines = !!cur.hit;
    $('blurb').textContent = blurbText(ch);
    const size = cur.kind === 'world' ? (ch.view === 'world' ? '15×15' : `${WHERE[ch.view]} tile`) : `${cur.w}×${cur.h}`;
    $('readout').textContent = (S.mode === 'journey' ? '' : name + ' · ') + `${leadText(ch)} · ${size}` + (!mines ? '' : cur.lost ? ' · lost' : ` · ${cur.hits}/${lim(cur)} mines`);
    // The tool says what a tap does; its label changes, so no aria-pressed.
    const tb = $('tool-btn');
    tb.dataset.tool = fill ? 'fill' : 'mark';
    tb.querySelector('.tb-label').textContent = fill ? 'Filling' : 'Marking';
    tb.title = fill ? 'Filling: a tap fills. Press to mark instead.' : 'Marking: a tap marks empty. Press to fill instead.';
    const plate = onPlate(), rb = $('reset-btn');
    rb.querySelector('.tb-label').textContent = plate ? 'Clear tiles' : 'Clear board';
    rb.title = plate ? 'Clear every open tile (Undo brings them back)' : mines ? 'Clear this board (found mines stay)' : 'Clear this board (Undo brings it back)';
    $('undo-btn').title = mines ? 'Undo your last fill or mark (Z). Found mines stay.' : 'Undo your last move (Z)';
    $('new-btn').title = `New game: all of ${name} starts over`;
    if (!$('keys').classList.contains('note')) $('keys-text').textContent = mines ? (fill ? KEYS.minesFill : KEYS.minesMark) : (fill ? KEYS.fill : KEYS.mark);
    $('back-btn').hidden = !(cur.kind === 'world' && ch.view !== 'world');
    const rb2 = $('rules-btn'), r = rule(), n = RULES[r];
    rb2.hidden = !mines;
    if (rb2.dataset.rule !== r) { rb2.dataset.rule = r; rb2.querySelector('.rb-icon').innerHTML = RULE_SVG[r]; }
    const nxt = RULE_ORDER[(RULE_ORDER.indexOf(r) + 1) % RULE_ORDER.length];
    rb2.querySelector('.tb-label').textContent = `Rules: ${RULE_NAME[r]}, ${n === 1 ? 'one mine loses' : n + ' mines lose'} a board`;
    rb2.title = `${RULE_NAME[r]}: ${n === 1 ? 'one mine loses' : n + ' mines lose'} a board. Press for ${RULE_NAME[nxt]}.`;
    syncBar();
  }

  /* What a new board carries, for screen readers: gray squares count. */
  function newBoardText(p) {
    let ink = 0, empty = 0;
    for (const v of p.given) { if (v === 1) ink++; else if (v === 0) empty++; }
    let t = `New ${p.w} by ${p.h} board.`;
    if (p.grav) t += p.grav.level ? ` The star in the middle square counts as filled. Gravity ${p.grav.level}.` : ' The star in the middle square counts as filled.';
    else if (ink + empty) t += ` Carried over and locked: ${ink} filled, ${empty} empty.`;
    if (p.hit) t += ` Mines hit: 0 of ${lim(p)}.`;
    return t;
  }

  /* What a new board says to screen readers, by what it carries. */
  function announce(ch) {
    const cur = ch.cur, h = cur.hole, first = S.mode === 'journey' && ch.firstOf === ch.depth ? (STEP[cur.step] || STEP.plain).first + ' ' : '';
    if (h) say(first + (h.collapsed ? `The hole outgrew the board. Each square now holds ${h.scale} times the mass. Mass ${h.mass}.` : `It fell in. Mass ${h.mass}.`) + ` New ${cur.w} by ${cur.h} board.`);
    else if (cur.kind !== 'world') say(first + newBoardText(cur));
    else say(first + PLATE);
  }

  /* Which move takes the solved view to the next one: the camera when the
   * old picture lands somewhere on the new board, a collapse into the star
   * for Gravity, and for a plain board a turn, as in Notan. */
  function arrive(old, A, done) {
    const cur = chain().cur, newEl = view.el;
    if ((cur.grav && cur.grav.level) || (cur.hole && old)) { collapse(old, newEl, done); return; }
    const B = regionRect();
    if (!B || !A) { turn(old, newEl, done); return; }
    camera(old, A, newEl, B, {}, done);
  }

  function levelSolved() {
    const ch = chain();
    const A = gridRect();
    const old = liftOld();
    noteSolved(ch);
    advance(S.mode, ch);
    save();
    announce(ch);
    if (ch.cur.kind === 'world') {
      render({ enter: true, flat: true, fresh: true });
      const scene = stage.querySelector('.scene:not(.leaving)');
      camera(old, A, scene, tileRect(4), {}, () => setFlat(scene, false, () => { busy = false; }));
      hud();
      return;
    }
    render({ enter: true, arriving: true });
    arrive(old, A, () => { busy = false; });
  }

  /* A board with nothing carried over: one crossfade in place, the solved
   * picture out while the new board comes in, over 1.4 s. Nothing moves or
   * scales. (Before: a 0.34 s lift-and-rise with a shrink and a swell that
   * felt close to nauseating, then an out-then-in dissolve that read as
   * off and on.) */
  function turn(old, newEl, done) {
    newEl.classList.remove('enter', 'arriving');
    if (reduced || !old) { if (old) old.el.remove(); done(); return; }
    stage.classList.add('zooming');
    const t = { duration: Math.round(TIMING.fade * 1.75), easing: EASE };
    old.el.animate([{ opacity: 1 }, { opacity: 0 }], { ...t, fill: 'forwards' });
    newEl.animate([{ opacity: 0 }, { opacity: 1 }], { ...t, fill: 'backwards' })
      .finished.then(() => { old.el.remove(); stage.classList.remove('zooming'); done(); });
  }

  /* Gravity: the solved picture spirals into the star, innermost squares
   * first, each turning the star's way and shrinking as it falls; the star
   * swells as it swallows them, and the new board's squares spill back out
   * of it, nearest first. The star never moves, so the eye stays on it. */
  function collapse(old, newEl, done) {
    const p = view.p, mid = (p.w - 1) / 2, at = p.grav ? p.grav.at : mid * p.w + mid;
    // the star's own square: on an even board it is not the middle point
    const ar = Math.floor(at / p.w), ac = at % p.w;
    const star = newEl.querySelector('.star, .hole'), sq = view.cellEls[at];
    if (reduced || !old || !star) { if (old) old.el.remove(); newEl.classList.remove('enter', 'arriving'); done(); return; }
    newEl.classList.remove('enter');
    // Falling into a star or hole already on screen (the last board's), the
    // new board's own stays hidden and then glides onto that spot; from any
    // other board the new one is shown at once and the ink falls into it.
    const was = old.el.querySelector(p.grav ? '.star' : '.hole');
    newEl.classList.add('arriving');
    if (!was) {
      newEl.classList.add('collapsing');
      // the old board's backing goes first, so the star shows from the start
      old.el.querySelectorAll('.pz-bg').forEach((b) => b.animate([{ opacity: 1 }, { opacity: 0 }], { duration: TIMING.fade, easing: 'ease-out', fill: 'forwards' }));
    }
    stage.classList.add('zooming');
    const sr = sq.getBoundingClientRect(), wr = was && was.getBoundingClientRect();
    const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;
    const tx = wr ? wr.left + wr.width / 2 : sx, ty = wr ? wr.top + wr.height / 2 : sy, spin = (p.grav || p.hole).spin;
    const cells = [...old.el.querySelectorAll('.cell')].filter((c) => c.classList.contains('ink') || c.querySelector('.thumb'));
    const pts = cells.map((c) => { const r = c.getBoundingClientRect(); return { c, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const far = Math.max(1, ...pts.map((q) => Math.hypot(q.x - tx, q.y - ty)));
    // A slow drift in: each square eases in and out along a gentle curve
    // (less than half a turn round the star), turning a little and fading
    // as it shrinks, so the picture pours in rather than scattering.
    const FALL = Math.round(TIMING.zoom * 0.55), SPREAD = Math.round(TIMING.zoom * 0.18);
    let last = 0;
    for (const q of pts) {
      const dx = q.x - tx, dy = q.y - ty, R = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx), delay = (R / far) * SPREAD;
      const frames = [];
      for (let s = 0; s <= 16; s++) {
        const t = s / 16, e = t * t * (3 - 2 * t), r = R * (1 - e), a = a0 + spin * 1.2 * e;
        frames.push({ translate: `${(tx + r * Math.cos(a) - q.x).toFixed(1)}px ${(ty + r * Math.sin(a) - q.y).toFixed(1)}px`, rotate: `${(spin * 45 * e).toFixed(1)}deg`, scale: (1 - 0.8 * e).toFixed(3), opacity: t < 0.6 ? 1 : (1 - t) / 0.4 });
      }
      q.c.animate(frames, { duration: FALL, delay, easing: 'linear', fill: 'both' });
      last = Math.max(last, delay + FALL);
    }
    old.el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.92 }, { opacity: 0 }], { duration: last + 60, fill: 'forwards' });
    const gulp = (el) => { el.classList.remove('gulp'); void el.offsetWidth; el.classList.add('gulp'); };
    if (p.grav) setTimeout(() => gulp(was || star), Math.max(0, last - 700));
    setTimeout(() => {
      // the new star takes the old one's place in the same frame
      if (wr) newEl.classList.add('collapsing');
      old.el.remove();
      newEl.classList.remove('arriving');
      requestAnimationFrame(() => newEl.classList.remove('collapsing'));
      if (wr) newEl.animate([{ translate: `${(tx - sx).toFixed(1)}px ${(ty - sy).toFixed(1)}px` }, { translate: '0 0' }], { duration: TIMING.fade, easing: EASE });
      // The new board's squares unfold from the star, nearest first: a short
      // way out from half size, fading in, never flung.
      let end = 0;
      const skip = new Set(p.hole ? p.hole.cells : [at]), cr = p.hole ? mid : ar, cc = p.hole ? mid : ac;
      const OUT = Math.round(TIMING.fade * 1.3);
      const dmax = Math.hypot(Math.max(cr, p.h - 1 - cr), Math.max(cc, p.w - 1 - cc)) || 1, per = Math.min(85, 600 / dmax);
      view.cellEls.forEach((c, i) => {
        if (skip.has(i)) return;
        const r = Math.floor(i / p.w), k = i % p.w, d = Math.hypot(r - cr, k - cc);
        const delay = Math.round(d * per);
        c.animate([{ translate: `${((cc - k) * sr.width * 0.35).toFixed(1)}px ${((cr - r) * sr.height * 0.35).toFixed(1)}px`, scale: 0.5, opacity: 0 }, { translate: '0 0', scale: 1, opacity: 1 }],
          { duration: OUT, delay, easing: 'cubic-bezier(.33,0,.25,1)', fill: 'backwards' });
        end = Math.max(end, delay + OUT);
      });
      setTimeout(() => { stage.classList.remove('zooming'); done(); }, end);
    }, last + 60);
  }

  function tileRect(k) { const c = stage.querySelector(`.scene:not(.leaving) .tile[data-k="${k}"]`); return c && c.getBoundingClientRect(); }
  /* Where the old board lands on the new one. A merged board fills its
   * seed (centered, when its sides are not in the seed's proportion). */
  function regionRect() {
    const p = view.p, g = p.land || p.region;
    if (!g) return null;
    if (p.land) {
      // a landing may start partway into a square
      const r = Math.floor(g.r), c = Math.floor(g.c), q = view.cellEls[r * p.w + c].getBoundingClientRect();
      return new DOMRect(q.left + (g.c - c) * q.width, q.top + (g.r - r) * q.height, g.w * q.width, g.h * q.height);
    }
    const a = view.cellEls[g.r * p.w + g.c].getBoundingClientRect();
    const z = view.cellEls[(g.r + g.h - 1) * view.p.w + g.c + g.w - 1].getBoundingClientRect();
    return new DOMRect(a.left, a.top, z.right - a.left, z.bottom - a.top);
  }

  /* Back out of a tile to the whole picture, solved or not. */
  function toWorld(k, after, stayFlat) {
    const ch = chain();
    const A = gridRect();
    const old = liftOld();
    ch.view = 'world';
    ch.undo = [];
    save();
    render({ flat: true });
    const scene = stage.querySelector('.scene:not(.leaving)');
    camera(old, A, scene, tileRect(k), {}, () => (stayFlat ? after() : setFlat(scene, false, after)));
  }

  const PLATE = 'Eight new tiles around your last picture. Pick a tile.';
  function tileSolved(k) {
    const w = chain().cur, t = w.tiles[k];
    t.done = true;
    // A solved tile locks the edge each open neighbor shares with it. A
    // neighbor those edges finish is solved too, and passes its own edges on.
    const helped = new Set(), finished = [], queue = [t];
    while (queue.length) {
      const s = queue.shift();
      for (const n of neighborsOf(w.tiles, s)) {
        if (n.center || n.done) continue;
        lockEdge(n.puzzle, facing(n, s));
        helped.add(n);
        if (isSolved(n.puzzle)) { n.done = true; finished.push(WHERE[w.tiles.indexOf(n)]); queue.push(n); }
      }
    }
    if (helped.size) {
      say(`Solved. Edges locked in ${helped.size} neighboring ${helped.size === 1 ? 'tile' : 'tiles'}` +
        (finished.length ? `, which finished the ${finished.join(' and ')} ${finished.length === 1 ? 'tile' : 'tiles'}.` : '.'));
    }
    const last = w.tiles.every((x) => x.done);
    // The last tile keeps the plate level: the pull-back that follows is
    // flat, like every other zoom, and only then does the plate tilt.
    toWorld(k, () => { if (last) worldSolved(); else busy = false; }, last);
  }

  /* The whole picture is done: pull back by three about the vanishing
   * point. The finished plate becomes the first layer down, every older
   * layer drops one more step, and the new plate settles in on top. */
  function worldSolved() {
    busy = true;
    say('Picture complete.');
    setTimeout(() => {
      const ch = chain();
      noteSolved(ch);
      if (ch.cur.kind === 'world' && S.mode === 'journey') {
        // In the journey a plate can be followed by any board: the whole
        // picture is the old view, and lands where the next one keeps it.
        const plate = stage.querySelector('.scene:not(.leaving) .world');
        const A = plate && plate.getBoundingClientRect();
        advance(S.mode, ch);
        if (ch.cur.kind !== 'world') {
          const old = liftOld();
          save();
          announce(ch);
          render({ enter: true, arriving: true });
          arrive(old, A, () => { busy = false; });
          return;
        }
      } else advance(S.mode, ch);
      save();
      announce(ch);
      if (reduced) { render({ fresh: true }); busy = false; return; }
      // Level, the new stack scaled by three lays the finished picture
      // exactly where the plate was; shrinking it back is a plain 2D zoom.
      render({ enter: true, fresh: true, flat: true });
      const scene = stage.querySelector('.scene');
      const stack = scene.querySelector('.stack');
      stage.classList.add('zooming');
      stack.animate([{ transform: 'scale3d(3, 3, 3)' }, { transform: 'none' }], { duration: TIMING.zoom, easing: EASE })
        .finished.then(() => { stage.classList.remove('zooming'); setFlat(scene, false, () => { busy = false; }); });
    }, reduced ? 100 : 600);
  }

  /* ---------- chrome ---------- */

  /* The "Focus outline" choice, off by default. */
  function applyRing() {
    document.documentElement.toggleAttribute('data-focus-ring', !!S.ring);
    $('ring-opt').checked = !!S.ring;
  }
  let keyNav = false;

  function applyTheme() {
    if (S.theme) document.documentElement.setAttribute('data-theme', S.theme);
    const dark = (S.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
    $('theme-btn').title = dark ? 'Switch to light' : 'Switch to dark';
    return dark;
  }

  /* Clear board clears what you laid on this board, as one stroke Undo
   * brings back. On the Patch plate, Clear tiles clears every open tile,
   * and Undo brings that back while you stay on the plate. Locked squares
   * and found mines are never touched. */
  function resetBoard() {
    if (busy) return;
    const ch = chain();
    if (view && view.p.lost && view.el.isConnected) { note(LOST); return; }
    if (!boardMarks()) { note('Nothing to clear.'); return; }
    if (onPlate()) {
      const snap = [];
      ch.cur.tiles.forEach((t, k) => {
        if (t.done || t.center || !t.puzzle || !t.puzzle.cells.some((v) => v !== -1)) return;
        snap.push([k, Int8Array.from(t.puzzle.cells)]);
        t.puzzle.cells.fill(-1);
      });
      pushUndo({ tiles: snap });
      save(); render();
      say(`Cleared your marks on ${snap.length} ${snap.length === 1 ? 'tile' : 'tiles'}. Undo brings them back.`);
      return;
    }
    const st = [];
    for (let i = 0; i < view.p.cells.length; i++) if (view.p.cells[i] !== -1) setCell(i, -1, st);
    endStroke(st);
    say(view.p.hit ? `Board cleared. Mines you found stay. Mines hit: ${view.p.hits} of ${lim(view.p)}.` : 'Board cleared. Undo brings your marks back.');
  }

  /* New game starts this tab over. When there is something to lose it asks
   * first, in the bar: Keep playing (focused, the safe choice, drawn
   * stronger) or New game (plain). The confirm never lands where New game
   * was, so a slow double click cannot hit it; a press on it within
   * 600 ms is ignored too. The question never times out; Escape, a tab or a
   * touch on the board keeps the game. */
  const ASK_MS = 600;
  let asking = false, askAt = 0;
  function lossText() {
    const ch = chain(), cur = ch.cur, q = `Start a new ${MODES[S.mode].name} game?`;
    if (ch.depth > 1) {
      let lead = leadText(ch).split(' · ')[0];
      if (lead === 'core') lead = `zoom ${ch.depth - 1}`;
      return `${q} This one ends at ${lead}.`;
    }
    const marks = `${q} Your ${cur.hit ? 'fills and marks' : 'marks'} on this board will be cleared.`;
    if (cur.kind === 'world') {
      const n = cur.tiles.filter((t) => !t.center && t.done).length;
      if (n) return `${q} Your ${n} solved ${n === 1 ? 'tile' : 'tiles'} will be lost.`;
      return cur.tiles.some((t) => !t.center && has(t.puzzle)) ? marks : null;
    }
    return has(cur) ? marks : null;
  }
  function openAsk() {
    if (busy) return;
    const t = lossText();
    if (!t) { startNew(); return; }
    const nb = $('new-btn').getBoundingClientRect();
    asking = true;
    askAt = performance.now();
    $('ask-text').textContent = t;
    $('bar-main').hidden = true;
    $('ask').hidden = false;
    placeAsk(nb);
    $('ask-no').focus();
  }
  /* The question and its two buttons sit centered as one group, the same
   * shape as the bar it replaces; nothing slides. If New game (confirm)
   * would land where New game was pressed, the two buttons trade places
   * (in the page order too, so Tab follows what you see). */
  function placeAsk(nb) {
    const ask = $('ask'), no = $('ask-no'), yes = $('ask-yes');
    ask.appendChild(yes);
    const y = yes.getBoundingClientRect();
    if (Math.max(y.left - nb.right, nb.left - y.right) < 12) ask.insertBefore(yes, no);
  }
  function closeAsk(focusBack) {
    if (!asking) return;
    asking = false;
    $('ask').hidden = true;
    $('bar-main').hidden = false;
    if (focusBack) $('new-btn').focus();
  }
  function keepPlaying() { closeAsk(true); say(`Kept your ${MODES[S.mode].name} game.`); }
  function startNew() {
    if (run) endRun(null, true);
    S.chains[S.mode] = newChain(S.mode);
    save();
    render({ enter: true });
    say(`New ${MODES[S.mode].name} game.`);
  }

  /* No pinch zoom. iOS Safari ignores user-scalable=no but honors a
   * canceled gesture event; a two-finger move is canceled too, for any
   * browser that lets a pinch past touch-action. */
  function blockPinch() {
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  }

  /* Run fn now, or once the zoom in progress has finished. */
  function whenIdle(fn) { const go = () => (busy ? setTimeout(go, 150) : fn()); go(); }

  /* ---------- the menu ----------
   * One sheet, opened from the line at the top: every journey board (all
   * open, as in Notan; solved ones darker, the twists marked), the other
   * games, and the focus outline. A choice made mid-zoom waits for it. */
  let wanted = null;
  function choose(fn) {
    closeAsk(false);
    $('menu').close();
    wanted = fn;
    whenIdle(() => { if (wanted) { const f = wanted; wanted = null; if (run) endRun(null, true); f(); save(); render({ enter: true }); announce(chain()); } });
  }
  function openMenu() {
    if (run) endRun(null, true);
    const ch = S.chains.journey, here = S.mode === 'journey', grid = $('lv-grid'), done = ch.solved || [];
    grid.textContent = '';
    const tile = (label, aria, cls, pressed, go) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button';
      b.className = 'lv' + (cls ? ' ' + cls : '');
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      if (pressed) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', go);
      li.appendChild(b);
      grid.appendChild(li);
    };
    JOURNEY.forEach((st, k) => {
      const n = k + 1, a = ART[st.art], what = st.k === 'plain' ? (done.includes(n) ? a.name : '') : STEP[st.k].name;
      const size = st.k === 'patch' ? '15 by 15 plate' : st.k === 'merge' ? `${st.n} by ${st.n}` : `${a.w} by ${a.h}`;
      tile(String(n), `Board ${n}${what ? ', ' + what : ''}, ${size}${done.includes(n) ? ', solved' : ''}`,
        (done.includes(n) ? 'done' : '') + (st.k === 'plain' ? '' : ' twist'), here && ch.depth === n,
        () => choose(() => { S.mode = 'journey'; goTo(ch, n); }));
    });
    // Notan's endless boards, once the ramp is behind you
    if ((ch.best || 0) > JOURNEY.length) {
      tile('∞', 'Endless boards', 'endless', here && ch.depth > JOURNEY.length,
        () => choose(() => { S.mode = 'journey'; if (ch.depth <= JOURNEY.length) goTo(ch, Math.max(JOURNEY.length + 1, ch.best)); }));
    }
    $('lv-meta').textContent = `${done.length} of ${JOURNEY.length} solved`;
    const list = $('others');
    list.textContent = '';
    for (const m of ORDER) {
      if (m === 'journey') continue;
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button';
      b.className = 'other';
      b.innerHTML = `<span class="other-name"></span><span class="other-blurb"></span>`;
      b.firstChild.textContent = MODES[m].name;
      b.lastChild.textContent = MODES[m].blurb;
      if (S.mode === m) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => choose(() => { S.mode = m; }));
      li.appendChild(b);
      list.appendChild(li);
    }
    const dlg = $('menu');
    dlg.showModal();
    dlg.querySelector('.sheet-body').scrollTop = 0;
    (dlg.querySelector('.lv[aria-current="true"], .other[aria-current="true"]') || grid.querySelector('button')).focus({ preventScroll: true });
    dlg.addEventListener('close', () => {
      const a = document.activeElement;
      if (!wanted && (a === document.body || dlg.contains(a))) $('menu-btn').focus({ preventScroll: true });
    }, { once: true });
  }

  function init() {
    blockPinch();
    load();
    // ?mode=merge|pixel|hole|ring|patch|mines opens that variant (the games index links each one)
    const q = new URLSearchParams(location.search).get('mode');
    if (q && MODES[q]) S.mode = q;
    $('menu-btn').addEventListener('click', openMenu);
    $('undo-btn').addEventListener('click', () => undo(true));
    $('reset-btn').addEventListener('click', resetBoard);
    $('theme-btn').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      S.theme = cur === 'dark' ? 'light' : 'dark';
      const dark = applyTheme(); save();
      say(dark ? 'Dark theme.' : 'Light theme.');
      whenIdle(() => render());
    });
    applyTheme();
    // Focus outline: off unless chosen. The board and tiles then draw no ring.
    applyRing();
    $('ring-opt').addEventListener('change', (e) => {
      S.ring = e.target.checked; save(); applyRing();
      say(S.ring ? 'Focus outline on.' : 'Focus outline off.');
    });
    // Keyboard or pointer, whichever was used last, so the board can show
    // its square cursor when a keyboard brings focus to it.
    addEventListener('keydown', () => { keyNav = true; }, true);
    addEventListener('pointerdown', () => { keyNav = false; }, true);
    $('rules-btn').addEventListener('click', () => {
      if (busy) return;
      const r = RULE_ORDER[(RULE_ORDER.indexOf(rule()) + 1) % RULE_ORDER.length], n = RULES[r];
      S.minesRule = r;
      // The board in play takes the new rule unless that would lose it at once.
      const p = chain().cur, now = p && p.hit && !p.lost && p.hits < n;
      if (now) { p.limit = n; if (view && view.p === p) view.el.setAttribute('aria-label', boardLabel(p)); }
      save(); hud();
      say(`${RULE_NAME[r]}: ${n === 1 ? 'one mine loses' : n + ' mines lose'} a board${now || !(p && p.hit) ? '' : ', from the next board'}.`);
    });
    $('tool-btn').addEventListener('click', () => {
      S.tool = S.tool ? 0 : 1; save(); hud();
      say(S.tool ? 'Filling. A tap fills a square.' : 'Marking. A tap marks a square empty.');
    });
    $('back-btn').addEventListener('click', () => {
      if (busy || chain().view === 'world' || chain().cur.kind !== 'world') return;
      busy = true;
      toWorld(chain().view, () => {
        busy = false;
        say(`All tiles. ${chain().cur.tiles.filter((t) => !t.center && t.done).length} of 8 solved.`);
      });
    });
    $('new-btn').addEventListener('click', openAsk);
    $('ask-no').addEventListener('click', keepPlaying);
    $('ask-yes').addEventListener('click', () => {
      // a double tap on New game must not land here
      if (busy || performance.now() - askAt < ASK_MS) return;
      closeAsk(true);
      startNew();
    });
    let t = 0;
    addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => whenIdle(() => render()), 120); });
    render({ enter: true });
  }
  init();

  // For headless checks.
  window.ZoomLab = { JOURNEY, journeyBoard, goTo, timing: () => Object.assign({}, TIMING), advance, isSolved, makePuzzle, makeWorld, down, ORDER, state: () => S, render, busy: () => busy, measureFrom, bandFor, TILE_BAND, MINES, commitRun, retryMines, undo, asking: () => asking };
})();
