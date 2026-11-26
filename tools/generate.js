#!/usr/bin/env node
// Generate-and-test level search.
//   node tools/generate.js <preset> [--count 40] [--seed 7] [--tries 4000] [--par N] [--length N]
// --par and --length keep only candidates with exactly that optimum or board length.
// The daily puzzle has its own tool: tools/build-daily.js.
// Prints the best candidates as JSON lines, ranked by quality. Pick, name and add them to levels.js by hand.
// Presets: homes, split, reserved, ordered, clipboard, seek, consolidate, system, fragile, links, nudge, daily.
const {makeRng} = require('./board-builder.js');
const {candidates} = require('./presets.js');

const args = process.argv.slice(2);
const preset = args[0] ?? 'homes';
const flag = (name, fallback) => {
  const at = args.indexOf('--' + name);
  return at < 0 ? fallback : Number(args[at + 1]);
};
const count = flag('count', 40);
const tries = flag('tries', 4000);
const rng = makeRng(flag('seed', 7));

const wantPar = flag('par', null);
const wantLength = flag('length', null);

const stats = {};
const picks = candidates(preset, {rng, tries, count, wantPar, length: wantLength, stats});
for (const level of picks) console.log(JSON.stringify(level));
console.error(`${preset}: ${stats.kept} candidates kept, showing ${picks.length}`);
