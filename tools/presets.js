// Generator presets and the generate-and-test loop. Used by generate.js and build-daily.js.
const E = require('../engine.js');
const {measure, addDetail} = require('./metrics.js');
const {build: buildBoard, canonical, quality} = require('./board-builder.js');

// One random level per call for each preset, or null when the files do not fit.
// A preset may add `want`, a test on the metrics that the candidate must pass.
function makePresets(rng) {
  const {between, shuffle} = rng;
  const build = spec => buildBoard(rng, spec);
  return {
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
}

// Up to `count` candidates from `preset`, ranked by quality. `par` is the [low, high] window; `length` keeps one board length.
// `stats.kept` receives how many candidates passed before the cut to `count`.
function candidates(preset, {rng, tries = 4000, count = 40, par = [3, 12], wantPar = null, length = null, stats = {}}) {
  const make = makePresets(rng)[preset];
  if (!make) throw new Error(`unknown preset ${preset}`);
  const seen = new Set();
  const found = [];
  for (let n = 0; n < tries && found.length < count * 3; n++) {
    const level = make();
    if (!level?.board) continue;
    const {want} = level;
    delete level.want;
    if (!E.parseBoard(level.board).some(t => t === '.')) continue;
    if (length !== null && E.parseBoard(level.board).length !== length) continue;
    const key = canonical(level);
    if (seen.has(key)) continue;
    seen.add(key);
    const initial = E.initialState(level);
    if (E.solved(level, initial)) continue;
    const metrics = measure(level, {detail: false});
    if (metrics.par === null || metrics.par < par[0] || metrics.par > par[1]) continue;
    if (wantPar !== null && metrics.par !== wantPar) continue;
    if (want && !want(metrics)) continue;
    addDetail(level, metrics, 3e5);
    if (want && !want(metrics)) continue;
    metrics.quality = quality(metrics);
    found.push({...level, ...metrics});
  }
  found.sort((a, b) => b.quality - a.quality);
  stats.kept = found.length;
  return found.slice(0, count);
}

module.exports = {makePresets, candidates};
