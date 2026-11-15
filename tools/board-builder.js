// Random board building shared by generate.js and combine.js.
const E = require('../engine.js');

// mulberry32: 32-bit integer math, so the sequence does not collapse into a short cycle.
function makeRng(start) {
  let seed = start;
  function random() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const pick = list => list[Math.floor(random() * list.length)];
  const between = (low, high) => low + Math.floor(random() * (high - low + 1));
  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
  return {random, pick, between, shuffle};
}

// Build a random board from file sizes, free sectors and reserved sectors.
function build(rng, {sizes, free, reserved = 0, ordered = false, homes = 0, slack = 0, locked = null}) {
  const letters = 'ABCD';
  const tokens = [];
  sizes.forEach((size, f) => {
    for (let n = 1; n <= size; n++) tokens.push(letters[f] + (ordered && size > 1 ? n : ''));
  });
  for (let n = 0; n < free; n++) tokens.push('.');
  for (let n = 0; n < reserved; n++) tokens.push('#');
  rng.shuffle(tokens);
  if (locked) tokens.splice(rng.between(1, tokens.length - 1), 0, ...'S'.repeat(locked));
  const level = {board: tokens.join('')};
  if (homes) {
    const cells = E.parseBoard(level.board);
    const taken = new Set();
    level.homes = {};
    for (let f = 0; f < Math.min(homes, sizes.length); f++) {
      const width = sizes[f] + slack;
      const options = [];
      for (let s = 0; s + width <= cells.length; s++) {
        const window = cells.slice(s, s + width);
        if (window.every((t, i) => t !== '#' && t !== 'S' && !taken.has(s + i))) options.push(s);
      }
      if (!options.length) return null;
      const start = rng.pick(options);
      for (let i = start; i < start + width; i++) taken.add(i);
      level.homes[letters[f]] = [start + 1, start + width];
    }
  }
  if (locked) level.locked = ['S'];
  return level;
}

// Same puzzle under letter relabeling or mirroring is a duplicate.
function canonical(level) {
  const variants = [];
  const cells = E.parseBoard(level.board);
  for (const mirror of level.board.match(/[1-9]/) || level.links ? [false] : [false, true]) {
    const order = mirror ? [...cells].reverse() : cells;
    const map = {};
    let next = 0;
    for (const t of order) if (/[A-R]/.test(t[0]) && !(t[0] in map)) map[t[0]] = 'abcdefgh'[next++];
    const relabel = t => (map[t[0]] ? map[t[0]] + t.slice(1) : t);
    const n = cells.length;
    const flip = s => (mirror ? n + 1 - s : s);
    const homes = Object.entries(level.homes ?? {}).map(([f, [a, b]]) => map[f] + [flip(a), flip(b)].sort((x, y) => x - y)).sort();
    variants.push(order.map(relabel).join('') + JSON.stringify([homes, (level.fragile ?? []).map(flip).sort(), level.links, level.locked]));
  }
  return variants.sort()[0];
}

// Fewer optimal lines and more tempting wrong first moves make a sharper puzzle.
const quality = metrics => Number((metrics.trapRate * 4 + 3 / Math.min(metrics.paths, 30) + Math.min(metrics.par, 9) / 9).toFixed(2));

module.exports = {makeRng, build, canonical, quality};
