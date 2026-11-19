---
title: Competing solutions implementation plan
created: 2026-11-19
source: claude-code
type: spec
status: active
tags: [defrag, level-design, badge, travel, plan]
---

# Competing Solutions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At least 80% of non-tutorial campaign levels offer a badge that pulls against par, few badge pairs overlap, and a Teach level introduces travel.

**Architecture:** The solver gets an exact second-cost budget, so `tools/badges.js` can prove badge overlap. A new `tools/badge-rules.js` holds the coverage and overlap checks, with ratcheting thresholds. `tools/climb.js` gets a `--badge` mode that mutates one existing level under the anti-goal guards. Levels are then redesigned chapter by chapter, and the thresholds rise as coverage grows.

**Tech Stack:** Plain Node and browser JS, no build step. Assert-based tests in `tests/tools.js`, Playwright in `tests/behavior.js`.

**Spec:** `docs/superpowers/specs/2026-11-16-competing-solutions-design.md`

## Global Constraints

- Coverage target: badged non-tutorial campaign levels ÷ all non-tutorial campaign levels ≥ 0.80. Today 16 of 49.
- Overlap cap: levels with an overlapping pair ÷ levels with two or more badges ≤ 0.25. Passes when no level has two badges.
- Par may move by at most 1 from each level's current value.
- The badge search limit stays at 1e6 states. Unproven counts as no badge and as overlap.
- Level ids never change. No changes to the Extra set, the daily puzzle, badge rules, stars, or par semantics.
- `badges.js` is generated: `node tools/badges.js --write badges.js`. Never hand-edit it.
- Every commit passes: `node tests/tools.js && node tools/check-levels.js --badges && node tests/behavior.js && node tests/play-all.js`. The run takes over 120 s, so run it in the background.
- New Teach level: id `near-or-far`, name "Near or far", in Format after `fewer-is-better` and before `warm-up`. Prompt, verbatim: "Travel counts every sector a run moves. Clear at par, then try for ↝: one more move, much less travel."
- Commit trailers as in the session rules. Push to `claude/serene-hypatia-e6c9ga` only.

## Spec correction

Spec section 2 says that one badge's solver mode, ranked by the other badge's measure, gives the exact overlap. It does not. A lexicographic rank finds the route with the least of one measure, and that route can miss the other target while a different route meets both. Task 1 adds an exact budget search instead, and updates the spec text.

## Review Focus

- **A grown board breaks the frame.** Growing a board with an `offset`, or one already at 24 sectors, must never produce a board that fails the frame check. Test in Task 4.
- **Growing at the start shifts every 1-based position.** Homes and fragile sectors move by one. Links and locked files are letters, so they stay. Test in Task 4.
- **A candidate passes the climber but fails the full checker.** The climber's guards must include teach order, combine rules, similarity, and hint cost (`hintCheap(level, 2e5)`), not only par and `matters`. Test in Task 4.
- **Behavior tests pin board shapes.** `tests/behavior.js` reads slot indices and track rows from `warm-up`, `move-a-run`, `join-two-blocks`, `park-a-pair`, `scattered-gaps-ii`, `split-workspace` and `no-room-at-all`. A redesigned board there changes the expected values. Task 5 re-derives them; it never deletes a check.
- **Inserting a Format level shifts campaign order.** Unlock order, chapter counts and "next level" flows move by one. `LEGACY_IDS` in `game.js` is frozen and must not change. Test in Task 2.

---

### Task 1: Exact overlap proof

**Files:**
- Modify: `engine.js` (`solve()`, about line 219)
- Modify: `tools/badges.js`
- Modify: `docs/superpowers/specs/2026-11-16-competing-solutions-design.md` (section 2 text)
- Test: `tests/tools.js` (beside the existing `computeBadges` block, about line 73)

**Interfaces:**
- Produces: `E.solve(level, start, {budget: {price: move => int >= 0, max: int}})`. It returns the least primary cost among paths whose summed `budget.price` is at most `budget.max`. Without `budget`, behavior is unchanged.
- Produces: `computeBadges(level)` skips `intro` levels unless `level.teaches === 'badges'`.
- Produces: `overlaps(level, badges) -> [[a, b], ...]` exported from `tools/badges.js`. Pairs follow the key order of `badges`. A pair is listed when one solution meets both targets, or when the search is unproven.
- Produces: `MEASURE = {tidy, unsplit, under: m => m.cost, light: E.travelOf, few: opsOf}` and `FLAGS = {tidy: {level: {consolidate: true}}, unsplit: {options: {whole: true}}}`, exported, for the climber.

- [ ] **Step 1: Write the failing tests**

```js
{
  const {computeBadges, overlaps, ranked} = require('../tools/badges.js');
  const L = id => require('../levels.js').levels.find(l => l.id === id);
  // The budget search agrees with the ranked search at the light target, and fails one below it.
  const level = L('a-can-wait');
  const light = computeBadges(level).light;
  const opsAtLight = ranked(level, E.travelOf, m => m.cost)[1];
  assert.strictEqual(E.solve(level, undefined, {budget: {price: E.travelOf, max: light}}).cost, opsAtLight);
  assert.strictEqual(E.solve(level, undefined, {budget: {price: E.travelOf, max: light - 1}}).cost, null);
  assert.strictEqual(E.solve(level, undefined, {budget: {price: E.travelOf, max: 999}}).cost, level.par);
  // load-drivers: one route meets Unsplit and Few moves together.
  assert.deepStrictEqual(overlaps(L('load-drivers'), {unsplit: 23, few: 5}), [['unsplit', 'few']]);
  assert.deepStrictEqual(overlaps(L('a-can-wait'), {light}), [], 'one badge has no pairs');
  // An intro level offers badges only when it teaches them.
  assert.deepStrictEqual(computeBadges({...L('short-hops'), teaches: undefined}), {});
}
```

Export `ranked` from `tools/badges.js` for this test.

- [ ] **Step 2: Run and confirm failure**

Run: `node tests/tools.js`
Expected: fails on the first budget assertion (option ignored, so cost equals par).

- [ ] **Step 3: Implement the budget in `engine.js`**

With `budget`, a node is keyed by `keyOf(state) + '|' + spent`, where `spent` is the summed `budget.price`. A move that would push `spent` past `budget.max` is skipped. This is exact because `spent` is part of the key. The heuristic stays the primary one, so it stays admissible. Path rebuild uses the same compound keys.

- [ ] **Step 4: Implement `overlaps` and `teaches` in `tools/badges.js`**

For a pair `(a, b)`, apply both badges' `FLAGS`. Use the measure that is not `light` as the primary `price`, because travel can be 0 and `price` needs at least 1. The other measure becomes `budget: {price, max: badges[other]}`. Use limit 1e6. The pair overlaps when the result is aborted, or its cost is at most the primary's target.

- [ ] **Step 5: Run and confirm pass**

Run: `node tests/tools.js`
Expected: `tools ok`.

- [ ] **Step 6: Fix the spec text**

In spec section 2, replace the "solver variant … ranked by" sentence with: "The solver's `budget` option gives the exact answer: least cost by one badge's measure, with the other badge's measure capped at its target."

- [ ] **Step 7: Commit**

```bash
git add engine.js tools/badges.js tests/tools.js docs/superpowers/specs/2026-11-16-competing-solutions-design.md
git commit -m "Prove badge overlap exactly with a budgeted search"
```

### Task 2: Near or far Teach level

**Files:**
- Modify: `levels.js` (Format chapter, after `fewer-is-better`, line 31)
- Regenerate: `badges.js`
- Test: `tests/tools.js`, `tests/behavior.js` (new checks beside the badge-chip checks)

**Interfaces:**
- Consumes: `computeBadges` with `teaches` from Task 1.
- Produces: level `near-or-far` with `mechanic: 'basics'`, `intro: true`, `teaches: 'badges'`.

- [ ] **Step 1: Write the failing tests**

In `tests/tools.js`:

```js
{
  const L = require('../levels.js');
  const {computeBadges} = require('../tools/badges.js');
  const format = L.chapters[0].levels.map(l => l.id);
  assert.strictEqual(format.indexOf('near-or-far'), format.indexOf('fewer-is-better') + 1);
  assert.strictEqual(format.indexOf('warm-up'), format.indexOf('near-or-far') + 1);
  const near = L.levels.find(l => l.id === 'near-or-far');
  assert.ok(near.intro && near.teaches === 'badges');
  assert.ok(E.placement(near).length <= E.COLUMNS, 'one row');
  const light = computeBadges(near).light;
  assert.ok(Number.isInteger(light), 'offers Light touch');
  // The low-travel route costs exactly one move more than par.
  assert.strictEqual(E.solve(near, undefined, {budget: {price: E.travelOf, max: light}}).cost, near.par + 1);
}
```

In `tests/behavior.js`: open `near-or-far`, check the prompt text equals the verbatim copy, and check the ↝ chip shows. Use the selectors the existing badge-chip checks use.

- [ ] **Step 2: Run and confirm failure**

Run: `node tests/tools.js`
Expected: fails on the index assertion.

- [ ] **Step 3: Design the board and add the level**

Search small one-row boards (3–8 sectors) with the solver until one meets the test. The shape: one route clears in N moves through a far gap, and one clears in N+1 through a near gap with much less travel. Goal text, about 10 words, names both goals. Use the verbatim prompt from Global Constraints. Then regenerate `badges.js`.

- [ ] **Step 4: Run the full suite and confirm pass**

Expected: exit 0. Fix any test that counted Format levels or walked "Next" from `fewer-is-better`, by updating the expected id, not by deleting the check. `LEGACY_IDS` stays unchanged.

- [ ] **Step 5: Commit**

```bash
git add levels.js badges.js tests/tools.js tests/behavior.js
git commit -m "Add the Near or far Teach level for travel"
```

### Task 3: Coverage and overlap checks

**Files:**
- Create: `tools/badge-rules.js`
- Modify: `tools/check-levels.js` (the `--badges` block, about line 116)
- Test: `tests/tools.js`

**Interfaces:**
- Consumes: `overlaps` from Task 1, `near-or-far` from Task 2.
- Produces: `BADGE_LIMITS = {floor, maxOverlap}`, exported from `tools/badge-rules.js`. These are the ratchets. `floor` only rises and `maxOverlap` only falls, toward 0.80 and 0.25.
- Produces: `badgeProblems(campaign, pool, {floor, maxOverlap}, overlapsOf = overlaps) -> string[]`. `campaign` is the chapter levels in order.

- [ ] **Step 1: Write the failing tests**

Use synthetic levels and a stub `overlapsOf`, so the test needs no solver:

```js
{
  const {badgeProblems} = require('../tools/badge-rules.js');
  const lv = (id, extra = {}) => ({id, ...extra});
  const campaign = [lv('t', {intro: true}), lv('a'), lv('near-or-far', {intro: true, teaches: 'badges'}), lv('b'), lv('c'), lv('d')];
  const none = () => [];
  const limits = {floor: 0.75, maxOverlap: 0.5};
  assert.deepStrictEqual(badgeProblems(campaign, {a: {tidy: 3}, b: {light: 4}, c: {few: 2}}, limits, none), []);
  assert.match(badgeProblems(campaign, {a: {tidy: 3}, b: {light: 4}}, limits, none).join(), /coverage 2\/4 .*c, d/);
  assert.match(badgeProblems(campaign, {a: {light: 3}, b: {tidy: 1}, c: {few: 2}}, limits, none).join(), /a offers Light touch before near-or-far/);
  const pool = {a: {tidy: 3, unsplit: 4}, b: {tidy: 1, light: 2}, c: {few: 2}};
  const both = level => (level.id === 'a' || level.id === 'b' ? [['x', 'y']] : []);
  assert.match(badgeProblems(campaign, pool, limits, both).join(), /overlap 2\/2/);
  assert.deepStrictEqual(badgeProblems(campaign, {a: {tidy: 3}}, {floor: 0, maxOverlap: 0}, none), [], 'no two-badge level passes');
}
```

Intro levels without `teaches` are outside both counts. `near-or-far` is outside the coverage count.

- [ ] **Step 2: Run and confirm failure**

Run: `node tests/tools.js`
Expected: `Cannot find module '../tools/badge-rules.js'`.

- [ ] **Step 3: Implement `tools/badge-rules.js` and wire it into `check-levels.js --badges`**

Set the starting `BADGE_LIMITS` to today's measured values, so the checker passes now: `floor` is the current covered share rounded down to 2 decimals (16/49 gives 0.32). `maxOverlap` is the larger of 0.25 and the measured ratio. Add one comment: these rise to the spec targets as levels are redesigned, and never move back.

- [ ] **Step 4: Run the full suite and confirm pass**

Expected: exit 0. Record the measured overlap ratio in the commit message.

- [ ] **Step 5: Commit**

```bash
git add tools/badge-rules.js tools/check-levels.js tests/tools.js
git commit -m "Check badge coverage and overlap with ratcheting limits"
```

### Task 4: Badge mode for the climber

**Files:**
- Modify: `tools/climb.js`
- Test: `tests/tools.js` (beside the `mutate` block, about line 277)

**Interfaces:**
- Consumes: `computeBadges`, `overlaps` (Task 1); `matters`, `hintCheap` (`tools/metrics.js`); `teachOrderProblems`; `combineProblems`; `similarPairs`.
- Produces: `grow(level, side) -> level | null`, where `side` is `'start'` or `'end'`. `mutate` also picks it at random.
- Produces: `judge(original, candidate, chapters) -> {ok, reason, badges, overlap, parDelta, changed}`. `reason` is one of `'unsolvable'`, `'par'`, `'mechanic'`, `'combine'`, `'teach'`, `'similar'`, `'hint'`, or `null`. `changed` is the count of sectors that differ from the original, after aligning for growth, plus one per grown sector.
- Produces: `climbBadge(levelId, {steps, seconds, seed, count}) -> candidate[]`, ranked. CLI: `node tools/climb.js --badge <level-id> [--seconds 300] [--steps N] [--seed 7] [--count 8]`, one JSON line per candidate on stdout.

- [ ] **Step 1: Write the failing tests**

```js
{
  const {grow, judge} = require('../tools/climb.js');
  const L = require('../levels.js');
  const byId = id => L.levels.find(l => l.id === id);
  const home = {board: 'AB.AB.', homes: {A: [1, 2], B: [5, 6]}, fragile: [3]};
  assert.deepStrictEqual(grow(home, 'start'), {...home, board: '.AB.AB.', homes: {A: [2, 3], B: [6, 7]}, fragile: [4]});
  assert.deepStrictEqual(grow(home, 'end'), {...home, board: 'AB.AB..'});
  assert.strictEqual(grow(byId('mount'), 'end'), null, 'a full disk cannot grow');
  const placed = byId('across-the-break');
  const grown = grow(placed, 'end');
  assert.ok(!grown || E.placement(grown).offset + E.placement(grown).length <= E.FRAME, 'growth stays inside the frame');
  const original = byId('park-a-pair');
  assert.strictEqual(judge(original, original, L.chapters).ok, true);
  assert.strictEqual(judge(original, original, L.chapters).changed, 0);
  assert.strictEqual(judge(original, {...original, homes: undefined}, L.chapters).reason, 'mechanic');
  assert.strictEqual(judge(original, {...original, board: original.board.replace(/\./g, '#')}, L.chapters).reason, 'unsolvable');
  assert.strictEqual(judge(original, {...byId('two-decks'), id: original.id}, L.chapters).reason, 'par');
}
```

Before writing the last line, confirm that `two-decks` differs from `park-a-pair` in par by 2 or more. If it does not, pick another level that does, and say which in a comment.

- [ ] **Step 2: Run and confirm failure**

Run: `node tests/tools.js`
Expected: `grow is not a function`.

- [ ] **Step 3: Implement `grow`, `judge` and `climbBadge`**

- `grow`: refuse when the board has 24 sectors, or when the grown board would not fit the frame at its offset. At the start, add 1 to every home bound and fragile index.
- `judge`: run the guards cheapest first and stop at the first failure. Replace the original with the candidate in a copy of `chapters`. Run `teachOrderProblems`, `combineProblems` and `similarPairs`, and fail only on messages that name the candidate's id. `ok` means every guard passed. It does not need a badge.
- `climbBadge`: hill-climb from the original. Accept a step when its rank is not lower. Rank order: has a non-overlapping badge, has any badge, `parDelta === 0`, fewer `changed`, then `quality`. Each candidate gets `par` set to its new optimum. Strip the new metric keys from seeds, as `strip` does now.

- [ ] **Step 4: Run and confirm pass**

Run: `node tests/tools.js`
Expected: `tools ok`.

- [ ] **Step 5: Smoke run**

Run: `node tools/climb.js --badge park-a-pair --seconds 60 --count 3`
Expected: JSON lines with `ok: true`, or none. The CLI must exit 0 either way. Report what it found.

- [ ] **Step 6: Commit**

```bash
git add tools/climb.js tests/tools.js
git commit -m "Add a badge mode with growth to the climber"
```

### Task 5: Redesign levels, one chapter group at a time

Run this task three times, once for each group. Commit after each group, so a group can be rejected alone:
- 5a: Format, Allocation, Move order, Fragmentation.
- 5b: Full disk, File system rules.
- 5c: Install, Wear, Recovery tools, Seek, Boot.

**Files:**
- Modify: `levels.js`, `badges.js` (regenerated), `tools/badge-rules.js` (raise `BADGE_LIMITS`)
- Modify, only where a pinned board changed: `tests/behavior.js`
- Create on 5a, then append: `docs/superpowers/reports/2026-11-19-badge-coverage.md`

**Interfaces:**
- Consumes: `climbBadge` and `judge` (Task 4), `badgeProblems` (Task 3).

- [ ] **Step 1: List the group's targets**

Targets are the badge-less non-intro levels in the group. Add `load-drivers` in 5c only if the overlap ratio is over 0.25 at that point. `fewer-is-better` may not take Light touch, because it comes before `near-or-far`.

- [ ] **Step 2: Climb each target**

Run: `node tools/climb.js --badge <id> --seconds 300 --count 5`.
Pick the top candidate whose `ok` is true and whose badges do not overlap. Prefer fewer `changed` among close ranks.

- [ ] **Step 3: Fallbacks for a target with no candidate**

- B: for a single-mechanic level, run the matching `tools/generate.js` preset with `--par` set to the current par ±1. Pass each result through `judge`.
- C: hand-edit the board, with `judge` and `computeBadges` run on each version.
- If all three fail, leave the level and record why in the report.

- [ ] **Step 4: Apply the picks**

Edit `levels.js`: board, homes, fragile and par from the candidate. Keep `id`, `name` and `mechanic`. Rewrite `goal` and `prompt` only where the new board makes them wrong. Regenerate `badges.js`.

- [ ] **Step 5: Raise the ratchets**

Set `BADGE_LIMITS.floor` to the new covered share, rounded down to 2 decimals. Lower `maxOverlap` toward 0.25. In 5c, the floor must be at least 0.80 and `maxOverlap` at most 0.25, unless the shortfall ruling applies. Under that ruling, the floor is the reached share, and the report lists each miss.

- [ ] **Step 6: Re-derive pinned behavior checks**

For each changed level in the Review Focus list, recompute the expected slot indices or track rows from the new board. Update the expectation and its comment.

- [ ] **Step 7: Write the report section**

Add one table row per target: id, old and new par, badges gained, `changed`, which approach (A, B, C, or none), and metric drift from `node tools/check-levels.js --metrics`.

- [ ] **Step 8: Run the full suite and confirm pass**

Expected: exit 0, `All 130 levels pass.`, and no FAIL lines.

- [ ] **Step 9: Commit and push**

```bash
git add levels.js badges.js tools/badge-rules.js tests/behavior.js docs/superpowers/reports/2026-11-19-badge-coverage.md
git commit -m "Redesign <group> levels for competing badges"
git push -u origin claude/serene-hypatia-e6c9ga
```

### Task 6: Docs and publish

**Files:**
- Modify: `docs/campaign-outline.md` (status line, roadmap, Decisions)
- Modify: the spec and this plan (front matter `status: active`)

- [ ] **Step 1: Update the outline**

Add a roadmap row for competing solutions. Link this plan and the report. Under Decisions, add: "Most levels offer a badge that pulls against par; Near or far teaches travel."

- [ ] **Step 2: Commit and push**

```bash
git add docs/
git commit -m "Record competing solutions in the outline"
git push -u origin claude/serene-hypatia-e6c9ga
```

- [ ] **Step 3: Republish the game artifact**

Copy the six files into the scratchpad game folder, rebuild `index.html` the usual way, and publish to the existing game URL.
