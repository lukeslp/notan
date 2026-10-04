/* node test-levels.js
 * 1. Every ramp level has exactly one solution (independent branch-and-
 *    propagate count) and the line solver finishes it without guessing.
 * 2. The ramp eases in: level 1 is a tiny board whose every line is all or
 *    nothing, it ends on 15x15, and the measured band never moves by more
 *    than one between neighbors.
 * 3. The endless generator only yields unique, line-solvable boards, and
 *    the same seed always gives the same board. */
const E = require('./engine.js');
const LEVELS = require('./levels.js');
const PLUS = require('./plus-levels.js');

let fail = 0;
const bad = (msg) => { fail++; console.log('  FAIL ' + msg); };

// --- 1. every level
const ids = new Set(), names = new Set();
const measured = LEVELS.map((L, i) => {
  if (ids.has(L.id)) bad(`duplicate id ${L.id}`);
  if (names.has(L.name)) bad(`duplicate name ${L.name}`);
  ids.add(L.id); names.add(L.name);
  const { w, h, sol } = E.fromArt(L.art);
  const { rows, cols } = E.cluesOf(sol, w, h);
  const n = E.countSolutions(rows, cols, w, h, 2);
  const m = E.measure(rows, cols, w, h);
  const res = E.propagate(rows, cols, w, h);
  if (n !== 1) bad(`${L.id}: ${n} solutions`);
  if (!m.solvable || !res.solved) bad(`${L.id}: the line solver stalls`);
  else if (!E.same(Array.from(res.grid), Array.from(sol))) bad(`${L.id}: line solver reached a different picture`);
  console.log(`${String(i + 1).padStart(2)}. ${L.name.padEnd(10)} ${(w + 'x' + h).padEnd(6)} band ${m.band}  depth ${String(m.depth).padStart(2)}  opening ${m.opening.toFixed(2)}  score ${m.score}`);
  return { L, w, h, rows, cols, m };
});

// --- 2. the ramp
if (LEVELS.length < 40) bad(`only ${LEVELS.length} levels`);
const first = measured[0];
if (first.w > 3 || first.h > 3) bad('level 1 is bigger than 3x3');
const allOrNothing = (clue, len) => clue.length === 0 || (clue.length === 1 && clue[0] === len);
if (!first.rows.every((cl) => allOrNothing(cl, first.w)) || !first.cols.every((cl) => allOrNothing(cl, first.h))) bad('level 1 has a line that is not all or nothing');
if (first.m.band !== 1) bad('level 1 is not band 1');
const last = measured[measured.length - 1];
if (last.w !== 15 || last.h !== 15) bad('the ramp does not end on 15x15');
if (last.m.depth > 12) bad('the last main level exceeds depth 12');
if (last.m.band !== 8) bad('the last main level must be band 8');
if (last.m.depth < measured[measured.length - 2].m.depth) bad('the last main level is easier than its predecessor');
if (last.m.band < 7) bad('the last level is band ' + last.m.band + ', expected 7 or more');
for (let i = 1; i < measured.length; i++) {
  const a = measured[i - 1], b = measured[i];
  if (Math.abs(b.m.band - a.m.band) > 1) bad(`band jumps ${a.m.band} -> ${b.m.band} between ${a.L.name} and ${b.L.name}`);
}
const bands = measured.map((x) => x.m.band);
console.log('bands: ' + bands.join(' '));

// The former 28–30 spike must not return after the band-4 neighbors.
for (let i = 27; i <= 34; i++) {
  if (measured[i].m.band < measured[i - 1].m.band) bad(`ramp falls at level ${i + 1}`);
}

// New Game+: distinct hand-drawn pictures and a gentle, nondecreasing ramp.
if (PLUS.length < 18 || PLUS.length > 22) bad('expected about 20 New Game+ pictures');
const pictures = new Set(LEVELS.map(L => L.art.join('/')));
let previous = null;
PLUS.forEach((L, i) => {
  if (ids.has(L.id)) bad(`duplicate id ${L.id}`);
  if (names.has(L.name)) bad(`duplicate name ${L.name}`);
  ids.add(L.id); names.add(L.name);
  if (!/^[A-Z][a-z]+$/.test(L.name)) bad(`${L.id}: name is not one word`);
  if (pictures.has(L.art.join('/'))) bad(`${L.id}: duplicate picture`);
  pictures.add(L.art.join('/'));
  if (L.art.some(row => row.length !== L.art[0].length || /[^.#]/.test(row))) bad(`${L.id}: malformed art`);
  const { w, h, sol } = E.fromArt(L.art);
  if (w < 10 || w > 15 || h < 10 || h > 15) bad(`${L.id}: size outside 10–15`);
  const { rows, cols } = E.cluesOf(sol, w, h);
  const m = E.measure(rows, cols, w, h), res = E.propagate(rows, cols, w, h);
  if (E.countSolutions(rows, cols, w, h, 2) !== 1) bad(`${L.id}: not unique`);
  if (!m.solvable || !res.solved || !E.same(Array.from(res.grid), Array.from(sol))) bad(`${L.id}: not line-solvable`);
  if (m.depth > 12) bad(`${L.id}: exceeds depth 12`);
  const full = rows.filter(cl => cl.length === 1 && cl[0] === w).length + cols.filter(cl => cl.length === 1 && cl[0] === h).length;
  if (full > 2) bad(`${L.id}: ${full} full lines`);
  const mirrors = [
    L.art.every(row => row === [...row].reverse().join('')),
    L.art.every((row, r) => row === L.art[h - 1 - r]),
    w === h && L.art.every((row, r) => [...row].every((v, c) => v === L.art[c][r])),
    w === h && L.art.every((row, r) => [...row].every((v, c) => v === L.art[h - 1 - c][w - 1 - r])),
  ];
  if (mirrors.some(Boolean)) bad(`${L.id}: mirror-symmetric`);
  if (!i && (m.band < 6 || m.band > 7)) bad('New Game+ must start near levels 45–50');
  if (previous && (m.band < previous.band || m.band > previous.band + 1)) bad(`${L.id}: New Game+ band jump`);
  previous = m;
  console.log(`+${String(i + 1).padStart(2)} ${L.name.padEnd(10)} ${w}x${h} band ${m.band} depth ${m.depth} score ${m.score}, ${full} full lines`);
});

// --- 3. the generator
let made = 0;
for (const n of [5, 8, 10, 12, 15]) {
  for (let seed = 1; seed <= 40; seed++) {
    const g = E.generate(seed, n);
    if (!g) { bad(`generate(${seed}, ${n}) gave nothing`); continue; }
    const again = E.generate(seed, n);
    if (!E.same(Array.from(g.sol), Array.from(again.sol))) bad(`generate(${seed}, ${n}) is not deterministic`);
    const { rows, cols } = E.cluesOf(g.sol, n, n);
    if (JSON.stringify(rows) !== JSON.stringify(g.rows) || JSON.stringify(cols) !== JSON.stringify(g.cols)) bad(`generate(${seed}, ${n}) clues do not match its picture`);
    if (E.countSolutions(g.rows, g.cols, n, n, 2) !== 1) bad(`generate(${seed}, ${n}) is not unique`);
    if (!E.measure(g.rows, g.cols, n, n).solvable) bad(`generate(${seed}, ${n}) needs a guess`);
    made++;
  }
}
console.log(`generator: ${made}/200 boards unique and line-solvable`);

// --- the line solver on a few hand-checked lines
const sl = (cells, clue) => { const r = E.solveLine(cells, clue); return r && r.join(','); };
if (sl([-1, -1, -1, -1, -1], [3, 1]) !== '1,1,1,0,1') bad('solveLine 3 1 in 5');
if (sl([-1, -1, -1, -1, -1], [4]) !== '-1,1,1,1,-1') bad('solveLine 4 in 5');
if (sl([1, -1, -1, -1, -1], [1]) !== '1,0,0,0,0') bad('solveLine 1 with the first filled');
if (sl([0, 0, -1, 0, 0], [2]) !== null) bad('solveLine should reject 2 in a 1-square gap');

// --- which clue numbers fade: from the board only, walking in from each end
const dc = (cells, clue) => E.doneClues(cells, clue).map((d) => (d ? 'y' : 'n')).join('');
if (dc([1, 1, 0, -1, -1, -1], [2, 1]) !== 'yn') bad('doneClues: a closed run on the left finishes the first number');
if (dc([-1, -1, -1, 0, 1], [2, 1]) !== 'ny') bad('doneClues: a run against the right edge finishes the last number');
if (dc([1, 1, -1, -1, -1, -1], [2, 1]) !== 'nn') bad('doneClues: a run not yet closed off finishes nothing');
if (dc([1, 1, 1, 0, -1], [2, 1]) !== 'nn') bad('doneClues: a run of the wrong length finishes nothing');
if (dc([1, 0, 1, 1, 0], [1, 2]) !== 'yy') bad('doneClues: a decided line finishes every number');
if (dc([-1, 1, 0, -1, 1, 0, 1, 1], [1, 1, 2]) !== 'nny') bad('doneClues: an undecided square stops the walk from the left');
if (dc([0, 0, 0], []) !== '') bad('doneClues: an empty clue has no numbers');
if (dc([1, 0, 1, 0, 1], [1, 1, 1]) !== 'yyy') bad('doneClues: numbers are not counted twice from both ends');

console.log(fail ? `${fail} failure(s)` : 'all good');
process.exit(fail ? 1 : 0);
