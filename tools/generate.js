#!/usr/bin/env node
// Generate-and-test level search.
//   node tools/generate.js <preset> [--count 40] [--seed 7] [--tries 4000]
// Prints the best candidates as JSON lines, ranked by quality. Pick, name and add them to levels.js by hand.
// Presets: homes, split, reserved, ordered, clipboard, seek, consolidate, system, fragile, links, nudge, daily.
const E = require('../engine.js');
const {measure, addDetail} = require('./metrics.js');

const args = process.argv.slice(2);
const preset = args[0] ?? 'homes';
const flag = (name, fallback) => {
  const at = args.indexOf('--' + name);
  return at < 0 ? fallback : Number(args[at + 1]);
};
const count = flag('count', 40);
const tries = flag('tries', 4000);
let seed = flag('seed', 7);

function random() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
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

// Build a random board from file sizes, free sectors and reserved sectors.
function build({sizes, free, reserved = 0, ordered = false, homes = 0, slack = 0, locked = null}) {
  const letters = 'ABCD';
  const tokens = [];
  sizes.forEach((size, f) => {
    for (let n = 1; n <= size; n++) tokens.push(letters[f] + (ordered && size > 1 ? n : ''));
  });
  for (let n = 0; n < free; n++) tokens.push('.');
  for (let n = 0; n < reserved; n++) tokens.push('#');
  shuffle(tokens);
  if (locked) tokens.splice(between(1, tokens.length - 1), 0, ...'S'.repeat(locked));
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
      const start = pick(options);
      for (let i = start; i < start + width; i++) taken.add(i);
      level.homes[letters[f]] = [start + 1, start + width];
    }
  }
  if (locked) level.locked = ['S'];
  return level;
}

const presets = {
  homes: () => build({sizes: [between(2, 3), between(2, 3), between(1, 3)], free: between(1, 2), homes: 3}),
  split: () => build({sizes: [between(3, 4), between(3, 4)], free: between(1, 2), homes: 2}),
  reserved: () => build({sizes: [between(2, 3), between(2, 3), 2], free: 3, reserved: between(4, 8), homes: 3}),
  ordered: () => ({...build({sizes: [3, between(2, 3)], free: between(1, 2), ordered: true}), want: m => m.gains.ordered <= -2}),
  clipboard: () => ({...build({sizes: [between(2, 3), between(2, 3), 2], free: 1, homes: 3}), clipboard: true, want: m => m.gains.clipboard >= 2}),
  seek: () => ({...build({sizes: [between(2, 3), between(2, 3), between(1, 2)], free: between(2, 3), homes: between(1, 2)}), cost: 'seek', want: m => m.gains.seekDetour >= 1}),
  consolidate: () => ({...build({sizes: [between(2, 3), between(2, 3), between(1, 2)], free: 3, homes: between(0, 1)}), consolidate: true, want: m => m.gains.consolidate <= -2}),
  system: () => {
    const level = build({sizes: [between(2, 3), between(2, 3)], free: 2, locked: 2});
    return level && {...level, links: [['S', 'A']], want: m => m.gains.links <= -2};
  },
  fragile: () => {
    const level = build({sizes: [between(2, 3), between(2, 3), between(1, 2)], free: between(2, 3), homes: 3});
    if (!level) return null;
    const cells = E.parseBoard(level.board);
    const free = cells.flatMap((t, i) => (t === '.' ? [i + 1] : []));
    const used = cells.flatMap((t, i) => (t !== '.' ? [i + 1] : []));
    const fragile = [...shuffle(free).slice(0, between(1, free.length)), ...shuffle(used).slice(0, between(0, 2))];
    return {...level, fragile: fragile.sort((a, b) => a - b), want: m => m.gains.fragile <= -1 && !(m.paths > 6)};
  },
  links: () => ({...build({sizes: [between(2, 3), between(2, 3), between(1, 2)], free: 2}), links: [['A', 'B'], ['B', 'C']], want: m => m.gains.links <= -2}),
  nudge: () => ({...build({sizes: [between(2, 4), between(2, 3), between(1, 2)], free: 1, homes: 3}), nudges: between(1, 2), want: m => m.gains.nudge >= 2}),
  daily: () => build({sizes: [between(2, 4), between(2, 3), between(1, 3)], free: between(1, 3), reserved: between(0, 3), homes: between(2, 3)}),
};

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

const seen = new Set();
const found = [];
for (let n = 0; n < tries && found.length < count * 3; n++) {
  const level = presets[preset]();
  if (!level?.board) continue;
  const {want} = level;
  delete level.want;
  if (!E.parseBoard(level.board).some(t => t === '.')) continue;
  const key = canonical(level);
  if (seen.has(key)) continue;
  seen.add(key);
  const initial = E.initialState(level);
  if (E.solved(level, initial)) continue;
  const metrics = measure(level, {detail: false});
  if (metrics.par === null || metrics.par < 3 || metrics.par > 12) continue;
  if (want && !want(metrics)) continue;
  addDetail(level, metrics, 3e5);
  if (want && !want(metrics)) continue;
  // Fewer optimal lines and more tempting wrong first moves make a sharper puzzle.
  metrics.quality = Number((metrics.trapRate * 4 + 3 / Math.min(metrics.paths, 30) + Math.min(metrics.par, 9) / 9).toFixed(2));
  found.push({...level, ...metrics});
}
found.sort((a, b) => b.quality - a.quality);
for (const level of found.slice(0, count)) console.log(JSON.stringify(level));
console.error(`${preset}: ${found.length} candidates kept, showing ${Math.min(count, found.length)}`);
