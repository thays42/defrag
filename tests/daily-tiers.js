// Unit checks for the daily tiers. Run: node tests/daily-tiers.js
const assert = require('assert');
const E = require('../engine.js');
const T = require('../tools/daily-tiers.js');

// boardRules lists the rules a board uses, in mechanics order.
assert.deepStrictEqual(T.boardRules({board: 'A#A.'}), ['reserved']);
assert.deepStrictEqual(T.boardRules({board: 'BA.AB', homes: {A: [1, 2]}}), ['homes']);
// Splitting is listed only when no whole-run solution reaches the optimum.
for (const board of ['AA.AA', 'AAA.A.AAB', 'AB.BAAB.']) {
  const level = {board};
  const needs = (E.solve(level, undefined, {whole: true}).cost ?? Infinity) > E.solve(level).cost;
  assert.strictEqual(T.boardRules(level).includes('splitting'), needs, board);
}

// The pick: weekday from the date, consecutive weeks give consecutive boards.
const tiers = Object.fromEntries(T.DAYS.map(day => [day, [0, 1, 2].map(n => ({id: `${day}-${n}`}))]));
assert.strictEqual(T.pick(tiers, '2026-11-30').id.split('-')[0], 'monday');
assert.strictEqual(T.pick(tiers, '2026-11-29').id.split('-')[0], 'sunday');
assert.strictEqual(T.pick(tiers, '2026-11-26').id.split('-')[0], 'thursday');
const index = date => Number(T.pick(tiers, date).id.split('-')[1]);
assert.strictEqual(index('2026-12-07'), (index('2026-11-30') + 1) % 3);
assert.strictEqual(index('2026-12-06'), (index('2026-11-29') + 1) % 3);
assert.strictEqual(T.pick, E.dailyPick);

// tierProblems: missing days and short tiers.
const one = {monday: [{id: 'mon-1', mechanic: 'homes', par: 4, board: 'BBCA.B.A', homes: {A: [3, 4], B: [5, 7], C: [1, 1]}, rules: ['homes'], checked: ['homes']}]};
one.monday[0].par = E.solve(one.monday[0]).cost;
const problems = T.tierProblems(one, []);
assert.ok(problems.some(p => /monday: 1 boards, below 20/.test(p)), problems.join('\n'));
assert.ok(problems.some(p => /sunday: missing/.test(p)), problems.join('\n'));
assert.ok(!problems.some(p => /^mon-1/.test(p)), problems.join('\n'));
// Hand-edited rules drift from what the board uses.
const drift = {monday: [{...one.monday[0], rules: ['homes', 'reserved']}]};
assert.ok(T.tierProblems(drift, []).some(p => /mon-1: rules/.test(p)));
// Par off the optimum, and a copy of a campaign level.
const off = {monday: [{...one.monday[0], par: one.monday[0].par + 1}]};
assert.ok(T.tierProblems(off, []).some(p => /mon-1: par/.test(p)));
assert.ok(T.tierProblems(one, [{id: 'camp', board: 'BBCA.B.A'}]).some(p => /mon-1: similar 1\.00 to camp/.test(p)));
// A board may use only its tier's rules: no split on Monday.
const split = {monday: [{id: 'mon-9', mechanic: 'homes', board: 'AA.AA', rules: ['splitting'], checked: [], par: E.solve({board: 'AA.AA'}).cost}]};
assert.ok(T.tierProblems(split, []).some(p => /mon-9: uses splitting, outside monday/.test(p)), T.tierProblems(split, []).join('\n'));
assert.deepStrictEqual(T.outsideTier('monday', ['homes', 'reserved']), []);
assert.deepStrictEqual(T.outsideTier('tuesday', ['homes', 'splitting', 'reserved']), []);
assert.deepStrictEqual(T.outsideTier('tuesday', ['seek']), ['seek']);
assert.deepStrictEqual(T.outsideTier('sunday', ['seek', 'links', 'fragile', 'homes', 'reserved', 'splitting']), []);
// Weekend counts.
const sat = {saturday: [{...one.monday[0], id: 'sat-1', checked: ['homes']}]};
assert.ok(T.tierProblems(sat, []).some(p => /sat-1: saturday needs exactly 2 advanced rules/.test(p)));

console.log('daily tiers ok');

// The generator presets are callable, with a par window.
{
  const {candidates} = require('../tools/presets.js');
  const {makeRng} = require('../tools/board-builder.js');
  const found = candidates('homes', {rng: makeRng(3), tries: 200, par: [3, 6], count: 3});
  assert.ok(found.length >= 1 && found.length <= 3, String(found.length));
  assert.ok(found.every(level => level.par >= 3 && level.par <= 6));
  assert.strictEqual(typeof require('../tools/combine.js').search, 'function');
  console.log('presets ok');
}

// The build tool: daily.js round trip, and the screen that keeps or drops a candidate.
{
  const B = require('../tools/build-daily.js');
  const {candidates} = require('../tools/presets.js');
  const {makeRng} = require('../tools/board-builder.js');
  const file = require('path').join(require('os').tmpdir(), `daily-test-${process.pid}.js`);
  const data = {tiers: {monday: [{id: 'mon-1', mechanic: 'homes', par: 4, board: 'AB.BA', rules: ['homes'], checked: ['homes'], homes: {A: [1, 2]}}]}, commands: ['node tools/build-daily.js monday --seed 1'], frozen: false};
  B.writeDaily(file, data);
  const back = B.readDaily(file);
  assert.deepStrictEqual(back.tiers.monday, data.tiers.monday);
  assert.deepStrictEqual(back.commands, data.commands);
  assert.strictEqual(back.frozen, false);
  for (const day of T.DAYS.slice(1)) assert.deepStrictEqual(back.tiers[day], []);
  require('fs').unlinkSync(file);
  assert.deepStrictEqual(B.readDaily(file).tiers.sunday, [], 'a missing file gives empty tiers');

  const loose = {minTrap: 0, maxPaths: Infinity};
  const good = candidates('daily', {rng: makeRng(11), tries: 400, par: [3, 6], count: 40}).find(level => level.gains.homes < 0 && !T.outsideTier('monday', T.boardRules(level)).length);
  assert.ok(good, 'fixture: a daily candidate whose homes matter');
  const candidate = {...good, checked: ['homes']};
  assert.strictEqual(B.screen(candidate, {day: 'monday', kept: [], campaign: [], bounds: loose}), null);
  assert.match(B.screen(candidate, {day: 'monday', kept: [], campaign: [{id: 'camp', board: candidate.board}], bounds: loose}), /similar/);
  assert.match(B.screen({...candidate, par: 99}, {day: 'monday', kept: [], campaign: [], bounds: loose}), /par/);
  assert.match(B.screen(candidate, {day: 'monday', kept: [], campaign: [], bounds: {minTrap: 2, maxPaths: Infinity}}), /trap/);
  assert.match(B.screen({...candidate, board: 'AA.AA', homes: undefined, par: 3}, {day: 'monday', kept: [], campaign: [], bounds: loose}), /outside monday/);
  assert.match(B.screen({...candidate, checked: ['ordered', 'links', 'seek']}, {day: 'saturday', kept: [], campaign: [], bounds: loose}), /exactly 2/);
  console.log('build tool ok');
}

// Quality bounds are cached per campaign, so a short build run does not spend minutes on them.
{
  const B = require('../tools/build-daily.js');
  const fs = require('fs');
  const file = require('path').join(require('os').tmpdir(), `bounds-test-${process.pid}.json`);
  const campaign = [{id: 'x', board: 'AB.BAB'}, {id: 'y', board: 'ABA.BA'}];
  const fresh = B.cachedBounds(campaign, file);
  assert.deepStrictEqual(fresh, B.qualityBounds(campaign));
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({...saved, bounds: {minTrap: 0.123, maxPaths: 7}}));
  assert.deepStrictEqual(B.cachedBounds(campaign, file), {minTrap: 0.123, maxPaths: 7}, 'same campaign reads the cache');
  assert.deepStrictEqual(B.cachedBounds([...campaign, {id: 'z', board: 'AA.A'}], file), B.qualityBounds([...campaign, {id: 'z', board: 'AA.A'}]), 'a changed campaign recomputes');
  fs.unlinkSync(file);
  console.log('bounds cache ok');
}
