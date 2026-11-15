#!/usr/bin/env node
// Search for Combine levels: boards where every listed rule changes par.
//   node tools/combine.js <rule,rule,...> [--sizes 3,3,2] [--free 3] [--length 24] [--active N] [--min-par N] [--par N]
//                         [--seed 7] [--tries 4000] [--count 10]
// Sectors left over after files and free space are reserved, so the board is exactly --length long.
// --active N keeps the puzzle in an N-sector stretch, with reserved padding at both ends.
// Filters run cheapest first: already solved, par (search capped at 2e5 states), each rule matters, then detail metrics.
// Each kept candidate is also written to stderr as it is found (`kept {...}`).
// Prints JSON lines ranked by quality. `similarity` is the closest match to an existing level (check-levels fails at 0.75).
const E = require('../engine.js');
const {addDetail, matters} = require('./metrics.js');
const {makeRng, build, canonical, quality} = require('./board-builder.js');
const {similarity} = require('./similarity.js');

const LETTERS = 'ABCD';

// One random board with every listed rule switched on. Null when the files do not fit.
// `active` sectors hold the puzzle; the rest of the board is reserved padding, split at random between the two ends.
function combineCandidate(rng, rules, {sizes = [3, 3, 2], free = 3, length = 24, active = length} = {}) {
  const has = rule => rules.includes(rule);
  const locked = has('system') ? 2 : 0;
  const reserved = active - sizes.reduce((a, b) => a + b, 0) - free - locked;
  if (reserved < 0 || active > length) return null;
  const level = build(rng, {sizes, free, reserved, ordered: has('ordered'), homes: has('homes') ? sizes.length : 0, locked: locked || null});
  if (!level) return null;
  const left = rng.between(0, length - active);
  level.board = '#'.repeat(left) + level.board + '#'.repeat(length - active - left);
  for (const file of Object.keys(level.homes ?? {})) level.homes[file] = level.homes[file].map(sector => sector + left);
  const links = [];
  if (has('system')) links.push(['S', 'A']);
  if (has('links')) for (let f = 0; f + 1 < sizes.length; f++) links.push([LETTERS[f], LETTERS[f + 1]]);
  if (links.length) level.links = links;
  // A's place is fixed by S→A, so with a system file only the other files get homes.
  if (has('system') && level.homes) delete level.homes.A;
  if (has('system')) {
    // A needs its whole run of open sectors right after S, outside every other home.
    const cells = E.parseBoard(level.board);
    const slot = cells.lastIndexOf('S') + 1;
    const span = [...Array(sizes[0]).keys()].map(i => slot + i);
    const inHome = i => Object.values(level.homes ?? {}).some(([a, b]) => i + 1 >= a && i + 1 <= b);
    if (span.some(i => i >= cells.length || cells[i] === '#' || inHome(i))) return null;
  }
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

// `found` is filled as the search runs, so a caller can report it if the search is stopped early.
// `stats` counts why candidates were dropped, so a dry search shows which filter to loosen.
function search(rules, {sizes, free, length, active, minPar, par, seed, tries, count}, found = [], stats = {}) {
  const drop = reason => {
    stats[reason] = (stats[reason] ?? 0) + 1;
  };
  const rng = makeRng(seed);
  const existing = require('../levels.js').levels;
  const checks = [...rules].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const seen = new Set();
  for (let n = 0; n < tries && found.length < count * 3; n++) {
    const level = combineCandidate(rng, rules, {sizes, free, length, active});
    if (!level) {
      drop('no fit');
      continue;
    }
    const key = canonical(level);
    if (seen.has(key)) continue;
    seen.add(key);
    if (E.solved(level, E.initialState(level))) {
      drop('solved');
      continue;
    }
    const best = E.solve(level, undefined, {limit: 2e5});
    if (best.aborted) {
      drop('par search too large');
      continue;
    }
    if (best.cost === null) {
      drop('unsolvable');
      continue;
    }
    if (best.cost < minPar || (par !== null && best.cost !== par)) {
      drop('par');
      continue;
    }
    const failed = checks.find(rule => {
      try {
        return !matters(level, rule, best.cost, {limit: 5e5});
      } catch {
        return true;
      }
    });
    if (failed) {
      drop(`${failed} does not change par`);
      continue;
    }
    const metrics = addDetail(level, {par: best.cost}, 3e5);
    metrics.quality = quality(metrics);
    const candidate = {id: 'candidate', ...level};
    metrics.similarity = Number(Math.max(...existing.map(other => similarity(candidate, other))).toFixed(2));
    found.push({...level, ...metrics});
    console.error(`kept ${JSON.stringify({...level, ...metrics})}`);
  }
  return rank(found, count);
}
const rank = (found, count) => [...found].sort((a, b) => b.quality - a.quality).slice(0, count);

if (require.main === module) {
  const args = process.argv.slice(2);
  const rules = (args[0] ?? '').split(',').filter(Boolean);
  const flag = (name, fallback) => {
    const at = args.indexOf('--' + name);
    return at < 0 ? fallback : args[at + 1];
  };
  const number = (name, fallback) => (flag(name, null) === null ? fallback : Number(flag(name)));
  const found = [];
  const stats = {};
  const count = number('count', 10);
  const report = picks => {
    for (const level of picks) console.log(JSON.stringify(level));
    console.error(`${rules.join('+')}: showing ${picks.length}; dropped ${JSON.stringify(stats)}`);
  };
  // A time limit (for example `timeout 600`) still prints the best candidates found so far.
  process.on('SIGTERM', () => {
    report(rank(found, count));
    process.exit(0);
  });
  const picks = search(rules, {
    sizes: flag('sizes', '3,3,2').split(',').map(Number),
    free: number('free', 3),
    length: number('length', 24),
    active: number('active', number('length', 24)),
    minPar: number('min-par', 3),
    par: number('par', null),
    seed: number('seed', 7),
    tries: number('tries', 4000),
    count,
  }, found, stats);
  report(picks);
}

module.exports = {combineCandidate};
