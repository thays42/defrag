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
for (const level of require('../levels.js').chapters.flatMap(c => c.levels).filter(l => !l.beatable)) {
  assert.strictEqual(E.solve(mirror(level)).cost, level.par, `mirror changes par of ${level.id}`);
}

console.log('tools ok');
