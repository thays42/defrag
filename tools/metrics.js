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

function cost(level, options) {
  return E.solve(level, undefined, options).cost ?? Infinity;
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
  // Seek: does the cheapest route take more moves than the shortest one?
  if (level.cost === 'seek') gains.seekDetour = best.path.length - cost(without.seek(level));
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

module.exports = {measure, addDetail, trapRate, without, uses};
