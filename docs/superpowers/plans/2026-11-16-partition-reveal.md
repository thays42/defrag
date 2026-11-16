---
title: Partition reveal implementation plan
created: 2026-11-16
source: claude-code
type: spec
status: active
tags: [defrag, animation, partition, plan]
---

# Partition Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every level change, slots that join or leave the partition animate, staggered along the read path.

**Architecture:** `buildBoard()` in `game.js` remembers the last partition's slot range. After a rebuild, a new `revealPartition(before, after)` tags each changed slot with `joining` or `leaving` and a `--delay`. CSS keyframes in `console.css` do the motion. Base styles are the end state, so reduced motion only removes the keyframes.

**Tech Stack:** Plain browser JS and CSS, no build step. Playwright behavior tests.

**Spec:** `docs/superpowers/specs/2026-11-16-partition-reveal-design.md`

## Global Constraints

- Total animation about 300 ms: the last slot starts by 200 ms, and each slot animates for 120 ms.
- Never block input. Joining slots are normal, clickable sector buttons from the first frame.
- No animation when the slot range is unchanged (Retry, Undo, reopening the same level) or on the first board after page load.
- `prefers-reduced-motion: reduce` shows no animation and adds no classes.
- No changes to `engine.js`, `levels.js`, scoring, or the save format.

## Review Focus

- **Rapid level changes** (Next pressed twice in 100 ms): the second change must animate from the first change's range, not an older one. Test in Task 1.
- **Tapping a joining slot mid-animation**: it must select like any cell. Test in Task 1.
- **Settled DOM**: after the animation, no slot keeps `joining` or `leaving`, so later styles such as `.settled` apply cleanly. Test in Task 1.
- **Page reload**: the first board after load shows no animation. Test in Task 1.
- **Window resize mid-animation**: `drawTrack()` redraws only the SVG and must not touch slot classes. No test; the code does not touch slots on resize. The reviewer should confirm this.

---

### Task 1: Animate partition changes

**Files:**
- Modify: `game.js` (module state near `frameOffset` at line 20; `buildBoard()` at lines 477–501; new function after `buildBoard()`)
- Modify: `console.css` (after the `.void` rule near line 152; the reduced-motion block near line 301)
- Test: `tests/behavior.js` (new section "Partition reveal" after "First-time player fixes", before the `'no page errors'` check)

**Interfaces:**
- Produces: `let shownRange = null`, which is `{start, end}`. These are frame slot indices with `end` exclusive, or `null` before the first board.
- Produces: `revealPartition(before, after)`, which tags the slots of `ui.board` and returns nothing.

- [ ] **Step 1: Write the failing tests**

Add the section below. `open`, `get`, `cell` and `check` already exist. `tags` reads classes and delays synchronously, in the same task as the level change, before any frame runs.

```js
  // ---------- Partition reveal ----------
  const tags = id => page.evaluate(target => {
    openLevel(findLevel(target));
    const slots = [...ui.board.querySelectorAll(':scope > .cell, :scope > .void')];
    const pick = cls => slots.map((slot, i) => slot.classList.contains(cls) ? [i, parseFloat(slot.style.getPropertyValue('--delay'))] : null).filter(Boolean);
    return {joining: pick('joining'), leaving: pick('leaving')};
  }, id);
  await open('join-two-blocks');                       // slots 7–9
  const grow = await tags('move-a-run');               // slots 6–11
  check('growing tags the new slots as joining', JSON.stringify(grow.joining.map(([i]) => i)) === '[6,10,11]' && !grow.leaving.length, JSON.stringify(grow));
  const delay = Object.fromEntries(grow.joining);
  check('joining slots stagger outward along the read path', delay[6] === delay[10] && delay[11] > delay[10] && Math.max(...Object.values(delay)) <= 200, JSON.stringify(delay));
  await cell(0).click({force: true}); // force skips Playwright's wait for the animation to settle
  check('a joining slot is clickable mid-animation', await get(() => selection !== null));
  const shrink = await tags('join-two-blocks');
  check('shrinking tags the old slots as leaving', JSON.stringify(shrink.leaving.map(([i]) => i)) === '[6,10,11]' && !shrink.joining.length, JSON.stringify(shrink));
  const same = await tags('join-two-blocks');
  check('reopening the same partition does not animate', !same.joining.length && !same.leaving.length, JSON.stringify(same));
  await page.waitForTimeout(400);
  check('tags are removed once the animation ends', await get(() => !ui.board.querySelector('.joining, .leaving')));
  // A quick double change animates from the middle level's range.
  await page.evaluate(() => openLevel(findLevel('move-a-run')));
  const quick = await tags('warm-up');                 // slots 0–16
  check('a quick second change starts from the last range', !quick.leaving.length && JSON.stringify(quick.joining.map(([i]) => i)) === JSON.stringify([0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16]), JSON.stringify(quick));
  await page.emulateMedia({reducedMotion: 'reduce'});
  const calm = await tags('join-two-blocks');
  check('reduced motion adds no reveal', !calm.joining.length && !calm.leaving.length, JSON.stringify(calm));
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.reload();
  check('the first board after load does not animate', await get(() => !ui.board.querySelector('.joining, .leaving')));
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node tests/behavior.js 2>&1 | grep -E 'FAIL|reveal|joining|leaving|partition'`
Expected: FAIL on 'growing tags the new slots as joining', 'joining slots stagger outward…', 'shrinking tags…' and 'a quick second change…'. The negative checks may already pass.

- [ ] **Step 3: Implement in `game.js`**

- Add `let shownRange = null;` beside `frameOffset`, with a one-line comment: the last board's partition slots, so the next board can animate the change.
- In `buildBoard()`, after the slots are appended and before `drawTrack()`: save `before = shownRange`, then set `shownRange = {start: frameOffset, end: frameOffset + state.cells.length}`. Call `revealPartition(before, shownRange)` only if `before` is set, its `start` or `end` differs, and `!reducedMotion()`.
- `revealPartition(before, after)`: take the slots as `ui.board.querySelectorAll(':scope > .cell, :scope > .void')`, the same selector `drawTrack()` uses. A slot changed if its inside status differs between `before` and `after`. Its distance is `Math.min(Math.abs(slot - before.start), Math.abs(slot - (before.end - 1)))`. Its delay is `Math.round(distance * step)` ms, where `step = 200 / maxDistance` over the changed slots and `maxDistance` is at least 1. Add class `joining` to a changed `.cell` and `leaving` to a changed `.void`, set `style.setProperty('--delay', delay + 'ms')`, and remove the class on `animationend` (`{once: true}`).

Why distance to the old edge works: when growing, joining slots nearest the old edge go first, so the edge travels outward. When shrinking, leaving slots at the old edge go first, so the edge travels inward.

- [ ] **Step 4: Implement in `console.css`**

After the `.void` rule:
- `.cell.joining { animation: slot-join 120ms var(--delay, 0ms) ease-out both; }` with `@keyframes slot-join` going from `opacity: 0; transform: scale(.7)` to the base style.
- `.void.leaving { animation: slot-leave 120ms var(--delay, 0ms) ease-in both; }` with `@keyframes slot-leave` going from `background: #2a2040; border-style: solid` to the base style.

In the existing `@media (prefers-reduced-motion: reduce)` block near line 301, add `.cell.joining, .void.leaving { animation: none; }` as a backstop.

- [ ] **Step 5: Run the full suite and confirm it passes**

Run in the background, because it takes longer than 120 s: `node tests/tools.js && node tools/check-levels.js && node tests/behavior.js && node tests/play-all.js`
Expected: exit 0, "All 129 levels pass.", no FAIL lines.

- [ ] **Step 6: Look at it**

Take a screenshot 60 ms after switching from `join-two-blocks` to `move-a-run`, and another for the reverse. Confirm slots are mid-change and nothing else on the board flickers.

- [ ] **Step 7: Commit**

```bash
git add game.js console.css tests/behavior.js
git commit -m "Animate the partition when it changes between levels"
```

### Task 2: Docs and publish

**Files:**
- Modify: `docs/campaign-outline.md` (the status line at line 14, the roadmap row for phase 5, Decisions, Open questions)
- Modify: `docs/superpowers/specs/2026-11-16-partition-reveal-design.md` (front matter `status: active`)

**Interfaces:**
- Consumes: the behavior from Task 1.

- [ ] **Step 1: Update the outline**

- Status line: "Phases 1–5 are done."
- Phase 5 row: Delivers becomes "Animation on every level change where the partition moves or resizes." Plan becomes this plan's path.
- Move the open question into Decisions as: "The partition reveal is plain layout, on every level change, not diegetic." Remove the now-empty Open questions section.
- The Principle 1 mitigation sentence "animate the partition growing only at chapter starts" becomes "animate the partition on each level change".

- [ ] **Step 2: Commit and push**

```bash
git add docs/campaign-outline.md docs/superpowers/specs/2026-11-16-partition-reveal-design.md
git commit -m "Record the partition reveal in the outline"
git push -u origin claude/serene-hypatia-e6c9ga
```

- [ ] **Step 3: Republish the game artifact**

Copy the six files into the scratchpad game folder, rebuild `index.html` the usual way, and publish to the existing game URL.
