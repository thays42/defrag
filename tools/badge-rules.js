// Badge rules over the campaign: enough levels offer a badge, few badges are redundant,
// no badge is offered before the level that teaches badges, and no Tidy before one-gap teaches consolidate.
const {overlaps, beforeConsolidate} = require('./badges.js');

// These rise toward 0.80 (floor) and fall toward 0.25 (maxOverlap) as levels are redesigned, and never move back.
const BADGE_LIMITS = {floor: 0.80, maxOverlap: 0.25};

// campaign: the chapter levels in order. pool: the stored badges by level id.
function badgeProblems(campaign, pool, {floor, maxOverlap}, overlapsOf = overlaps) {
  const problems = [];
  const counted = campaign.filter(level => !level.intro);
  const uncovered = counted.filter(level => !Object.keys(pool[level.id] ?? {}).length);
  const covered = counted.length - uncovered.length;
  if (counted.length && covered / counted.length < floor) {
    problems.push(`badge coverage ${covered}/${counted.length} is below ${floor}: no badge on ${uncovered.map(l => l.id).join(', ')}`);
  }
  const multi = counted.filter(level => Object.keys(pool[level.id] ?? {}).length >= 2);
  const overlapping = multi.filter(level => overlapsOf(level, pool[level.id]).length);
  if (multi.length && overlapping.length / multi.length > maxOverlap) {
    problems.push(`badge overlap ${overlapping.length}/${multi.length} is above ${maxOverlap}: ${overlapping.map(l => l.id).join(', ')}`);
  }
  const teach = campaign.findIndex(level => level.teaches === 'badges');
  if (teach >= 0) {
    for (const level of campaign.slice(0, teach)) {
      const early = Object.keys(pool[level.id] ?? {});
      if (early.length) problems.push(`${level.id} offers ${early.join(', ')} before ${campaign[teach].id}`);
    }
  }
  const untaught = beforeConsolidate(campaign);
  const gap = campaign.find(level => level.intro && level.mechanic === 'consolidate');
  for (const level of campaign) {
    if (untaught.has(level.id) && pool[level.id]?.tidy !== undefined) problems.push(`${level.id} offers tidy before ${gap.id}`);
  }
  return problems;
}

module.exports = {BADGE_LIMITS, badgeProblems};
