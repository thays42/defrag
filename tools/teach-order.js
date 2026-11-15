// Teach order: a campaign level may only use a rule after the campaign has taught it.
// A rule is taught by the first intro level whose mechanic is that rule. Row wrap is taught by across-the-break.
const E = require('../engine.js');
const {uses} = require('./metrics.js');

// The partition crosses from one row of the frame into the next.
const spansRows = level => {
  const {offset, length} = E.placement(level);
  return (offset % E.COLUMNS) + length > E.COLUMNS;
};
// Needs a split to reach par. Only asked of levels before splitting is taught, so the search stays small.
const needsSplit = level => {
  const whole = E.solve(level, undefined, {whole: true}).cost;
  return whole === null || whole > level.par;
};

// levels: the campaign in order. Returns one message per violation.
function teachOrderProblems(levels) {
  const taught = new Set(['basics']);
  const problems = [];
  for (const level of levels) {
    if (level.intro) taught.add(level.mechanic);
    if (level.id === 'across-the-break') taught.add('row wrap');
    const used = Object.keys(uses).filter(rule => uses[rule](level));
    if (spansRows(level)) used.push('row wrap');
    if (!taught.has('splitting') && needsSplit(level)) used.push('splitting');
    for (const rule of used) if (!taught.has(rule)) problems.push(`${level.id} uses ${rule} before it is taught`);
  }
  return problems;
}

module.exports = {teachOrderProblems};
