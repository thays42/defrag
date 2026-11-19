---
title: Badge coverage
created: 2026-11-19
source: claude-code
type: research
status: active
tags: [defrag, level-design, badge, campaign, coverage]
---

# Badge coverage

Results of the level redesigns in the competing solutions work (spec: `docs/superpowers/specs/2026-11-16-competing-solutions-design.md`). One section per chapter group. Coverage counts non-tutorial campaign levels that offer at least one badge. Overlap counts levels with two or more badges where one route meets two targets.

## Group 5a: Format, Allocation, Move order, Fragmentation

Coverage 16/49 (0.33) → 24/49 (0.48). Overlap 1/4 → 1/4 (`load-drivers`, left for 5c). `BADGE_LIMITS` is now `{floor: 0.48, maxOverlap: 0.25}`.

8 of 9 targets gained a badge with approach A (`tools/climb.js --badge`, 300 s, seed 7; other seeds where noted). None of the new badges overlap. Every pick was re-judged at the default 1e6 search limit. `fewer-is-better` keeps its board and has no badge. A ruling bars every badge before `near-or-far`, the level that teaches badges (see below).

| Level | Par old → new | Badges gained | Changed | Approach | Metric drift (trap, lines) |
|---|---|---|---|---|---|
| fewer-is-better | 2 → 2 | none (barred) | 0 | none: no badge allowed before near-or-far | 0.67, 1 → unchanged |
| warm-up | 2 → 2 | Light 6 | 2 | A, filtered climb (a run crosses a row break), seed 7, screened at 1e5 | 0.80, 1 → 0.86, 1 |
| park-a-pair | 3 → 3 | Light 10 | 5 | A | 0.00, 2 → 0.50, 1 |
| scattered-gaps-ii | 4 → 4 | Light 14 | 2 | A | 1.00, 2 → 1.00, 2 |
| blocked-lanes | 4 → 4 | Light 15 | 3 | A, seed 11 | 1.00, 5 → 1.00, 6 |
| required-split | 4 → 4 | Unsplit 5 | 1 | A | 0.00, 1 → 0.00, 1 (split gap ∞ → 1) |
| make-a-parking-spot | 5 → 5 | Light 14 | 1 | A | 0.00, 4 → 0.00, 4 |
| required-split-revisited | 6 → 7 | Light 27 | 2 | A, seeds 7 and 11 agree | 1.00, 3 → 1.00, 8 |
| two-splits | 7 → 7 | Light 20 | 3 | A, seed 11 | 0.00, 13 → 0.75, 2 |

Notes:

- `blocked-lanes`: the seed 7 pick (trap 1.00 → 0.00, lines 5 → 19) made the level much easier. The seed 11 pick keeps the trap rate.
- `required-split` now finishes without a split at par + 1, which is what its Unsplit badge means. Its goal now says "finish at par".
- `required-split-revisited`: both seeds found only par 7 (+1, within the limit).
- Ruling (review of 5a): no badge of any kind may appear before the `teaches: 'badges'` level. `badge-rules.js` and `judge` enforce it. A first pass gave `fewer-is-better` Tidy 3 (`.ABA.BA`). That pick was reverted, and the floor dropped from 0.51 to 0.48 under this ruling only.
- `warm-up` teaches that runs cross a row break. A first pass (`#.#A.A#CAC..CBBB##..`, 7 changed) lost that: nothing crossed a break at the start or in the par route. The re-climb only accepted boards where a run crosses a break at the start. The pick `#C.#.CAC.AABBB###` (old `#C.##CAC.AABBB##.`) has BBB across a break at the start. Its only par route ends with CCC and BBB across breaks.
