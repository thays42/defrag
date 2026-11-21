---
title: Bonus stars design
created: 2026-11-21
source: claude-code
type: spec
status: active
tags: [defrag, scoring, star, badge, result-sheet]
---

# Bonus stars design

## Problem

The results sheet draws stars from the run just finished, not from the best. A player with ★★★ who goes for Light touch finishes over par, and the sheet shows ★★☆ "Over par". It looks like a lost star. Badges pull against par by design, so this happens on every badged level. Badges are also a second reward system next to stars.

## Decision (user, 2026-11-21)

- Badges become bonus stars. One reward system: stars.
- The sheet shows every star the level offers, which are earned, and which were earned on this run.
- Hover or long-press a star to see how to earn it.
- Bonus stars count on any clear, hinted or not. A hint only affects the No hints and Par stars.

## Design

- **Star set per level.** The three base stars stay as they are: Clear, No hints, Par. They remain a ladder. Each offered badge adds one bonus star. Bonus stars are independent of the ladder and of each other.
- **Names.** The bonus stars keep the badge names and targets: Tidy, Unsplit, Light touch, Few moves, Under par. The word "badge" leaves all player-facing copy.
- **Storage.** No save change. Base stars still derive from `progress.best` and `progress.clean`. Bonus stars still live in `progress.badges`. `badges.js`, `tools/badges.js` and the checker keep their names; they are internal.
- **Earning.** A clear earns every bonus star whose target it meets, whether or not a hint was used. Remove "Hints void badges".
- **Results sheet.** One row holds every star of the level: the 3 base stars, then the bonus stars.
  - Not earned: outline.
  - Earned on an earlier run: filled, no animation.
  - Earned on this run for the first time: filled, with the existing star animation.
  - Each star keeps a short label under it (Clear, No hints, Par, Light touch …).
  - Each star has a `title` and `aria-label` that say how to earn it, for example "Light touch: travel 5 sectors or less". Long-press on touch shows the same text; a tap that toggles a small caption is fine.
  - The base stars show the best ever, so a run over par never shows a lost star.
  - "Your best here" goes away; the row already shows it.
  - The title is "Optimized" when this run cleared at par without hints, else "Defragmented".
  - The line under the stars speaks to the next unearned star, not to this run's shortfall. It hides when every star is earned.
  - The separate badge list on the sheet goes away.
- **Before the first clear.** Bonus stars stay hidden until the level's first clear, as badge chips are today.
- **During play.** The live counters beside the score stay. They show the bonus star's icon, the count and the target.
- **Totals.** A level's maximum is 3 plus its bonus stars. Campaign totals, the resume line, the catalog and the ending sum these maximums. The catalog row shows the level's filled and empty stars, base then bonus. The daily puzzle has only the base 3.
- **Help.** The Badges entry becomes Bonus stars, with the same rules and no hint clause.

## Non-goals

- No change to which levels offer which targets, or to the targets.
- No change to the daily share text.
- No save migration.
