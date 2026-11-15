---
title: First-time player fixes implementation plan
created: 2026-11-15
source: claude-code
type: spec
status: draft
tags: [defrag, plan, onboarding, ux]
---

# First-Time Player Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five open rows of the confusion table: par copy, hint warning, settled state, split cost preview, and clipboard placing.

**Architecture:** All changes are in the UI layer: `game.js`, `index.html`, `console.css`. The engine and levels do not change. Two new progress flags remember one-time messages. Each fix has browser checks in `tests/behavior.js`.

**Tech Stack:** Plain browser JS, no build step. Playwright for `tests/behavior.js`.

**Spec:** `docs/campaign-outline.md`, section "What a first-time player gets confused by".

## What already exists

Several rows are partly done. This plan fixes only the gap in each.

| Row | Already there | Gap this plan fixes |
| --- | --- | --- |
| Lower score is better; what par means | The `fewer-is-better` level prompt says both. | A player who starts elsewhere never sees it. The results sheet never says when par is beatable. |
| Hints cost stars | The results sheet says so after the clear. | Nothing says it before the first hint. |
| Why a joined file is not done | A small ✓ marks settled files. | The ✓ is faint. Nothing explains a joined file outside its home. |
| Tapping a selected run splits it | The prompt says "tap a block to split it off". | The extra point is not shown before the tap commits. |
| Clipboard takes two taps to place | The clipboard button shows its contents. | Nothing says the second tap is Clipboard, then a destination. A full clipboard looks the same as an empty one. |

The clipboard row's stated fix ("show contents beside the board while full") is already met. This plan treats the two-tap step as the real gap.

## Global Constraints

- The status line has a fixed height of three short lines at 420 px width. New status text must fit without overflow.
- Every new string is in the "Copy" lines below. Use them verbatim.
- Progress stays at `version: 3`. New fields get defaults in `fresh`, so old saves load unchanged.
- No new files. No change to `engine.js` or `levels.js`.
- Every visible marker has a matching `aria-label` or text change for screen readers.

## Copy

| Key | Text |
| --- | --- |
| Par note, first results sheet | `Par is the best possible score. Lower is better.` |
| Par note, beatable level | `Par can be beaten on this level.` |
| Hint warning | `A hint caps this level at one star. Tap Hint again to use one.` |
| Joined outside home | `` `${file} is joined but not home. Move it onto the ${file} sectors.` `` |
| Split prompt, run selected | `` `Choose a destination, or tap a block to split it off (+1)${extra}.` `` |
| Split prompt, no gap | `` `No gap fits the whole run. Tap a block to split it off (+1)${extra}.` `` |
| Cut notice | `` `Lifted ${file}. To place it, choose Clipboard, then a destination.` `` |
| Clipboard blocker | `` `To place ${file}, choose Clipboard, then a destination.` `` |
| Pending score | `` `+${cost}` `` |

## Review Focus

- Pressing H on the keyboard must hit the same hint warning as the button. Test: Task 2 uses the `h` key.
- A level already hinted (the star is already lost) must not warn again. Test: Task 2.
- New status strings must fit the fixed status box at 420 px. Test: Task 5 checks `scrollHeight <= clientHeight` for the longest new string.
- Seek levels show move cost on destination marks. The pending score must not show a misleading single number there. Test: Task 4 on `short-hops`.
- A file in a homes level that is joined *and* home must not show the "not home" message. Test: Task 3.

---

### Task 1: Par note on the results sheet

**Files:**
- Modify: `index.html` (results sheet, after `#result-why`)
- Modify: `game.js` (`fresh` in progress load near line 42; `showResult` near line 878)
- Modify: `console.css` (style beside `.result-why`, line 557)
- Test: `tests/behavior.js`

**Interfaces:**
- Produces: `progress.parExplained: boolean` (default `false`). `<p id="result-note" class="result-note" hidden>`.

- [ ] **Step 1: Write the failing checks** in `tests/behavior.js`, after the existing results-sheet checks. Use a fresh page state (`localStorage.clear()` and reload, as other checks do).

```js
// The first results sheet defines par. Later sheets do not repeat it.
await open('join-two-blocks');
await page.evaluate(() => perform(E.moves(level, state)[0]));
await page.waitForFunction(() => !ui.result.hidden);
check('first results sheet defines par', await get(() => !ui['result-note'].hidden && ui['result-note'].textContent === 'Par is the best possible score. Lower is better.'));
check('par note is remembered', await get(() => progress.parExplained === true));
await open('move-a-run');
await page.evaluate(() => perform(E.solve(level).path[0]));
await page.waitForFunction(() => !ui.result.hidden);
check('later sheets skip the par note', await get(() => ui['result-note'].hidden));
// A beatable level says so on every sheet.
await open('beat-par');
await page.evaluate(() => { for (const move of E.solve(level).path) perform(move); });
await page.waitForFunction(() => !ui.result.hidden);
check('beatable level says par can be beaten', await get(() => !ui['result-note'].hidden && ui['result-note'].textContent === 'Par can be beaten on this level.'));
```

If `E.solve(level).path` holds moves in a different shape than `perform` takes, use the shape the existing "plays at par" checks use.

- [ ] **Step 2: Run** `node tests/behavior.js`. Expected: the four new checks FAIL (`result-note` missing).

- [ ] **Step 3: Implement.**
  - Add `parExplained: false` to `fresh`.
  - In `showResult`, build the note from two parts: the par definition when `!progress.parExplained`, then the beatable line when `level.beatable`. Join with a space. Hide the element when empty.
  - Set `progress.parExplained = true` and `save()` when the definition is shown.
  - Time it with `at(ui['result-note'], beat.tag)`, as `result-why` does.
  - CSS: same font as `.result-why`, muted color (`var(--muted)`), not coral.

- [ ] **Step 4: Run** `node tests/behavior.js`. Expected: all checks pass.

- [ ] **Step 5: Commit** `git commit -m "Define par on the first results sheet and flag beatable par"`.

### Task 2: Warn before the first hint

**Files:**
- Modify: `game.js` (`fresh`; `showHint` near line 417)
- Test: `tests/behavior.js` (existing hint checks near line 55)

**Interfaces:**
- Produces: `progress.hintWarned: boolean` (default `false`).

- [ ] **Step 1: Write the failing checks.** Change the existing block that starts `// Hints mark the attempt` so the first `h` press is asserted as the warning:

```js
await open('find-home');
await cell(0).focus();
await page.keyboard.press('h');
check('first hint warns instead of hinting', await get(() => hint === null && !hinted && ui.status.textContent === 'A hint caps this level at one star. Tap Hint again to use one.'));
check('warning is remembered', await get(() => progress.hintWarned === true));
await page.keyboard.press('h');
await page.waitForFunction(() => hint !== null);
// ...existing checks continue unchanged from 'hint text is visible'.
```

Add after the existing "hint flag survives reopening" check:

```js
// The warning shows once ever, not once per level.
await open('two-files');
await page.click('#hint');
await page.waitForFunction(() => hint !== null);
check('second level hints without a warning', await get(() => ui.status.textContent.startsWith('Hint:')));
```

Add a check that an already hinted level does not warn, by clearing `progress.hintWarned` with `page.evaluate`, reopening `find-home` (which is still hinted), pressing Hint, and expecting a hint.

- [ ] **Step 2: Run** `node tests/behavior.js`. Expected: the new checks FAIL.

- [ ] **Step 3: Implement.** At the top of `showHint`, before any search: when `!progress.hintWarned && !hinted` (dailies included), set `progress.hintWarned = true`, `save()`, set `notice` to the warning copy, `render()`, and return.

- [ ] **Step 4: Run** `node tests/behavior.js`. Expected: all pass.

- [ ] **Step 5: Commit** `git commit -m "Warn that hints cost stars before the first hint"`.

### Task 3: Settled looks different from joined

**Files:**
- Modify: `console.css` (`.cell.settled`, line 401)
- Modify: `game.js` (`blocker`, near line 609)
- Test: `tests/behavior.js`

**Interfaces:**
- Consumes: `E.fileSettled(level, state, file)`, `E.info(level).counts`, the existing `joined` test inside `blocker`.

- [ ] **Step 1: Write the failing checks.** Use `find-home` (`AA..`, home A at 3–4).

```js
// A joined file outside its home says why it is not done, and looks different from a settled file.
await open('find-home');
check('joined but not home is explained', await get(() => blocker() === 'A is joined but not home. Move it onto the A sectors.'));
const joinedShadow = await get(() => getComputedStyle(ui.cells[0]).boxShadow);
await page.evaluate(() => perform(E.solve(level).path[0]));
const settledShadow = await get(() => getComputedStyle(ui.cells[2]).boxShadow);
check('settled cells have a ring that joined cells lack', settledShadow !== 'none' && settledShadow !== joinedShadow, `${joinedShadow} / ${settledShadow}`);
check('joined and home gives no blocker', await get(() => blocker() === null));
```

The cleared board may change cell styling. If it does, take the settled reading from a two-file homes level with one file home and one not (`two-files`), instead of a cleared board.

- [ ] **Step 2: Run** `node tests/behavior.js`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - In `blocker`, inside the existing per-file loop, after the order check: if the file is `joined`, has a home in `level.homes`, and `!E.fileSettled(level, state, file)`, return the "joined outside home" copy.
  - CSS: `.cell.settled` gets an inset ring, `box-shadow: inset 0 0 0 2px #211930`, and the ✓ grows to `.8rem`. Keep the ✓ offsets for cracked cells working.
  - Help text: in `index.html`, the "Clear the board" entry says "A file shows ✓ once it meets all its own rules." Change it to "A file shows ✓ and a dark ring once it meets all its own rules."

- [ ] **Step 4: Run** `node tests/behavior.js`. Expected: all pass. Also take one screenshot of `two-files` mid-play at deviceScaleFactor 1 and confirm the ring reads at a glance.

- [ ] **Step 5: Commit** `git commit -m "Ring settled files and explain joined files outside their home"`.

### Task 4: Show the split cost before the tap

**Files:**
- Modify: `index.html` (inside the Score `.score` div: `<em id="score-pending" class="score-pending" hidden></em>`)
- Modify: `game.js` (new `pendingCost`; `render`; `selectionPrompt` near line 787)
- Modify: `console.css`
- Test: `tests/behavior.js`

**Interfaces:**
- Produces: `pendingCost(): number | null`. Returns `preview.cost` when a preview is shown. Otherwise, on a non-seek level with a selection, the lowest `cost` of any `moveTo(index)` over the board. Otherwise `null`.

- [ ] **Step 1: Write the failing checks.** Use `split-a-run` (`AA.AA`).

```js
// The score shows what the next move will cost, and a split shows its extra point before it commits.
await open('split-a-run');
await cell(0).click();
check('selected run previews +1', await get(() => pendingCost() === 1 && ui['score-pending'].textContent === '+1' && !ui['score-pending'].hidden));
await cell(1).click();
check('pending split previews +2', await get(() => anchor !== null && pendingCost() === 2 && ui['score-pending'].textContent === '+2'));
await page.keyboard.press('Escape');
check('no selection hides the pending score', await get(() => ui['score-pending'].hidden));
// Seek destinations already show their own costs.
await open('short-hops');
await cell(0).click();
check('seek level shows no pending score without a preview', await get(() => pendingCost() === null && ui['score-pending'].hidden));
```

Add a check that the split prompt on a non-tutorial level with a two-block run ends `(+1).` or `(+1), or ...`. Pick the level from `levels.js` where the first run has two or more blocks and splitting is allowed, for example `required-split`.

- [ ] **Step 2: Run** `node tests/behavior.js`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `pendingCost()` as in Interfaces.
  - In `render`, set `#score-pending` text to `+N` and toggle `hidden`. Set `data-split="true"` when `isSplit()`.
  - Change the two split prompt strings to the Copy lines.
  - CSS: small, beside the score number. Coral when `data-split="true"`, muted otherwise.
  - Accessibility: append `, next move costs N` to the `#score` element's `aria-label` while pending.

- [ ] **Step 4: Run** `node tests/behavior.js`. Expected: all pass.

- [ ] **Step 5: Commit** `git commit -m "Preview the cost of the next move, including the split point"`.

### Task 5: Clipboard placing is explicit

**Files:**
- Modify: `game.js` (cut notice near line 295; `blocker` line 610; `renderClipboard` line 677)
- Modify: `console.css` (`.clipboard`, line 429)
- Test: `tests/behavior.js`

**Interfaces:**
- Consumes: `state.clip: string[] | null`.

- [ ] **Step 1: Write the failing checks.** Use `no-room-at-all` (`AB`, clipboard).

```js
// After a lift, the status names the second tap, and the full clipboard stands out.
await open('no-room-at-all');
await cell(0).click();
await page.click('#clipboard');
check('lift names the two-step place', await get(() => ui.status.textContent === 'Lifted A. To place it, choose Clipboard, then a destination.'));
check('full clipboard is marked', await get(() => ui.clipboard.classList.contains('full')));
check('status fits its box', await get(() => ui.status.scrollHeight <= ui.status.clientHeight));
check('blocker names the clipboard step', await get(() => blocker() === 'To place A, choose Clipboard, then a destination.'));
```

- [ ] **Step 2: Run** `node tests/behavior.js`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Cut notice and the clipboard blocker use the Copy lines. `file` is `E.letterOf(state.clip[0])`.
  - `renderClipboard` toggles `full` on `Boolean(state.clip)`.
  - CSS: `.clipboard.full` gets a solid border in the held file's tile color. Set `data-file` on the button from the held file, and clear it when empty.

- [ ] **Step 4: Run** `node tests/behavior.js`. Expected: all pass.

- [ ] **Step 5: Commit** `git commit -m "Name the clipboard place step and mark a full clipboard"`.

### Task 6: Docs, full verification, publish

**Files:**
- Modify: `docs/campaign-outline.md` (status line; roadmap phase 4 row: link this plan; note the clipboard row's real fix)
- Modify: `README.md` only if it describes any changed copy or UI. Check with `grep -n "clipboard\|hint\|settled" README.md`.

- [ ] **Step 1: Run every suite.**
  - `node tests/tools.js` → `tools ok`.
  - `node tools/check-levels.js` → `All 129 levels pass`.
  - `node tests/behavior.js` → no `FAIL` lines.
  - `node tests/play-all.js` → every level at par.

- [ ] **Step 2: Update docs** as listed above. Status line becomes "Phases 1–4 are done".

- [ ] **Step 3: Commit and push** `git commit -m "Phase 4 docs"`, then `git push -u origin claude/serene-hypatia-e6c9ga`.

- [ ] **Step 4: Republish the game artifact** (https://claude.ai/artifact/HdUMYTToekT9LuAprQQ4Fy) from the scratchpad `game` folder, with the six files rebuilt as in Phase 3.
