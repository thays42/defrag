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
// Weekend counts.
const sat = {saturday: [{...one.monday[0], id: 'sat-1', checked: ['homes']}]};
assert.ok(T.tierProblems(sat, []).some(p => /sat-1: saturday needs exactly 2 advanced rules/.test(p)));

console.log('daily tiers ok');
