// Defrag rules and solver. Shared by the game (browser) and the tools (Node).
// A level is plain data; a state is {cells, clip, wear, nudges}.
(function (root) {
  const EMPTY = '.';
  const RESERVED = '#';
  const COLUMNS = 6;

  // Cells are tokens: '.', '#', a file letter, or a letter plus a fragment digit ('A2').
  function parseBoard(text) {
    const cells = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (/[A-Z]/.test(c) && /[1-9]/.test(text[i + 1] ?? '')) cells.push(c + text[++i]);
      else cells.push(c);
    }
    return cells;
  }

  const letterOf = token => token[0];
  const isFile = token => token !== EMPTY && token !== RESERVED;

  // Static facts about a level, computed once.
  const infoCache = new WeakMap();
  function info(level) {
    let facts = infoCache.get(level);
    if (facts) return facts;
    const cells = parseBoard(level.board);
    const counts = {};
    for (const token of cells) if (isFile(token)) counts[letterOf(token)] = (counts[letterOf(token)] ?? 0) + 1;
    const locked = new Set(level.locked ?? []);
    facts = {counts, files: Object.keys(counts).sort(), locked, movable: Object.keys(counts).filter(f => !locked.has(f))};
    infoCache.set(level, facts);
    return facts;
  }

  function initialState(level) {
    const cells = parseBoard(level.board);
    while (cells.length % COLUMNS) cells.push(RESERVED);
    const fragile = new Set(level.fragile ?? []);
    return {
      cells,
      clip: null,
      // Cracked (fragile) sectors fail as soon as they are emptied: an empty one takes one write.
      wear: fragile.size ? cells.map((token, i) => (fragile.has(i + 1) ? (token === EMPTY ? 1 : 0) : -1)) : null,
      nudges: level.nudges ?? 0,
    };
  }

  function keyOf(state) {
    return state.cells.join('') + '|' + (state.clip ? state.clip.join('') : '') +
      (state.wear ? '|' + state.wear.join(',') : '') + '|' + state.nudges;
  }

  function runAt(cells, index) {
    const file = letterOf(cells[index]);
    let first = index;
    let last = index;
    while (first > 0 && isFile(cells[first - 1]) && letterOf(cells[first - 1]) === file) first--;
    while (last < cells.length - 1 && isFile(cells[last + 1]) && letterOf(cells[last + 1]) === file) last++;
    return [first, last];
  }

  // Can `length` blocks starting at `from` land at `to`? Returns null, or {nudge}.
  function landing(state, from, length, to) {
    const {cells} = state;
    if (to < 0 || to + length > cells.length || to === from) return null;
    let nudge = false;
    for (let t = to; t < to + length; t++) {
      if (cells[t] === EMPTY) continue;
      if (from !== null && t >= from && t < from + length) nudge = true;
      else return null;
    }
    // A nudge slides a run exactly one sector into space it partly covers.
    if (nudge && (state.nudges <= 0 || Math.abs(to - from) !== 1)) return null;
    return {nudge};
  }

  function moveCost(level, from, to, split) {
    return (level.cost === 'seek' ? Math.abs(to - from) : 1) + (split ? 1 : 0);
  }

  // Every legal move. `whole` forbids splits (used to measure whether splitting matters).
  function moves(level, state, {whole = false} = {}) {
    const {cells} = state;
    const {locked} = info(level);
    const out = [];
    for (let a = 0; a < cells.length; a++) {
      if (!isFile(cells[a]) || locked.has(letterOf(cells[a]))) continue;
      const [, last] = runAt(cells, a);
      const b = last + 1;
      for (let i = a; i < b; i++) {
        for (let j = i + 1; j <= b; j++) {
          const split = i !== a || j !== b;
          if (split && whole) continue;
          const length = j - i;
          for (let to = 0; to + length <= cells.length; to++) {
            const fit = landing(state, i, length, to);
            if (fit) out.push({type: 'move', from: i, length, to, split, nudge: fit.nudge, cost: moveCost(level, i, to, split)});
          }
          if (level.clipboard && !state.clip) out.push({type: 'cut', from: i, length, split, cost: 1 + (split ? 1 : 0)});
        }
      }
      a = last;
    }
    if (state.clip) {
      for (let to = 0; to + state.clip.length <= cells.length; to++) {
        if (landing(state, null, state.clip.length, to)) out.push({type: 'paste', length: state.clip.length, to, cost: 1});
      }
    }
    return out;
  }

  function apply(level, state, move) {
    const cells = [...state.cells];
    const wear = state.wear && [...state.wear];
    let clip = state.clip;
    let tokens;
    if (move.type === 'paste') {
      tokens = clip;
      clip = null;
    } else {
      tokens = cells.slice(move.from, move.from + move.length);
      cells.fill(EMPTY, move.from, move.from + move.length);
    }
    if (move.type === 'cut') {
      clip = tokens;
    } else {
      for (let t = 0; t < tokens.length; t++) {
        const index = move.to + t;
        if (wear && wear[index] > 0 && state.cells[index] === EMPTY) wear[index]--;
        cells[index] = tokens[t];
      }
    }
    // A worn-out fragile sector fails as soon as it is empty.
    if (wear) for (let i = 0; i < cells.length; i++) if (cells[i] === EMPTY && wear[i] === 0) cells[i] = RESERVED;
    return {cells, clip, wear, nudges: state.nudges - (move.nudge ? 1 : 0)};
  }

  // Per-file check: joined, complete, inside its home, fragments in order.
  function fileSettled(level, state, file) {
    const {counts} = info(level);
    const {cells} = state;
    let first = -1;
    let last = -1;
    let seen = 0;
    for (let i = 0; i < cells.length; i++) {
      if (isFile(cells[i]) && letterOf(cells[i]) === file) {
        if (first < 0) first = i;
        last = i;
        seen++;
      }
    }
    if (seen !== counts[file] || last - first + 1 !== seen) return false;
    const home = level.homes?.[file];
    if (home && (first < home[0] - 1 || last > home[1] - 1)) return false;
    for (let i = first; i <= last; i++) {
      const digit = cells[i].slice(1);
      if (digit && Number(digit) !== i - first + 1) return false;
    }
    return true;
  }

  function span(cells, file) {
    let first = -1;
    let last = -1;
    cells.forEach((token, i) => {
      if (isFile(token) && letterOf(token) === file) {
        if (first < 0) first = i;
        last = i;
      }
    });
    return [first, last];
  }

  function linksMet(level, state) {
    return (level.links ?? []).every(([before, after]) => span(state.cells, before)[1] + 1 === span(state.cells, after)[0]);
  }

  function freeSpaceJoined(state) {
    const empties = state.cells.flatMap((token, i) => (token === EMPTY ? [i] : []));
    return !empties.length || empties.at(-1) - empties[0] + 1 === empties.length;
  }

  function solved(level, state) {
    if (state.clip) return false;
    if (!info(level).files.every(file => fileSettled(level, state, file))) return false;
    if (!linksMet(level, state)) return false;
    if (level.consolidate && !freeSpaceJoined(state)) return false;
    return true;
  }

  // Admissible: each move changes one file, and every unsettled file needs a move.
  function estimate(level, state) {
    let unsettled = 0;
    for (const file of info(level).movable) if (!fileSettled(level, state, file)) unsettled++;
    if (unsettled) return unsettled;
    return solved(level, state) ? 0 : 1;
  }

  // Sectors a move carries its run. Cut and paste have no single distance, so they count 0.
  function travelOf(move) {
    return move.type === 'move' ? Math.abs(move.to - move.from) : 0;
  }

  // Best-first search over integer costs with a bucket queue.
  // heuristic: A* (fast, for hints). countPaths: plain Dijkstra that also counts optimal lines.
  // price: optional move => integer >= 1 that replaces move.cost (badge tools rank by two costs at once).
  // minPrice: the least any move can cost under `price`, so the heuristic stays admissible but sharper.
  function solve(level, start = initialState(level), {heuristic = true, countPaths = false, whole = false, limit = 4e6, maxCost = 200, price, minPrice = 1} = {}) {
    const useH = heuristic && !countPaths;
    // Each unsettled file needs at least one move, and every move costs at least minPrice.
    const h = state => estimate(level, state) * minPrice;
    const startKey = keyOf(start);
    const nodes = new Map([[startKey, {g: 0, parent: null, move: null, ways: 1}]]);
    const buckets = [];
    const push = (f, key, state) => (buckets[f] ??= []).push([key, state]);
    push(useH ? h(start) : 0, startKey, start);
    let best = null;
    let goalKey = null;
    let paths = 0;
    for (let f = 0; f < buckets.length && f <= maxCost; f++) {
      if (best !== null && f > best) break;
      const bucket = buckets[f];
      if (!bucket) continue;
      for (let n = 0; n < bucket.length; n++) {
        const [key, state] = bucket[n];
        const node = nodes.get(key);
        const g = node.g;
        if ((useH ? g + h(state) : g) !== f) continue;
        if (node.closed) continue;
        node.closed = true;
        if (solved(level, state)) {
          if (best === null) {
            best = g;
            goalKey = key;
          }
          paths += node.ways;
          if (!countPaths) break;
          continue;
        }
        if (best !== null) continue;
        for (const move of moves(level, state, {whole})) {
          const next = apply(level, state, move);
          const nextKey = keyOf(next);
          const total = g + (price ? price(move) : move.cost);
          const seen = nodes.get(nextKey);
          if (!seen || total < seen.g) {
            if (seen?.closed) continue;
            nodes.set(nextKey, {g: total, parent: key, move, ways: node.ways});
            push(useH ? total + h(next) : total, nextKey, next);
          } else if (total === seen.g && countPaths && !seen.closed) {
            seen.ways += node.ways;
          }
        }
        if (nodes.size > limit) return {cost: null, path: null, paths: 0, states: nodes.size, aborted: true};
      }
      if (best !== null && !countPaths) break;
    }
    if (best === null) return {cost: null, path: null, paths: 0, states: nodes.size};
    const path = [];
    for (let key = goalKey; nodes.get(key).parent !== null; key = nodes.get(key).parent) path.unshift(nodes.get(key).move);
    return {cost: best, path, paths, states: nodes.size};
  }

  root.DefragEngine = {
    EMPTY, RESERVED, COLUMNS, parseBoard, letterOf, isFile, info, initialState, keyOf, runAt, landing,
    moveCost, travelOf, moves, apply, fileSettled, linksMet, freeSpaceJoined, solved, estimate, solve,
  };
  if (typeof module !== 'undefined') module.exports = root.DefragEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
