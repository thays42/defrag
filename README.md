# Defrag

A puzzle game about defragmenting a disk. Join each file into one run, send it home, and beat par.

Open `index.html` in a browser. There is no build step.

## Files

| File | Purpose |
| --- | --- |
| `engine.js` | Rules and solver. The game and every tool share it, so the rules exist once. |
| `levels.js` | Mechanics, chapters, and handmade levels. Each level has a stable `id` and one primary `mechanic`. |
| `daily.js` | Generated pool for the daily puzzle. Do not edit by hand. |
| `game.js` | User interface. |
| `tools/` | Level checker, quality metrics, and generator. |
| `tests/` | Browser tests (Playwright). |

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
| `nudges: 2` | Two one-sector slides into space the run already covers. |

## Add or change levels

1. Find candidates: `node tools/generate.js <preset> --count 20`. Presets: `homes`, `split`, `reserved`, `ordered`, `clipboard`, `seek`, `consolidate`, `system`, `fragile`, `links`, `nudge`, `daily`. The output is ranked by quality.
2. Pick candidates. Give each one an `id`, a name, a goal, and its `par` from the output. Add it to `levels.js`.
3. Verify: `node tools/check-levels.js`. Add `--metrics` to see the quality metrics for every level.

The checker fails if a par is not the optimum, an id repeats, a home does not fit, or a level's mechanic does not change its result. Intro levels (`intro: true`) are exempt from the last check. A level with `beatable: true` may set par above the optimum.

For `homes` and `reserved` levels the mechanic check only warns. Some original campaign levels keep the same optimum when their reserved sectors become free space, so their reserved sectors are decoration, not constraint. The checker lists them.

### Quality metrics

| Metric | Meaning | Good sign |
| --- | --- | --- |
| Par | Optimal score. | Rises through a chapter. |
| Trap rate | Share of tempting first moves (they settle a file or join pieces) that make par impossible. | High. |
| Lines | Number of optimal solutions. | Low (1–4). Many lines feel like shuffling. |
| Split gap | Best score without splitting, minus par. | Above 0 when the level is about splitting. |
| Gains | Par with each mechanic switched off, minus par. | Nonzero for the level's mechanic. |

Difficulty comes from tight space, not board size. Bigger boards with more free sectors are usually easier.

### Regenerate the daily pool

```
node tools/generate.js daily --count 60 --tries 6000 --seed 2026 --write daily.js
node tools/check-levels.js
```

## Tests

```
node tools/check-levels.js   # every par is optimal; data is valid
node tests/play-all.js       # plays every level's optimal line through real clicks
node tests/behavior.js       # selection, undo, restart, hints, medals, save migration
```

## Saves

Progress is saved in `localStorage` under `defrag-progress-v3`, keyed by level id. Reordering or inserting levels does not break saves. Older index-based saves (`v1`, `v2`) migrate on first load.
