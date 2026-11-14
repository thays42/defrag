#!/usr/bin/env node
// Board transforms that change how a level looks but not its puzzle.
// Positions are 1-based sectors, as in levels.js. Each function returns a new level.
//   node tools/redress.js <id>   prints the level and its nearest look-alike
const E = require('../engine.js');

const tokens = level => E.parseBoard(level.board);
const mapHomes = (homes, f) => homes && Object.fromEntries(Object.entries(homes).map(([k, range]) => [k, f(range)]));

// Reverse the disk. Fragment numbers flip so the lowest still finishes on the left; links flip direction.
function mirror(level) {
  const cells = tokens(level).reverse();
  const n = cells.length;
  const fragments = {};
  for (const t of cells) if (t.length > 1) fragments[t[0]] = (fragments[t[0]] ?? 0) + 1;
  const board = cells.map(t => (t.length > 1 ? t[0] + (fragments[t[0]] + 1 - Number(t[1])) : t)).join('');
  const out = {...level, board};
  if (level.homes) out.homes = mapHomes(level.homes, ([a, b]) => [n + 1 - b, n + 1 - a]);
  if (level.fragile) out.fragile = level.fragile.map(p => n + 1 - p).sort((a, b) => a - b);
  if (level.links) out.links = level.links.map(([a, b]) => [b, a]);
  return out;
}

// Insert `count` reserved sectors before sector `at` (board length + 1 appends).
function insertReserved(level, at, count = 1) {
  const cells = tokens(level);
  if (at < 1 || at > cells.length + 1) throw new Error(`insert position ${at} is off the board`);
  cells.splice(at - 1, 0, ...Array(count).fill(E.RESERVED));
  const shift = p => (p >= at ? p + count : p);
  const out = {...level, board: cells.join('')};
  if (level.homes) out.homes = mapHomes(level.homes, ([a, b]) => [shift(a), shift(b)]);
  if (level.fragile) out.fragile = level.fragile.map(shift);
  return out;
}

// Rename files, e.g. {A: 'D', B: 'A'}. Goal and prompt text are rewritten word by word.
function relabel(level, map) {
  const swap = letter => map[letter] ?? letter;
  const text = s => s && s.replace(/\b[A-Z]\b/g, swap);
  const out = {...level, board: level.board.replace(/[A-Z]/g, swap)};
  if (level.homes) out.homes = Object.fromEntries(Object.entries(level.homes).map(([k, v]) => [swap(k), v]));
  if (level.links) out.links = level.links.map(pair => pair.map(swap));
  if (level.locked) out.locked = level.locked.map(swap);
  if (level.goal) out.goal = text(level.goal);
  if (level.prompt) out.prompt = text(level.prompt);
  return out;
}

module.exports = {mirror, insertReserved, relabel};

if (require.main === module) {
  const {similarity} = require('./similarity.js');
  const levels = require('../levels.js').chapters.flatMap(c => c.levels);
  const level = levels.find(l => l.id === process.argv[2]);
  if (!level) {
    console.error('usage: node tools/redress.js <level id>');
    process.exit(1);
  }
  const nearest = levels.filter(l => l !== level).map(l => [similarity(level, l), l]).sort((a, b) => b[0] - a[0])[0];
  console.log(JSON.stringify(level));
  console.log(`nearest: ${nearest[1].id} ${nearest[1].board} (${nearest[0].toFixed(2)})`);
}
