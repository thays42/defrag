#!/usr/bin/env node
// Generate-and-test level search.
//   node tools/generate.js <preset> [--count 40] [--seed 7] [--tries 4000] [--par N] [--length N] [--write daily.js]
// --par and --length keep only candidates with exactly that optimum or board length.
// --write saves the picks as the daily puzzle pool instead of printing them.
// Prints the best candidates as JSON lines, ranked by quality. Pick, name and add them to levels.js by hand.
// Presets: homes, split, reserved, ordered, clipboard, seek, consolidate, system, fragile, links, nudge, daily.
const E = require('../engine.js');
const {measure, addDetail} = require('./metrics.js');
const {makeRng, build: buildBoard, canonical, quality} = require('./board-builder.js');

const args = process.argv.slice(2);
const preset = args[0] ?? 'homes';
const flag = (name, fallback) => {
  const at = args.indexOf('--' + name);
  return at < 0 ? fallback : Number(args[at + 1]);
};
const count = flag('count', 40);
const tries = flag('tries', 4000);
const rng = makeRng(flag('seed', 7));
const {between, shuffle} = rng;
const build = spec => buildBoard(rng, spec);

const wantPar = flag('par', null);
const wantLength = flag('length', null);

const presets = {
  homes: () => build({sizes: [between(2, 3), between(2, 3), between(1, 3)], free: between(1, 2), homes: 3}),
  split: () => build({sizes: [between(3, 4), between(3, 4)], free: between(1, 2), homes: 2}),
  // Reserved sectors must raise par: with them freed, the puzzle gets cheaper.
  reserved: () => {
    const files = between(2, 3);
    const sizes = [between(2, 3), between(2, 3), 2].slice(0, files);
    return {...build({sizes, free: between(2, 4), reserved: between(4, 14), homes: files}), want: m => m.gains.reserved <= -1};
  },
  ordered: () => ({...build({sizes: [3, between(2, 3)], free: between(1, 2), ordered: true}), want: m => m.gains.ordered <= -2}),
  clipboard: () => ({...build({sizes: [between(2, 3), between(2, 3), 2], free: 1, homes: 3}), clipboard: true, want: m => m.gains.clipboard >= 2}),
  seek: () => ({...build({sizes: [between(2, 3), between(2, 3), between(1, 2)], free: between(2, 3), homes: between(1, 2)}), cost: 'seek', want: m => m.gains.seekDetour >= 1}),
  consolidate: () => ({...build({sizes: [between(2, 3), between(2, 3), between(1, 2)], free: 3, homes: between(0, 1)}), consolidate: true, want: m => m.gains.consolidate <= -2}),
  system: () => {
    const level = build({sizes: [between(2, 3), between(2, 3)], free: 2, locked: 2});
    // Locking must matter: with S movable, the puzzle would be cheaper.
    return level && {...level, links: [['S', 'A']], want: m => m.gains.links <= -1 && m.gains.system <= -1};
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

const seen = new Set();
const found = [];
for (let n = 0; n < tries && found.length < count * 3; n++) {
  const level = presets[preset]();
  if (!level?.board) continue;
  const {want} = level;
  delete level.want;
  if (!E.parseBoard(level.board).some(t => t === '.')) continue;
  if (wantLength !== null && E.parseBoard(level.board).length !== wantLength) continue;
  const key = canonical(level);
  if (seen.has(key)) continue;
  seen.add(key);
  const initial = E.initialState(level);
  if (E.solved(level, initial)) continue;
  const metrics = measure(level, {detail: false});
  if (metrics.par === null || metrics.par < 3 || metrics.par > 12) continue;
  if (wantPar !== null && metrics.par !== wantPar) continue;
  if (want && !want(metrics)) continue;
  addDetail(level, metrics, 3e5);
  if (want && !want(metrics)) continue;
  metrics.quality = quality(metrics);
  found.push({...level, ...metrics});
}
found.sort((a, b) => b.quality - a.quality);
const picks = found.slice(0, count);
const writeAt = args.indexOf('--write');
if (writeAt >= 0) {
  // Shuffle so consecutive days vary in difficulty.
  const pool = shuffle(picks).map(({board, homes, par}, i) => ({id: `daily-${i + 1}`, mechanic: board.includes('#') ? 'reserved' : 'homes', par, board, homes}));
  const lines = pool.map(level => '  ' + JSON.stringify(level) + ',').join('\n');
  require('fs').writeFileSync(require('path').resolve(__dirname, '..', args[writeAt + 1]),
    `// Generated by: node tools/generate.js ${args.join(' ')}\nconst dailyPool = [\n${lines}\n];\nif (typeof module !== 'undefined') module.exports = {dailyPool};\n`);
} else {
  for (const level of picks) console.log(JSON.stringify(level));
}
console.error(`${preset}: ${found.length} candidates kept, showing ${Math.min(count, found.length)}`);
