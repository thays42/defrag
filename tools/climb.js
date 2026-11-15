#!/usr/bin/env node
// Hill-climb toward a Combine level: mutate seed boards and keep changes that score at least as well.
//   node tools/climb.js <rule,rule,...> --from seeds.jsonl [--min-par N] [--steps 300] [--seconds 300] [--seed 7] [--count 8]
// Seeds are JSON lines (or `kept {...}` lines from combine.js). Each needs board and the level fields for its rules;
// add the fields a new rule needs (for example consolidate: true) to the seeds first.
// Mutations: swap two sectors, move a home, move a cracked sector. S never moves.
// Score: rules that change par first, then par up to --min-par, then quality. Prints JSON lines ranked by quality,
// for boards where every rule changes par and par reaches --min-par.
const fs = require('fs');
const E = require('../engine.js');
const {addDetail, matters} = require('./metrics.js');
const {makeRng, quality} = require('./board-builder.js');
const {similarity} = require('./similarity.js');

const METRIC_KEYS = ['par', 'splitGap', 'trapRate', 'paths', 'quality', 'similarity', 'moves', 'gains'];
const strip = row => Object.fromEntries(Object.entries(row).filter(([key]) => !METRIC_KEYS.includes(key)));

// One random change. Null when the change is not possible.
function mutate(rng, level) {
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

if (require.main === module) {
  const args = process.argv.slice(2);
  const rules = (args[0] ?? '').split(',').filter(Boolean);
  const flag = (name, fallback) => {
    const at = args.indexOf('--' + name);
    return at < 0 ? fallback : args[at + 1];
  };
  const number = (name, fallback) => (flag(name, null) === null ? fallback : Number(flag(name)));
  const seeds = fs.readFileSync(flag('from'), 'utf8').split('\n').filter(line => line.includes('{')).map(line => JSON.parse(line.slice(line.indexOf('{'))));
  const picks = climb(rules, seeds, {minPar: number('min-par', 3), steps: number('steps', 300), seconds: number('seconds', Infinity), seed: number('seed', 7), count: number('count', 8)});
  for (const level of picks) console.log(JSON.stringify(level));
  console.error(`${rules.join('+')}: showing ${picks.length}`);
}

module.exports = {mutate, climb};
