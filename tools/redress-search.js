// Greedy re-dress search used to make campaign levels look distinct. Prints proposals; writes redress-result.json beside itself.
// Usage: node tools/redress-search.js [maxLen]. Proposals keep par, the mechanic check and trap rate; review them by eye before use.
const R = '/home/user/defrag/';
const E = require(R + 'engine.js');
const {without, addDetail} = require(R + 'tools/metrics.js');
const {similarity} = require(R + 'tools/similarity.js');
const {mirror, insertReserved, relabel} = require(R + 'tools/redress.js');
const baseline = require(R + 'tools/metrics-baseline.json');
const {chapters} = require(R + 'levels.js');
const maxLen = Number(process.argv[2] ?? 24);
const pinned = new Set(['tight-fit', 'failing-drive', 'chained', 'find-home', 'two-files', 'join-two-blocks']);
const opt = (l, o) => { const r = E.solve(l, undefined, {limit: 3e5, ...o}); if (r.aborted) throw 0; return r.cost ?? Infinity; };
const matters = {
  ordered: (l, p) => opt(without.ordered(l)) < p,
  clipboard: (l, p) => !(opt(without.clipboard(l)) <= p),
  seek: (l, p) => opt(without.seek(l)) < p,
  consolidate: (l, p) => opt(without.consolidate(l)) < p,
  system: (l, p) => opt(without.system(l)) < p && opt(without.links(l)) < p,
  splitting: (l, p) => opt(l, {whole: true}) > p,
  fragile: (l, p) => opt(without.fragile(l)) < p,
  links: (l, p) => opt(without.links(l)) < p,
  nudge: (l, p) => !(opt(without.nudge(l)) <= p),
};
const all = chapters.flatMap(c => c.levels);
const current = new Map(all.map(l => [l.id, l]));
const others = id => [...current.values()].filter(l => l.id !== id && !l.intro);
const worst = l => Math.max(...others(l.id).map(o => similarity(l, o)));
function valid(c, orig) {
  const n = E.parseBoard(c.board).length;
  if (n > maxLen) return false;
  for (const [f, [a, b]] of Object.entries(c.homes ?? {})) if (E.parseBoard(c.board).slice(a - 1, b).includes('#')) return false;
  try {
    const best = opt(c);
    if (orig.beatable ? best !== opt(orig) : best !== orig.par) return false;
    if (matters[c.mechanic] && !matters[c.mechanic](c, best)) return false;
    const m = addDetail(c, {par: best}, 3e5);
    const was = baseline[orig.id];
    if (m.trapRate < was.trapRate - 0.1 || m.paths > 2 * (was.paths ?? Infinity)) return false;
    c._m = m;
    return true;
  } catch { return false; }
}
function candidates(l) {
  const out = [];
  const bases = [l];
  if (!(l.links ?? []).some(p => (l.locked ?? []).some(x => p.includes(x)))) {
    let m = mirror(l);
    if (l.links) {
      // Restore the original link letters: map each mirrored chain onto the original one.
      const chain = ls => { const order = [ls[0][0]]; for (const [a, b] of ls) order.push(b); return order; };
      const orig = chain(l.links), back = chain([...m.links].reverse());
      const map = Object.fromEntries(back.map((x, i) => [x, orig[i]]));
      m = {...relabel(m, map), goal: l.goal, prompt: l.prompt, links: l.links};
    }
    bases.push(m);
  }
  for (const base of bases) {
    const n = E.parseBoard(base.board).length;
    for (let pad = 0; pad < 6; pad++) {
      const padded = pad ? insertReserved(base, 1, pad) : base;
      out.push(padded);
      for (let i = pad + 2; i <= pad + n; i++) for (const k of [1, 2]) {
        const one = insertReserved(padded, i, k);
        out.push(one);
        for (let j = i + k + 2; j <= pad + n + k; j++) for (const k2 of [1, 2]) out.push(insertReserved(one, j, k2));
      }
    }
  }
  return out;
}
const order = all.filter(l => !l.intro && !pinned.has(l.id)).sort((a, b) => worst(b) - worst(a));
const results = [];
for (const l of order) {
  const before = worst(current.get(l.id));
  const scored = candidates(l).map(c => ({c, s: worst(c), n: E.parseBoard(c.board).length})).sort((a, b) => a.s - b.s || a.n - b.n);
  let pick = null;
  for (const x of scored.slice(0, 400)) if (x.s < before - 0.05 && valid(x.c, l)) { pick = x; break; }
  if (pick) { current.set(l.id, pick.c); results.push({id: l.id, mirrored: pick.c.board !== l.board && !l.board.includes(pick.c.board.replace(/#/g,'')), level: pick.c, from: l.board, to: pick.c.board, before: before.toFixed(2), after: pick.s.toFixed(2), homes: pick.c.homes, fragile: pick.c.fragile, links: pick.c.links}); }
  console.error(l.id, before.toFixed(2), '->', pick ? pick.s.toFixed(2) + ' ' + pick.c.board : 'kept');
}
require('fs').writeFileSync(__dirname + '/redress-result.json', JSON.stringify(results, null, 1));
