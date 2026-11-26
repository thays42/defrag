# Daily Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 60-board daily pool with seven weekday tiers of at least 20 checked boards each, chosen by date, with a rule card for rules the player has not learned.

**Architecture:** A new data module, `tools/daily-tiers.js`, holds the tier spec and the checks. The build tool and the checker both use it. `tools/build-daily.js` searches one tier per run with the existing generators and appends to `daily.js`. The game picks the tier by local weekday and the board by week. It shows a rule card on open when the board uses rules whose intro level the player has not cleared.

**Tech Stack:** Plain JavaScript, no build step. Node for the tools. Playwright for the browser tests (`node tests/behavior.js`, `node tests/play-all.js`). `node tests/tools.js` holds the unit tests, which use `assert`.

**Spec:** `docs/superpowers/specs/2026-11-26-daily-tiers-design.md`

## Global Constraints

- No build step. `daily.js` stays a plain script loaded by `index.html` and exported for Node with `module.exports`.
- The rules and solver live only in `engine.js`. The tools and the game call `E.solve`; they never reimplement rules.
- Every tier holds at least `MIN_TIER = 20` boards, up to a target of `TARGET_TIER = 60`. Both the build tool and the checker fail on a tier below 20.
- Similarity fails at `0.75`, against every non-intro campaign or Extra level and every other daily board.
- Every rule in a board's `checked` list must change par (`matters`). Other rules in `rules` may appear without mattering.
- Saturday: exactly 2 advanced rules in `checked`. Sunday: 3 or more. Advanced rules are `ordered, consolidate, links, system, fragile, clipboard, nudge, seek`.
- Tiers freeze once shipped. There are no appends and no reordering after release.
- The daily offers only the 3 base stars. The share text format is unchanged.
- Docs and UI copy use short active sentences, in the README's style.

## Review Focus

- **The same local date gives the same board on every load.** That includes a reload just after midnight and a date across a daylight-saving change. The pick uses only the `YYYY-MM-DD` string. Task 4 tests it on two dates around the November DST change.
- **A daily cleared on the old pool.** `progress.best['daily-<date>']` may hold a score from the old board. The board must still open, the attempt must start fresh, and nothing may throw. Task 4 tests it with a seeded best score and a stale attempt.
- **The rule card reopens only on open, never on restart or undo.** Restart calls `start`, not `openLevel`. Task 5 tests that restart leaves the card closed.
- **A rule card for a board with no unlearned rules never shows, and an empty card never renders.** Task 5 tests a player who has cleared every intro level.
- **Hints stay fast on weekend boards.** A hint runs the solver in the browser. The `HINT_LIMIT` filter in Task 1 guards it. Task 6 checks that every shipped board passes `hintCheap` under `HINT_LIMIT`.

---

### Task 1: Tier spec and checks (`tools/daily-tiers.js`)

**Files:**
- Create: `tools/daily-tiers.js`
- Modify: `engine.js` (add `DAYS` and `dailyPick` to the exports)
- Test: `tests/tools.js` (append)

**Interfaces:**
- Produces:
  - `DAYS`: `['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']`
  - `ADVANCED`: the 8 advanced rule ids listed in Global Constraints.
  - `MIN_TIER = 20`, `TARGET_TIER = 60`, `HINT_LIMIT = 2e5`, `SIMILAR_FAIL = 0.75`.
  - `TIERS`: `{[day]: {par: [low, high], sources: [{preset, checked: string[], par?: [low, high]}]} | {par: [low, high], combine: 2 | 3}}`. Starting values (the builder may tune them in Task 6):
    - monday: par `[3, 6]`, sources `{preset: 'daily', checked: ['homes']}`
    - tuesday: par `[5, 8]`, sources `split` (checked `['splitting']`) and `ordered` (checked `['ordered']`)
    - wednesday: par `[5, 8]`, sources `consolidate`, `links`
    - thursday: par `[5, 8]`, sources `system` (checked `['system']`), `fragile`
    - friday: par `[5, 9]`, sources `clipboard`, `nudge`, and `seek` with par `[8, 16]`
    - saturday: par `[6, Infinity]`, `combine: 2`
    - sunday: par `[7, Infinity]`, `combine: 3`
  - `boardRules(level) -> string[]`: the rules a board uses, in the order of `mechanics` in `levels.js`. It is the `uses` keys that hold, plus `'splitting'` when no whole-run solution reaches the optimum (`E.solve(level, undefined, {whole: true}).cost` is null or above `E.solve(level).cost`).
  - `tierProblems(tiers, campaign) -> string[]`: one message per violation. `tiers` is `{[day]: board[]}`. `campaign` is the levels from `levels.js`. It checks:
    - Every day in `DAYS` is present, with at least `MIN_TIER` boards.
    - Ids are unique.
    - `par` equals the optimum and lies in the tier's par range (or the source's, for seek).
    - `rules` deep-equals `boardRules(board)`.
    - `checked` is a subset of `rules`, and every rule in it passes `matters`.
    - On Saturday, `checked` has exactly 2 advanced rules; on Sunday, 3 or more.
    - No daily board reaches `SIMILAR_FAIL` with another daily board or with a non-intro campaign level.
  - `E.dailyPick(tiers, date) -> board` and `E.DAYS`, added to `engine.js` so the game and the tools share one definition without a new script tag. (My call: `engine.js` is already shared by both.) `tools/daily-tiers.js` re-exports them as `pick` and `DAYS`. `date` is `'YYYY-MM-DD'`. With `day = Date.parse(date + 'T00:00:00Z') / 86400000`, the weekday is `DAYS[(day + 3) % 7]` (1970-01-01 was a Thursday), the week is `Math.floor((day + 3) / 7)`, and the result is `tiers[weekday][week % tiers[weekday].length]`.

- [ ] **Step 1: Write the failing tests** in `tests/tools.js`:
  - `boardRules({board: 'A#A.', par: 1})` deep-equals `['reserved']`.
  - `boardRules({board: 'AA.AA', par: 3})` includes `'splitting'` only if the solver needs a split there. Assert it against `E.solve` directly, not a hard-coded value.
  - `pick` gives the `monday` tier for `'2026-11-30'` and the `sunday` tier for `'2026-11-29'`. Consecutive Mondays `'2026-11-30'` and `'2026-12-07'` give consecutive indices modulo the tier length.
  - `tierProblems` on a fixture with one tier of 1 board reports `'below 20'` and missing days.
  - `tierProblems` reports `rules` drift when a board's `rules` is edited by hand.
- [ ] **Step 2: Run** `node tests/tools.js`. Expected: it fails with `Cannot find module '../tools/daily-tiers.js'`.
- [ ] **Step 3: Implement** `tools/daily-tiers.js`. Reuse `uses` and `matters` from `metrics.js` and `similarity` from `similarity.js`.
- [ ] **Step 4: Run** `node tests/tools.js`. Expected: no assertion errors.
- [ ] **Step 5: Commit:** `Add the daily tier spec and checks`

### Task 2: Make the generators callable

**Files:**
- Create: `tools/presets.js`
- Modify: `tools/generate.js`, `tools/combine.js` (export `search`)
- Test: `tests/tools.js` (append)

**Interfaces:**
- Produces:
  - `makePresets(rng) -> {[name]: () => level | null}`: the preset table moved from `generate.js` unchanged, `want` predicates included. The names stay the same.
  - `candidates(preset, {rng, tries, par: [low, high], count}) -> level[]`: the loop from `generate.js` (dedupe by `canonical`, skip solved boards, par window, `want`, `addDetail`, `quality`), ranked by quality. It replaces the hard-coded `3..12` par window with the `par` argument.
  - `combine.js` exports `search` next to `combineCandidate`. The signature is unchanged.
- `generate.js` keeps its CLI and output byte for byte. Its par window defaults to `[3, 12]`.

- [ ] **Step 1: Capture the baseline:** `node tools/generate.js daily --count 5 --tries 300 --seed 99 > $SCRATCH (any scratch directory)/before.txt`
- [ ] **Step 2: Write the failing test:** `require('../tools/presets.js').candidates('homes', {rng: makeRng(3), tries: 200, par: [3, 6], count: 3})` returns at most 3 levels, each with `par` in 3–6.
- [ ] **Step 3: Run** `node tests/tools.js`. Expected: it fails with `Cannot find module`.
- [ ] **Step 4: Move the presets and the loop** into `tools/presets.js`, and make `generate.js` call them. Export `search` from `combine.js`.
- [ ] **Step 5: Verify:** `node tests/tools.js` passes, and `node tools/generate.js daily --count 5 --tries 300 --seed 99 | diff - $SCRATCH/before.txt` prints nothing.
- [ ] **Step 6: Commit:** `Make the presets and combine search callable`

### Task 3: Build tool (`tools/build-daily.js`)

**Files:**
- Create: `tools/build-daily.js`
- Test: `tests/tools.js` (append)

**Interfaces:**
- Consumes: Task 1 (`TIERS`, `DAYS`, `ADVANCED`, `boardRules`, `HINT_LIMIT`, `SIMILAR_FAIL`, `TARGET_TIER`, `MIN_TIER`) and Task 2 (`candidates`, `search`).
- Produces:
  - CLI: `node tools/build-daily.js <day> [--seconds 600] [--seed 7] [--out daily.js]`
  - `readDaily(file) -> {tiers, commands, frozen}`. A missing file gives empty tiers.
  - `writeDaily(file, {tiers, commands, frozen})`. It writes this layout:
    ```js
    // Generated by tools/build-daily.js. Do not edit by hand.
    // <one line per recorded command>
    const dailyFrozen = false;
    const dailyTiers = {
      monday: [
        {...one board per line...},
      ],
      ...
    };
    if (typeof module !== 'undefined') module.exports = {dailyTiers, dailyFrozen};
    ```
  - `qualityBounds(campaign) -> {minTrap, maxPaths}`: the 10th-percentile trap rate and 90th-percentile path count of the non-intro campaign levels, from `addDetail(level, {par}, 3e5)`.
  - `screen(candidate, {day, kept, campaign, bounds}) -> string | null`: the first reason to drop a candidate, or null to keep it. Checks: par range; every rule in `checked` changes par; for Saturday and Sunday, the advanced-rule count; `hintCheap(candidate, HINT_LIMIT)`; `trapRate >= minTrap` and `paths <= maxPaths`; similarity below `SIMILAR_FAIL` against `kept` and the non-intro `campaign`.
- Board fields written: `id` (`mon-1`, `tue-1`, …, numbered on after the tier's existing boards), `mechanic` (`checked[0]`), `par`, `rules`, `checked`, and only the level fields the board uses (`board`, `homes`, `cost`, `fragile`, `links`, `locked`, `clipboard`, `nudges`, `consolidate`, `offset`). Metrics are not written.
- A run:
  1. Refuse with exit 1 if `frozen`.
  2. Draw candidates until `--seconds` runs out or the tier reaches `TARGET_TIER`. Preset tiers cycle through their sources. Combine tiers draw a random rule set of size `combine` from `ADVANCED` for each slice and call `search` with `{sizes: [3, 2, 2], free: 3, length: 12–18 at random, minPar: par[0], hintLimit: HINT_LIMIT, seconds: 120}`.
  3. `screen` each candidate against everything kept so far, across all tiers.
  4. Append the best by quality, record the command line, and write.
  5. Print `<day>: <n> boards (min 20)`, plus the drop counts by reason.

- [ ] **Step 1: Write the failing tests:**
  - A `writeDaily`/`readDaily` round trip to a scratch file preserves `tiers`, `commands` and `frozen`.
  - `screen` returns a similarity reason for an exact copy of a campaign level.
  - `screen` returns a count reason for a Saturday candidate with 3 advanced rules.
  - `screen` returns null for a known-good fixture (take one board from a short run of `candidates('daily', …)`).
- [ ] **Step 2: Run** `node tests/tools.js`. Expected: it fails with `Cannot find module`.
- [ ] **Step 3: Implement** `tools/build-daily.js`, with `require.main === module` guarding the CLI.
- [ ] **Step 4: Verify:** `node tests/tools.js` passes. A smoke run, `node tools/build-daily.js monday --seconds 30 --out $SCRATCH/daily.js`, prints a count and writes a file that `readDaily` loads.
- [ ] **Step 5: Commit:** `Add the daily tier build tool`

### Task 4: Fill the tiers and switch the game and checker

This task contains the long search runs. Run the weekend tiers in the background with several seeds. Each run appends, so several passes add up.

**Files:**
- Modify: `daily.js` (regenerated), `game.js` (`dailyLevel`), `tools/check-levels.js`, `tests/behavior.js`, `tests/play-all.js`

**Interfaces:**
- Consumes: Task 1 (`pick`, `tierProblems`), Task 3 (the CLI).
- Produces: `dailyLevel(date = today())` in `game.js`, which returns `{...pick(dailyTiers, date), id: 'daily-' + date, chapter: 'Daily puzzle', name: date, date, daily: true, goal}`. The goal copy changes to `'A new disk every day. The rules change through the week.'`.

- [ ] **Step 1: Fill each tier.** Run `node tools/build-daily.js <day> --seconds <N> --seed <S>` for every day until `readDaily` shows at least 20 per tier, aiming for 60. Start with `--seconds 300` for Monday to Friday and `--seconds 3600` for the weekend, with fresh seeds per pass. If a tier stalls below 20 after about 3 weekend-length passes, stop. Report the tier and its top drop reasons to the user before changing that tier's spec in `TIERS`. The spec says a short tier changes its rules or par range, never its quality bar.
- [ ] **Step 2: Write the failing browser tests** in `tests/behavior.js`:
  - `dailyLevel('2026-11-30')` gets its board from `dailyTiers.monday`, and `dailyLevel('2026-11-29')` from `dailyTiers.sunday`.
  - Two calls with the same date deep-equal each other.
  - `dailyLevel('2026-11-01')` and `dailyLevel('2026-11-02')` (the US DST change) come from `sunday` and `monday`.
  - With `progress.best['daily-' + today()]` set to 99 and a stale `progress.attempts` entry whose signature does not match, `openLevel(dailyLevel())` starts with `stats.moves === 0` and no page error.
  - The existing "daily offers only the base stars" and share-text checks still pass.
- [ ] **Step 3: Run** `node tests/behavior.js`. Expected: the new checks FAIL (`dailyPool` or `dailyTiers` mismatch).
- [ ] **Step 4: Implement** the new `dailyLevel` (calling `E.dailyPick`) and the checker change:
  - In `tools/check-levels.js`, build `all` from `Object.values(dailyTiers).flat()` with `daily: true`. Keep the frame, home and par checks for daily boards. Skip the per-level mechanic `matters` check for them and remove the old reserved exemption. Push `tierProblems(dailyTiers, levels)` into `problems`.
- [ ] **Step 5: Update `tests/play-all.js`** to play `dailyLevel(date)` for the seven dates `2026-11-30` to `2026-12-06`, opened with `openLevel(dailyLevel(date))`, in place of today's daily only.
- [ ] **Step 6: Verify:** `node tools/check-levels.js` prints `All N levels pass.`, and `node tests/tools.js`, `node tests/behavior.js` and `node tests/play-all.js` pass.
- [ ] **Step 7: Commit** `daily.js` and the code: `Build seven weekday daily tiers and pick by date`

### Task 5: Rule card

**Files:**
- Modify: `index.html` (a dialog next to `#help-dialog`), `game.js` (`openLevel` and two new functions), `console.css` (only if the dialog needs more than the `help-dialog` class)
- Test: `tests/behavior.js`

**Interfaces:**
- Consumes: `level.rules` from Task 4's boards, and `mechanics` and `campaign`.
- Produces:
  - `unlearnedRules(target) -> mechanic[]`: for each id in `target.rules`, except `basics`, the first campaign level with `intro: true` and that `mechanic`. The rule is unlearned while `progress.best[thatLevel.id] == null`. The result is the matching `mechanics` entries, in `mechanics` order.
  - `showRuleCard(rules)`: fills and opens `#rules-dialog`.
  - `openLevel(target)` calls `showRuleCard` after `start` when `target.daily`, `progress.best[target.id] == null` and `unlearnedRules(target).length > 0`.
- Markup: `<dialog id="rules-dialog" class="help-dialog" aria-labelledby="rules-title">` holding an `h2#rules-title`, a `p`, a `dl#rules-list` with the same `div > dt + dd` rows as `#help-rules`, and a `button#rules-start`. The start button closes the dialog and focuses the board. Escape also closes it.
- Copy (fixed):
  - Title: `New rules today`
  - Line: `This disk uses rules the campaign has not shown you yet.`
  - Button: `Start`

- [ ] **Step 1: Write the failing tests:**
  - With a fresh `progress`, opening a Sunday board (`dailyLevel('2026-11-29')`) opens `#rules-dialog`, and its rows equal `unlearnedRules(level)` by name.
  - With every intro level marked cleared in `progress.best`, the same open leaves the dialog closed.
  - After `#rules-start`, `#reset` does not reopen the dialog.
  - Once `progress.best` holds a score for that daily id, opening it again leaves the dialog closed.
  - Campaign levels never open the dialog.
- [ ] **Step 2: Run** `node tests/behavior.js`. Expected: the new checks FAIL (`#rules-dialog` is missing).
- [ ] **Step 3: Implement** the markup and the functions.
- [ ] **Step 4: Update `tests/play-all.js`** so it clicks `#rules-start` when `#rules-dialog` is open after an open.
- [ ] **Step 5: Verify:** `node tests/behavior.js` and `node tests/play-all.js` pass. Take one screenshot of the card at phone width (420×900, deviceScaleFactor 2) for the user.
- [ ] **Step 6: Commit:** `Show a rule card for unlearned rules on the daily`

### Task 6: Freeze, docs, final check

**Files:**
- Modify: `daily.js` (`dailyFrozen = true`, written with `writeDaily`), `README.md`, `tests/tools.js`

- [ ] **Step 1: Write the failing test:** every board in `dailyTiers` passes `hintCheap(board, HINT_LIMIT)`, and `dailyFrozen === true`.
- [ ] **Step 2: Run** `node tests/tools.js`. Expected: FAIL on `dailyFrozen`.
- [ ] **Step 3: Set the flag.** Set `frozen: true` through `writeDaily`. Confirm that `node tools/build-daily.js monday --seconds 1` now exits 1 with a "frozen" message.
- [ ] **Step 4: Update `README.md`:**
  - The `daily.js` row: seven weekday tiers, generated, frozen once shipped.
  - A short "Daily tiers" section: the weekday table from the spec, the 20-board minimum, the `build-daily.js` CLI, and the rule that growing a tier needs a new pool version that takes over from a set date.
  - Add `build-daily.js` to the tools list.
- [ ] **Step 5: Verify everything:** `node tools/check-levels.js`, `node tests/tools.js`, `node tests/behavior.js` and `node tests/play-all.js` all pass. Report the board count per tier to the user.
- [ ] **Step 6: Commit:** `Freeze the daily tiers and document them`
