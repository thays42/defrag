// How alike two levels look. Used by check-levels.js to stop near-copies.
// A level's fingerprint is one token per sector: the file renamed in order of
// appearance (a, b, …; S stays S) with its fragment digit, or '.' or '#',
// plus '^' for a home sector and '!' for a cracked one.
const E = require('../engine.js');

function fingerprint(level, {marks = true} = {}) {
  const names = {};
  const homes = new Set();
  for (const [first, last] of Object.values(level.homes ?? {})) for (let s = first; s <= last; s++) homes.add(s);
  const fragile = new Set(level.fragile ?? []);
  return E.parseBoard(level.board).map((token, i) => {
    let base = token;
    if (E.isFile(token)) {
      const letter = E.letterOf(token);
      const name = letter === 'S' ? 'S' : (names[letter] ??= String.fromCharCode(97 + Object.keys(names).length));
      base = name + token.slice(1);
    }
    if (!marks) return base;
    return base + (homes.has(i + 1) ? '^' : '') + (fragile.has(i + 1) ? '!' : '');
  });
}

function distance(a, b) {
  let row = Array.from({length: b.length + 1}, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

function score(x, y) {
  return 1 - distance(x, y) / Math.max(x.length, y.length, 1);
}

// The higher of two views: the layout alone (so moving homes does not make a board look new)
// and the layout with home and cracked marks (so shared marks count as looking alike).
function similarity(a, b) {
  return Math.max(score(fingerprint(a, {marks: false}), fingerprint(b, {marks: false})), score(fingerprint(a), fingerprint(b)));
}

// Pairs at or above `warn`. A pair is 'fail' at or above `fail`, unless it includes an intro level.
function similarPairs(levels, {warn = 0.6, fail = 0.75} = {}) {
  const out = [];
  for (let i = 0; i < levels.length; i++) {
    for (let j = i + 1; j < levels.length; j++) {
      const score = similarity(levels[i], levels[j]);
      if (score < warn) continue;
      const intro = levels[i].intro || levels[j].intro;
      out.push({a: levels[i], b: levels[j], score, level: score >= fail && !intro ? 'fail' : 'warn'});
    }
  }
  return out.sort((p, q) => q.score - p.score);
}

module.exports = {fingerprint, similarity, similarPairs};
