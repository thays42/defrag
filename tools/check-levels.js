#!/usr/bin/env node
// Verifies every level: par equals the solver's optimum, ids are unique, data is valid,
// and the level's mechanic actually changes the result. Exits 1 on any failure.
//   node tools/check-levels.js [--metrics]
const E = require('../engine.js');
const {measure, addDetail, without, uses} = require('./metrics.js');
const {similarPairs} = require('./similarity.js');
const {mechanics, chapters} = require('../levels.js');
const daily = require('../daily.js');

const showMetrics = process.argv.includes('--metrics');
// Trap rate and line count recorded before a re-dress, so --metrics can report drift.
const baselinePath = require('path').join(__dirname, 'metrics-baseline.json');
if (process.argv.includes('--save-baseline')) {
  const baseline = {};
  for (const level of chapters.flatMap(c => c.levels)) {
    const m = addDetail(level, {par: E.solve(level).cost}, 3e5);
    baseline[level.id] = {board: level.board, trapRate: m.trapRate, paths: m.paths};
  }
  require('fs').writeFileSync(baselinePath, JSON.stringify(baseline, null, 1) + '\n');
  console.log(`Saved metrics baseline for ${Object.keys(baseline).length} levels.`);
  process.exit(0);
}
const baseline = require('fs').existsSync(baselinePath) ? require(baselinePath) : {};
const mechanicIds = new Set(mechanics.map(m => m.id));
const problems = [];
const warnings = [];
// Older campaign levels predate this check; report them without failing.
const soft = {
  homes: (level, par) => optimum(without.homes(level), {limit: 3e5}) < par,
  reserved: (level, par) => optimum(without.reserved(level), {limit: 3e5}) < par,
};
const ids = new Set();
const all = [...chapters.flatMap(c => c.levels), ...daily.dailyPool.map(level => ({...level, mechanic: level.mechanic ?? 'homes', daily: true}))];

// Which flag each new mechanic needs, and how to tell it matters.
const needs = {
  ordered: level => uses.ordered(level),
  clipboard: level => uses.clipboard(level),
  seek: level => uses.seek(level),
  consolidate: level => uses.consolidate(level),
  system: level => level.locked?.length > 0,
  fragile: level => uses.fragile(level),
  links: level => uses.links(level),
  nudge: level => uses.nudge(level),
};
// Infinity when unsolvable. Throws if the search hit its size limit, so a check never passes by accident.
function optimum(level, options) {
  const result = E.solve(level, undefined, options);
  if (result.aborted) throw new Error('search too large to check');
  return result.cost ?? Infinity;
}
const matters = {
  ordered: (level, par) => optimum(without.ordered(level)) < par,
  clipboard: (level, par) => !(optimum(without.clipboard(level)) <= par),
  seek: (level, par) => optimum(without.seek(level)) < par,
  consolidate: (level, par) => optimum(without.consolidate(level)) < par,
  system: (level, par) => optimum(without.system(level)) < par && optimum(without.links(level)) < par,
  splitting: (level, par) => optimum(level, {whole: true}) > par,
  fragile: (level, par) => optimum(without.fragile(level)) < par,
  links: (level, par) => optimum(without.links(level)) < par,
  nudge: (level, par) => !(optimum(without.nudge(level)) <= par),
};

for (const level of all) {
  const where = level.id ?? level.name;
  const fail = message => problems.push(`${where}: ${message}`);
  if (!level.id) fail('missing id');
  if (ids.has(level.id)) fail('duplicate id');
  ids.add(level.id);
  if (!mechanicIds.has(level.mechanic)) fail(`unknown mechanic "${level.mechanic}"`);
  const cells = E.initialState(level).cells;
  for (const [file, [first, last]] of Object.entries(level.homes ?? {})) {
    const span = last - first + 1;
    if (first < 1 || last > cells.length || span < E.info(level).counts[file]) fail(`home ${file} does not fit`);
    if (cells.slice(first - 1, last).includes(E.RESERVED)) fail(`home ${file} covers a reserved sector`);
  }
  if (needs[level.mechanic] && !needs[level.mechanic](level)) fail(`mechanic ${level.mechanic} is not switched on`);
  const best = E.solve(level);
  if (best.cost === null) {
    fail('unsolvable');
    continue;
  }
  if (level.beatable ? level.par < best.cost : level.par !== best.cost) fail(`par ${level.par}, optimum ${best.cost}`);
  // Intro levels teach a rule; they need not depend on it.
  try {
    if (!level.intro && matters[level.mechanic] && !matters[level.mechanic](level, best.cost)) fail(`${level.mechanic} does not change the result`);
  } catch (error) {
    fail(error.message);
  }
  try {
    if (!level.intro && !level.daily && soft[level.mechanic] && !soft[level.mechanic](level, best.cost)) warnings.push(`${where}: ${level.mechanic} does not change the result`);
  } catch (error) {
    warnings.push(`${where}: ${error.message}`);
  }
  if (showMetrics && !level.daily) {
    const m = measure(level, {limit: 3e5});
    const fmt = v => (v === Infinity ? '∞' : v);
    const was = baseline[level.id];
    const drift = was && was.board !== level.board ? `  (was trap ${was.trapRate.toFixed(2)}, lines ${fmt(was.paths ?? Infinity)})` : '';
    console.log(`${level.mechanic.padEnd(12)} ${level.id.padEnd(26)} par ${String(level.par).padStart(2)}  trap ${m.trapRate.toFixed(2)}  lines ${String(fmt(m.paths)).padStart(4)}  split-gap ${fmt(m.splitGap)}${drift}`);
    if (drift && (m.trapRate < was.trapRate - 0.1 || m.paths > 2 * (was.paths ?? Infinity))) warnings.push(`${where}: re-dress changed difficulty${drift.replace('  (was', ' (was')}, now trap ${m.trapRate.toFixed(2)}, lines ${fmt(m.paths)}`);
  }
}

// Campaign levels must look distinct. Intro pairs only warn: tiny boards cannot differ much.
for (const pair of similarPairs(chapters.flatMap(c => c.levels))) {
  const line = `similar ${pair.score.toFixed(2)}: ${pair.a.id} ${pair.a.board} ~ ${pair.b.id} ${pair.b.board}`;
  (pair.level === 'fail' ? problems : warnings).push(line);
}

if (warnings.length) console.warn('Warnings:\n  ' + warnings.join('\n  '));
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`${problems.length} problem(s) in ${all.length} levels`);
  process.exit(1);
}
console.log(`All ${all.length} levels pass.`);
