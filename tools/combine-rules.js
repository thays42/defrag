// Combine rules. A level with `combines` lists two or more rules, and each must change par.
// A Combine level is no easier than any earlier plain level of its own mechanic.
// The Boot chapter is the finale: three or more rules per level, and the last level boots the system file.
const {matters} = require('./metrics.js');

// chapters: the campaign in order, as [{name, levels}]. Returns one message per violation.
function combineProblems(chapters) {
  const problems = [];
  const earlier = [];
  for (const chapter of chapters) {
    chapter.levels.forEach((level, index) => {
      const fail = message => problems.push(`${level.id}: ${message}`);
      const rules = level.combines;
      if (!rules) {
        earlier.push(level);
        return;
      }
      if (rules.length < 2) fail('combines needs at least 2 rules');
      if (!rules.includes(level.mechanic)) fail(`combines does not include mechanic ${level.mechanic}`);
      for (const rule of rules) {
        try {
          if (!matters(level, rule, level.par)) fail(`${rule} does not change par`);
        } catch (error) {
          fail(`${rule} could not be checked: ${error.message}`);
        }
      }
      const peers = earlier.filter(other => other.mechanic === level.mechanic);
      const hardest = peers.reduce((top, other) => (top && top.par >= other.par ? top : other), null);
      if (hardest && level.par < hardest.par) fail(`par ${level.par} is below ${hardest.par} of earlier ${level.mechanic} level ${hardest.id}`);
      if (chapter.name === 'Boot') {
        if (rules.length < 3) fail('Boot levels combine at least 3 rules');
        if (index === chapter.levels.length - 1 && !rules.includes('system')) fail('the last Boot level must use system');
      }
    });
  }
  return problems;
}

module.exports = {combineProblems};
