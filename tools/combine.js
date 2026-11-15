#!/usr/bin/env node
// Search for Combine levels: boards where every listed rule changes par.
//   node tools/combine.js <rule,rule,...> [--sizes 3,3,2] [--free 3] [--length 24] [--min-par N] [--par N]
//                         [--seed 7] [--tries 4000] [--count 10]
// Sectors left over after files and free space are reserved, so the board is exactly --length long.
// Filters run cheapest first: already solved, par (search capped at 2e5 states), each rule matters, then detail metrics.
// Prints JSON lines ranked by quality. `similarity` is the closest match to an existing level (check-levels fails at 0.75).
const E = require('../engine.js');
const {addDetail, matters} = require('./metrics.js');
const {makeRng, build, canonical, quality} = require('./board-builder.js');
const {similarity} = require('./similarity.js');

const LETTERS = 'ABCD';

// One random board with every listed rule switched on. Null when the files do not fit.
function combineCandidate(rng, rules, {sizes = [3, 3, 2], free = 3, length = 24} = {}) {
  const has = rule => rules.includes(rule);
  const locked = has('system') ? 2 : 0;
  const reserved = length - sizes.reduce((a, b) => a + b, 0) - free - locked;
  if (reserved < 0) return null;
  const level = build(rng, {sizes, free, reserved, ordered: has('ordered'), homes: has('homes') ? sizes.length : 0, locked: locked || null});
  if (!level) return null;
  const links = [];
  if (has('system')) links.push(['S', 'A']);
  if (has('links')) for (let f = 0; f + 1 < sizes.length; f++) links.push([LETTERS[f], LETTERS[f + 1]]);
  if (links.length) level.links = links;
  if (has('consolidate')) level.consolidate = true;
  if (has('clipboard')) level.clipboard = true;
  if (has('nudge')) level.nudges = rng.between(1, 2);
  if (has('seek')) level.cost = 'seek';
  if (has('fragile')) {
    const cells = E.parseBoard(level.board);
    const where = test => cells.flatMap((t, i) => (test(t) ? [i + 1] : []));
    const empty = rng.shuffle(where(t => t === '.'));
    const files = rng.shuffle(where(t => /[A-R]/.test(t[0])));
    const fragile = [...empty.slice(0, rng.between(1, Math.min(3, empty.length))), ...files.slice(0, rng.between(0, 2))];
    level.fragile = fragile.sort((a, b) => a - b);
  }
  return level;
}

// Rough cost order, so cheap rejections happen first.
const ORDER = ['reserved', 'homes', 'ordered', 'links', 'consolidate', 'fragile', 'system', 'splitting', 'clipboard', 'nudge', 'seek'];

function search(rules, {sizes, free, length, minPar, par, seed, tries, count}) {
  const rng = makeRng(seed);
  const existing = require('../levels.js').levels;
  const checks = [...rules].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const seen = new Set();
  const found = [];
  for (let n = 0; n < tries && found.length < count * 3; n++) {
    const level = combineCandidate(rng, rules, {sizes, free, length});
    if (!level) continue;
    const key = canonical(level);
    if (seen.has(key)) continue;
    seen.add(key);
    if (E.solved(level, E.initialState(level))) continue;
    const best = E.solve(level, undefined, {limit: 2e5});
    if (best.aborted || best.cost === null || best.cost < minPar) continue;
    if (par !== null && best.cost !== par) continue;
    const ok = checks.every(rule => {
      try {
        return matters(level, rule, best.cost);
      } catch {
        return false;
      }
    });
    if (!ok) continue;
    const metrics = addDetail(level, {par: best.cost}, 3e5);
    metrics.quality = quality(metrics);
    const candidate = {id: 'candidate', ...level};
    metrics.similarity = Number(Math.max(...existing.map(other => similarity(candidate, other))).toFixed(2));
    found.push({...level, ...metrics});
    console.error(`try ${n}: kept ${found.length}`);
  }
  return found.sort((a, b) => b.quality - a.quality).slice(0, count);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const rules = (args[0] ?? '').split(',').filter(Boolean);
  const flag = (name, fallback) => {
    const at = args.indexOf('--' + name);
    return at < 0 ? fallback : args[at + 1];
  };
  const number = (name, fallback) => (flag(name, null) === null ? fallback : Number(flag(name)));
  const picks = search(rules, {
    sizes: flag('sizes', '3,3,2').split(',').map(Number),
    free: number('free', 3),
    length: number('length', 24),
    minPar: number('min-par', 3),
    par: number('par', null),
    seed: number('seed', 7),
    tries: number('tries', 4000),
    count: number('count', 10),
  });
  for (const level of picks) console.log(JSON.stringify(level));
  console.error(`${rules.join('+')}: showing ${picks.length}`);
}

module.exports = {combineCandidate};
