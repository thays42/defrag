---
title: Daily tiers design
created: 2026-11-26
source: claude-code
type: spec
status: active
tags: [defrag, daily, generator, level-quality]
---

# Daily tiers design

## Problem

The daily puzzle draws from 60 boards in `daily.js`. The pick is days since 1970 modulo 60, so a board repeats every 60 days. Every board uses only homes and reserved sectors, with par 3–9. A player who finished the campaign knows 12 rules but gets a chapter-2 puzzle every day. The pool is shuffled, so difficulty jumps at random from day to day.

## Intent

One shared board a day that is still worth playing after the campaign. Everyone gets the same board on the same date, so the share text compares like with like.

## Decisions (user, 2026-11-26)

- The daily can use any rule. It does not follow the player's campaign progress. (A future endless mode will unlock rules with the campaign. That mode is out of scope here.)
- Difficulty ramps by weekday: Monday is gentle, and the weekend mixes rules.
- Build approach: tiers written down per weekday (approach 1 below).
- Out of scope: streaks, an archive of past days, and bonus stars on the daily.

## Goals

- Each weekday has its own tier of boards, and each tier has its own rules and par range.
- A tier repeats much less often than every 60 days.
- Daily boards meet the same quality bar as campaign boards.
- A player who meets a rule they have not learned yet can still play the board.

## Non-goals

- Streaks, archive, bonus stars (deferred; each can be added later without touching the pool).
- Generating boards in the browser.
- Per-player boards or unlocking rules.
- Changes to the share text format or the 3 base stars.

## Anti-goals

- Lowering the quality bar to fill a tier. A smaller tier that repeats sooner is better than weak boards.
- A daily that breaks result comparison: two players on the same local date must get the same board.

## Approaches

1. **Tiers written down per weekday (chosen).** A spec lists the rules and the par range for each weekday. A build tool searches each tier with the existing generators, filters candidates, and writes seven lists. It is predictable for players ("Sunday is a mix"), each tier can be tuned on its own, and it reuses proven tools. The cost: the spec is a judgment call, and a narrow tier may yield few boards.
2. **One pool cut by a difficulty score.** Generate a broad mix, score difficulty from par, rule count, trap rate and paths, and cut into seven bands. One dial, and the bands always fill. Rejected: no proven difficulty formula exists, and players could not predict a day's rules.

Chosen because the weekday pattern is the point of the feature, and because the campaign is already designed rule first, par second.

## Design

### Tier spec

The spec lives in the build tool as data, one entry per weekday. Each entry gives the rule sets a board may use, the par range, and a target count. Starting proposal (my call; tune during the build):

| Day | Rules | Board shape |
| --- | --- | --- |
| Monday | homes, reserved | Today's pool shape. Par 3–6. |
| Tuesday | splitting or numbered fragments, with homes | Par 5–8. |
| Wednesday | free space or linked files | Par 5–8. |
| Thursday | system files or cracked sectors | Par 5–8. |
| Friday | clipboard, nudges or seek cost | Par 5–9; seek par uses its own range (about 8–16), since a seek move costs its distance. |
| Saturday | exactly two advanced rules combined | Each rule must change par. |
| Sunday | three or more advanced rules combined | Each rule must change par. Like the Boot chapter. |

"Advanced rules" are numbered fragments, free space, linked files, system files, cracked sectors, clipboard, nudges and seek cost. Homes, reserved sectors and splitting may appear on a weekend board but do not count toward its two or three. Two rules from the same weekday tier (clipboard and nudges, say) may combine. (My call.)

Target: 60 boards per tier. A tier fills up to the target or to what passes the filters, whichever is lower. With 60 boards, a tier repeats about every 14 months.

Minimum: 20 boards per tier, so a tier repeats at most every 5 months or so (user, 2026-11-26). The new pool does not ship until every tier meets the minimum. No tier borrows boards from another. If a tier stays below 20 after long runs, its spec is revisited (rules or par range), not its quality bar. The build tool and the checker both fail on a tier below 20.

### Build tool: `tools/build-daily.js`

- For single-rule tiers it reuses the `generate.js` presets. For Saturday and Sunday it reuses the `combine.js` search, with a time budget (`--seconds`). Refactor the presets and the combine search into functions the tool can call, rather than shelling out.
- It can build one tier at a time: `node tools/build-daily.js <day> [--seconds N] [--seed N]`. Runs append to the tier already in `daily.js`, so a long weekend search can run overnight in several passes.
- It prints the count per tier when it finishes, so a thin tier is visible.
- Seeds and the command are recorded in the `daily.js` header, as today.

### Filters (each candidate must pass all)

- Not solved at the start. Par inside the tier's range.
- Every rule the tier names changes par (`matters` in `tools/metrics.js`). Monday names homes; reserved sectors may appear without mattering there, as in today's pool. Rules a generator adds on the side, such as reserved padding from `combine.js` or homes from the clipboard preset, may appear without mattering. (My call.) The board records the tier rules it was checked for in `checked`, so the checker can repeat the check.
- Hint search stays small (`hintCheap`), because the hint runs the solver in the player's browser.
- Trap rate and paths within the ranges the campaign uses. The builder picks the exact bounds from the campaign's metrics (`check-levels.js --metrics`).
- Not too similar to any campaign level or any board in any tier (`similarity`, fail at 0.75 as for campaign pairs). Players who finished the campaign would recognize a copied level. (My call; it costs some weekend yield.)
- Ranked by `quality`; the best are kept.

### `daily.js` format

Seven lists keyed by weekday. Each board carries the level fields it needs (`board`, `par`, `homes`, `cost`, `fragile`, `links`, `locked`, `clipboard`, `nudges`, `consolidate`, `offset` as used) a `rules` list, and a `checked` list. `rules` is every rule the board uses, computed at build time with `uses` plus a split check; the rule card reads it, so side-effect rules are explained too. `checked` is the subset that must change par. The game reads `rules` and never recomputes it.

```js
const dailyTiers = {
  monday: [{id: 'mon-1', par: 5, board: '...', homes: {...}, rules: ['homes', 'reserved'], checked: ['homes']}, ...],
  ...
};
```

The old 60 boards can seed the Monday tier if they pass the new filters.

### Choosing today's board

- Tier: the weekday of the player's local date, as today's code uses the local date.
- Index: weeks since a fixed epoch, modulo the tier length. Consecutive Mondays get consecutive Monday boards.
- Tiers freeze once shipped: no appends and no reordering, since either would move every future date to another board. Appending runs happen before release. Growing a tier later means a new pool version that takes over from a set date, with the old pool kept for dates before it. (My call.)
- The level id stays `daily-<date>`, so saved best scores by date keep working. A saved attempt for today from the old pool fails the signature check and starts fresh; that already works.

### Rule card

When today's board uses a rule the player has not learned, a short card shows before play.

- "Learned" means the player has cleared the first intro level of that rule's mechanic (the same level `tools/teach-order.js` treats as teaching it).
- The card lists each unlearned rule by name with its `rule` text from `mechanics` in `levels.js`.
- It shows when the daily opens, until the player clears that day's board. The rules stay reachable through Help.
- Presentation follows the existing help dialog. The exact look is left to the builder.

### Checker and tests

- `check-levels.js` reads the tiers. For each daily board it checks that par is the optimum, every rule in `checked` changes par, `rules` matches what the board uses, and no daily board reaches 0.75 similarity with another daily board or a campaign level. Teach order does not apply to daily boards.
- Browser tests: today's board comes from the right tier, the same date always gives the same board, the rule card appears for an unlearned rule and not for a learned one, and the daily still offers only the 3 base stars. `play-all.js` should play one board from each tier.

## Constraints

- No build step. `daily.js` is a plain script loaded by `index.html`.
- Weekend combo searches take minutes per board. Building them happens offline, never in the browser.
- The rules and solver live once, in `engine.js`.

## Left to the builder

- The exact par, trap-rate and path bounds per tier.
- How to refactor `generate.js` and `combine.js` so the build tool can call them.
- The rule card's look and wording, within the existing UI style.
- The weekly epoch.
- Whether the Monday tier reuses the old pool.
