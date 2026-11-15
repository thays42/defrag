// Quality metrics for a level. Used by check-levels.js and generate.js.
const E = require('../engine.js');

// The same level with one mechanic switched off, to measure whether that mechanic matters.
const without = {
  ordered: level => ({...level, board: level.board.replace(/[1-9]/g, '')}),
  clipboard: level => ({...level, clipboard: false}),
  seek: level => ({...level, cost: undefined}),
  consolidate: level => ({...level, consolidate: false}),
  fragile: level => ({...level, fragile: undefined}),
  links: level => ({...level, links: undefined}),
  nudge: level => ({...level, nudges: 0}),
  homes: level => ({...level, homes: undefined}),
  system: level => ({...level, locked: undefined}),
  reserved: level => ({...level, board: level.board.replace(/#/g, '.')}),
};

const uses = {
  ordered: level => /[1-9]/.test(level.board),
  clipboard: level => Boolean(level.clipboard),
  seek: level => level.cost === 'seek',
  consolidate: level => Boolean(level.consolidate),
  fragile: level => Boolean(level.fragile?.length),
  links: level => Boolean(level.links?.length),
  nudge: level => level.nudges > 0,
  homes: level => Boolean(level.homes && Object.keys(level.homes).length),
  system: level => Boolean(level.locked?.length),
  reserved: level => level.board.includes('#'),
};

// NaN when the search is too large to finish, so a metric never claims a value it did not prove.
function cost(level, options) {
  const result = E.solve(level, undefined, {limit: 1e6, ...options});
  return result.aborted ? NaN : result.cost ?? Infinity;
}

// How many separate pieces each file is in; fewer is "progress" to a player.
function pieces(level, state) {
  let count = 0;
  state.cells.forEach((token, i) => {
    if (E.isFile(token) && (i === 0 || E.letterOf(state.cells[i - 1]) !== E.letterOf(token))) count++;
  });
  return count;
}

function settledCount(level, state) {
  return E.info(level).movable.filter(file => E.fileSettled(level, state, file)).length;
}

// Share of tempting first moves (they settle a file or join pieces) that make par unreachable.
function trapRate(level, par) {
  const start = E.initialState(level);
  const before = [settledCount(level, start), pieces(level, start)];
  const tempting = E.moves(level, start).filter(move => {
    const next = E.apply(level, start, move);
    return move.type !== 'cut' && (settledCount(level, next) > before[0] || pieces(level, next) < before[1]);
  });
  if (!tempting.length) return 0;
  let traps = 0;
  for (const move of tempting) {
    const rest = E.solve(level, E.apply(level, start, move)).cost;
    if (rest === null || move.cost + rest > par) traps++;
  }
  return traps / tempting.length;
}

// Cheap metrics first; `detail` adds the expensive ones (trap rate, optimal line count, split gap).
// gains[m] = par with mechanic m switched off, minus par. Negative: the rule adds cost.
// Positive or Infinity: the tool saves cost.
function measure(level, {detail = true, limit = 1.5e6} = {}) {
  const best = E.solve(level);
  if (best.cost === null) return {par: null};
  const result = {par: best.cost, moves: best.path.length};
  const gains = {};
  for (const [name, strip] of Object.entries(without)) {
    if (!uses[name](level)) continue;
    gains[name] = cost(strip(level)) - best.cost;
  }
  if (level.cost === 'seek') gains.seekDetour = seekDetour(level, {limit: 1e6});
  result.gains = gains;
  if (detail) addDetail(level, result, limit);
  return result;
}

function addDetail(level, result, limit = 1.5e6) {
  result.splitGap = cost(level, {whole: true}) - result.par;
  result.trapRate = Number(trapRate(level, result.par).toFixed(2));
  const counted = E.solve(level, undefined, {countPaths: true, limit});
  result.paths = counted.aborted ? Infinity : counted.paths;
  return result;
}

// Seek: how many more moves the cheapest routes need than the fewest-move route. 0 means some cheapest route
// is also a fewest-move route, so seek changes nothing about the plan. Ranks routes by cost, then by moves,
// so the answer never depends on which cheapest route the solver returns. NaN when a search is too large.
const ROUTE_K = 1000;
function seekDetour(level, {limit = 4e6} = {}) {
  const ranked = E.solve(level, undefined, {limit, price: m => m.cost * ROUTE_K + 1, minPrice: ROUTE_K + 1, maxCost: 200 * ROUTE_K});
  const fewest = E.solve(level, undefined, {limit, price: () => 1});
  if (ranked.aborted || fewest.aborted) return NaN;
  return (ranked.cost % ROUTE_K) - fewest.cost;
}

// True when a hint search stays within `limit` states at the start and after every first move.
function hintCheap(level, limit) {
  const start = E.initialState(level);
  return [start, ...E.moves(level, start).map(move => E.apply(level, start, move))].every(state => !E.solve(level, state, {limit}).aborted);
}

// True when the rule changes par. Every search is capped at par, so it finishes even on full-disk boards.
// Constraint rules: switching the rule off lowers par. Tools: switching the tool off puts par out of reach.
// Splitting: no whole-run solution reaches par. Seek: the cheapest route takes more moves than the fewest-move one.
// Throws when a bounded search still hits its size limit, so a check never passes by accident.
function bounded(level, options, limit = 4e6) {
  const result = E.solve(level, undefined, {limit, ...options});
  if (result.aborted) throw new Error('search too large to check');
  return result;
}
// `limit` caps each search's states; a search tool passes a lower one to save time and memory.
function matters(level, rule, par, {limit = 4e6} = {}) {
  const lowers = stripped => bounded(stripped, {maxCost: par - 1}, limit).cost !== null;
  const outOfReach = (stripped, options = {}) => bounded(stripped, {maxCost: par, ...options}, limit).cost === null;
  switch (rule) {
    case 'clipboard':
    case 'nudge':
      return outOfReach(without[rule](level));
    case 'splitting':
      return outOfReach(level, {whole: true});
    case 'system':
      return lowers(without.system(level)) && lowers(without.links(level));
    case 'seek': {
      const detour = seekDetour(level, {limit});
      if (Number.isNaN(detour)) throw new Error('search too large to check');
      return detour > 0;
    }
    default:
      if (!without[rule]) throw new Error(`unknown rule ${rule}`);
      return lowers(without[rule](level));
  }
}

module.exports = {measure, addDetail, trapRate, without, uses, matters, seekDetour, hintCheap};
