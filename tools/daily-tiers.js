// Daily tiers: the weekday spec, and the checks shared by build-daily.js and check-levels.js.
// Each weekday has its own tier of boards. The weekday picks the tier, the week picks the board (E.dailyPick).
const E = require('../engine.js');
const {uses, matters} = require('./metrics.js');
const {similarity} = require('./similarity.js');
const {mechanics} = require('../levels.js');

const DAYS = E.DAYS;
const ADVANCED = ['ordered', 'consolidate', 'links', 'system', 'fragile', 'clipboard', 'nudge', 'seek'];
const MIN_TIER = 20;
const TARGET_TIER = 60;
// A hint runs the solver in the player's browser, so every board's hint search must stay this small.
const HINT_LIMIT = 2e5;
const SIMILAR_FAIL = 0.75;

// `checked`: the rules that must change par. Other rules may appear on a board without mattering.
const TIERS = {
  monday: {par: [3, 6], sources: [{preset: 'daily', checked: ['homes']}]},
  tuesday: {par: [5, 8], sources: [{preset: 'split', checked: ['splitting']}, {preset: 'ordered', checked: ['ordered']}]},
  wednesday: {par: [5, 8], sources: [{preset: 'consolidate', checked: ['consolidate']}, {preset: 'links', checked: ['links']}]},
  thursday: {par: [5, 8], sources: [{preset: 'system', checked: ['system']}, {preset: 'fragile', checked: ['fragile']}]},
  friday: {
    par: [5, 9],
    // A seek move costs its distance, so seek par runs higher.
    sources: [{preset: 'clipboard', checked: ['clipboard']}, {preset: 'nudge', checked: ['nudge']}, {preset: 'seek', checked: ['seek'], par: [8, 16]}],
  },
  saturday: {par: [6, Infinity], combine: 2},
  sunday: {par: [7, Infinity], combine: 3},
};

const ORDER = mechanics.map(m => m.id);

// The rules a board uses, in mechanics order. Splitting counts when no whole-run solution reaches the optimum.
function boardRules(level) {
  const rules = Object.keys(uses).filter(rule => uses[rule](level));
  const best = E.solve(level).cost;
  const whole = E.solve(level, undefined, {whole: true}).cost;
  if (best !== null && (whole === null || whole > best)) rules.push('splitting');
  return rules.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

// The par range a board must fall in: its source's range when it has one (seek), else the tier's.
function parRange(day, level) {
  const tier = TIERS[day];
  const source = tier.sources?.find(s => s.par && s.checked.every(rule => level.checked?.includes(rule)));
  return source?.par ?? tier.par;
}

// A reason the weekend rule count is wrong, or null.
function countProblem(day, checked) {
  const advanced = checked.filter(rule => ADVANCED.includes(rule)).length;
  if (day === 'saturday' && advanced !== 2) return 'saturday needs exactly 2 advanced rules';
  if (day === 'sunday' && advanced < 3) return 'sunday needs 3 or more advanced rules';
  return null;
}

// The closest board in `others` at or above SIMILAR_FAIL, as {other, score}, or null.
function tooSimilar(level, others) {
  let worst = null;
  for (const other of others) {
    if (other === level || other.id === level.id) continue;
    const score = similarity(level, other);
    if (score >= SIMILAR_FAIL && (!worst || score > worst.score)) worst = {other, score};
  }
  return worst;
}

// tiers: {[day]: board[]}. campaign: levels from levels.js. Returns one message per violation.
function tierProblems(tiers, campaign) {
  const problems = [];
  const ids = new Set();
  const all = DAYS.flatMap(day => tiers[day] ?? []);
  const reference = campaign.filter(level => !level.intro);
  for (const day of DAYS) {
    const tier = tiers[day];
    if (!tier) {
      problems.push(`${day}: missing`);
      continue;
    }
    if (tier.length < MIN_TIER) problems.push(`${day}: ${tier.length} boards, below ${MIN_TIER}`);
    for (const level of tier) {
      const fail = message => problems.push(`${level.id}: ${message}`);
      if (ids.has(level.id)) fail('duplicate id');
      ids.add(level.id);
      const best = E.solve(level).cost;
      if (best === null) {
        fail('unsolvable');
        continue;
      }
      if (level.par !== best) fail(`par ${level.par}, optimum ${best}`);
      const [low, high] = parRange(day, level);
      if (best < low || best > high) fail(`par ${best} outside ${low}–${high}`);
      const rules = boardRules(level);
      if (JSON.stringify(rules) !== JSON.stringify(level.rules)) fail(`rules ${JSON.stringify(level.rules)}, board uses ${JSON.stringify(rules)}`);
      for (const rule of level.checked ?? []) {
        if (!rules.includes(rule)) fail(`checked rule ${rule} is not used`);
        try {
          if (!matters(level, rule, best)) fail(`${rule} does not change par`);
        } catch (error) {
          fail(`${rule} could not be checked: ${error.message}`);
        }
      }
      const count = countProblem(day, level.checked ?? []);
      if (count) fail(count);
      const close = tooSimilar(level, [...all, ...reference]);
      if (close) fail(`similar ${close.score.toFixed(2)} to ${close.other.id}`);
    }
  }
  return problems;
}

module.exports = {
  DAYS, ADVANCED, MIN_TIER, TARGET_TIER, HINT_LIMIT, SIMILAR_FAIL, TIERS,
  pick: E.dailyPick, boardRules, parRange, countProblem, tooSimilar, tierProblems,
};
