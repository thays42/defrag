---
title: Competing solutions design
created: 2026-11-16
source: claude-code
type: spec
status: draft
tags: [defrag, level-design, badge, travel, campaign]
---

# Competing solutions design

## Intent

Most puzzles should have more than one good answer. Par is one. A badge goal that pulls against par is another. The player clears at par, then sees a different target and tries again. This gives replay value on most levels, not only a few.

Travel is the axis that started this. Every level counts it, but the game never introduces it. A player first meets it as an unexplained chip, "↝ 3/8 travel", on Choose what to park.

## Current state (measured 2026-11-16)

- 49 campaign levels are non-tutorial (`intro` not set). 16 of them offer any badge. 4 offer two or more.
- By badge: Light touch 10, Few moves 4, Unsplit 3, Tidy 2, Under par 1.
- The solver compared par travel with minimum travel on the 45 non-tutorial, non-seek levels. On 10, minimum travel costs more than par. On 30, a par solution is already the minimum travel. On 5, the search hit its limit.
- The cause: levels were tuned so one route is clearly best. Where only one good route exists, it is also the shortest.
- The 33 non-tutorial levels with no badge are listed by `node tools/badges.js` (`{}` output). 10 of them fill all 24 sectors, so they cannot grow.

## Goals

- At least 80% of non-tutorial campaign levels offer at least one badge. A badge counts only if it pulls against par: the existing rule in `tools/badges.js` (the badge target is unreachable at par). Any badge type counts.
- One route meeting two badge targets at once is allowed but uncommon. Among levels with two or more badges, at most 25% may have one solution that meets two badge targets.
- A tutorial teaches travel and the idea that a level can have a second goal.
- `tools/check-levels.js` enforces both numbers, so later level edits cannot erode them.

## Non-goals

- No new badge types and no change to badge rules, stars, or par.
- No change to tutorial levels, except the new travel Teach level.
- No change to the Extra set or the daily puzzle.
- No UI changes beyond what the new Teach level needs.

## Anti-goals

- A redesigned level must keep its lesson. Its own mechanic must still change par. Combine levels must still pass `tools/combine-rules.js`.
- The difficulty curve must not jump. Par may move by at most 1 from the current value.
- Chapter order and teach order (`tools/teach-order.js`) must still pass.
- A badge that only exists because of an unproven search does not count. The search limit stays at 1e6 states.

## Constraints

- Plain JS, no build step. Levels live in `levels.js`. `badges.js` is generated: `node tools/badges.js --write badges.js`.
- Saves are keyed by level id. A redesigned level keeps its id. A changed board changes its `signature`, so an in-progress attempt restarts. That is acceptable. Best scores and stars stay keyed by id. Ruling: keep them, even though the board changed. Phase 2 already reworked levels under the same policy.
- Light touch is skipped on seek and clipboard levels by `computeBadges`. That stays.

## Approaches

- **A. Mutate existing levels (chosen).** Extend `tools/climb.js` with a badge objective and one new mutation: grow the board by one empty sector at either end. It keeps names, lessons, and chapter order. Some levels may not converge.
- **B. Generate replacements.** Run `tools/generate.js` presets with a badge filter and pick new boards. This gives more variety and a faster search. But it discards curated levels, names, and tuned order. Used only as the fallback for a level where A fails.
- **C. Hand edits with solver feedback.** The most control, but the slowest. It is A without the search.

## Design

### 1. Badge objective in the climber

- New flag `--badge` for `tools/climb.js`. A candidate scores when `computeBadges(candidate)` returns at least one badge.
- The existing guards stay: the level's own rules must still change par (the `matters` check from `tools/metrics.js`). For Combine levels, every rule in `combines` must still change par.
- New guard: `|candidate par − original par| ≤ 1`.
- A candidate may make another rule change par (for example, a split now required on a non-splitting level, which is what an Unsplit badge implies), provided `tools/teach-order.js` still passes. Ruling: tutorials carry the teaching, so a non-tutorial level may use any rule already taught.
- Difficulty metrics from `check-levels --metrics` (trap rate, number of optimal lines) are soft. Among passing candidates, prefer the one whose metrics move least. Their warnings are allowed on edited levels.
- Overlap is penalised: a candidate whose new badges overlap (section 2) ranks below one whose badges do not.
- New mutation `grow`: add one `.` at the start or end of the board. Allowed only while the board is under 24 sectors. Homes, fragile, and other 1-based positions shift when growing at the start.
- Score order: has badge, then par distance (0 before 1), then fewer sectors changed from the original (similarity), then quality.
- Input: one level id. Output: JSON lines, ranked.

### 2. Overlap check

- New function `overlaps(level, badges)` in `tools/badges.js`. It returns the badge pairs that one solution can meet together.
- It must be exact. A pair overlaps if some solution meets both targets. The solver's `budget` option gives the exact answer: least cost by one badge's measure, with the other badge's measure capped at its target.
- An unproven search counts as overlapping. This is the conservative choice.

### 3. Checker rules

- In `tools/check-levels.js --badges`:
  - Coverage: badged non-tutorial levels ÷ all non-tutorial levels ≥ the floor. The floor is 0.80, or the reached value under the shortfall ruling in section 5.
  - Overlap: levels with an overlapping pair ÷ levels with two or more badges ≤ 0.25. When no level has two badges, this passes.
- Each failure prints the numbers and lists the levels without a badge.

### 4. Travel Teach level

- One new level in Format, right after `fewer-is-better` (the par lesson) and before `warm-up`. Ruling: id `near-or-far`, name "Near or far". Placing it this early means every later level may carry Light touch without meeting an unexplained chip, and keeps `warm-up` eligible. No level before it may offer Light touch; the checker enforces this.
- It teaches that travel is the number of sectors moved, and that a second goal can pull against par.
- Board: two routes. One clears in N moves using a far gap. One clears in N+1 moves using a near gap with less travel. Small partition, 1 row.
- It is a Teach level that offers a badge. The score and badge chips already show on every level, including `intro` ones; only `computeBadges` skips `intro` levels. Ruling: add a level field `teaches: 'badges'`; `computeBadges` skips `intro` levels unless they have it. No `game.js` change is needed for the chip.
- Prompt copy: "Travel counts every sector a run moves. Clear at par, then try for ↝: one more move, much less travel."
- It counts as a tutorial, so it is outside the 80% count.

### 5. Process per level

- Run the climber on each badge-less non-tutorial level, roughly one chapter at a time.
- Already-badged levels may also be re-climbed, but only to fix the overlap ratio. Today `load-drivers` overlaps (Unsplit and Few moves), which is 1 of 4 two-badge levels: exactly the 25% limit.
- Budget: 24 of the 33 badge-less levels must gain a badge (39 of 49 is 79.6%, a fail). 10 of the 33 fill all 24 sectors, so `grow` cannot help them, and `tools/generate.js` presets are single-mechanic, so approach B cannot replace Combine levels.
- The builder picks the best candidate and checks it against the anti-goals. The goal text and prompt get updated if the board changed what they describe.
- When the climber fails after `--seconds 300`, try approach B for that slot. If B also fails, try approach C: hand edits, with `computeBadges` and the anti-goal checks run on each version. If C also fails, leave the level as is. The 80% target allows 9 of 49 without a badge.
- Shortfall ruling: if coverage is still under 80% after A, B and C, the checker floor is set to the coverage reached (a ratchet), not 80%. The floor may only rise later. The builder reports each level that missed and why.
- After all edits: regenerate `badges.js`, and run `tools/check-levels.js --badges`, `tests/play-all.js`, and `tests/behavior.js`.

## Left to the builder

- Mutation weights and step counts in the climber.
- Which candidate to pick when several pass. Prefer the one that changes the board least.
- Updating goal text where a board change makes it wrong.
- The exact board of Near or far, within the shape above.
