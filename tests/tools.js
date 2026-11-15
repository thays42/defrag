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
  // A rework that changes par takes a new id, so old best scores do not carry over.
  const RENAMED = {'scattered-gaps': 'scattered-gaps-ii'};
  for (const id of ORIGINAL_55_IDS) assert.ok(L.levels.some(l => l.id === (RENAMED[id] ?? id)), `${id} kept`);
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

// Reserved sectors are a constraint, not decoration: freeing them must lower par.
{
  const {without} = require('../tools/metrics.js');
  for (const id of ['scattered-gaps-ii', 'blocked-lanes', 'pocket-change']) {
    const level = require('../levels.js').levels.find(l => l.id === id);
    const freed = E.solve(without.reserved(level)).cost;
    assert.ok(freed < level.par, `${id}: freeing the reserved sectors must lower par (freed ${freed}, par ${level.par})`);
  }
}

// Every campaign level labelled reserved really depends on its reserved sectors. A bounded search proves it even on big boards.
{
  const {without} = require('../tools/metrics.js');
  const {matters} = require('../tools/metrics.js');
  for (const level of require('../levels.js').chapters.flatMap(c => c.levels).filter(l => l.mechanic === 'reserved' && !l.intro)) {
    assert.strictEqual(matters(level, 'reserved', level.par), true, `${level.id}: reserved sectors are decoration`);
  }
  assert.strictEqual(matters({board: 'A#A.', par: 1}, 'reserved', 1), false, 'freeing # in A#A. still costs 1');
}

// One bounded check per rule: switching the rule off changes par.
{
  const {matters} = require('../tools/metrics.js');
  const byId = id => require('../levels.js').levels.find(l => l.id === id);
  // The phase 2 scattered-gaps board, whose homes did not change par.
  const decorativeHomes = {board: '#..BB#A#A#######.#A.#.##', homes: {A: [3, 5], B: [19, 20]}};
  assert.strictEqual(matters(decorativeHomes, 'homes', 4), false);
  assert.strictEqual(matters(decorativeHomes, 'reserved', 4), true);
  assert.strictEqual(matters(byId('scattered-gaps-ii'), 'homes', 4), true);
  assert.strictEqual(matters(byId('blocked-lanes'), 'homes', 4), true);
  assert.strictEqual(matters(byId('two-splits'), 'splitting', 7), true);
  assert.strictEqual(matters(byId('tidy-disk'), 'consolidate', 6), true);
  assert.strictEqual(matters(byId('hold-that-thought'), 'clipboard', 4), true);
  assert.strictEqual(matters(byId('scoot-over'), 'nudge', 3), true);
  assert.strictEqual(matters(byId('long-way-round'), 'seek', 6), true);
  assert.strictEqual(matters(byId('load-order'), 'system', 4), true);
}

// Combine rules: every combined rule changes par, and the level is no easier than earlier levels of its rule.
{
  const L = require('../levels.js');
  const {combineProblems} = require('../tools/combine-rules.js');
  const byId = id => L.levels.find(l => l.id === id);
  const tag = (id, combines, extra = {}) => ({...byId(id), combines, ...extra});
  assert.deepStrictEqual(combineProblems([{name: 'X', levels: [tag('blocked-lanes', ['reserved', 'homes'])]}]), []);
  const oldGaps = {id: 'old-gaps', mechanic: 'reserved', par: 4, board: '#..BB#A#A#######.#A.#.##', homes: {A: [3, 5], B: [19, 20]}, combines: ['reserved', 'homes']};
  assert.deepStrictEqual(combineProblems([{name: 'X', levels: [oldGaps]}]), ['old-gaps: homes does not change par']);
  assert.deepStrictEqual(combineProblems([{name: 'X', levels: [tag('blocked-lanes', ['reserved'])]}]), ['blocked-lanes: combines needs at least 2 rules']);
  assert.deepStrictEqual(combineProblems([{name: 'X', levels: [tag('blocked-lanes', ['homes', 'splitting'])]}]),
    ['blocked-lanes: combines does not include mechanic reserved', 'blocked-lanes: splitting does not change par']);
  assert.ok(combineProblems([{name: 'X', levels: [byId('two-decks'), tag('in-order', ['ordered', 'homes'], {homes: {A: [3, 4]}, par: 1})]}])
    .includes('in-order: par 1 is below 7 of earlier ordered level two-decks'));
  assert.deepStrictEqual(combineProblems([{name: 'Boot', levels: [tag('two-splits', ['splitting', 'homes'])]}]),
    ['two-splits: Boot levels combine at least 3 rules', 'two-splits: the last Boot level must use system']);
  for (const level of L.chapters.flatMap(c => c.levels)) assert.ok(level.goal.length <= 70, `${level.id} goal is over 70 characters`);
}

// combine.js builds full-disk candidates with every listed rule switched on.
{
  const {makeRng} = require('../tools/board-builder.js');
  const {combineCandidate} = require('../tools/combine.js');
  const rng = makeRng(3);
  let level = null;
  for (let n = 0; n < 50 && !level; n++) level = combineCandidate(rng, ['ordered', 'homes'], {sizes: [3, 3, 2], free: 3, length: 24});
  assert.ok(level, 'no candidate built');
  assert.strictEqual(E.parseBoard(level.board).length, 24);
  assert.ok(/[1-9]/.test(level.board) && Object.keys(level.homes).length === 3);
  let sys = null;
  const rng2 = makeRng(5);
  for (let n = 0; n < 50 && !sys; n++) sys = combineCandidate(rng2, ['system', 'homes'], {sizes: [3, 2], free: 3, length: 24});
  assert.deepStrictEqual(sys.links[0], ['S', 'A']);
  assert.deepStrictEqual(sys.locked, ['S']);
  assert.strictEqual(E.parseBoard(sys.board).length, 24);
  // With a system file, A has no home and its run fits right after S.
  assert.strictEqual(sys.homes.A, undefined);
  const cells = E.parseBoard(sys.board);
  const slot = cells.lastIndexOf('S') + 1;
  assert.ok(cells.slice(slot, slot + 3).every(t => t !== '#') && slot + 3 <= 24);
  // --active keeps the puzzle in one stretch; homes move with it and never cover padding.
  const rng3 = makeRng(9);
  let small = null;
  for (let n = 0; n < 50 && !small; n++) small = combineCandidate(rng3, ['homes'], {sizes: [3, 2], free: 2, length: 24, active: 10});
  const padded = E.parseBoard(small.board);
  assert.strictEqual(padded.length, 24);
  const open = padded.flatMap((t, i) => (t === '#' ? [] : [i]));
  assert.ok(open[open.length - 1] - open[0] < 10, 'open sectors lie inside the active stretch');
  for (const [a, b] of Object.values(small.homes)) for (let i = a; i <= b; i++) assert.notStrictEqual(padded[i - 1], '#');
}

// Every campaign Combine level passes the Combine rules; scattered gaps is the Allocation Combine.
{
  const L = require('../levels.js');
  const {combineProblems} = require('../tools/combine-rules.js');
  assert.deepStrictEqual(L.levels.find(l => l.id === 'scattered-gaps-ii').combines, ['reserved', 'homes']);
  assert.deepStrictEqual(combineProblems(L.chapters), []);
}

// New Combine levels fill the disk, sit right after their chapter's Twists, and stay fast enough for hints.
const fastEnough = level => {
  const start = Date.now();
  const best = E.solve(level);
  assert.ok(!best.aborted && Date.now() - start < 2000, `${level.id} hint search is too slow`);
  if (level.fragile) assert.ok(!E.solve(level, undefined, {limit: 2e5}).aborted, `${level.id} dead-end check aborts`);
};
{
  const L = require('../levels.js');
  const byId = id => L.levels.find(l => l.id === id);
  const NEW_COMBINE = {
    'filed-in-order': 'two-decks', 'broken-chain': 'daisy-chain', 'install-path': 'driver-stack',
    'last-writes': 'failing-drive', 'fragile-hold': 'juggle', 'tight-quarters': 'shuffle-step', 'long-commute': 'head-travel',
  };
  const order = L.chapters.flatMap(c => c.levels).map(l => l.id);
  for (const [id, after] of Object.entries(NEW_COMBINE)) {
    const level = byId(id);
    assert.ok(level, `${id} missing`);
    assert.strictEqual(order.indexOf(id), order.indexOf(after) + 1, `${id} is not right after ${after}`);
    assert.strictEqual(E.placement(level).length, 24, `${id} does not fill the disk`);
    assert.ok(level.offset === undefined);
    fastEnough(level);
  }
}

console.log('tools ok');
