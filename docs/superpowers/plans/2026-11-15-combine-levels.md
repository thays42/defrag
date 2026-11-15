---
title: Combine levels implementation plan
created: 2026-11-15
source: claude-code
type: spec
status: draft
tags: [defrag, campaign, plan]
---

# Combine Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every chapter a Combine level where two rules both change par, and end the campaign with a five-level Boot chapter.

**Architecture:** A level lists its combined rules in a new `combines` field. One bounded `matters(level, rule, par)` function in `tools/metrics.js` proves each rule changes par. A new checker module enforces the Combine rules. A new search tool, `tools/combine.js`, finds full-disk boards for any rule set. It shares its random board builder with `tools/generate.js`.

**Tech Stack:** Plain browser JS, no build step. Node for tools and `tests/tools.js`. Playwright for `tests/behavior.js` and `tests/play-all.js`.

**Spec:** `docs/campaign-outline.md` (Principles 2 and 3, chapters 6–11, roadmap phase 3).

## Global Constraints

- Combine beat: "The rule meets an earlier rule. | Full disk | Two mechanics both change par."
- "A Combine level should be harder than any earlier Twist."
- Chapter 11 "Boot": "Five new levels on the full disk. Each combines three or more earlier rules. The last level uses the system file as the boot target."
- Every new level in this plan fills the frame: 24 sectors, no `offset`.
- A par-changing rework of an existing level takes a new id (README rule from phase 2).
- `LEGACY_IDS` in `game.js` stays frozen.
- Player copy is STE-style: short sentences, active voice. A `goal` is one sentence of at most 70 characters.
- No new UI. Rule chips, homes, links, locks and counters already render from level fields.

## Decisions this plan makes

- **`combines` field.** An array of mechanic ids, at least 2 entries, and it includes the level's `mechanic`. `mechanic` stays the chapter's own rule, so the catalog and badges keep working.
- **What "changes par" means**, per rule:
  - Constraint rules (`ordered`, `consolidate`, `fragile`, `links`, `homes`, `reserved`): switching the rule off lowers par.
  - `system`: switching off the lock and switching off the links each lower par (as today).
  - Tools (`clipboard`, `nudge`): switching the tool off makes par unreachable.
  - `splitting`: no whole-run solution reaches par.
  - `seek`: the cheapest route takes more moves than the fewest-move solution (`seekDetour >= 1`, the generator's existing test).
- **"Harder than earlier Twists"** becomes one checkable rule. A Combine level's par is at least the par of every earlier non-Combine campaign level with the same `mechanic`. Seek par compares only with seek levels, so the units match.
- **Existing Combine beats get tagged:**

  | Level | `combines` | Status today |
  | --- | --- | --- |
  | `blocked-lanes` | `reserved, homes` | Both change par. |
  | `required-split-revisited` | `splitting, homes, reserved` | All change par. |
  | `two-splits` | `splitting, homes` | Both change par. |
  | `tidy-disk` | `consolidate, homes` | Both change par. |
  | `scattered-gaps-ii` | `reserved, homes` | Homes do not change par. Rework in Task 4. |

- **New levels.** Ids and names are fixed here. The search picks the boards. The implementer writes each `goal`.

  | Chapter | Insert after | id | Name | `mechanic` | `combines` | Min par |
  | --- | --- | --- | --- | --- | --- | --- |
  | File system rules | `two-decks` | `filed-in-order` | Filed in order | ordered | ordered, homes | 7 |
  | File system rules | `daisy-chain` | `broken-chain` | Broken chain | links | links, splitting | 4 |
  | Install | `driver-stack` | `install-path` | Install path | system | system, homes | 5 |
  | Wear | `failing-drive` | `last-writes` | Last writes | fragile | fragile, consolidate | 6 |
  | Recovery tools | `juggle` | `fragile-hold` | Fragile hold | clipboard | clipboard, fragile | 5 |
  | Recovery tools | `shuffle-step` | `tight-quarters` | Tight quarters | nudge | nudge, reserved | 7 |
  | Seek | `head-travel` | `long-commute` | Long commute | seek | seek, homes | 10 |
  | Boot (new, last) | — | `power-on` | Power on | homes | homes, reserved, ordered | 9 |
  | Boot | — | `self-test` | Self-test | links | links, splitting, consolidate | 9 |
  | Boot | — | `mount` | Mount | fragile | fragile, clipboard, homes | 9 |
  | Boot | — | `load-drivers` | Load drivers | seek | seek, homes, reserved | 10 |
  | Boot | — | `first-boot` | First boot | system | system, ordered, homes | 9 |

  "Min par" is the floor from the harder-than-earlier rule, raised to 9 for Boot so the finale beats `tight-fit` (par 9).
- **Boot chapter:** `{name: 'Boot', summary: 'The disk is ready. Start it up.'}`. `first-boot` is the last campaign level, so finishing it opens the ending.
- **Search fallback.** Suppose a rule set finds no candidate within 20,000 tries over three seeds. For a Boot level, swap one rule (never `system` in `first-boot`) for another taught rule. For a chapter level, lower the free sectors or file sizes first. Record every swap in the final report.

## Review Focus

- **Hints on big three-rule boards.** The hint button runs `E.solve(level, state)` on the main thread with the default 4e6 limit. A slow or aborted search freezes the page or shows "No solution". Task 5's test: each new level solves from the start in under 2 s without aborting.
- **Dead-end notice on cracked boards.** `checkDeadEnd` uses a 2e5 limit. If that search aborts, the player never hears that a 24-sector cracked board is lost. Task 5's test: each new `fragile` level's start solve finishes under 2e5 states.
- **Rule pairs never played together.** `ordered`+`homes`, `system`+`homes`, `nudge`+`reserved`, `seek`+`homes` and `fragile`+`clipboard` reach engine paths no current level reaches. `tests/play-all.js` already plays each level at par in the browser, so it covers these once the levels exist. Run it in Task 6.
- **Goal text on a phone.** Longer two-rule goals can wrap the board caption at 360 px. Task 2's test: every campaign `goal` is at most 70 characters.
- **Saves from before this phase.** New levels sit mid-chapter, so Continue after an old save lands on a new level. Unlocking goes by id and `LEGACY_IDS` is frozen, so old saves must keep their scores. The existing legacy-order behavior test guards this. Run it in Task 6.

---

### Task 1: One bounded `matters` check for every rule

**Files:**
- Modify: `tools/metrics.js` (replace `reservedMatters`; export `matters`)
- Modify: `tools/check-levels.js` (use it; delete the local `optimum`-based `matters` table)
- Test: `tests/tools.js`

**Interfaces:**
- Produces: `matters(level, rule, par) -> boolean` in `tools/metrics.js`. `rule` is any mechanic id or `'splitting'`. It throws `Error('search too large to check')` when a bounded search aborts. Every search is capped by `maxCost` (`par - 1` for constraint rules, `par` for tools and splitting) and `limit: 4e6`.

- [ ] **Step 1: Write the failing tests** in `tests/tools.js`:

```js
const {matters} = require('../tools/metrics.js');
const byId = id => L.levels.find(l => l.id === id);
assert.strictEqual(matters(byId('scattered-gaps-ii'), 'homes', 4), false);
assert.strictEqual(matters(byId('scattered-gaps-ii'), 'reserved', 4), true);
assert.strictEqual(matters(byId('blocked-lanes'), 'homes', 4), true);
assert.strictEqual(matters(byId('two-splits'), 'splitting', 7), true);
assert.strictEqual(matters(byId('tidy-disk'), 'consolidate', 6), true);
assert.strictEqual(matters(byId('hold-that-thought'), 'clipboard', 4), true);
assert.strictEqual(matters(byId('scoot-over'), 'nudge', 3), true);
assert.strictEqual(matters(byId('long-way-round'), 'seek', 6), true);
assert.strictEqual(matters(byId('load-order'), 'system', 4), true);
```

Also replace the phase 2 `reservedMatters` assertions with `matters(level, 'reserved', level.par)`.

- [ ] **Step 2: Run** `node tests/tools.js`. Expected: FAIL, `matters is not a function`.
- [ ] **Step 3: Implement `matters`** using the definitions in "Decisions this plan makes". For seek, compare `E.solve(level).path.length` with the unit-cost optimum of `without.seek(level)`.
- [ ] **Step 4: Switch `check-levels.js`** to `(level, par) => matters(level, level.mechanic, par)`. Keep the `needs` table, the `soft.homes` warning, the daily exemption, and the warning-on-throw for reserved.
- [ ] **Step 5: Run** `node tests/tools.js && node tools/check-levels.js`. Expected: `tools ok` and `All 117 levels pass.` with no new warnings.
- [ ] **Step 6: Commit** `Use one bounded matters check for every rule`.

### Task 2: The Combine rules

**Files:**
- Create: `tools/combine-rules.js`
- Modify: `tools/check-levels.js` (call it on `chapters`)
- Modify: `levels.js` (tag the four passing levels from the table)
- Test: `tests/tools.js`

**Interfaces:**
- Consumes: `matters` from Task 1.
- Produces: `combineProblems(chapters) -> string[]`. It checks only levels with `combines`. The messages, exactly:
  - `<id>: combines needs at least 2 rules`
  - `<id>: combines does not include mechanic <mechanic>`
  - `<id>: <rule> does not change par`
  - `<id>: <rule> could not be checked: <error message>`
  - `<id>: par <par> is below <other-par> of earlier <mechanic> level <other-id>`
  - `<id>: Boot levels combine at least 3 rules`
  - `<id>: the last Boot level must use system`

- [ ] **Step 1: Write the failing tests.** Run `combineProblems` on small synthetic chapter lists built from copies of real levels:

```js
const {combineProblems} = require('../tools/combine-rules.js');
const tag = (id, combines, extra = {}) => ({...byId(id), combines, ...extra});
assert.deepStrictEqual(combineProblems([{name: 'X', levels: [tag('blocked-lanes', ['reserved', 'homes'])]}]), []);
assert.deepStrictEqual(combineProblems([{name: 'X', levels: [tag('scattered-gaps-ii', ['reserved', 'homes'])]}]), ['scattered-gaps-ii: homes does not change par']);
assert.deepStrictEqual(combineProblems([{name: 'X', levels: [tag('blocked-lanes', ['reserved'])]}]), ['blocked-lanes: combines needs at least 2 rules']);
assert.deepStrictEqual(combineProblems([{name: 'X', levels: [tag('blocked-lanes', ['homes', 'splitting'])]}]),
  ['blocked-lanes: combines does not include mechanic reserved', 'blocked-lanes: splitting does not change par']);
assert.ok(combineProblems([{name: 'X', levels: [byId('two-decks'), tag('in-order', ['ordered', 'homes'], {homes: {A: [3, 4]}, par: 1})]}])
  .includes('in-order: par 1 is below 7 of earlier ordered level two-decks'));
assert.deepStrictEqual(combineProblems([{name: 'Boot', levels: [tag('two-splits', ['splitting', 'homes'])]}]),
  ['two-splits: Boot levels combine at least 3 rules', 'two-splits: the last Boot level must use system']);
// Phone check for the Review Focus.
for (const level of L.chapters.flatMap(c => c.levels)) assert.ok(level.goal.length <= 70, `${level.id} goal is over 70 characters`);
```

- [ ] **Step 2: Run** `node tests/tools.js`. Expected: FAIL, cannot find `combine-rules.js`.
- [ ] **Step 3: Implement `combineProblems`.** Walk the levels in order. For the par floor, look at earlier levels that have no `combines` and share the `mechanic`. If a goal is over 70 characters, shorten it in `levels.js` in this task.
- [ ] **Step 4: Tag** `blocked-lanes`, `required-split-revisited`, `two-splits` and `tidy-disk` in `levels.js`, as in the table. Leave `scattered-gaps-ii` untagged until Task 4.
- [ ] **Step 5: Wire** `problems.push(...combineProblems(chapters))` into `check-levels.js`.
- [ ] **Step 6: Run** `node tests/tools.js && node tools/check-levels.js`. Expected: both pass.
- [ ] **Step 7: Document** the `combines` field in README's levels.js row and in the `levels.js` header comment.
- [ ] **Step 8: Commit** `Add combines field and the Combine rules`.

### Task 3: Shared board builder and the `combine.js` search

**Files:**
- Create: `tools/board-builder.js` (moved from `generate.js`: mulberry32 `random`, `pick`, `between`, `shuffle`, `build`, `canonical`, and the quality formula)
- Modify: `tools/generate.js` (import them; behavior unchanged)
- Create: `tools/combine.js` (CLI)
- Test: `tests/tools.js`

**Interfaces:**
- Produces from `board-builder.js`:
  - `makeRng(seed) -> {random, pick, between, shuffle}`
  - `build(rng, spec) -> level | null`, with the same `spec` as today's `build`
  - `canonical(level) -> string`
  - `quality(metrics) -> number`
- Produces from `combine.js`:
  - `combineCandidate(rng, rules, {sizes, free, length}) -> level | null`. It is exported for tests. The CLI runs when `require.main === module`.
  - CLI: `node tools/combine.js <rule,rule,...> [--sizes 3,3,2] [--free 3] [--length 24] [--min-par N] [--par N] [--seed 7] [--tries 4000] [--count 10]`. It prints JSON lines ranked by quality: `{board, homes?, links?, locked?, fragile?, clipboard?, nudges?, cost?, consolidate?, par, trapRate, paths, similarity}`. `similarity` is the highest `similarPairs` score against the current levels.
- Features each rule adds in `combineCandidate`. Filler sectors are `#`, so the board is exactly `length` long.
  - `homes`: a home of exactly the file's size for every file.
  - `ordered`: number the fragments of files longer than 1.
  - `links`: the chain A→B, then B→C when there are 3 files.
  - `system`: insert `SS` at a random place, add `locked: ['S']`, and put `['S', 'A']` first in `links`.
  - `consolidate`, `clipboard`: set the flag. `nudge`: `nudges` 1–2. `seek`: `cost: 'seek'`.
  - `fragile`: 1–3 free sectors plus 0–2 file sectors.
  - `reserved`, `splitting`: no feature; they are only filters.
- Filter order, cheapest first:
  - Skip a board that is already solved.
  - Par search with `limit: 2e5`; skip if it aborts or par is below `--min-par` (or not `--par`).
  - `matters` for each rule, cheapest rule first; skip on false or a throw.
  - `addDetail` at `3e5`.

- [ ] **Step 1: Capture a baseline** before the refactor: `node tools/generate.js homes --count 3 --tries 300 > /tmp/gen-before.txt`.
- [ ] **Step 2: Write the failing tests:**

```js
const {makeRng} = require('../tools/board-builder.js');
const {combineCandidate} = require('../tools/combine.js');
const rng = makeRng(3);
let level = null;
for (let n = 0; n < 50 && !level; n++) level = combineCandidate(rng, ['ordered', 'homes'], {sizes: [3, 3, 2], free: 3, length: 24});
assert.ok(level, 'no candidate built');
assert.strictEqual(E.parseBoard(level.board).length, 24);
assert.ok(/[1-9]/.test(level.board) && Object.keys(level.homes).length === 3);
const sys = combineCandidate(makeRng(5), ['system', 'homes'], {sizes: [3, 2], free: 3, length: 24});
assert.deepStrictEqual(sys.links[0], ['S', 'A']);
assert.deepStrictEqual(sys.locked, ['S']);
```

- [ ] **Step 3: Run** `node tests/tools.js`. Expected: FAIL, module not found.
- [ ] **Step 4: Move the shared code** into `board-builder.js` and implement `combine.js`.
- [ ] **Step 5: Run** `node tools/generate.js homes --count 3 --tries 300 | diff - /tmp/gen-before.txt`. Expected: no diff. Then run `node tests/tools.js`. Expected: `tools ok`.
- [ ] **Step 6: Smoke-test** with `timeout 600 node tools/combine.js reserved,homes --par 4 --tries 3000 --count 3`. Expected: at least one line, unless the search finds nothing. Task 4 handles the empty case.
- [ ] **Step 7: Document** `combine.js` in the README tools section: purpose, flags, and the filter order.
- [ ] **Step 8: Commit** `Share the board builder; add combine.js search for rule sets`.

### Task 4: Rework `scattered-gaps-ii` so homes matter

**Files:**
- Modify: `levels.js`, `badges.js` (regenerated), `docs/campaign-outline.md` (ch2 row)
- Test: `tests/tools.js`

**Interfaces:**
- Consumes: `tools/combine.js`, `combineProblems`.

- [ ] **Step 1: Write the failing test.** `scattered-gaps-ii` has `combines: ['reserved', 'homes']`, and `combineProblems(L.chapters)` returns `[]`. Update the phase 2 test that names `scattered-gaps-ii` if the id changes.
- [ ] **Step 2: Run it.** Expected: FAIL, because `combines` is missing.
- [ ] **Step 3: Search.** Run `node tools/combine.js reserved,homes --sizes 3,2 --free 3 --par 4 --tries 20000` over seeds 1–3. Pick the top-quality board with `similarity` below the check's fail threshold. Keep the id, name and par. If no par-4 board exists, search `--min-par 4`. In that case the level takes the id `scattered-gaps-iii` and the README rule applies.
- [ ] **Step 4: Run** `node tests/tools.js && node tools/check-levels.js && node tools/badges.js --write badges.js && node tools/check-levels.js --badges`. Expected: all pass.
- [ ] **Step 5: Commit** `Rework scattered gaps so its homes change par`.

### Task 5: Seven chapter Combine levels

**Files:**
- Modify: `levels.js`, `badges.js`
- Test: `tests/tools.js`

**Interfaces:**
- Consumes: `combine.js`, `combineProblems`, `matters`.
- Produces: the seven chapter rows of the new-levels table, in place.

- [ ] **Step 1: Write the failing tests:**

```js
const NEW_COMBINE = {
  'filed-in-order': 'two-decks', 'broken-chain': 'daisy-chain', 'install-path': 'driver-stack',
  'last-writes': 'failing-drive', 'fragile-hold': 'juggle', 'tight-quarters': 'shuffle-step', 'long-commute': 'head-travel',
};
const order = L.chapters.flatMap(c => c.levels).map(l => l.id);
for (const [id, after] of Object.entries(NEW_COMBINE)) {
  const level = byId(id);
  assert.ok(level, `${id} missing`);
  assert.strictEqual(order.indexOf(id), order.indexOf(after) + 1, `${id} is not right after ${after}`);
  assert.strictEqual(E.placement(level).length, 24, `${id} does not fill the disk`);
  assert.ok(level.offset === undefined);
  const start = Date.now();
  const best = E.solve(level);
  assert.ok(!best.aborted && Date.now() - start < 2000, `${id} hint search is too slow`);
  if (level.fragile) assert.ok(!E.solve(level, undefined, {limit: 2e5}).aborted, `${id} dead-end check aborts`);
}
assert.deepStrictEqual(combineProblems(L.chapters), []);
```

- [ ] **Step 2: Run** `node tests/tools.js`. Expected: FAIL, `filed-in-order missing`.
- [ ] **Step 3: Search each level** with `combine.js` and its table rules, `--min-par` from the table, and `--length 24`. Start from `--sizes 3,3,2 --free 3`. Run searches in the background with `timeout 1800`. Pick by quality, then by low `similarity`. Prefer `paths` from 1 to 12. Apply the search fallback if needed.
- [ ] **Step 4: Add the levels** at the table's positions, each with `combines`, `name`, `par` and a `goal` of at most 70 characters that names both rules.
- [ ] **Step 5: Run** `node tests/tools.js && node tools/check-levels.js && node tools/badges.js --write badges.js && node tools/check-levels.js --badges`. Expected: all pass.
- [ ] **Step 6: Commit** `Add a Combine level to chapters 6 through 10`.

### Task 6: The Boot chapter

**Files:**
- Modify: `levels.js`, `badges.js`, `tests/tools.js` (chapter names), `README.md`, `docs/campaign-outline.md`
- Test: `tests/tools.js`, `tests/behavior.js`, `tests/play-all.js`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing tests:**
  - Change the chapter-name assertion to end in `'Seek', 'Boot'`.
  - Assert that the `Boot` chapter's ids are `['power-on', 'self-test', 'mount', 'load-drivers', 'first-boot']`.
  - Run the Task 5 loop over these five as well, except the insert-position check.
  - Assert that the last campaign level is `first-boot` and that it has `locked: ['S']` and `['S', 'A']` in `links`.
- [ ] **Step 2: Run** `node tests/tools.js`. Expected: FAIL on chapter names.
- [ ] **Step 3: Search and add** the five levels as in Task 5, using `--min-par` from the table. For three-rule sets, start from `--sizes 3,3,2 --free 4`. In `first-boot`, A is the boot target: its goal names S and A.
- [ ] **Step 4: Run the full suite:**
  - `node tests/tools.js`
  - `node tools/check-levels.js --badges`, after `node tools/badges.js --write badges.js`
  - `node tests/behavior.js`
  - `node tests/play-all.js`

  Expected: `tools ok`, `All 129 levels pass.`, all behavior checks ok, and every level at par.
- [ ] **Step 5: Update the docs:**
  - Outline status line: "Phases 1–3 are done". Link the phase 3 plan in the roadmap.
  - Fill the "Combine gap" cells with the new ids.
  - Add the Boot table.
  - README: Boot chapter in the levels.js row.
- [ ] **Step 6: Commit** `Add the Boot chapter`, push, and republish the game artifact from `scratchpad/game/`.
