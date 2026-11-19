# Defrag

A puzzle game about defragmenting a disk. Join each file into one run, send it home, and beat par.

Run `make play`, or open `index.html` in a browser. There is no build step.

## Files

| File | Purpose |
| --- | --- |
| `engine.js` | Rules and solver. The game and every tool share it, so the rules exist once. |
| `levels.js` | Mechanics, chapters, and handmade levels. Each chapter has a one-line `summary`. `extras` holds the optional Extra set, and `levels` lists every level. Each level has a stable `id` and one primary `mechanic`. A Combine level also lists `combines`: two or more rules, each of which must change par. The last chapter, Boot, is the finale: three or more rules per level. |
| `daily.js` | Generated pool for the daily puzzle. Do not edit by hand. |
| `badges.js` | Generated badge targets per level. Do not edit by hand. |
| `game.js` | User interface. |
| `tools/` | Level checker, quality metrics, and generator. |
| `tests/` | Browser tests (Playwright). |
| `Makefile` | `make play` opens the game in your default browser. |

## Mechanics

Mechanics are level flags. One level can combine several.

| Flag | Effect |
| --- | --- |
| `homes: {A: [3, 5]}` | File A must finish inside sectors 3–5. |
| `#` in the board | Reserved sector. |
| Digits in the board (`A2A1`) | Numbered fragments. They must finish in order. |
| `clipboard: true` | One off-disk slot that holds a single run. |
| `cost: 'seek'` | A move costs the distance it travels. |
| `consolidate: true` | All empty sectors must finish in one stretch. |
| `locked: ['S']` | File S never moves. |
| `fragile: [4]` | Sector 4 is cracked. It fails as soon as it is emptied. |
| `links: [['A', 'B']]` | A's run must end where B's starts. |
| `offset: 9` | Nine unallocated sectors come before the board in the 6×4 frame. Without it, the board is centered. |
| `nudges: 2` | Two one-sector slides into space the run already covers. |

Every board sits in a fixed 6×4 frame of 24 sectors. Sectors outside the board are unallocated.

## Scoring

| Stars | Condition |
| --- | --- |
| ★ | Cleared. |
| ★★ | Cleared without hints. |
| ★★★ | Cleared without hints, at or under par. |

The first Hint press ever only warns that a hint caps the level at one star; the next press shows the hint. The first results sheet defines par, and a level with `beatable: true` says on every sheet that par can be beaten.

Badges reward a different goal that costs more than par, so 3 stars never earns one for free. `tools/badges.js` solves each campaign level under each condition and offers a badge only where the solver proves that trade-off. The daily puzzle and most intro levels offer none. The intro level `near-or-far` teaches badges with Light touch. Hints void badges.

| Badge | Condition | Target |
| --- | --- | --- |
| Tidy | Free space in one stretch. | Best score with that rule on. |
| Unsplit | No splits. | Best score without splits. |
| Light touch | Non-seek, non-clipboard levels. | Lowest total travel. |
| Few moves | Seek levels. | Fewest moves plus splits. |
| Under par | `beatable` levels. | The true optimum. |

A search too large to finish leaves the badge out, since its target is unproven.

## Add or change levels

1. Find candidates: `node tools/generate.js <preset> --count 20`. Presets: `homes`, `split`, `reserved`, `ordered`, `clipboard`, `seek`, `consolidate`, `system`, `fragile`, `links`, `nudge`, `daily`. The output is ranked by quality.
2. Pick candidates. Give each one an `id`, a name, a goal, and its `par` from the output. Add it to `levels.js`.
3. Verify: `node tools/check-levels.js`. Add `--metrics` to see the quality metrics for every level.

The checker fails if a par is not the optimum, an id repeats, a home does not fit, or a level's mechanic does not change its result. Intro levels (`intro: true`) are exempt from the last check. A level with `beatable: true` may set par above the optimum.

The checker also enforces teach order (`tools/teach-order.js`). A campaign level may use a rule only after the first intro level of that rule. No level before `split-a-run` may need a split, and no board before `across-the-break` may span two rows.

`--par N` and `--length N` make the generator keep only candidates with that optimum or board length.

Campaign levels must also look distinct. The checker compares every pair of boards, with files renamed in order of appearance, and scores 1 minus the normalized edit distance. It takes the higher of two views: the layout alone, and the layout with home and cracked sectors marked. Non-intro pairs at 0.75 or above fail. Pairs from 0.60 warn. Intro boards are tiny, so their pairs only warn. `tools/redress.js` mirrors, pads or relabels a level without changing its puzzle. `node tools/redress-search.js` proposes re-dresses that keep par, the mechanic check and trap rate.

For `reserved` campaign levels the mechanic check fails when freeing the reserved sectors leaves par unchanged: reserved sectors must be a constraint, not decoration. The check searches only up to par − 1, so it finishes even on full-disk boards. A level whose reserved sectors are decoration but whose homes drive the puzzle is labelled `homes`. For `homes` levels the check only warns, since some original levels keep the same optimum without their homes. A rework that changes a level's par keeps the level's id. A one-time save migration in `game.js` (`loadProgress`) drops that level's old best scores, stars and badges, so they do not carry over.

### Combine levels

A Combine level lists its rules in `combines`. The checker (`tools/combine-rules.js`) requires the following:

- At least two rules, including the level's own `mechanic`.
- Each rule changes par. A constraint rule lowers par when switched off. A tool (clipboard, nudges) puts par out of reach when switched off. Splitting: no whole-run solution reaches par. Seek: the cheapest route takes more moves than the fewest-move solution.
- Par is at least the par of every earlier plain level with the same `mechanic`.
- In the Boot chapter, at least three rules per level, and the last level uses `system`.

Find boards with `node tools/combine.js <rule,rule,...>`. Flags: `--sizes 3,3,2` (file sizes), `--free 3`, `--length 24`, `--min-par N`, `--par N`, `--seed`, `--tries`, `--count`. Sectors left over become reserved. Filters run cheapest first: par (capped at 2e5 states), then each rule's check, then the detail metrics. Each output line has `quality` and `similarity`, the closest match to an existing level. `--active N` keeps the puzzle in an N-sector stretch padded with reserved sectors; random spreads over all 24 sectors rarely work. `--seconds N` stops the search and reports what it found. Each kept board also streams to stderr as a `kept {...}` line.

Hints run the solver on the main thread, and `game.js` stops a hint at 3e5 states with a message. So every campaign level must solve within 2e5 states at the start and after any first move (`hintCheap` in `tools/metrics.js`, tested in `tests/tools.js`). `combine.js --hint-limit 2e5` applies the same filter while searching. Numbered fragments on three files of 3 sectors are the usual cause of slow hints.

When random search finds nothing, `node tools/climb.js <rule,rule,...> --from seeds.jsonl --min-par N` hill-climbs from earlier boards (for example `kept` lines with a field added for the new rule). It swaps sectors, moves homes and moves cracked sectors, and keeps changes that make more rules matter, raise par, or raise quality. `tools/board-builder.js` holds the random builder that `generate.js` and `combine.js` share.

### Quality metrics

| Metric | Meaning | Good sign |
| --- | --- | --- |
| Par | Optimal score. | Rises through a chapter. |
| Trap rate | Share of tempting first moves (they settle a file or join pieces) that make par impossible. | High. |
| Lines | Number of optimal solutions. | Low (1–4). Many lines feel like shuffling. |
| Split gap | Best score without splitting, minus par. | Above 0 when the level is about splitting. |
| Gains | Par with each mechanic switched off, minus par. | Nonzero for the level's mechanic. |

Difficulty comes from tight space, not board size. Bigger boards with more free sectors are usually easier.

### Regenerate badges

After changing any campaign level, regenerate badge targets and verify them:

```
node tools/badges.js --write badges.js
node tools/check-levels.js --badges
```

### Badge rules

`check-levels --badges` enforces these rules (`tools/badge-rules.js`):

- A level with `teaches: 'badges'` teaches badges. Today that is `near-or-far`, an intro level that offers Light touch.
- No level before `near-or-far` offers a badge. No level before `one-gap` offers Tidy. `tools/badges.js` applies both bars, so `--write` never emits a badge the checker rejects.
- At least 80% of non-intro campaign levels offer a badge (the coverage floor).
- At most 25% of levels with two or more badges let one solution meet two badges at once (the overlap cap).
- These limits only ratchet: the floor never falls and the cap never rises. Do not loosen them to pass a level.

To find a board for a level that has no badge, run `node tools/climb.js --badge <id>`. It changes the board a little at a time and keeps candidates that pass every check-levels guard. `--limit N` caps each badge search to screen big boards faster. A capped search offers no badge, so re-verify a pick at the default limit of 1e6 before applying it.

### Regenerate the daily pool

```
node tools/generate.js daily --count 60 --tries 6000 --seed 2026 --write daily.js
node tools/check-levels.js
```

## Tests

```
node tools/check-levels.js   # every par is optimal; data is valid; levels look distinct
node tests/tools.js          # unit checks for the level tools
node tests/play-all.js       # plays every level's optimal line through real clicks
node tests/behavior.js       # selection, undo, restart, hints, medals, save migration
```

## Saves

Progress is saved in `localStorage` under `defrag-progress-v3`, keyed by level id. Reordering or inserting levels does not break saves. Older index-based saves (`v1`, `v2`) migrate on first load.
