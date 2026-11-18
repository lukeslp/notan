/* node notan-zoom-lab/test-solvable.cjs [--chains N]
 * No browser. Builds boards with the page's own generators (the generation
 * code of zoom.js and journey.js, run in node with Notan's engine) and
 * checks each with test-solve.cjs, which shares no code with the page:
 *   - every board has exactly one answer given its clues and locked squares,
 *     and it is the page's stored picture (the page wins, and Mines places
 *     its mines, by the stored picture, so a second answer would be refused)
 *   - line logic (with single-square contradiction probing if it stalls)
 *     finishes it from its locked squares, so nobody has to guess
 *   - every locked square agrees with the picture
 * Covered: the Journey's 58 fixed boards; N chains of 12 boards in every
 * Primitives and Journey mode, Mines' Another board at every zoom, and every
 * tile of every Patch plate; a stripes fallback for a picture that cannot be
 * settled. The default N is 40; the full audit ran 20000 chains per mode. */
'use strict';
const fs = require('fs');
const path = require('path');
const V = require('./test-solve.cjs');
const E = require('./engine.js');
const LEVELS = require('./levels.js');

const NAMES = ['advance', 'retryMines', 'makePuzzle', 'makeWorld', 'JOURNEY', 'journeyBoard', 'stripes'];
function load(file, failSettle) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const a = src.indexOf('/* ---------- generation'), b = src.indexOf('/* ---------- drawing helpers');
  if (a < 0 || b < a) throw new Error(file + ': generation banners not found');
  const ret = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  // With failSettle, no picture ever settles, which drives every fallback.
  const force = failSettle ? '\nsettle = function () { return null; };' : '';
  // the page's own source, from this folder
  const lab = new Function('E', 'window', `'use strict';\n${src.slice(a, b)}${force}\nreturn { ${ret} };`)(E, { InkEngine: E, InkLevels: LEVELS });
  lab.ORDER = JSON.parse(src.match(/const ORDER = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  return lab;
}

/* Why a board fails, or null when it passes. */
function verdict(p) {
  const { w, h, sol, given } = p;
  for (let i = 0; i < w * h; i++) if (given[i] >= 0 && given[i] !== sol[i]) return `locked square ${i} is ${given[i]} but the picture says ${sol[i]}`;
  const b = V.board(sol, w, h);
  const start = Int8Array.from(given);
  const c = V.countSolutions(b, start, 2, 2000000);
  if (c.aborted) return 'answer count gave up';
  if (c.count !== 1) return c.count ? 'more than one answer' : 'no answer';
  if (c.sols[0].some((v, i) => v !== sol[i])) return 'its one answer is not the stored picture';
  let g = Int8Array.from(start);
  if (!V.propagate(b, g)) return 'contradiction';
  // single-square contradiction probing, only if line logic stalls
  for (let progress = true; progress && g.includes(-1);) {
    progress = false;
    for (let i = 0; i < g.length && !progress; i++) {
      if (g[i] !== -1) continue;
      for (const v of [1, 0]) {
        const t = Int8Array.from(g); t[i] = v;
        if (V.propagate(b, t)) continue;
        g[i] = 1 - v;
        if (!V.propagate(b, g)) return 'contradiction';
        progress = true;
        break;
      }
    }
  }
  if (g.includes(-1)) return 'logic stalls; a player has to guess';
  return null;
}

const arg = process.argv.indexOf('--chains');
const N = arg > 0 ? Number(process.argv[arg + 1]) : 40;
let fail = 0, checked = 0;
const bad = (msg) => { fail++; if (fail <= 30) console.log('  FAIL ' + msg); };
function check(name, cur) {
  const list = cur.kind === 'world' ? cur.tiles.filter((t) => !t.center).map((t) => [`${name} tile ${t.tr},${t.tc}`, t.puzzle]) : [[name, cur]];
  for (const [n, p] of list) { const why = verdict(p); if (why) bad(`${n} (${p.w}x${p.h}): ${why}`); checked++; }
}
const seedOf = (i) => (Math.imul(i + 1, 2654435761) >>> 1);

for (const file of ['zoom.js', 'journey.js']) {
  const lab = load(file);
  if (file === 'journey.js') for (let k = 0; k < lab.JOURNEY.length; k++) check(`journey board ${k + 1}`, lab.journeyBoard(k));
  for (const mode of lab.ORDER) {
    for (let i = 0; i < N; i++) {
      const ch = { seed: seedOf(i), depth: 0, cur: null, view: 'world', undo: [] };
      // the Journey's chains start where its fixed boards end
      const len = mode === 'journey' ? lab.JOURNEY.length + 12 : 12;
      for (let d = 0; d < len; d++) {
        lab.advance(mode, ch);
        if (mode === 'journey' && d < lab.JOURNEY.length) continue;
        check(`${file} ${mode} seed ${ch.seed} board ${ch.depth}`, ch.cur);
        if (mode === 'mines') {
          const again = Object.assign({}, ch);
          lab.retryMines(again);
          check(`${file} mines seed ${ch.seed} board ${ch.depth} Another board`, again.cur);
        }
      }
    }
  }
  // The last-resort picture, for when no generated picture can be settled:
  // with the hole's void, a Ring core, a Patch tile's locked edge, or nothing.
  if (lab.stripes) {
    for (const n of [5, 7, 9, 13]) {
      for (let t = 0; t < 20; t++) {
        const rng = E.mulberry32(t * 7919 + n);
        const fixed = new Int8Array(n * n).fill(-1);
        for (let i = 0; i < n * n; i++) if (rng() < 0.2) fixed[i] = rng() < 0.5 ? 1 : 0;
        const sol = lab.stripes(n, n, fixed);
        const why = verdict({ w: n, h: n, sol, given: fixed });
        if (why) bad(`${file} stripes ${n}x${n} try ${t}: ${why}`);
        checked++;
      }
    }
  } else bad(`${file}: no stripes fallback`);
  // When no picture settles at all, a board and a Patch plate must still come
  // out with one answer the clues reach (the fallbacks, wired in).
  const stuck = load(file, true);
  const hole = new Int8Array(49).fill(-1);
  for (const i of [17, 23, 24, 25, 31]) hole[i] = 0;
  for (const [name, n, fixed] of [['blank', 5, new Int8Array(25).fill(-1)], ['hole', 7, hole]]) {
    const p = stuck.makePuzzle(n, n, fixed, E.mulberry32(n), { gen: 'blobs', dens: 0.5, depth: 0 });
    const why = verdict(p);
    if (why || !p.fallback) bad(`${file} unsettled ${name} board: ${why || 'not marked as a fallback'}`);
    checked++;
  }
  const center = Uint8Array.from([0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1]);
  check(`${file} unsettled Patch plate`, stuck.makeWorld(center, E.mulberry32(3), 0, null));
}
console.log(fail ? `${fail} failure(s) in ${checked} boards` : `solvable: all ${checked} boards have one answer that logic reaches`);
process.exit(fail ? 1 : 0);
