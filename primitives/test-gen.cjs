/* Generation checks, no clicking: for every mode, several chains of a dozen
 * boards each, built in the page with ZoomLab.advance.
 *
 * In the page: Notan's line solver must finish every board from its locked
 * squares alone, and each mode's rules must hold (start sizes, the size
 * ramp, off-center Merge and Mines seeds, lopsided Ring cores and ring
 * widths, Hole margins, Patch edges, Mines picks, retries and arming).
 *
 * In node, with test-solve.cjs, which shares no code with the page:
 *   - every board has exactly one answer given its clues and locked squares
 *     (backtracking over complete line logic), and it is the page's answer
 *   - every board falls in its band: the human rules for its depth finish
 *     it within the band's rounds, with enough lines moving every round
 *   - Mines boards pass the strict gate (no bottleneck round, a good first
 *     round, no clue longer than three numbers)
 *   - no board is much more work than the one before it
 *   - chains start easy: depth 0 boards average close to two rounds, so a
 *     return to keeping the hardest of three candidates fails here
 *
 * BASE=http://127.0.0.1:8765 node notan-zoom-lab/test-gen.cjs */
const { chromium } = require('playwright');
const V = require('./test-solve.cjs');

/* The band by depth: [solver, most rounds, fewest lines moving per round].
 * A copy of BAND in zoom.js, kept here on purpose so loosening the game's
 * band fails this test until the test agrees. */
const BAND = [['simple', 3, 3], ['simple', 4, 2], ['simple', 4, 2], ['simple', 5, 2], ['simple', 6, 2], ['pack', 7, 2], ['pack', 7, 2], ['pack', 8, 2]];
const AIM = [2, 3, 3, 4, 4, 5, 5, 6];
function bandOf(x) {
  if (x.tile != null) return { solver: 'simple', most: 4, lines: 1 };
  if (x.mode === 'mines') return { solver: 'simple', most: x.w <= 6 ? 4 : 5, lines: 2, thin: 0, opening: 0.4, firstInk: 2, numbers: 3 };
  const [solver, most, lines] = BAND[Math.min(x.bandRow != null ? x.bandRow : x.depth, BAND.length - 1)];
  return { solver, most, lines: x.mode === 'pixel' && x.depth <= 4 ? 3 : lines };
}
const fnOf = (n) => (n === 'pack' ? V.linePack : V.lineSimple);

/* One synchronous round: how many open squares, and ink squares, it decides. */
function firstRound(b, given, fn) {
  let decided = 0, ink = 0;
  const next = Int8Array.from(given);
  for (let li = 0; li < b.lines.length; li++) {
    const ix = b.lines[li];
    const cells = ix.map((i) => given[i]);
    if (!cells.includes(-1)) continue;
    const res = fn(cells, b.clues[li]);
    if (!res) return { decided: 0, ink: 0 };
    ix.forEach((i, t) => { if (res[t] !== cells[t] && next[i] === -1) { next[i] = res[t]; decided++; if (res[t] === 1) ink++; } });
  }
  return { decided, ink };
}

/* A quick brute-force check of the checker itself. */
function selfTest() {
  let seed = 7, fails = 0;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let t = 0; t < 3000; t++) {
    const n = 1 + Math.floor(rand() * 10);
    const sol = Array.from({ length: n }, () => (rand() < 0.5 ? 1 : 0));
    const clue = V.runs(sol), known = sol.map((v) => (rand() < 0.35 ? v : -1));
    const can1 = new Array(n).fill(false), can0 = new Array(n).fill(false);
    for (let m = 0; m < 1 << n; m++) {
      const line = Array.from({ length: n }, (_, i) => (m >> i) & 1);
      if (known.some((v, i) => v >= 0 && v !== line[i]) || V.runs(line).join() !== clue.join()) continue;
      line.forEach((v, i) => { if (v) can1[i] = true; else can0[i] = true; });
    }
    const exact = known.map((v, i) => (can1[i] && !can0[i] ? 1 : can0[i] && !can1[i] ? 0 : -1));
    const full = V.lineFull(known, clue);
    if (!full || full.join() !== exact.join()) fails++;
    for (const fn of [V.lineSimple, V.linePack]) {
      const r = fn(known, clue);
      if (!r || r.some((v, i) => v >= 0 && v !== sol[i])) fails++;
    }
  }
  for (let t = 0; t < 80; t++) {
    const w = 3 + Math.floor(rand() * 2), h = 3;
    const sol = Array.from({ length: w * h }, () => (rand() < 0.5 ? 1 : 0));
    const b = V.board(sol, w, h), given = new Int8Array(w * h).fill(-1);
    if (rand() < 0.5) for (let i = 0; i < w * h; i++) if (rand() < 0.2) given[i] = sol[i];
    let brute = 0;
    for (let m = 0; m < 1 << (w * h) && brute < 2; m++) {
      const g = Array.from({ length: w * h }, (_, i) => (m >> i) & 1);
      if (given.some((v, i) => v >= 0 && v !== g[i])) continue;
      if (V.cluesOf(g, w, h).every((c, k) => c.join() === b.clues[k].join())) brute++;
    }
    if (V.countSolutions(b, given, 2).count !== brute) fails++;
  }
  return fails;
}

(async () => {
  const bad = [];
  const sf = selfTest();
  if (sf) bad.push(`the independent checker disagrees with brute force ${sf} times`);
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const pg = await b.newPage();
  await pg.addInitScript(() => { window.__zoomTiming = { pause: 600, zoom: 1300, fade: 300 }; });
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto((process.env.BASE || 'http://127.0.0.1:8765') + '/notan-zoom-lab/');
  await pg.waitForFunction(() => window.ZoomLab && window.InkEngine);
  const out = await pg.evaluate(() => {
    const Z = window.ZoomLab, E = window.InkEngine, bad = [], stats = {}, boards = [];
    const FIRST = { merge: 5, pixel: 3, hole: 5, ring: 3, patch: 5, mines: 5 };
    const MERGE = [5, 6, 6, 7, 8], MINES = Z.MINES.sizes;
    const free = (g) => g.filter((v) => v < 0).length;
    const keep = (x, p) => boards.push(Object.assign(x, { w: p.w, h: p.h, sol: Array.from(p.sol), given: Array.from(p.given), fallback: !!p.fallback }));
    function check(p, where) {
      const { rows, cols } = E.cluesOf(p.sol, p.w, p.h);
      for (let i = 0; i < p.sol.length; i++) if (p.given[i] >= 0 && p.given[i] !== p.sol[i]) { bad.push(`${where}: a locked square disagrees with the answer`); return; }
      const res = E.propagate(rows, cols, p.w, p.h, p.given);
      if (!res.solved || res.grid.some((v, i) => v !== p.sol[i])) bad.push(`${where}: the line solver cannot finish it`);
    }
    const clone = (p) => Object.assign({}, p, { sol: Uint8Array.from(p.sol), given: Int8Array.from(p.given), cells: Int8Array.from(p.cells), hit: p.hit ? Uint8Array.from(p.hit) : p.hit });

    /* Mines: a careful player, who only fills what one line proves, never hits a mine. */
    function careful(p0, rng) {
      const p = clone(p0), { rows, cols } = E.cluesOf(p.sol, p.w, p.h);
      const know = (i) => (p.given[i] >= 0 ? p.given[i] : p.hit[i] ? 0 : p.cells[i]);
      for (let step = 0; step < p.w * p.h * 4 && !Z.isSolved(p); step++) {
        const li = Math.floor(rng() * (p.w + p.h)), isRow = li < p.h, k = isRow ? li : li - p.h, n = isRow ? p.w : p.h;
        const ix = Array.from({ length: n }, (_, t) => (isRow ? k * p.w + t : t * p.w + k));
        const res = E.solveLine(ix.map(know), isRow ? rows[k] : cols[k]);
        if (!res) return { hits: -1 };
        ix.forEach((i, t) => {
          if (know(i) !== -1 || res[t] === -1 || Z.isSolved(p)) return;
          Z.commitRun(p, [i], res[t], []);
        });
      }
      return { hits: p.hits, solved: Z.isSolved(p) };
    }

    for (const mode of Z.ORDER) {
      const st = stats[mode] = { boards: 0, gens: new Set(), sizes: new Set(), centered: 0, offCenter: 0, eccentric: 0, rings: 0, merges: 0, collapses: 0, years: new Set(), lockedEdges: 0, fallbacks: 0 };
      for (let s = 1; s <= 6; s++) {
        const ch = { seed: s * 104729, depth: 0, cur: null, view: 'world', undo: [] };
        let lastMass = -1, prev = null;
        for (let k = 0; k < 12; k++) {
          Z.advance(mode, ch);
          const c = ch.cur, where = `${mode} seed ${s} board ${k}`;
          st.boards++;
          if (c.gen) st.gens.add(c.gen);
          if (c.kind === 'world') {
            c.tiles.forEach((t, j) => {
              if (t.center) return;
              check(t.puzzle, `${where} tile ${j}`);
              keep({ mode, seed: s, depth: k, tile: j }, t.puzzle);
              const edge = Math.abs(t.tr - 1) + Math.abs(t.tc - 1) === 1 ? 5 : 0;
              const lockedT = t.puzzle.given.filter((v) => v >= 0).length;
              if (lockedT !== edge) bad.push(`${where} tile ${j}: ${lockedT} locked squares, expected ${edge}`);
              // the tile is the big picture's own slice
              for (let i = 0; i < 25; i++) if (t.puzzle.sol[i] !== c.sol[(t.tr * 5 + Math.floor(i / 5)) * 15 + t.tc * 5 + (i % 5)]) { bad.push(`${where} tile ${j}: differs from the big picture`); break; }
              const ink = t.puzzle.sol.reduce((a, v) => a + v, 0);
              if (ink < 3 || ink > 22) bad.push(`${where} tile ${j}: ${ink} ink squares, blank or full`);
              if (t.done) bad.push(`${where} tile ${j}: solved before it was opened`);
              if (Math.abs(t.tr - 1) + Math.abs(t.tc - 1) === 1) {
                const side = t.tr === 0 ? (i) => i >= 20 : t.tr === 2 ? (i) => i < 5 : t.tc === 0 ? (i) => i % 5 === 4 : (i) => i % 5 === 0;
                let ok = true;
                for (let i = 0; i < 25; i++) if (side(i) && t.puzzle.given[i] < 0) ok = false;
                if (ok) st.lockedEdges++; else bad.push(`${where} tile ${j}: edge next to the old picture is not locked`);
              }
              // finish it, as a player would, before the next zoom
              t.done = true;
            });
            prev = null;
            continue;
          }
          check(c, where);
          keep({ mode, seed: s, depth: k, bandRow: c.bandRow, prevRow: prev ? prev.bandRow : null, grew: !!prev && c.w > prev.w, merged: !!c.merged, collapsed: !!(c.hole && c.hole.collapsed), prevFree: prev ? free(prev.given) : null }, c);
          st.sizes.add(c.w);
          if (c.fallback) st.fallbacks++;
          if (k === 0 && c.w !== FIRST[mode]) bad.push(`${where}: starts ${c.w}x${c.h}, expected ${FIRST[mode]}x${FIRST[mode]}`);
          // Nothing starts locked but the squares the mode carries over:
          // Merge's and Mines' seed, Pixel's middle, Hole's void, Ring's core.
          {
            const carried = c.hole ? c.hole.cells.length : c.region ? c.region.h * c.region.w : 0;
            const locked = c.given.filter((v) => v >= 0).length;
            if (c.hole ? locked !== carried : locked > carried) bad.push(`${where}: ${locked} locked squares, ${carried} carried over`);
            if (k === 0 && locked > (mode === 'hole' ? 1 : 0)) bad.push(`${where}: the first board starts with locked squares`);
            if (E.mirrored(c.sol, c.w, c.h)) st.mirrored = (st.mirrored || 0) + 1;
          }
          if (mode === 'merge' || mode === 'mines') {
            const want = (mode === 'merge' ? MERGE : MINES)[Math.min(k, 4, (mode === 'merge' ? MERGE : MINES).length - 1)];
            if (c.w !== want) bad.push(`${where}: ${c.w}x${c.h}, expected ${want}x${want}`);
            if (prev) {
              const kk = Math.ceil(prev.w / 2), g = c.region, span = c.w - kk;
              if (!g || g.w !== kk || g.h !== kk || g.r < 0 || g.c < 0 || g.r + kk > c.w || g.c + kk > c.w) bad.push(`${where}: the seed is not a ${kk}x${kk} square inside the board`);
              else if (c.given.filter((v) => v >= 0).length !== kk * kk) bad.push(`${where}: ${c.given.filter((v) => v >= 0).length} locked squares, expected ${kk * kk}`);
              else if (span >= 2 && g.r * 2 === span && g.c * 2 === span) st.centered++;
              else st.offCenter++;
              if (!c.land || c.land.w !== prev.w / 2) bad.push(`${where}: the old board does not land two squares to one`);
            }
          }
          if (mode === 'pixel' && k > 0 && (c.w !== 5 || c.given[12] !== 1)) bad.push(`${where}: not a 5x5 with its middle locked`);
          if (mode === 'ring' && c.region) {
            st.rings++;
            if (c.merged) st.merges++;
            st.years.add(c.ring.year);
            const extra = c.w - c.region.w;
            if (c.region.r < 1 || c.region.c < 1 || extra - c.region.r < 1 || extra - c.region.c < 1) bad.push(`${where}: a side of the ring did not grow`);
            if (c.region.r * 2 !== extra || c.region.c * 2 !== extra) st.eccentric++;
            // squares added across: two or three for rings 1-3, up to four for 4-5, then six
            const most = c.ring.n <= 3 ? 3 : c.ring.n <= 5 ? 4 : 6;
            if (extra !== c.ring.add || extra < 2 || extra > most) bad.push(`${where}: ring ${c.ring.n} adds ${extra} across (says ${c.ring.add}), expected 2 to ${most}`);
            if (!c.merged) { st.early = (st.early || 0) + 1; if (c.region.r * 2 !== extra || c.region.c * 2 !== extra) st.earlyEccentric = (st.earlyEccentric || 0) + 1; }
            if (!c.merged && c.region.w !== prev.w) bad.push(`${where}: the core is not the last board`);
          }
          if (mode === 'hole') {
            const h = c.hole;
            if (h.mass < lastMass) bad.push(`${where}: mass went down`);
            lastMass = h.mass;
            if (h.collapsed) st.collapses++;
            if (c.w !== 2 * h.k + 5) bad.push(`${where}: ${c.w} wide with a hole of reach ${h.k}, expected a margin of two`);
            if (h.cells.some((i) => c.given[i] !== 0 || c.sol[i] !== 0)) bad.push(`${where}: a hole square is not locked empty`);
            if (c.w > 13) bad.push(`${where}: board wider than 13`);
            for (const a of new Set(h.cells.map((i) => Math.floor(i / c.w)))) {
              let row = 0, col = 0;
              for (let bb = 0; bb < c.w; bb++) { row += c.sol[a * c.w + bb]; col += c.sol[bb * c.w + a]; }
              if (!row || !col) st.emptyHoleLines = (st.emptyHoleLines || 0) + 1;
            }
          }
          if (mode === 'mines') {
            if (!(c.hit instanceof Uint8Array) || c.hit.length !== c.w * c.h || c.hit.some((v) => v) || c.hits !== 0 || c.lost !== false) bad.push(`${where}: not armed`);
            const m = Z.measureFrom(c.sol, c.w, c.h, c.given);
            const { rows, cols } = E.cluesOf(c.sol, c.w, c.h);
            const longest = Math.max(...rows.concat(cols).map((x) => x.length));
            if (!m.solved || m.depth > (c.w <= 6 ? 4 : 5) || m.opening < 0.4 || m.firstInk < 2 || longest > 3) bad.push(`${where}: outside the Mines gate ${JSON.stringify({ depth: m.depth, opening: m.opening, firstInk: m.firstInk, longest })}`);
            const rng = E.mulberry32(s * 31 + k);
            const cp = careful(c, rng);
            if (cp.hits !== 0 || !cp.solved) bad.push(`${where}: a careful player hit ${cp.hits} mines, solved ${cp.solved}`);
            // the rules, on copies
            const ink = [], empty = [];
            for (let i = 0; i < c.sol.length; i++) if (c.given[i] < 0) (c.sol[i] ? ink : empty).push(i);
            if (ink.length >= 2 && empty.length >= 3) {
              const p = Object.assign({}, c, { cells: Int8Array.from(c.cells), hit: new Uint8Array(c.w * c.h), hits: 0, lost: false });
              const r1 = Z.commitRun(p, [ink[0], empty[0], empty[1], ink[1]], 1, []);
              if (r1.done < 1 || r1.hit !== empty[0] || p.hits !== 1 || p.cells[empty[1]] !== -1 || p.cells[ink[1]] !== -1) bad.push(`${where}: a run did not stop at its first mine`);
              const r2 = Z.commitRun(p, [empty[0]], 1, []);
              if (r2.done || r2.hit >= 0 || p.hits !== 1) bad.push(`${where}: picking a found mine again changed something`);
              const r3 = Z.commitRun(p, ink, 0, []);
              if (r3.hit >= 0 || p.hits !== 1) bad.push(`${where}: a mark hit a mine`);
              const q = Object.assign({}, c, { cells: Int8Array.from(c.cells), hit: new Uint8Array(c.w * c.h), hits: 0, lost: false });
              for (const i of ink.slice(0, -1)) q.cells[i] = 1;
              const r4 = Z.commitRun(q, [ink[ink.length - 1], empty[0]], 1, []);
              if (!r4.solved || q.hits !== 0) bad.push(`${where}: the run that finishes the board did not stop there`);
              const l = Object.assign({}, c, { cells: Int8Array.from(c.cells), hit: new Uint8Array(c.w * c.h), hits: 0, lost: false });
              for (const i of empty.slice(0, 3)) Z.commitRun(l, [i], 1, []);
              const r5 = Z.commitRun(l, [ink[0]], 1, []);
              if (!l.lost || l.hits !== 3 || r5.done || l.cells[ink[0]] !== -1) bad.push(`${where}: three mines did not lose the board, or a lost board took a pick`);
            }
            // Another board: the same zoom, size and locked squares, a new picture
            if (k < 4) {
              const cc = Object.assign({}, ch, { cur: Object.assign({}, c, { hits: 3, lost: true }) });
              let same = 0;
              for (let t = 0; t < 3; t++) {
                const before = cc.cur;
                const r = Z.retryMines(cc);
                if (cc.depth !== ch.depth || r.w !== c.w || r.given.join() !== c.given.join() || JSON.stringify(r.region) !== JSON.stringify(c.region) || r.tries !== (before.tries || 0) + 1 || r.hits !== 0 || r.lost) bad.push(`${where}: Another board changed more than the picture`);
                if (r.sol.join() === before.sol.join()) same++;
                check(r, `${where} retry ${t + 1}`);
                keep({ mode, seed: s, depth: k, retry: t + 1 }, r);
                cc.cur = Object.assign(r, { hits: 3, lost: true });
              }
              st.sameRetries = (st.sameRetries || 0) + same;
            }
          }
          prev = c;
        }
      }
      if (mode === 'merge' || mode === 'mines') { if (st.centered) bad.push(`${mode}: ${st.centered} seeds dead center`); }
      // rings before a merge lean too, so the core drifts off center like a tree's
      if (mode === 'ring' && (st.earlyEccentric || 0) < 0.25 * st.early) bad.push(`ring: ${st.earlyEccentric || 0} of ${st.early} rings before a merge are lopsided`);
      if (st.sameRetries > 1) bad.push(`mines: ${st.sameRetries} retries dealt the same picture`);
      st.gens = [...st.gens].join(' ');
      st.years = [...st.years].join(' ');
      st.sizes = [...st.sizes].sort((a, z) => a - z).join(' ');
    }
    return { bad, stats, boards };
  });
  await b.close();
  for (const [m, st] of Object.entries(out.stats)) console.log(m, JSON.stringify(st));
  bad.push(...out.bad);

  // ---- independent checks, in node ----
  const per = {};
  for (const x of out.boards) {
    const name = `${x.mode} seed ${x.seed} board ${x.depth}${x.tile != null ? ' tile ' + x.tile : ''}${x.retry ? ' retry ' + x.retry : ''}`;
    const bd = V.board(x.sol, x.w, x.h), given = Int8Array.from(x.given);
    const cnt = V.countSolutions(bd, given, 2);
    if (cnt.aborted || cnt.count !== 1 || !cnt.sols[0].every((v, i) => v === x.sol[i])) bad.push(`${name}: ${cnt.aborted ? 'search aborted' : cnt.count + ' answers'}${cnt.count === 1 ? ', not the page\'s' : ''}`);
    const band = bandOf(x), fn = fnOf(band.solver);
    const r = V.rounds(bd, given, fn), L = V.productiveLines(bd, given, fn);
    const minL = L.length ? Math.min(...L) : 0;
    if (!r.solved || r.rounds > band.most || minL < band.lines) bad.push(`${name}: outside its band (${band.solver}, ${r.solved ? r.rounds + ' rounds' : 'unfinished'}, fewest lines ${minL}; at most ${band.most} rounds, at least ${band.lines} lines)`);
    if (band.thin != null) {
      const thin = V.bottlenecks(bd, given, fn, 2), f1 = firstRound(bd, given, fn), open = given.filter((v) => v < 0).length;
      const longest = Math.max(...bd.clues.map((c) => c.length));
      if (thin > band.thin || f1.decided < band.opening * open || f1.ink < band.firstInk || longest > band.numbers) bad.push(`${name}: outside the Mines gate (bottlenecks ${thin}, first round ${f1.decided} of ${open} with ${f1.ink} ink, longest clue ${longest})`);
    }
    if (x.fallback) bad.push(`${name}: a fallback board`);
    // Hole's band climbs a row a board, but waits a board rather than switch
    // rules on a board that just grew
    if (x.bandRow != null && !x.retry) {
      const row = (r) => BAND[Math.min(r, BAND.length - 1)];
      if (x.bandRow > x.depth || x.bandRow < x.depth - 2 || (x.prevRow != null && x.bandRow > x.prevRow + 1)) bad.push(`${name}: band row ${x.bandRow} at depth ${x.depth}`);
      if (x.grew && x.prevRow != null && row(x.bandRow)[0] !== row(x.prevRow)[0]) bad.push(`${name}: new rules on a board that grew`);
    }
    // growth: never much more work than the board before, short of a merge or collapse
    if (x.prevFree != null && !x.merged && !x.collapsed) {
      const now = given.filter((v) => v < 0).length;
      if (now > Math.max(1.75 * x.prevFree, x.prevFree + 24)) bad.push(`${name}: ${now} open squares after ${x.prevFree}`);
    }
    if (x.tile == null && !x.retry) {
      const key = x.mode + ' d' + Math.min(x.depth, 7);
      const a = per[key] = per[key] || { n: 0, rounds: 0, max: 0, thin: 0, sizes: new Set() };
      a.n++; a.rounds += r.rounds; a.max = Math.max(a.max, r.rounds); a.sizes.add(x.w);
      if (V.bottlenecks(bd, given, fn, 2)) a.thin++;
    }
  }
  for (const [k, a] of Object.entries(per)) {
    const mean = a.rounds / a.n, d = +k.split(' d')[1];
    console.log(k.padEnd(10), 'sizes', [...a.sizes].join('/').padEnd(8), 'rounds mean', mean.toFixed(2), 'max', a.max, 'bottleneck boards', a.thin);
    // A chain opens easy, and boards keep near the band's aim on average.
    // Keeping the hardest of three candidates instead fails here (Hole's
    // early boards average a round more).
    const aim = k.startsWith('pixel') ? Math.min(4, AIM[d]) : AIM[d];
    if (d === 0 && mean > 2.5) bad.push(`${k}: first boards average ${mean.toFixed(2)} rounds, aim 2`);
    if (mean > aim + 0.5) bad.push(`${k}: boards average ${mean.toFixed(2)} rounds, aim ${aim}`);
  }
  console.log(`independent checks: ${out.boards.length} boards`);
  const all = bad.concat(errs);
  console.log('problems:', all.length ? all.slice(0, 20) : 'none', all.length > 20 ? `(+${all.length - 20} more)` : '');
  process.exitCode = all.length ? 1 : 0;
})();
