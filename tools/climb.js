#!/usr/bin/env node
// Hill-climb toward a Combine level: mutate seed boards and keep changes that score at least as well.
//   node tools/climb.js <rule,rule,...> --from seeds.jsonl [--min-par N] [--steps 300] [--seconds 300] [--seed 7] [--count 8]
// Seeds are JSON lines (or `kept {...}` lines from combine.js). Each needs board and the level fields for its rules;
// add the fields a new rule needs (for example consolidate: true) to the seeds first.
// Mutations: swap two sectors, move a home, move a cracked sector. S never moves.
// Score: rules that change par first, then par up to --min-par, then quality. Prints JSON lines ranked by quality,
// for boards where every rule changes par and par reaches --min-par.
//
// Badge mode redesigns an existing level so it offers a badge (a second goal that pulls against par):
//   node tools/climb.js --badge <level-id> [--seconds 300] [--steps N] [--seed 7] [--count 8]
// It also grows the board by one empty sector at either end. Every kept candidate passes the same guards as
// check-levels.js (see judge). Prints one JSON line per candidate with a badge, best first.
const fs = require('fs');
const E = require('../engine.js');
const {addDetail, matters, hintCheap, uses} = require('./metrics.js');
const {makeRng, quality} = require('./board-builder.js');
const {similarity, similarPairs} = require('./similarity.js');
const {computeBadges, overlaps} = require('./badges.js');
const {teachOrderProblems} = require('./teach-order.js');
const {combineProblems} = require('./combine-rules.js');

const METRIC_KEYS = ['par', 'splitGap', 'trapRate', 'paths', 'quality', 'similarity', 'moves', 'gains', 'ok', 'reason', 'badges', 'overlap', 'parDelta', 'changed', 'rank'];
const strip = row => Object.fromEntries(Object.entries(row).filter(([key]) => !METRIC_KEYS.includes(key)));

// The same level with one empty sector added at `side` ('start' or 'end'). Null when the board fills the frame
// or would no longer fit it at its offset. Growing at the start renumbers homes and cracked sectors.
function grow(level, side) {
  const length = E.parseBoard(level.board).length;
  if (length >= E.FRAME) return null;
  if (level.offset !== undefined && level.offset + length + 1 > E.FRAME) return null;
  if (side === 'end') return {...level, board: level.board + '.'};
  const next = {...level, board: '.' + level.board};
  if (level.homes) next.homes = Object.fromEntries(Object.entries(level.homes).map(([file, [a, b]]) => [file, [a + 1, b + 1]]));
  if (level.fragile) next.fragile = level.fragile.map(n => n + 1);
  return next;
}

// One random change. Null when the change is not possible. With {grow: true}, it sometimes grows the board.
function mutate(rng, level, {grow: growth = false} = {}) {
  if (growth && rng.random() < 0.15) return grow(level, rng.pick(['start', 'end']));
  const cells = E.parseBoard(level.board);
  const next = {...level, homes: level.homes && {...level.homes}, fragile: level.fragile && [...level.fragile]};
  const kind = rng.between(0, 2);
  if (kind === 0) {
    const open = cells.flatMap((t, i) => (t === 'S' ? [] : [i]));
    const [a, b] = [rng.pick(open), rng.pick(open)];
    if (cells[a] === cells[b]) return null;
    [cells[a], cells[b]] = [cells[b], cells[a]];
    next.board = cells.join('');
  } else if (kind === 1 && level.homes && Object.keys(level.homes).length) {
    const file = rng.pick(Object.keys(level.homes));
    const [first, last] = level.homes[file];
    const width = last - first + 1;
    const taken = new Set(Object.entries(level.homes).filter(([f]) => f !== file).flatMap(([, [a, b]]) => Array.from({length: b - a + 1}, (_, k) => a + k)));
    const starts = [];
    for (let s = 1; s + width - 1 <= cells.length; s++) {
      if (Array.from({length: width}, (_, k) => s + k).every(n => cells[n - 1] !== '#' && cells[n - 1] !== 'S' && !taken.has(n))) starts.push(s);
    }
    if (!starts.length) return null;
    const start = rng.pick(starts);
    next.homes[file] = [start, start + width - 1];
  } else if (kind === 2 && level.fragile?.length) {
    const free = cells.flatMap((t, i) => (t !== '#' && t !== 'S' && !level.fragile.includes(i + 1) ? [i + 1] : []));
    if (!free.length) return null;
    next.fragile[rng.between(0, next.fragile.length - 1)] = rng.pick(free);
    next.fragile.sort((a, b) => a - b);
  } else {
    return null;
  }
  // Homes must stay off reserved and system sectors.
  const after = E.parseBoard(next.board);
  for (const [first, last] of Object.values(next.homes ?? {})) {
    for (let n = first; n <= last; n++) if (after[n - 1] === '#' || after[n - 1] === 'S') return null;
  }
  return next;
}

// Higher is better. Null when the board is unsolvable or too large to search.
function evaluate(level, rules, minPar) {
  if (E.solved(level, E.initialState(level))) return null;
  const best = E.solve(level, undefined, {limit: 2e5});
  if (best.aborted || best.cost === null) return null;
  const par = best.cost;
  let ok = 0;
  for (const rule of rules) {
    try {
      if (matters(level, rule, par, {limit: 3e5})) ok++;
    } catch {
      // Unproven counts as not mattering.
    }
  }
  const feasible = ok === rules.length && par >= minPar;
  let metrics = {par};
  let score = ok * 10 + Math.min(par, minPar) * 2;
  if (feasible) {
    metrics = addDetail(level, {par}, 2e5);
    metrics.quality = quality(metrics);
    score += metrics.quality;
  }
  return {score, feasible, metrics};
}

function climb(rules, seeds, {minPar = 3, steps = 300, seconds = Infinity, seed = 7, count = 8} = {}) {
  const rng = makeRng(seed);
  const stop = Date.now() + seconds * 1000;
  const found = new Map();
  const keep = (level, result) => {
    if (!result?.feasible) return;
    const key = JSON.stringify(level);
    if (!found.has(key)) {
      found.set(key, {...level, ...result.metrics});
      console.error(`kept ${JSON.stringify({...level, ...result.metrics})}`);
    }
  };
  for (const start of seeds) {
    let current = strip(start);
    let result = evaluate(current, rules, minPar);
    if (!result) continue;
    keep(current, result);
    for (let n = 0; n < steps && Date.now() < stop; n++) {
      const next = mutate(rng, current);
      if (!next) continue;
      const tried = evaluate(next, rules, minPar);
      if (!tried || tried.score < result.score) continue;
      current = next;
      result = tried;
      keep(current, result);
    }
    if (Date.now() >= stop) break;
  }
  const existing = require('../levels.js').levels;
  return [...found.values()]
    .map(level => ({...level, similarity: Number(Math.max(...existing.map(other => similarity({id: 'candidate', ...strip(level)}, other))).toFixed(2))}))
    .sort((a, b) => b.quality - a.quality)
    .slice(0, count);
}

// Mechanics whose rule must change par; mirrors `checked` in check-levels.js.
const CHECKED = new Set(['ordered', 'clipboard', 'seek', 'consolidate', 'system', 'splitting', 'fragile', 'links', 'nudge', 'reserved']);
// Hint searches stop at this many states; mirrors the hint test in tests/tools.js.
const HINT_LIMIT = 2e5;

// One label per sector: its token, the file whose home covers it, and whether it is cracked.
function sectors(level) {
  const home = {};
  for (const [file, [a, b]] of Object.entries(level.homes ?? {})) for (let n = a; n <= b; n++) home[n] = file;
  const fragile = new Set(level.fragile ?? []);
  return E.parseBoard(level.board).map((token, i) => `${token}|${home[i + 1] ?? ''}|${fragile.has(i + 1) ? '!' : ''}`);
}

// Sectors that differ, at the alignment that differs least, plus one per added sector.
function changedSectors(original, candidate) {
  let [short, long] = [sectors(original), sectors(candidate)];
  if (short.length > long.length) [short, long] = [long, short];
  const added = long.length - short.length;
  let fewest = Infinity;
  for (let shift = 0; shift <= added; shift++) fewest = Math.min(fewest, short.filter((label, i) => label !== long[i + shift]).length);
  return fewest + added;
}

// The other combine levels with no rules to check, so combineProblems only spends time on the candidate.
// They still count as Combine levels, so the par-order check against the candidate is unchanged.
const onlyCandidate = (chapters, id) => chapters.map(c => ({...c, levels: c.levels.map(l => (l.combines && l.id !== id ? {...l, combines: []} : l))}));
// A message is about the level when it starts with its id (combine-rules.js, teach-order.js) or names it as
// the earlier level a Combine level's par must reach. Ids can also be rule names ('nudge'), so match by position.
const names = (message, id) => message.startsWith(`${id}: `) || message.startsWith(`${id} uses `) || message.endsWith(` level ${id}`);

// The best score the level promises. A beatable splitting level promises the best unsplit score.
function newPar(level, best) {
  if (level.beatable && level.mechanic === 'splitting') return E.solve(level, undefined, {whole: true, limit: HINT_LIMIT}).cost;
  return best;
}

const rulePasses = (level, rule, par) => {
  try {
    return matters(level, rule, par);
  } catch {
    return false; // Unproven counts as failing, so a candidate never passes by accident.
  }
};
const homesMatterCache = new WeakMap();
const homesMatter = (level, par) => {
  if (!homesMatterCache.has(level)) homesMatterCache.set(level, rulePasses(level, 'homes', par));
  return homesMatterCache.get(level);
};

// Run check-levels.js's guards on a redesign of `original`, cheapest first, stopping at the first failure.
// `chapters` is the campaign; the candidate replaces the original in a copy of it.
// Returns {ok, reason, badges, overlap, parDelta, changed}. Badges are only computed when every guard passes.
function judge(original, candidate, chapters) {
  const level = {...strip(candidate), id: original.id};
  const changed = changedSectors(original, level);
  const out = (reason, parDelta = null, badges = null, overlap = null) => ({ok: reason === null, reason, badges, overlap, parDelta, changed});
  const mechanic = level.mechanic;
  // The level's rule must still be switched on (cheap: data only).
  if (uses[mechanic] && !uses[mechanic](level)) return out('mechanic');
  const {offset, length} = E.placement(level);
  if (offset < 0 || offset + length > E.FRAME) return out('unsolvable');
  if (E.solved(level, E.initialState(level))) return out('unsolvable'); // nothing to do is not a puzzle
  const best = E.solve(level, undefined, {limit: HINT_LIMIT});
  if (best.aborted) return out('hint');
  if (best.cost === null) return out('unsolvable');
  const par = newPar(level, best.cost);
  if (par === null || par === undefined) return out('unsolvable');
  const parDelta = par - original.par;
  if (Math.abs(parDelta) > 1 || (level.beatable && par <= best.cost)) return out('par', parDelta);
  level.par = par;
  if (!level.intro && CHECKED.has(mechanic) && !rulePasses(level, mechanic, best.cost)) return out('mechanic', parDelta);
  // check-levels only warns when homes stop mattering; refuse to add that warning to a level that has none.
  if (!level.intro && mechanic === 'homes' && homesMatter(original, original.par) && !rulePasses(level, 'homes', best.cost)) return out('mechanic', parDelta);
  const swapped = chapters.map(c => ({...c, levels: c.levels.map(l => (l.id === level.id ? level : l))}));
  if (combineProblems(onlyCandidate(swapped, level.id)).some(m => names(m, level.id))) return out('combine', parDelta);
  if (teachOrderProblems(swapped.flatMap(c => c.levels)).some(m => names(m, level.id))) return out('teach', parDelta);
  const inChapters = new Set(swapped.flatMap(c => c.levels).map(l => l.id));
  const extras = require('../levels.js').levels.filter(l => !inChapters.has(l.id)).map(l => (l.id === level.id ? level : l));
  const pairs = similarPairs([...swapped.flatMap(c => c.levels), ...extras]);
  if (pairs.some(p => p.level === 'fail' && (p.a.id === level.id || p.b.id === level.id))) return out('similar', parDelta);
  if (!hintCheap(level, HINT_LIMIT)) return out('hint', parDelta);
  const badges = computeBadges(level);
  return out(null, parDelta, badges, overlaps(level, badges));
}

// Higher is better, compared in order: a badge set with no overlap, any badge, same par, fewer changes, quality.
const rankOf = r => [r.badgeCount && !r.overlap.length ? 1 : 0, r.badgeCount ? 1 : 0, r.parDelta === 0 ? 1 : 0, -r.changed, r.quality];
const compare = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

// Hill-climb a redesign of one level toward a badge. Returns candidates with a badge that pass every guard,
// best first, each with par set to its new optimum.
function climbBadge(levelId, {steps = 300, seconds = Infinity, seed = 7, count = 8} = {}) {
  const L = require('../levels.js');
  const original = L.levels.find(l => l.id === levelId);
  if (!original) throw new Error(`unknown level ${levelId}`);
  const rng = makeRng(seed);
  const stop = Date.now() + seconds * 1000;
  const found = new Map();
  const score = level => {
    const result = judge(original, level, L.chapters);
    if (!result.ok) return null;
    const par = original.par + result.parDelta;
    const scored = {...strip(level), id: original.id, par};
    const metrics = addDetail(scored, {par: E.solve(scored).cost}, 2e5);
    const row = {...scored, ok: true, badges: result.badges, overlap: result.overlap, parDelta: result.parDelta, changed: result.changed, quality: quality(metrics)};
    row.rank = rankOf({...row, badgeCount: Object.keys(row.badges).length});
    return row;
  };
  let current = score(original);
  if (!current) throw new Error(`${levelId} does not pass its own guards`);
  for (let n = 0; n < steps && Date.now() < stop; n++) {
    const next = mutate(rng, strip(current), {grow: true});
    if (!next) continue;
    const tried = score(next);
    if (!tried || compare(tried.rank, current.rank) < 0) continue;
    current = tried;
    const key = JSON.stringify(strip(current));
    if (current.changed && Object.keys(current.badges).length && !found.has(key)) {
      const {rank, ...row} = current;
      found.set(key, {rank, row});
      console.error(`kept ${JSON.stringify(row)}`);
    }
  }
  return [...found.values()].sort((a, b) => compare(b.rank, a.rank)).slice(0, count).map(({row}) => row);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const rules = (args[0] ?? '').split(',').filter(Boolean);
  const flag = (name, fallback) => {
    const at = args.indexOf('--' + name);
    return at < 0 ? fallback : args[at + 1];
  };
  const number = (name, fallback) => (flag(name, null) === null ? fallback : Number(flag(name)));
  if (flag('badge', null) !== null) {
    const id = flag('badge');
    const picks = climbBadge(id, {steps: number('steps', Infinity), seconds: number('seconds', 300), seed: number('seed', 7), count: number('count', 8)});
    for (const level of picks) console.log(JSON.stringify(level));
    console.error(`${id}: showing ${picks.length}`);
    process.exit(0);
  }
  const seeds = fs.readFileSync(flag('from'), 'utf8').split('\n').filter(line => line.includes('{')).map(line => JSON.parse(line.slice(line.indexOf('{'))));
  const picks = climb(rules, seeds, {minPar: number('min-par', 3), steps: number('steps', 300), seconds: number('seconds', Infinity), seed: number('seed', 7), count: number('count', 8)});
  for (const level of picks) console.log(JSON.stringify(level));
  console.error(`${rules.join('+')}: showing ${picks.length}`);
}

module.exports = {mutate, climb, grow, judge, climbBadge};
