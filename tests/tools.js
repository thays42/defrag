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
  assert.deepStrictEqual(computeBadges(L('short-hops')), {}, 'intro levels offer no badges unless they teach them');
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


{
  const {computeBadges, overlaps, ranked} = require('../tools/badges.js');
  const L = id => require('../levels.js').levels.find(l => l.id === id);
  // The budget search agrees with the ranked search at the light target, and fails one below it.
  const level = L('a-can-wait');
  const light = computeBadges(level).light;
  const opsAtLight = ranked(level, E.travelOf, m => m.cost)[1];
  assert.strictEqual(E.solve(level, undefined, {budget: {price: E.travelOf, max: light}}).cost, opsAtLight);
  assert.strictEqual(E.solve(level, undefined, {budget: {price: E.travelOf, max: light - 1}}).cost, null);
  assert.strictEqual(E.solve(level, undefined, {budget: {price: E.travelOf, max: 999}}).cost, level.par);
  // load-drivers' earlier board: one route meets Unsplit and Few moves together.
  const oldDrivers = {...L('load-drivers'), board: '######ACB.BAAC.#########'};
  assert.deepStrictEqual(overlaps(oldDrivers, {unsplit: 23, few: 5}), [['unsplit', 'few']]);
  // Its redesign frees reserved sector 17, and no route meets both any more.
  assert.deepStrictEqual(overlaps(L('load-drivers'), {unsplit: 22, few: 5}), []);
  assert.deepStrictEqual(overlaps(L('a-can-wait'), {light}), [], 'one badge has no pairs');
  // Path counts would sum across spent amounts, so the two options refuse to combine.
  assert.throws(() => E.solve(level, undefined, {countPaths: true, budget: {price: E.travelOf, max: light}}), /countPaths/);
  // An intro level offers badges only when it teaches them.
  assert.deepStrictEqual(computeBadges({...L('short-hops'), teaches: undefined}), {});
  // A screening limit only drops badges: a search it cuts short offers none, and an unproven pair overlaps.
  assert.deepStrictEqual(computeBadges(level, {limit: 1e6}), {light});
  assert.deepStrictEqual(computeBadges(level, {limit: 5}), {});
  assert.deepStrictEqual(overlaps(L('choose-what-to-park'), {tidy: 4, light: 8}, {limit: 5}), [['tidy', 'light']]);
  const {judge} = require('../tools/climb.js');
  const chapters = require('../levels.js').chapters;
  assert.deepStrictEqual(judge(level, level, chapters).badges, {light});
  assert.deepStrictEqual(judge(level, level, chapters, {limit: 5}).badges, {});
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
  assert.deepStrictEqual(L.chapters.map(c => c.name), ['Format', 'Allocation', 'Move order', 'Fragmentation', 'Full disk', 'File system rules', 'Install', 'Wear', 'Recovery tools', 'Seek', 'Boot']);
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

// The Boot chapter closes the campaign: five full-disk finale levels, ending on the system file.
{
  const L = require('../levels.js');
  const boot = L.chapters.find(c => c.name === 'Boot');
  assert.deepStrictEqual(boot.levels.map(l => l.id), ['power-on', 'self-test', 'mount', 'load-drivers', 'first-boot']);
  for (const level of boot.levels) {
    assert.strictEqual(E.placement(level).length, 24, `${level.id} does not fill the disk`);
    assert.ok(level.offset === undefined);
    fastEnough(level);
  }
  const last = L.chapters.flatMap(c => c.levels).at(-1);
  assert.strictEqual(last.id, 'first-boot');
  assert.deepStrictEqual(last.locked, ['S']);
  assert.deepStrictEqual(last.links[0], ['S', 'A']);
}

// climb.js mutations keep the board's length and contents, keep S fixed, and keep homes off reserved and system sectors.
{
  const {mutate} = require('../tools/climb.js');
  const {makeRng} = require('../tools/board-builder.js');
  const rng = makeRng(4);
  const start = {board: '####.B3SS.B2A1A3B1C1C2A2########', homes: {B: [14, 16], C: [5, 6]}, locked: ['S'], links: [['S', 'A']], fragile: [5]};
  const sorted = board => E.parseBoard(board).sort().join();
  let level = start;
  for (let n = 0; n < 200; n++) {
    level = mutate(rng, level) ?? level;
    const cells = E.parseBoard(level.board);
    assert.strictEqual(sorted(level.board), sorted(start.board));
    assert.strictEqual(cells.indexOf('S'), E.parseBoard(start.board).indexOf('S'));
    for (const [a, b] of Object.values(level.homes)) for (let i = a; i <= b; i++) assert.ok(!['#', 'S'].includes(cells[i - 1]));
  }
  assert.notStrictEqual(level.board, start.board);
}

// Badge mode: growth adds one empty sector at either end, and judge runs the check-levels guards on a candidate.
{
  const {grow, judge} = require('../tools/climb.js');
  const {computeBadges} = require('../tools/badges.js');
  const L = require('../levels.js');
  const byId = id => L.levels.find(l => l.id === id);
  const home = {board: 'AB.AB.', homes: {A: [1, 2], B: [5, 6]}, fragile: [3]};
  assert.deepStrictEqual(grow(home, 'start'), {...home, board: '.AB.AB.', homes: {A: [2, 3], B: [6, 7]}, fragile: [4]});
  assert.deepStrictEqual(grow(home, 'end'), {...home, board: 'AB.AB..'});
  assert.strictEqual(grow(byId('mount'), 'end'), null, 'a full disk cannot grow');
  const placed = byId('across-the-break');
  const grown = grow(placed, 'end');
  assert.deepStrictEqual(E.placement(grown), {offset: 9, length: 7}, 'growth keeps the offset');
  assert.strictEqual(grow({board: 'AA.', offset: 21}, 'end'), null, 'growth stays inside the frame');
  const original = byId('park-a-pair');
  assert.strictEqual(judge(original, original, L.chapters).ok, true);
  assert.strictEqual(judge(original, original, L.chapters).changed, 0);
  assert.strictEqual(judge(original, {...original, homes: undefined}, L.chapters).reason, 'mechanic');
  assert.strictEqual(judge(original, {...original, board: original.board.replace(/\./g, '#')}, L.chapters).reason, 'unsolvable');
  // two-decks has par 7, park-a-pair par 3.
  assert.strictEqual(judge(original, {...byId('two-decks'), id: original.id}, L.chapters).reason, 'par');
  // No badge is offered before near-or-far teaches badges; the same boards offer them on their own.
  const fewer = byId('fewer-is-better');
  assert.deepStrictEqual(computeBadges({...fewer, board: 'ABA.AB'}), {}, 'computeBadges holds them back, so --write cannot emit them');
  assert.deepStrictEqual(computeBadges({...fewer, board: 'ABA.AB'}, {campaign: []}), {light: 5}, 'the board offers Light on its own');
  const early = judge(fewer, {...fewer, board: 'ABA.AB'}, L.chapters);
  assert.ok(early.ok);
  assert.deepStrictEqual(early.badges, {});
  // fewer-is-better also comes before one-gap, so only a level outside the campaign offers this board's Tidy.
  assert.deepStrictEqual(computeBadges({...fewer, id: 'loose', board: '.ABA.BA'}), {tidy: 3});
  assert.deepStrictEqual(judge(fewer, {...fewer, board: '.ABA.BA'}, L.chapters).badges, {}, 'Tidy is held back too');
  // Tidy is barred before one-gap teaches consolidate, even after near-or-far; other badges stay.
  const park = byId('choose-what-to-park');
  assert.deepStrictEqual(computeBadges({...park, id: 'loose'}), {tidy: 4, light: 8}, 'the board offers Tidy on its own');
  assert.deepStrictEqual(computeBadges(park), {light: 8});
  assert.deepStrictEqual(judge(park, park, L.chapters).badges, {light: 8});
  // The campaign can be passed in: with consolidate taught first, the same level offers Tidy.
  const taughtFirst = [{id: 'one-gap', intro: true, mechanic: 'consolidate'}, park];
  assert.deepStrictEqual(computeBadges(park, {campaign: taughtFirst}), {tidy: 4, light: 8});
  // --limit must be a positive number: an empty or zero limit would abort every search.
  const {spawnSync} = require('child_process');
  for (const bad of ['', '0', '-5']) {
    const run = spawnSync(process.execPath, [require.resolve('../tools/climb.js'), '--badge', 'near-or-far', '--steps', '1', '--seconds', '5', '--limit', bad], {encoding: 'utf8'});
    assert.notStrictEqual(run.status, 0, `--limit '${bad}' is refused`);
    assert.match(run.stderr, /--limit needs a positive number/);
  }
  // Growth is aligned before counting, so one added sector counts once.
  assert.strictEqual(judge(original, grow(original, 'start'), L.chapters).changed, 1);
  assert.strictEqual(judge(original, grow(grow(original, 'end'), 'start'), L.chapters).changed, 2);
  // Growth is opt-in for mutate, and still keeps the frame.
  const {mutate} = require('../tools/climb.js');
  const {makeRng} = require('../tools/board-builder.js');
  const rng = makeRng(3);
  const lengths = new Set();
  for (let n = 0; n < 200; n++) {
    const next = mutate(rng, placed, {grow: true});
    if (next) lengths.add(E.placement(next).length);
  }
  assert.ok(lengths.has(7) && lengths.has(6), 'mutate grows sometimes, not always');
}

// Seek matters only when every cheapest route takes more moves than the fewest-move route.
// The answer must not depend on which cheapest route the solver happens to return.
{
  const {matters} = require('../tools/metrics.js');
  const {seekDetour} = require('../tools/metrics.js');
  const loadDrivers = {board: '###.C1B2A1.C2B3A2A3#B1##########', homes: {A: [10, 12], B: [7, 9], C: [4, 5]}, cost: 'seek'};
  assert.strictEqual(seekDetour(loadDrivers), 0, 'a 6-move route also costs 18');
  assert.strictEqual(matters(loadDrivers, 'seek', 18), false);
  const byId = id => require('../levels.js').levels.find(l => l.id === id);
  for (const id of ['long-way-round', 'head-travel']) assert.ok(seekDetour(byId(id)) >= 1, `${id} needs a detour`);
}

// Hints stay cheap after the first move too: every campaign level solves within 2e5 states from its start
// and from every position one move in. game.js stops a hint at 3e5 states, so this keeps hints working early on.
{
  const L = require('../levels.js');
  const {hintCheap} = require('../tools/metrics.js');
  assert.strictEqual(hintCheap(L.levels.find(l => l.id === 'tight-fit'), 2e5), true);
  assert.strictEqual(hintCheap({board: '###.C1B2A1.C2B3A2A3#B1##########', homes: {A: [10, 12], B: [7, 9], C: [4, 5]}, cost: 'seek'}, 2e5), false);
  assert.deepStrictEqual(L.chapters.flatMap(c => c.levels).filter(level => !hintCheap(level, 2e5)).map(level => level.id), []);
}

// Near or far teaches Light touch: one route at par, and a gentler one a move longer.
{
  const L = require('../levels.js');
  const {computeBadges} = require('../tools/badges.js');
  const format = L.chapters[0].levels.map(l => l.id);
  assert.strictEqual(format.indexOf('near-or-far'), format.indexOf('fewer-is-better') + 1);
  assert.strictEqual(format.indexOf('warm-up'), format.indexOf('near-or-far') + 1);
  const near = L.levels.find(l => l.id === 'near-or-far');
  assert.ok(near.intro && near.teaches === 'badges');
  assert.ok(E.placement(near).length <= E.COLUMNS, 'one row');
  const light = computeBadges(near).light;
  assert.ok(Number.isInteger(light), 'offers Light touch');
  // The low-travel route costs exactly one move more than par.
  assert.strictEqual(E.solve(near, undefined, {budget: {price: E.travelOf, max: light}}).cost, near.par + 1);
}

// Badge rules: coverage floor, overlap ceiling, and no badge before badges are taught.
{
  const {badgeProblems} = require('../tools/badge-rules.js');
  const lv = (id, extra = {}) => ({id, ...extra});
  const campaign = [lv('t', {intro: true}), lv('near-or-far', {intro: true, teaches: 'badges'}), lv('a'), lv('b'), lv('c'), lv('d')];
  const early = [lv('t', {intro: true}), lv('e'), lv('near-or-far', {intro: true, teaches: 'badges'}), lv('a')];
  const none = () => [];
  const limits = {floor: 0.75, maxOverlap: 0.5};
  assert.deepStrictEqual(badgeProblems(campaign, {a: {tidy: 3}, b: {light: 4}, c: {few: 2}}, limits, none), []);
  assert.match(badgeProblems(campaign, {a: {tidy: 3}, b: {light: 4}}, limits, none).join(), /coverage 2\/4 .*c, d/);
  assert.deepStrictEqual(badgeProblems(early, {e: {light: 3}, a: {tidy: 1}}, limits, none), ['e offers light before near-or-far']);
  assert.deepStrictEqual(badgeProblems(early, {e: {tidy: 3, unsplit: 4}, a: {tidy: 1}}, limits, none), ['e offers tidy, unsplit before near-or-far']);
  assert.deepStrictEqual(badgeProblems(early, {a: {tidy: 1}}, {floor: 0.5, maxOverlap: 0.5}, none), [], 'badges after the teach level are fine');
  // Tidy is barred before the first consolidate intro level (one-gap); other badges there are fine.
  const gap = lv('one-gap', {intro: true, mechanic: 'consolidate'});
  const untaught = [lv('near-or-far', {intro: true, teaches: 'badges'}), lv('a'), gap, lv('b')];
  assert.deepStrictEqual(badgeProblems(untaught, {a: {tidy: 3, light: 4}, b: {light: 2}}, limits, none), ['a offers tidy before one-gap']);
  assert.deepStrictEqual(badgeProblems(untaught, {a: {light: 4}, b: {tidy: 2}}, limits, none), [], 'Tidy after one-gap is fine');
  const pool = {a: {tidy: 3, unsplit: 4}, b: {tidy: 1, light: 2}, c: {few: 2}};
  const both = level => (level.id === 'a' || level.id === 'b' ? [['x', 'y']] : []);
  assert.match(badgeProblems(campaign, pool, limits, both).join(), /overlap 2\/2/);
  assert.deepStrictEqual(badgeProblems(campaign, {a: {tidy: 3}}, {floor: 0, maxOverlap: 0}, none), [], 'no two-badge level passes');
}

console.log('tools ok');
