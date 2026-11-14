---
title: Re-dressed levels, three stars, and badges
created: 2026-11-14
source: claude-code
type: spec
status: draft
tags: [defrag, level-design, scoring]
---

# Re-dressed levels, three stars, and badges

## Intent

There are two problems.

**Levels look alike.** Many campaign levels are near copies of each other. Some differ by two moved blocks or rearranged homes. The player sees "the same puzzle again", even when the challenge differs. A level that looks new feels more generous. The look of a level should vary more than its challenge does.

**Scoring is one ladder.** Today a level earns ✓ (cleared), ★ (par without hints) or ✦ (under par). Nothing rewards a different way of playing it. We want a standard 3-star rating and optional badges. A badge rewards an optimization goal that pulls against par, so a player has a reason to replay.

## Evidence

A similarity scan compared every pair of non-intro boards, with file letters renamed in order of appearance.

- `required-split` and `required-split-revisited` use the identical board `.BCCCAA.BBAA`.
- About 30 of 37 non-intro levels have 7–14 sectors and 2–3 files. On the fixed 6-column grid (`engine.js` `COLUMNS`), they all render as two rows of small pairs.
- Clusters such as `park-a-pair`, `make-a-parking-spot`, `hold-that-thought`, `juggle` and `scoot-over` score 0.70–0.78 similarity. Similarity is 1 minus the normalized edit distance.

The cause is our own rule: "difficulty comes from tight space." It pushes every level toward a small, dense board.

## Goals

- Every campaign level looks clearly different from every other campaign level.
- Re-dressing keeps each level's par, mechanic, id and name, so saved scores stay valid.
- A checker rule stops near-copies from coming back.
- Every level shows a 1–3 star rating.
- Levels offer badges where a badge is a real trade-off against 3 stars.
- The solver proves badge targets, the same way it proves par.

## Non-goals

- Changing the grid width or the board drawing. The 6-column grid stays.
- New mechanics or new rules.
- Badges on the daily puzzle. It gets stars only. (My call: the daily pool has 60 generated levels, and badge solving would slow its generation.)
- Career achievements, such as "Tidy on 10 levels". These may come later as totals of per-level badges.

## Anti-goals

- A re-dress that changes difficulty. Adding free space makes puzzles easier. That counts as failure even when the level still looks different.
- A badge you earn automatically by getting 3 stars. That badge adds nothing.
- A badge with no target, such as "Tidy" at any cost. That is often trivial.
- Running the solver in the browser to decide badges.

## Part 1: Re-dress existing levels in place

### Approaches considered

- **Re-dress in place (chosen).** Change the look of existing levels and keep ids and pars. Saves survive. The current set of challenges is kept.
- **Regenerate new levels.** We get fresh boards, but lose authored levels and their saved progress.
- **Rule for new levels only.** The cheapest option, but it leaves the current sameness in place.

### Allowed transforms

Each transform must keep the optimum. The checker proves this.

- **Mirror.** Reverse the board. Map homes, cracked sectors and other positions to their mirrored sector. Relabel numbered fragments so the order still reads from the left. Reverse link direction (`A→B` becomes `B→A`), or relabel the files so the original chips stay correct.
- **Embed.** Place the puzzle inside a larger disk. Fill new sectors with reserved sectors (`#`) laid out as shapes or patterns. Never add free sectors. No locked filler files: `locked` belongs to the System files chapter, and filler would teach it early. (My call.)
- **Interleave reserved sectors.** Insert `#` between puzzle sectors where this does not change the optimum. On seek levels this changes travel distances, so the checker must confirm par. A different par is a failure.
- **Shift.** Move the puzzle to a different place on the disk.
- **Relabel.** Rename files, so the same letters do not repeat level after level. Keep `S` for system files. This is cosmetic. The similarity fingerprint ignores letters, so relabelling alone never passes the check. Rely on mirror, embed, interleave and shift. (My call.)

Builder's call: which transforms to use on each level. The aim is the most visually distinct set that still passes the checker.

### Hard requirements per re-dressed level

- Par is unchanged and is still the optimum. `beatable` levels keep their par above the optimum.
- The level's mechanic still changes the result. Existing `matters` checks pass.
- `id`, `name`, `mechanic` and `intro` are unchanged. Update `goal` and `prompt` text where positions or letters changed.
- Difficulty: par and the `matters` checks are the hard gate. Trap rate and line count (`tools/metrics.js`) may drift. `--metrics` prints them before and after for re-dressed levels, and warns if trap rate drops by more than 0.1 or line count more than doubles. (My call. The intent is the same challenge in new clothes, not an identical search tree.)
- Intro levels may be re-dressed, but they stay small and readable. They teach a rule.

`required-split-revisited` must no longer share a board with `required-split`. It may keep the same challenge in different clothes.

In-progress attempts are stored with a level signature. A re-dressed level discards its in-progress attempt. Best and clean scores stay valid. This is acceptable.

### Similarity check

Add a rule to `tools/check-levels.js`.

- Compare every pair of non-intro campaign levels. Not the daily pool.
- Intro levels are excluded from failure. They are 3–6 sectors, so one edit moves the score 20–33%. They only need to stay readable. Intro pairs at 0.75 or above produce a warning. (My call.)
- Fingerprint: the board string with files renamed in order of appearance (`a`, `b`, …), fragment digits kept and `S` kept. Overlay homes and cracked sectors as distinct marks, so two levels that differ only in homes still compare correctly.
- Similarity = 1 − (edit distance ÷ longer length).
- **Fail** at 0.75 or above. **Warn** from 0.60 to 0.75. (My call. These are starting values. Tune them once the re-dress is done.)
- Print each flagged pair with both boards.

The check is cheap. It runs on every `check-levels.js` call, not only with `--metrics`.

## Part 2: Stars and badges

### Stars

| Stars | Condition |
| --- | --- |
| 1 | Cleared. |
| 2 | Cleared without hints. |
| 3 | Cleared without hints, at or under par. |

Stars replace the ✓/★/✦ medal everywhere it shows: the Levels list, the home screen resume line, the ending screen, the clear message and the daily share text. Totals become "N of M ★" (stars earned out of stars possible).

Stars come from saved data that already exists (`progress.best`, `progress.clean`). No save migration is needed.

### Badges

#### Approaches considered

- **Computed per level (chosen).** There is a global list of badge conditions. A tool solves each level under each condition. A level offers a badge only where it is achievable and pulls against par. This needs no hand authoring, the solver proves it, and it scales to new levels.
- **Hand-picked per level.** More control, but slow, and it misses trade-offs nobody looked for.
- **Career achievements only.** Cheap, but nothing ties to a puzzle, so it creates no replay pull.

#### Badge conditions

Each level has a **primary cost**. That is operations (moves + splits) on most levels, and travel plus splits on `seek` levels.

| Badge | Condition | Target |
| --- | --- | --- |
| Tidy | Finish with all free space in one stretch. | Best primary cost with `consolidate` on. |
| Unsplit | Finish with no splits. | Best primary cost with whole-run moves only (`solve(..., {whole: true})`). |
| Light touch | Non-seek, non-clipboard levels. Finish with low total travel. | Lowest total travel, at any operation count. |
| Few moves | Seek levels. Finish with few operations. | Fewest operations, at any travel. |
| Under par | `beatable` levels only. Score below par. | The true optimum. Replaces ✦. |

Travel is the seek cost without splits: sectors between a run's old and new start. A nudge travels 1. Clipboard levels never offer Light touch, because a lift and a drop have no single distance without new solver state. (My call.)

A badge is earned when a hint-free clear meets its condition at or under its target. (My call: hints void badges, as they void 3 stars.)

#### When a level offers a badge

A level offers a badge only if both are true:

- The condition is achievable.
- No par line also meets the badge target. Getting 3 stars must not earn the badge for free.

For Tidy and Unsplit this test is simple: target > par.

For Light touch and Few moves it is a two-cost test. Light touch is offered if every solution with minimum travel costs more than par in operations. Few moves is the mirror test on seek levels. Builder's call how to compute this, for example a lexicographic solve or a combined weighted cost. It must be exact, not a heuristic.

`consolidate` levels never offer Tidy, because Tidy is already required. Levels with no free sectors never offer Tidy. `splitting` levels whose optimum needs a split offer Unsplit if the test passes.

#### Where badge data lives

Results are stored as data in `levels.js`, next to `par`, for example `badges: {tidy: 5, light: 9}`. The game never runs the solver to decide badges.

- Add a tool, `tools/badges.js` or a `--badges` flag on the generator. It computes badge data and writes it into each level.
- `check-levels.js` verifies stored badge data: each target is the true optimum, and each offered badge passes the trade-off test. Badge checks are slow, so they run behind a `--badges` flag. Default checks stay fast.
- A level with zero badges is valid. Many levels will have none. The checker fails only when stored badge data is wrong or missing a badge the tool would offer.

#### Tracking during play

`stats` today holds `moves`, `splits` and `cost`. Add `travel`, the total sectors travelled, tracked on every level, not only seek levels. At clear time, also record whether free space is in one stretch.

#### Saves

Add `progress.badges`, keyed by level id, holding the set of earned badge ids. Keep `defrag-progress-v3` and add the field with a default of `{}`, as `hinted` was added. No version bump.

#### Display

- **Levels list:** each level shows its stars, then one small icon per offered badge, filled when earned and outlined when not.
- **Clear screen:** stars earned, then each offered badge with its target and whether you met it. Example: "Tidy: 6 or less ✓". Show this only after the first clear. Before that, the badges are not shown, to keep the first play clean.
- **Help:** one line per badge rule.

Builder's call: icons, wording and layout, within the existing style in `console.css`.

## Order of work

1. Similarity check, warn-only at first, to list the offenders.
2. Re-dress levels until the check passes at the fail threshold. Turn on failure.
3. Stars in the UI.
4. Badge solver tool and checker verification.
5. Badge tracking, saves and display.

Steps 1–2 ship as one change. Steps 3–5 ship as a second.

## Tests

- `node tools/check-levels.js` passes with the similarity rule on.
- `node tests/play-all.js` still plays every level's optimal line.
- `tests/behavior.js` gains cases for: star levels from saved data, hints capping stars at 1, badge earned on a qualifying clear, badge not earned with a hint, and an old v3 save without `badges` loading cleanly.
- One play-through per badge type, on a level that offers it, following the badge's optimal line.

## Left to the builder

- Which transforms to apply to each level.
- How to compute the two-cost tests exactly.
- Badge icons, wording and layout.
- Final similarity thresholds, within the intent above.
