# Re-dressed Levels, Stars and Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every campaign level look distinct without changing its challenge, then replace the medal with a 3-star rating and add solver-proven optimization badges.

**Architecture:** A similarity fingerprint and puzzle-preserving board transforms live in `tools/`. Levels are re-dressed in `levels.js`, and the checker enforces distinctness. The engine's `solve` gains a `price` option, so a tool can compute badge targets offline into a generated `badges.js`. The game reads `badges.js` the same way it reads `daily.js`, and never runs the solver for badges.

**Tech Stack:** Plain browser JavaScript (no build), Node for tools, Playwright for browser tests.

**Spec:** `docs/superpowers/specs/2026-11-14-redress-stars-badges-design.md`

## Global Constraints

- Ids, names, mechanics, `intro` flags and pars of existing levels do not change. `beatable` levels keep par above the optimum.
- A re-dress never adds free (`.`) sectors.
- Similarity: compare non-intro campaign levels only. Fail at ≥ 0.75. Warn from 0.60 to 0.75. Intro pairs at ≥ 0.75 warn only. The daily pool is excluded.
- Fingerprint: files renamed in order of appearance, fragment digits kept, `S` kept, home and cracked sectors marked.
- Stars: 1 = cleared, 2 = cleared without hints, 3 = cleared without hints at or under par.
- Badges: `tidy`, `unsplit`, `light` (non-seek, non-clipboard levels), `few` (seek levels), `under` (`beatable` levels only). Hints void badges.
- Travel: `|to − from|` for a move, which makes a nudge 1. Cut and paste travel 0.
- Saves stay under `defrag-progress-v3`. The new `badges` field defaults to `{}`.
- The daily puzzle gets stars only, no badges.
- Badge data is generated, never hand-edited. Badge checks run only behind `--badges`. Default `check-levels.js` stays fast.
- Deviation from the spec, builder's call: badge data lives in a generated `badges.js` keyed by level id, not inline in `levels.js`, so a tool never rewrites hand-written level data.

## Review Focus

- **Old v3 save with an in-progress attempt whose `stats` has no `travel`.** Resuming must not produce `NaN` travel. It should continue counting from 0 (Task 8).
- **A re-dressed level that discards an in-progress attempt.** It should open fresh with no error, and keep its best and clean scores and stars (Task 8).
- **A level offering zero badges.** The Levels list and clear screen should show stars only, with no empty badge row and no stray separator (Task 8).
- **A badge earned on a hinted clear.** It must not be recorded. Stars must cap at 1 (Task 8).
- **A badge level whose `badges.js` entry is stale after a board edit.** `check-levels.js --badges` must fail, naming the level (Task 6).

---

## Part A: Distinct levels (ships as one change)

### Task 1: Similarity fingerprint and checker rule (warn-only)

**Files:**
- Create: `tools/similarity.js`
- Create: `tests/tools.js` (plain Node asserts, no Playwright)
- Modify: `tools/check-levels.js` (after the per-level loop, before the warnings print)
- Modify: `README.md` (Tests section: add `node tests/tools.js`. Checker section: describe the rule)

**Interfaces:**
- Produces: `fingerprint(level) -> string[]`, one token per sector. `similarity(a, b) -> number` in [0, 1]. `similarPairs(levels, {warn = 0.6, fail = 0.75}) -> [{a, b, score, level: 'warn'|'fail'}]`. A pair that includes an intro level is never `'fail'`.

- [ ] **Step 1: Write failing tests in `tests/tools.js`**

```js
const assert = require('assert');
const {fingerprint, similarity, similarPairs} = require('../tools/similarity.js');
const lv = (board, extra = {}) => ({id: board, board, ...extra});
// Letters ignored, structure kept.
assert.strictEqual(similarity(lv('AB.AB'), lv('CD.CD')), 1);
// Fragment digits kept.
assert.ok(similarity(lv('A2.A1.'), lv('A.A.')) < 1);
// Homes and cracked sectors change the fingerprint.
assert.ok(similarity(lv('AA..'), lv('AA..', {homes: {A: [3, 4]}})) < 1);
assert.ok(similarity(lv('AA..'), lv('AA..', {fragile: [3]})) < 1);
// S stays S.
assert.deepStrictEqual(fingerprint(lv('S.A')).map(t => t[0]), ['S', '.', 'a']);
// Identical non-intro boards fail; an intro pair only warns.
assert.strictEqual(similarPairs([lv('.BCCCAA.BBAA'), {...lv('.BCCCAA.BBAA'), id: 'x'}])[0].level, 'fail');
assert.strictEqual(similarPairs([lv('A.A.', {intro: true}), {...lv('A.A.'), id: 'y'}])[0].level, 'warn');
console.log('tools ok');
```

- [ ] **Step 2: Run** `node tests/tools.js`. Expected: FAIL, "Cannot find module '../tools/similarity.js'".

- [ ] **Step 3: Implement `tools/similarity.js`**

A token is the base character plus suffixes. The base is the renamed file letter (`a`, `b`, … in order of first appearance, `S` unchanged) plus its fragment digit, or `.`, or `#`. Append `^` if the sector is in any home, and `!` if it is cracked. Parse with `E.parseBoard` and positions with `E.initialState(level).cells`, so tokenizing matches the engine. Ignore the engine's end padding: compare `level.board` length only. Similarity is 1 − Levenshtein(tokens) ÷ longer length.

- [ ] **Step 4: Run** `node tests/tools.js`. Expected: `tools ok`.

- [ ] **Step 5: Wire into `check-levels.js`**

Run `similarPairs` over `chapters.flatMap(c => c.levels)`. For now, push **every** pair into `warnings`, fails included, formatted `similar 0.83: required-split .BCCCAA.BBAA ~ required-split-revisited .BCCCAA.BBAA`. Task 4 switches fails to `problems`.

- [ ] **Step 6: Run** `node tools/check-levels.js`. Expected: "All N levels pass." plus similarity warnings, including `required-split ~ required-split-revisited` at 1.00.

- [ ] **Step 7: Commit** `tools/similarity.js tests/tools.js tools/check-levels.js README.md` with the message "Add level similarity check (warn-only)".

### Task 2: Puzzle-preserving board transforms

**Files:**
- Create: `tools/redress.js`
- Modify: `tests/tools.js`

**Interfaces:**
- Produces, all pure functions returning a new level and leaving other fields unchanged:
  - `mirror(level)`
  - `insertReserved(level, at, count = 1)`, where `at` is a 1-based sector index and new `#` go before it. `at = board length + 1` appends.
  - `relabel(level, map)`, where `map` is like `{A: 'D', B: 'A'}`.
- Remapped fields: `board`, `homes`, `fragile`, `links`, `locked`. Also rewrite `goal` and `prompt` text only for relabel, by replacing whole-word letters. Mirror and insert leave text to the author.
- CLI: `node tools/redress.js <id>` prints the level and its similarity to its nearest neighbour.

- [ ] **Step 1: Add failing tests to `tests/tools.js`**

```js
const E = require('../engine.js');
const {mirror, insertReserved, relabel} = require('../tools/redress.js');
const base = {id: 't', board: 'A2.A1B', homes: {B: [4, 4]}, fragile: [2], links: [['A', 'B']]};
const m = mirror(base);
assert.strictEqual(m.board, 'BA2.A1'); // tokens reversed, fragments renumbered k -> m+1-k
assert.deepStrictEqual(m.homes, {B: [1, 1]});
assert.deepStrictEqual(m.fragile, [3]);
assert.deepStrictEqual(m.links, [['B', 'A']]);
const i = insertReserved(base, 2, 2);
assert.strictEqual(i.board, 'A2##.A1B');
assert.deepStrictEqual(i.fragile, [4]);
assert.deepStrictEqual(i.homes, {B: [6, 6]});
assert.strictEqual(relabel(base, {A: 'C', B: 'D'}).board, 'C2.C1D');
// Mirror keeps the optimum on real levels.
for (const lvl of require('../levels.js').chapters.flatMap(c => c.levels).filter(l => !l.beatable))
  assert.strictEqual(E.solve(mirror(lvl)).cost, lvl.par, `mirror changes par of ${lvl.id}`);
```


- [ ] **Step 2: Run** `node tests/tools.js`. Expected: FAIL, missing module.

- [ ] **Step 3: Implement `tools/redress.js`**

Tokenize with `E.parseBoard`. For mirror, sector `p` maps to `n + 1 − p`, a home `[a, b]` maps to `[n+1−b, n+1−a]`, links are reversed pairwise, and fragments are renumbered per file. For insert, every position ≥ `at` shifts by `count`. Export the functions and run the CLI when `require.main === module`.

- [ ] **Step 4: Run** `node tests/tools.js`. Expected: `tools ok`, and the mirror-par loop passes for every non-beatable level.

- [ ] **Step 5: Commit** with the message "Add puzzle-preserving board transforms".

### Task 3: Metrics baseline for re-dress drift

**Files:**
- Create: `tools/metrics-baseline.json`, generated once before any re-dress
- Modify: `tools/check-levels.js` (the `--metrics` branch, plus a `--save-baseline` flag)

**Interfaces:**
- Consumes: `measure(level, {limit})` from `tools/metrics.js`. It returns `{trapRate, paths, splitGap, …}`.
- Produces: the baseline JSON `{[id]: {board, trapRate, paths}}`.

- [ ] **Step 1: Implement**

`--save-baseline` writes the baseline for all campaign levels and exits. In `--metrics` mode, a level whose `board` differs from its baseline entry prints `trap 0.40→0.30 lines 2→3`. It adds a warning when trap rate drops by more than 0.1 or `paths > 2 × baseline.paths`.

- [ ] **Step 2: Run** `node tools/check-levels.js --save-baseline`. Expected: the file is written with one entry per campaign level. (This is slow. Run it in the background if needed.)

- [ ] **Step 3: Commit** with the message "Record metrics baseline before re-dress".

### Task 4: Re-dress the campaign and turn on failure

**Files:**
- Modify: `levels.js`
- Modify: `tools/check-levels.js` (fails go to `problems`)
- Modify: `tests/behavior.js` only if a level it opens by cell index changes

**Interfaces:**
- Consumes: `mirror`, `insertReserved`, `relabel` (Task 2), `similarPairs` (Task 1).

- [ ] **Step 1: List offenders.** Run `node tools/check-levels.js 2>&1 | grep similar` and save the list in the task notes.

- [ ] **Step 2: Re-dress level by level**

Work from the highest score down. For each level, apply transforms with the tools, paste the result into `levels.js`, and update `goal` and `prompt` where letters or positions are named. Aim for visibly different silhouettes: longer boards with `#` shapes, mirrored layouts, files placed at different rows. `required-split-revisited` must differ from `required-split`. Leave `tight-fit`, `failing-drive`, `chained`, `find-home`, `two-files` and `join-two-blocks` unchanged where possible. `tests/behavior.js` clicks them by cell index. If one changes, update those indices.

- [ ] **Step 3: Switch fails to problems** in `check-levels.js`. Intro pairs stay as warnings.

- [ ] **Step 4: Verify**
  - `node tools/check-levels.js` → "All N levels pass." There are no `similar` problems, and no par or mechanic failures.
  - `node tools/check-levels.js --metrics` → any drift warnings are reviewed. Re-dress again any level whose trap rate fell by more than 0.1.
  - `node tests/play-all.js` → every line `ok`.
  - `node tests/behavior.js` → every line `ok`.
  - `node tests/tools.js` → `tools ok`.

- [ ] **Step 5: Screenshot check.** Open the Levels list and 6 re-dressed levels in Playwright at 420×900, deviceScaleFactor 1. Confirm the boards look distinct and that no board overflows the screen.

- [ ] **Step 6: Commit** with the message "Re-dress campaign levels so each looks distinct; fail on near-copies".

---

## Part B: Stars and badges (ships as a second change)

### Task 5: Engine `price` option and travel

**Files:**
- Modify: `engine.js` (the `solve` signature and the `g + move.cost` line, and export `travelOf`)
- Modify: `tests/tools.js`

**Interfaces:**
- Produces:
  - `E.travelOf(move) -> number`: `|move.to − move.from|` for `type: 'move'`, and 0 otherwise.
  - `E.solve(level, start, {…, price})`: `price(move) -> integer ≥ 1` replaces `move.cost` in the search. When `price` is given, `result.cost` is the summed price, and `result.path` is a path that achieves it. Callers raise `maxCost` as needed.

- [ ] **Step 1: Failing tests**

```js
assert.strictEqual(E.travelOf({type: 'move', from: 5, to: 2}), 3);
assert.strictEqual(E.travelOf({type: 'paste', to: 2}), 0);
const lvl = {board: 'BC.BACA..', homes: {A: [6, 7]}}; // long-way-round without seek
const ops = E.solve(lvl).cost;
const travelFirst = E.solve(lvl, undefined, {price: m => E.travelOf(m) * 64 + m.cost, maxCost: 5000});
assert.ok(Math.floor(travelFirst.cost / 64) >= 1 && travelFirst.cost % 64 >= ops);
```

- [ ] **Step 2: Run** → FAIL, `E.travelOf is not a function`.

- [ ] **Step 3: Implement.** Use `price ? price(move) : move.cost` where `total` is computed. Keep the heuristic: it is admissible while every price is ≥ 1.

- [ ] **Step 4: Run** `node tests/tools.js` and `node tools/check-levels.js`. Expected: both pass. Default behaviour is unchanged.

- [ ] **Step 5: Commit** with the message "Let the solver take a custom move price; add travelOf".

### Task 6: Badge computation tool and checker verification

**Files:**
- Create: `tools/badges.js`
- Create: `badges.js` (generated: `const badgePool = {...}; if (typeof module …) module.exports = {badgePool};`)
- Modify: `tools/check-levels.js` (a `--badges` flag)
- Modify: `index.html` (load `badges.js` after `daily.js`)
- Modify: `README.md` (badge regeneration command, and a `badges.js` row in the Files table)
- Modify: `tests/tools.js`

**Interfaces:**
- Consumes: `E.solve` with `price` and `whole`, `E.travelOf`, and `without.seek` from `tools/metrics.js`.
- Produces: `computeBadges(level) -> {tidy?, unsplit?, light?, few?, under?}`, with integer targets. CLI: `node tools/badges.js --write badges.js` computes every campaign level. Generated shape: `badgePool[id] = {tidy: 5, …}`, and levels with no badges are omitted.

Rules, with K = 64. Throw if any operation count reaches K.

| Badge | Offered when | Target |
| --- | --- | --- |
| `tidy` | Not `consolidate`, board has a `.`, `T = solve({...level, consolidate: true}).cost` is finite and `> par` | `T` |
| `unsplit` | `U = solve(level, _, {whole: true}).cost` is finite and `> par` | `U` |
| `light` | `cost !== 'seek'`, not `clipboard`; `r = solve(level, _, {price: m => travelOf(m)*K + m.cost})`; `r.cost % K > par` | `floor(r.cost / K)` |
| `few` | `cost === 'seek'`; `r = solve(level, _, {price: m => opsOf(m)*K + m.cost})`; `r.cost % K > par` | `floor(r.cost / K)` |
| `under` | `beatable` | `solve(level).cost` |

`opsOf(m) = 1 + (m.split ? 1 : 0)`, exported from `tools/badges.js`. `maxCost` for lexicographic solves: `200 * K`.

- [ ] **Step 1: Failing tests**

```js
const {computeBadges} = require('../tools/badges.js');
const L = id => require('../levels.js').chapters.flatMap(c => c.levels).find(l => l.id === id);
assert.ok(computeBadges(L('beat-par')).under < L('beat-par').par);
assert.strictEqual(computeBadges(L('sweep-up')).tidy, undefined); // consolidate level
assert.strictEqual(computeBadges(L('no-room-at-all')).light, undefined); // clipboard level
for (const [k, v] of Object.entries(computeBadges(L('required-split')))) assert.ok(Number.isInteger(v), k);
```

- [ ] **Step 2: Run** → FAIL, missing module.

- [ ] **Step 3: Implement `tools/badges.js`.** Use a solve limit of `4e6`. Throw on `aborted`.

- [ ] **Step 4: Generate** with `node tools/badges.js --write badges.js` (slow, so run it in the background). Print a summary table: each id and its offered badges.

- [ ] **Step 5: Add `--badges` to `check-levels.js`.** Recompute every campaign level and compare deep-equal with `badgePool[id] ?? {}`. On a mismatch, push `badges stale for <id>: stored {…}, computed {…}` to `problems`. Then edit one board in a scratch copy and confirm the check fails with that id. That covers Review Focus item 5.

- [ ] **Step 6: Verify** `node tests/tools.js`, `node tools/check-levels.js` and `node tools/check-levels.js --badges`. All three pass.

- [ ] **Step 7: Commit** with the message "Compute solver-proven badge targets into badges.js".

### Task 7: Stars replace medals

**Files:**
- Modify: `game.js` (`glyphs`, `medal()`, and its callers at the resume line, Levels list, ending, daily button and share text, plus `clearMessage()`)
- Modify: `console.css` (star styling, if needed)
- Modify: `tests/behavior.js` (existing medal assertions and new cases)

**Interfaces:**
- Produces: `stars(target) -> 0|1|2|3` in `game.js`. 1 means `progress.best[id] != null`. 2 means `progress.clean[id] != null`. 3 means `progress.clean[id] <= target.par`. Also `starText(n) -> string`: `'★'.repeat(n) + '☆'.repeat(3 − n)`.
- Remove `medal()` and `glyphs.under`. The ✦ meaning moves to the `under` badge in Task 8.

- [ ] **Step 1: Failing tests in `tests/behavior.js`**

Set `progress.best`, `progress.clean` and `progress.hinted` directly through `page.evaluate`, call `renderMenu()` or its equivalent, and assert:
  - Cleared with a hint only → `stars(level) === 1`, and the list row starts with `★☆☆`.
  - Clean above par → 2.
  - Clean at par → 3.
  - The resume line and ending use a total of the form `N of M ★`, where M = 3 × campaign length.
  - The daily share text contains the star string instead of `★` for par.

- [ ] **Step 2: Run** `node tests/behavior.js` → the new checks FAIL.

- [ ] **Step 3: Implement.** In `clearMessage()`, keep the par comparison text and replace the glyph with `starText(n)` for this clear. A hinted clear is 1.

- [ ] **Step 4: Run** `node tests/behavior.js` and `node tests/play-all.js`. All lines are `ok`.

- [ ] **Step 5: Commit** with the message "Replace medals with a three-star rating".

### Task 8: Badge tracking, saves and display

**Files:**
- Modify: `game.js` (`emptyStats`, `perform`, attempt restore, `loadProgress`, Levels list rows, `clearMessage` or the clear panel, help dialog)
- Modify: `console.css` (badge icons, filled and outlined)
- Modify: `tests/behavior.js`

**Interfaces:**
- Consumes: `badgePool` (global from `badges.js`), `E.travelOf`, `E.freeSpaceJoined`, `stars()`.
- Produces:
  - `stats.travel`
  - `progress.badges[id]: string[]`
  - `offeredBadges(target) -> [{id, target}]`, in the fixed order `tidy, unsplit, light, few, under`. It returns empty for the daily level.
  - `earnedOnClear(target, state, stats) -> string[]`
- Badge copy, used in the clear panel and help:
  - `tidy`: "Tidy: free space in one stretch, score ≤ T"
  - `unsplit`: "Unsplit: no splits, score ≤ T"
  - `light`: "Light touch: travel ≤ T"
  - `few`: "Few moves: moves + splits ≤ T"
  - `under`: "Under par: score ≤ T"

Earn conditions, all on a hint-free clear:

| Badge | Condition |
| --- | --- |
| `tidy` | `E.freeSpaceJoined(state) && stats.cost <= T` |
| `unsplit` | `stats.splits === 0 && stats.cost <= T` |
| `light` | `stats.travel <= T` |
| `few` | `stats.moves + stats.splits <= T` |
| `under` | `stats.cost <= T` |

- [ ] **Step 1: Failing tests in `tests/behavior.js`**
  - **Old save:** seed `localStorage` with a v3 save that has no `badges` field and has an attempt whose `stats` is `{moves: 1, splits: 0, cost: 1}`. Reload, resume and make one move. Assert `stats.travel` is a finite number and `progress.badges` deep-equals `{}`.
  - **Stale attempt:** seed an attempt whose `signature` does not match the current level. Open it. Assert the board is fresh, there are no page errors, and the stars computed from `best` and `clean` are unchanged.
  - **Badge earned:** on a level whose `badgePool` entry has `unsplit`, play the `solve(level, _, {whole: true}).path` line. Assert `progress.badges[id]` includes `'unsplit'`.
  - **Hinted clear:** same level, call `showHint()` first, then play the line. Assert no badge is recorded and `stars === 1`.
  - **No badges:** open a level with no `badgePool` entry and clear it. Assert the clear panel and its list row contain no `.badge` elements.
  - **Badges hidden before the first clear:** a fresh level's list row shows no `.badge`. After the first clear, it shows outlined badges for those not earned.

- [ ] **Step 2: Run** → the new checks FAIL.

- [ ] **Step 3: Implement**
  - `emptyStats` adds `travel: 0`.
  - On restore, use `{...emptyStats(), ...attempt.stats}`.
  - `perform` adds `E.travelOf(move)`.
  - At clear time, if not hinted, union `earnedOnClear` into `progress.badges[id]`.
  - `loadProgress` defaults `badges: {}`.
  - Levels row: show the star string, then one `.badge` per offered badge, only if the level has been cleared, with `data-earned` set to true or false.
  - Clear panel: list each offered badge with its copy and ✓ when earned this run or earlier.
  - Help dialog: one line per badge rule.
  - Use outlined and filled styles within the existing palette. The icon glyph is the builder's choice.

- [ ] **Step 4: Verify** `node tests/behavior.js`, `node tests/play-all.js`, `node tests/tools.js`, `node tools/check-levels.js` and `node tools/check-levels.js --badges`. All pass.

- [ ] **Step 5: Screenshot check** at 420×900 and in landscape: the Levels list with mixed stars and badges, and a clear panel with two badges. Confirm nothing wraps badly or overflows.

- [ ] **Step 6: Update `README.md`.** Add a Scoring section with the stars table, the badge table and how targets are proved.

- [ ] **Step 7: Commit** with the message "Track and show optimization badges".
