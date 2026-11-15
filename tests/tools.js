// Unit checks for the level tools. Run: node tests/tools.js
const assert = require('assert');
const {fingerprint, similarity, similarPairs} = require('../tools/similarity.js');

const lv = (board, extra = {}) => ({id: board, board, ...extra});
// Letters are ignored; structure is kept.
assert.strictEqual(similarity(lv('AB.AB'), lv('CD.CD')), 1);
// Fragment digits are kept.
assert.ok(similarity(lv('A2.A1.'), lv('A.A.')) < 1);
// Homes and cracked sectors are marked in the fingerprint...
assert.notDeepStrictEqual(fingerprint(lv('AA..')), fingerprint(lv('AA..', {homes: {A: [3, 4]}})));
assert.notDeepStrictEqual(fingerprint(lv('AA..')), fingerprint(lv('AA..', {fragile: [3]})));
// ...but the same layout with homes moved still counts as the same look.
assert.strictEqual(similarity(lv('.BCCCAA.BBAA'), lv('.BCCCAA.BBAA', {homes: {B: [1, 3], C: [6, 8], A: [9, 12]}})), 1);
// S stays S.
assert.deepStrictEqual(fingerprint(lv('S.A')).map(t => t[0]), ['S', '.', 'a']);
// Identical non-intro boards fail; an intro pair only warns.
assert.strictEqual(similarPairs([lv('.BCCCAA.BBAA'), {...lv('.BCCCAA.BBAA'), id: 'x'}])[0].level, 'fail');
assert.strictEqual(similarPairs([lv('A.A.', {intro: true}), {...lv('A.A.'), id: 'y'}])[0].level, 'warn');
// Dissimilar boards are not reported.
assert.strictEqual(similarPairs([lv('AA'), lv('#B#.#B.#.CC.C')]).length, 0);

// Board transforms keep the puzzle.
const E = require('../engine.js');
const {mirror, insertReserved, relabel} = require('../tools/redress.js');
const base = {id: 't', board: 'A2.A1B', homes: {B: [4, 4]}, fragile: [2], links: [['A', 'B']], goal: 'Join A before B.'};
const m = mirror(base);
assert.strictEqual(m.board, 'BA2.A1'); // tokens reversed, fragments renumbered k -> count+1-k
assert.deepStrictEqual(m.homes, {B: [1, 1]});
assert.deepStrictEqual(m.fragile, [3]);
assert.deepStrictEqual(m.links, [['B', 'A']]);
const i = insertReserved(base, 2, 2);
assert.strictEqual(i.board, 'A2##.A1B');
assert.deepStrictEqual(i.fragile, [4]);
assert.deepStrictEqual(i.homes, {B: [6, 6]});
assert.strictEqual(insertReserved(base, 5).board, 'A2.A1B#');
const r = relabel(base, {A: 'C', B: 'D'});
assert.strictEqual(r.board, 'C2.C1D');
assert.deepStrictEqual(r.homes, {D: [4, 4]});
assert.deepStrictEqual(r.links, [['C', 'D']]);
assert.strictEqual(r.goal, 'Join C before D.');
assert.strictEqual(base.board, 'A2.A1B'); // input untouched
// Mirroring keeps the optimum on every real level.
for (const level of require('../levels.js').levels.filter(l => !l.beatable)) {
  assert.strictEqual(E.solve(mirror(level)).cost, level.par, `mirror changes par of ${level.id}`);
}

// Travel and custom move prices.
assert.strictEqual(E.travelOf({type: 'move', from: 5, to: 2}), 3);
assert.strictEqual(E.travelOf({type: 'paste', to: 2}), 0);
assert.strictEqual(E.travelOf({type: 'cut', from: 2}), 0);
{
  const lvl = {board: 'BC.BACA..', homes: {A: [6, 7]}};
  const ops = E.solve(lvl).cost;
  const K = 64;
  const travelFirst = E.solve(lvl, undefined, {price: m => E.travelOf(m) * K + m.cost, maxCost: 200 * K});
  const seekBest = E.solve({...lvl, cost: 'seek'}).cost;
  // Lowest travel equals the seek optimum (no splits needed here), and needs at least as many operations.
  assert.strictEqual(Math.floor(travelFirst.cost / K), seekBest);
  assert.ok(travelFirst.cost % K >= ops);
  assert.strictEqual(travelFirst.path.reduce((t, m) => t + E.travelOf(m), 0), seekBest);
  // minPrice scales the heuristic: same answer, fewer states.
  const big = require('../levels.js').levels.find(l => l.id === 'required-split');
  const price = m => E.travelOf(m) * K + m.cost;
  const plain = E.solve(big, undefined, {price, maxCost: 200 * K});
  const scaled = E.solve(big, undefined, {price, maxCost: 200 * K, minPrice: K + 1});
  assert.strictEqual(scaled.cost, plain.cost);
  assert.ok(scaled.states < plain.states, `minPrice should prune: ${scaled.states} vs ${plain.states}`);
}

// Badge targets.
{
  const {computeBadges, opsOf} = require('../tools/badges.js');
  const L = id => require('../levels.js').levels.find(l => l.id === id);
  assert.deepStrictEqual(computeBadges(L('short-hops')), {}, 'intro levels hide the score, so offer no badges');
  assert.strictEqual(opsOf({split: true}), 2);
  assert.strictEqual(opsOf({}), 1);
  const beat = computeBadges(L('beat-par'));
  assert.ok(beat.under < L('beat-par').par, 'beat-par offers under par');
  assert.strictEqual(computeBadges(L('sweep-up')).tidy, undefined, 'consolidate level never offers tidy');
  assert.strictEqual(computeBadges(L('no-room-at-all')).light, undefined, 'clipboard level never offers light');
  assert.strictEqual(computeBadges(L('one-sector-off')).few, undefined, 'few is for seek levels only');
  assert.strictEqual(computeBadges({id: 'x', board: 'A.A', par: 1}).tidy, undefined, 'no tidy when par already tidies');
  // Every offered badge costs more than par under the level's own scoring (else 3 stars would earn it free).
  const E2 = require('../engine.js');
  for (const level of require('../levels.js').levels.filter(l => !l.beatable && l.board.length <= 10)) {
    const b = computeBadges(level);
    if (b.tidy !== undefined) assert.ok(b.tidy > level.par && E2.solve({...level, consolidate: true}).cost === b.tidy, `tidy ${level.id}`);
    if (b.unsplit !== undefined) assert.ok(b.unsplit > level.par, `unsplit ${level.id}`);
  }
  for (const [k, v] of Object.entries(computeBadges(L('required-split')))) assert.ok(Number.isInteger(v), k);
}


// Placement in the fixed 24-sector frame.
const at = (board, extra) => E.placement({board, ...extra});
assert.deepStrictEqual(at('A.A'), {offset: 7, length: 3}); // row 2, centered
assert.deepStrictEqual(at('AB'), {offset: 8, length: 2});
assert.deepStrictEqual(at('A.A.'), {offset: 7, length: 4});
assert.deepStrictEqual(at('AA.AA'), {offset: 6, length: 5}); // odd gap leans left
assert.deepStrictEqual(at('AA..AA'), {offset: 6, length: 6});
assert.deepStrictEqual(at('A2.A1.'), {offset: 7, length: 4}); // a fragment digit is not a sector
assert.deepStrictEqual(at('A.AAAAAA'), {offset: 6, length: 8}); // two rows: rows 2–3
assert.deepStrictEqual(at('A.AAACCC.BBBDD'), {offset: 0, length: 14}); // three rows start in row 1
assert.deepStrictEqual(at('.#B#...BB######A#AABA.##'), {offset: 0, length: 24});
assert.deepStrictEqual(at('A.AA..', {offset: 9}), {offset: 9, length: 6});
// A board longer than the frame starts at the top, so the checker sees it overflow.
assert.deepStrictEqual(at('A.'.repeat(15)), {offset: 0, length: 30});
// Boards are no longer padded.
assert.strictEqual(E.initialState({board: 'A.A'}).cells.length, 3);
assert.strictEqual(E.initialState({board: 'A.AAACCC.BBBDD'}).cells.length, 14);

// The campaign follows the outline's chapters; surplus hard levels sit in an Extra set.
{
  const L = require('../levels.js');
  const ORIGINAL_55_IDS = ["join-two-blocks","move-a-run","split-a-run","find-home","two-files","reserved-intro","scattered-gaps","warm-up","required-split","borrow-a-home","park-a-pair","choose-what-to-park","make-a-parking-spot","save-the-gap","a-can-wait","b-can-wait","required-split-revisited","beat-par","one-sector-off","two-splits","four-files","free-the-pair","trade-places","tight-fit","blocked-lanes","broken-workspace","across-the-disk","pocket-change","split-workspace","cut-across","in-order","shuffled","two-decks","no-room-at-all","hold-that-thought","juggle","short-hops","long-way-round","head-travel","one-gap","sweep-up","tidy-disk","boot-sector","load-order","kernel-space","driver-stack","cracked","one-write-left","failing-drive","chained","chain-of-three","daisy-chain","nudge","scoot-over","shuffle-step"];
  assert.deepStrictEqual(L.chapters.map(c => c.name), ['Format', 'Allocation', 'Move order', 'Fragmentation', 'Full disk', 'File system rules', 'Install', 'Wear', 'Recovery tools', 'Seek']);
  assert.ok(L.chapters.every(c => c.summary && c.levels.length), 'every chapter has a summary and levels');
  assert.deepStrictEqual(L.extras.levels.map(l => l.id), ['trade-places', 'broken-workspace', 'pocket-change']);
  assert.strictEqual(L.levels.length, L.chapters.flatMap(c => c.levels).length + L.extras.levels.length);
  assert.strictEqual(new Set(L.levels.map(l => l.id)).size, L.levels.length, 'no level appears twice');
  for (const id of ORIGINAL_55_IDS) assert.ok(L.levels.some(l => l.id === id), `${id} kept`);
}

// A level may only use a rule once the campaign has taught it. Row wrap is taught by across-the-break.
{
  const {teachOrderProblems} = require('../tools/teach-order.js');
  const t = (id, extra) => ({id, mechanic: 'basics', par: 1, board: 'A.A', ...extra});
  assert.deepStrictEqual(teachOrderProblems([t('a', {homes: {A: [1, 2]}}), t('b', {mechanic: 'homes', intro: true})]), ['a uses homes before it is taught']);
  assert.deepStrictEqual(teachOrderProblems([t('b', {mechanic: 'homes', intro: true, homes: {A: [2, 3]}}), t('a', {homes: {A: [1, 2]}})]), []);
  assert.deepStrictEqual(teachOrderProblems([t('w', {board: 'A.....A'})]), ['w uses row wrap before it is taught']);
  assert.deepStrictEqual(teachOrderProblems([t('across-the-break', {board: 'A.AA..', offset: 9})]), []);
  assert.deepStrictEqual(teachOrderProblems([t('s', {board: 'AA.AA', par: 2})]), ['s uses splitting before it is taught']);
  assert.deepStrictEqual(teachOrderProblems(require('../levels.js').chapters.flatMap(c => c.levels)), []);
}

console.log('tools ok');
