# Campaign Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the campaign into the outline's chapters, show the catalog in that order, add two Teach levels, make three decoration levels test their reserved sectors, and move surplus hard levels to an Extra set.

**Architecture:** `levels.js` keeps the `chapters` array but regroups it into 10 chapters (Boot waits for Phase 3), adds a one-line `summary` per chapter, and exports `extras` and a flat `levels` list. `game.js` treats `campaign` as the main path and `extras` as an optional tail. The checker gains a teach-order rule and a hard reserved rule.

**Tech Stack:** Plain browser JS, Node tools, Playwright tests. No build step.

**Spec:** `docs/campaign-outline.md` (sections "The campaign" and "Implementation roadmap", phase 2).

## Global Constraints

- Progress is keyed by level `id`. Never rename an existing id unless the task says so.
- Chapter names, in order: Format, Allocation, Move order, Fragmentation, Full disk, File system rules, Install, Wear, Recovery tools, Seek. Chapter 11 (Boot) is Phase 3; do not add an empty chapter.
- Every level must fit the 24-sector frame. New and reworked boards must pass `node tools/check-levels.js`, including the similarity check.
- After any board change: `node tools/badges.js --write badges.js`, then `node tools/check-levels.js --badges`.
- The title shows the chapter above the level name. Every chapter and level name must fit on one line at 360px (the existing "title is two whole lines" behavior test covers it).
- Commit trailers per session settings. No model names in code or commits.

## Review Focus

- **Old index-based saves.** `loadProgress` maps v1/v2 saves through `campaign[index]` for the first 30 levels. Reordering would silently credit the wrong levels. The map must use a frozen list of the old order (Task 1 test).
- **Rule chips after renaming chapters.** `renderRules` hides a chip when `level.chapter` equals the mechanic's old chapter name ("Seek cost", "Cracked sectors", "Numbered fragments"). New chapter names never match, so chips change silently. Decide explicitly (Task 1).
- **Next on an Extra level.** Extra levels are outside `campaign`, so `findIndex` returns -1 and "Next" would open `campaign[0]`. It must go to the next Extra level, then back to the catalog (Task 2 test).
- **A level that needs a rule before it is taught.** Moving `split-a-run` to chapter 4 means no chapter 1–3 level may need a split, and no board before "Across the break" may span two rows (Task 3 checker rule).
- **Menu and ending totals.** Stars from Extra levels must not push the menu past `3 × campaign.length` or block the ending (Task 2 test).

---

### Task 1: Regroup the chapters and freeze the legacy order

**Files:**
- Modify: `levels.js`, `game.js` (top of file, `loadProgress`, `renderRules`)
- Modify: `tools/check-levels.js`, `tools/badges.js`, `tools/redress.js`, `tools/redress-search.js`, `tests/tools.js` (replace `chapters.flatMap(c => c.levels)` with `levels`)
- Test: `tests/tools.js`, `tests/behavior.js`

**Interfaces:**
- Produces: `levels.js` exports `{mechanics, chapters, extras, levels}`. Each chapter is `{name, summary, levels}`. `extras` is `{name: 'Extra', summary, levels}`. `levels` is every chapter level, then every Extra level.
- Produces in `game.js`: `campaign` (main chapters only, each level has `chapter`), `extraLevels` (each has `chapter: 'Extra'`, `extra: true`), `levelById` over both, and `const LEGACY_IDS = [...]` (the 30 ids below).

Chapter contents, in this order. New levels from Task 3 and reworks from Task 4 slot in later; leave their positions noted in a comment.

| Chapter | Summary | Levels |
| --- | --- | --- |
| Format | New disk. Learn to move data. | join-two-blocks, move-a-run, *(across-the-break, Task 3)*, reserved-intro, *(fewer-is-better, Task 3)*, warm-up |
| Allocation | Files have homes. | find-home, two-files, borrow-a-home, park-a-pair, choose-what-to-park, save-the-gap, scattered-gaps |
| Move order | Same rule, harder planning. | a-can-wait, b-can-wait, blocked-lanes |
| Fragmentation | Break a run to make it fit. | split-a-run, required-split, make-a-parking-spot, one-sector-off, beat-par, required-split-revisited, two-splits |
| Full disk | Everything so far, on the whole disk. | four-files, free-the-pair, cut-across, split-workspace, across-the-disk, tight-fit |
| File system rules | New rules for what "done" means. | in-order, shuffled, two-decks, one-gap, sweep-up, tidy-disk, chained, chain-of-three, daisy-chain |
| Install | The operating system arrives. | boot-sector, load-order, kernel-space, driver-stack |
| Wear | The disk ages. | cracked, one-write-left, failing-drive |
| Recovery tools | Two tools for a failing disk. | no-room-at-all, hold-that-thought, juggle, nudge, scoot-over, shuffle-step |
| Seek | The read head is slow. | short-hops, long-way-round, head-travel |
| Extra *(extras)* | Hard puzzles off the main path. | trade-places, broken-workspace, pocket-change |

Chapter 5 keeps the six with the highest trap rate or fewest lines (`four-files` 1.00/2, `across-the-disk` .83, `free-the-pair` .75/6, `split-workspace` .67, `tight-fit` .50 split, `cut-across` 4 lines split). `trade-places` (trap 0) and `broken-workspace` (trap .25) go to Extra.

- [ ] **Step 1: Write the failing tests**

In `tests/tools.js`:

```js
const L = require('../levels.js');
assert.deepStrictEqual(L.chapters.map(c => c.name), ['Format', 'Allocation', 'Move order', 'Fragmentation', 'Full disk', 'File system rules', 'Install', 'Wear', 'Recovery tools', 'Seek']);
assert.ok(L.chapters.every(c => c.summary && c.levels.length));
assert.deepStrictEqual(L.extras.levels.map(l => l.id), ['trade-places', 'broken-workspace', 'pocket-change']);
assert.strictEqual(L.levels.length, L.chapters.flatMap(c => c.levels).length + L.extras.levels.length);
assert.strictEqual(new Set(L.levels.map(l => l.id)).size, L.levels.length, 'no level appears twice');
for (const id of ORIGINAL_55_IDS) assert.ok(L.levels.some(l => l.id === id), `${id} kept`);
```

`ORIGINAL_55_IDS` is a literal list of today's 55 ids (print it with `node -e "console.log(JSON.stringify(require('./levels.js').chapters.flatMap(c=>c.levels).map(l=>l.id)))"` before editing).

In `tests/behavior.js`, keep the existing "v2 save migrates" check unchanged (it expects index 23 → `tight-fit`). Add:

```js
check('legacy order is frozen', await get(() => LEGACY_IDS.length === 30 && LEGACY_IDS[23] === 'tight-fit' && LEGACY_IDS[2] === 'split-a-run'));
check('extra levels open by id', await get(() => levelById.get('pocket-change')?.extra === true));
await get(() => openLevel(levelById.get('long-way-round')));
check('seek chip shows on seek levels', await get(() => [...ui.rules.children].some(c => c.textContent === 'Seek cost')));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/tools.js` → FAIL on chapter names. `node tests/behavior.js` → FAIL on `LEGACY_IDS is not defined`.

- [ ] **Step 3: Regroup `levels.js`, add `extras` and `levels`, update `game.js`**

- `loadProgress`: `idAt = index => LEGACY_IDS[index]`. `LEGACY_IDS` is the old first 30, copied verbatim:
  `["join-two-blocks","move-a-run","split-a-run","find-home","two-files","reserved-intro","scattered-gaps","warm-up","required-split","borrow-a-home","park-a-pair","choose-what-to-park","make-a-parking-spot","save-the-gap","a-can-wait","b-can-wait","required-split-revisited","beat-par","one-sector-off","two-splits","four-files","free-the-pair","trade-places","tight-fit","blocked-lanes","broken-workspace","across-the-disk","pocket-change","split-workspace","cut-across"]`
- `renderRules`: delete `named`. Chapter names are now themes, not mechanics, so the seek, numbered and cracked chips always show when the level uses the rule.
- Tools and `tests/tools.js`: iterate `levels` from `levels.js`. `tests/play-all.js` and the behavior loops over `campaign` become `[...campaign, ...extraLevels]`.

- [ ] **Step 4: Run all checks**

Run: `node tests/tools.js && node tools/check-levels.js && node tests/behavior.js && node tests/play-all.js`
Expected: all pass. The catalog checks "one group per mechanic" still pass here; Task 2 replaces them.

- [ ] **Step 5: Commit** — "Regroup the campaign into the outline's chapters"

---

### Task 2: Catalog in campaign order, Extra navigation, totals

**Files:**
- Modify: `game.js` (`showCatalog`, `showEnding`, `ui.next.onclick`, `ui['result-next'].onclick`, the "next" button text near lines 543 and 921)
- Test: `tests/behavior.js` (replace "one group per mechanic" and "each group sorted by par")

**Interfaces:**
- Consumes: `chapters`, `extras`, `campaign`, `extraLevels` from Task 1.
- Produces: `nextLevel(level) -> level | null`. Main path: the next campaign level, or `null` after the last (shows the ending). Extra: the next Extra level, or `null` after the last (opens the catalog).

- [ ] **Step 1: Write the failing tests**

```js
check('one group per chapter, then Extra', groups.map(g => g.name.split(' · ')[0]).join('|') === [...chapters.map(c => c.name), 'Extra'].join('|'));
check('catalog lists levels in campaign order', (await get(() => [...ui.levels.querySelectorAll('button > span:first-child')].map(s => s.firstChild.textContent))).join('|') === (await get(() => [...campaign, ...extraLevels].map(l => l.name))).join('|'));
check('each group shows its summary', groups.every(g => g.summary));
const solveAndNext = id => get(() => { openLevel(levelById.get(id)); for (const m of E.solve(level, state).path) perform(m); ui.next.click(); return {id: level.id, catalog: !ui.catalog.hidden}; });
check('next on an Extra level opens the next Extra', (await solveAndNext('trade-places')).id === 'broken-workspace');
check('next on the last Extra opens the catalog', (await solveAndNext('pocket-change')).catalog);
await get(() => { for (const l of extraLevels) progress.best[l.id] = l.par; showMenu(); });
check('menu total ignores Extra stars', (await get(() => ui['resume-detail'].textContent)).includes(`/${await get(() => 3 * campaign.length)}\u00a0★`));
```

`ui.next.onclick` and `ui['result-next'].onclick` use `nextLevel`: open it if non-null, else `showCatalog()` for an Extra level and `showEnding()` for the main path.

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/behavior.js` → FAIL on "one group per chapter".

- [ ] **Step 3: Implement**

- `showCatalog`: one `<section>` per chapter, then one for Extra. Heading `${name} · ${done}/${count}`. The paragraph under it is the chapter `summary` (class `rule`, as now). Buttons in data order. Drop the par sort.
- Result and game "next" text: `'Next puzzle →'`, except the last main level (`'Finish campaign'`) and the last Extra (`'Back to levels'`).
- `starTotal`, the menu line and the ending count `campaign` only, as now. The Extra heading's `done/count` is its only tally.
- `showEnding` copy: replace "Levels lists every puzzle by mechanic" with "Levels lists every puzzle by chapter, plus an Extra set".

- [ ] **Step 4: Run all checks** — `node tests/behavior.js && node tests/play-all.js` pass.

- [ ] **Step 5: Commit** — "Order the catalog by chapter and add the Extra set"

---

### Task 3: Teach-order rule and two new Teach levels

**Files:**
- Modify: `tools/check-levels.js`, `levels.js`, `badges.js` (regenerated)
- Test: `tests/tools.js`

**Interfaces:**
- Produces: `teachOrderProblems(levels) -> string[]` exported from a new `tools/teach-order.js`, used by `check-levels.js`. One string per violation: `"<id> uses <rule> before it is taught"`.

Rules, over campaign order (`chapters` flattened, Extra excluded):
- A rule is taught at the first `intro: true` level whose `mechanic` is that rule. `basics` needs no teaching.
- A level uses `homes` if it has a non-empty `homes`, `reserved` if its board has `#`, `splitting` if `E.solve(level, undefined, {whole: true}).cost` is null or above `par` (only test levels before the splitting Teach, to keep it fast), and any mechanic in `check-levels.js`'s `needs` table if that predicate holds. Move `needs` into `tools/teach-order.js` and import it back.
- **Row wrap:** the first level whose partition spans a row break must have id `across-the-break`. A partition spans a break when `offset % 6 + length > 6`, using `E.placement`.

- [ ] **Step 1: Write the failing tests**

```js
const {teachOrderProblems} = require('../tools/teach-order.js');
const t = (id, extra) => ({id, mechanic: 'basics', par: 1, board: 'A.A', ...extra});
assert.deepStrictEqual(teachOrderProblems([t('a', {homes: {A: [1, 2]}}), t('b', {mechanic: 'homes', intro: true})]), ['a uses homes before it is taught']);
assert.deepStrictEqual(teachOrderProblems([t('b', {mechanic: 'homes', intro: true, homes: {A: [2, 3]}}), t('a', {homes: {A: [1, 2]}})]), []);
assert.deepStrictEqual(teachOrderProblems([t('w', {board: 'A.....A'})]), ['w uses row wrap before it is taught']);
assert.deepStrictEqual(teachOrderProblems([t('across-the-break', {board: 'A.AA..', offset: 9})]), []);
assert.deepStrictEqual(teachOrderProblems(require('../levels.js').chapters.flatMap(c => c.levels)), []);
```

The last assert fails until the new levels exist, because `warm-up` (17 sectors) is the first multi-row board.

- [ ] **Step 2: Run to verify it fails** — `node tests/tools.js` → FAIL: module not found, then `warm-up uses row wrap before it is taught`.

- [ ] **Step 3: Implement `tools/teach-order.js` and call it from `check-levels.js`** (failures go to `problems`).

- [ ] **Step 4: Add the two levels to chapter Format**

- `across-the-break`, after `move-a-run`: `{mechanic: 'basics', intro: true, par: 1, name: 'Across the break', board: 'A.AA..', offset: 9, goal: 'Join A. The end of a row continues at the start of the next.', prompt: 'The A pair crosses the row break. It is one run. Tap the lone A, then the sector beside the pair.'}`. Frame sectors 10–15, so it sits across rows 2 and 3.
- `fewer-is-better`, after `reserved-intro`: mechanic `basics`, **not** `intro` (the score must show), `par: 2`, name "Fewer is better". Board: the first of these that passes the checker and the trap test below: `ABA.BA`, `ABA.AB`, `AB.ABA`, `A.BABA`, `AB.BAB`, `ABAB.A` (all par 2, no split needed, trap rate .67, one optimal line). **Trap test:** some legal first move leaves a best total of exactly 3. Goal: "Join both files in as few moves as you can." Prompt: "Score counts your moves. Fewer is better. Par is the best possible score. Over par? Undo and try again."

- [ ] **Step 5: Run checks and regenerate badges**

Run: `node tests/tools.js && node tools/check-levels.js && node tools/badges.js --write badges.js && node tools/check-levels.js --badges && node tests/behavior.js && node tests/play-all.js`
Expected: all pass. Similarity warnings for the new boards are fine; a failure is not.

- [ ] **Step 6: Commit** — "Teach row wrap and par in chapter 1; check teach order"

---

### Task 4: Reserved sectors must matter

**Files:**
- Modify: `tools/check-levels.js` (move `reserved` from `soft` to `matters`), `tools/generate.js` (reserved preset `want`, `--par` and `--length` filters), `levels.js` (three boards), `badges.js` (regenerated), `README.md` (the paragraph "For `homes` and `reserved` levels the mechanic check only warns")
- Test: `tests/tools.js`

**Interfaces:**
- Consumes: `without.reserved` from `tools/metrics.js`.
- Produces: `generate.js` flags `--par N` (keep only candidates whose optimum is N) and `--length N` (board length exactly N). The `reserved` preset gains `want: m => m.gains.reserved <= -1`.

- [ ] **Step 1: Write the failing test**

```js
for (const id of ['scattered-gaps', 'blocked-lanes', 'pocket-change']) {
  const level = require('../levels.js').levels.find(l => l.id === id);
  const freed = E.solve(without.reserved(level)).cost;
  assert.ok(freed < level.par, `${id}: freeing the reserved sectors must lower par (freed ${freed}, par ${level.par})`);
}
```

- [ ] **Step 2: Run to verify it fails** — FAIL for all three.

- [ ] **Step 3: Promote the rule**

In `check-levels.js`, `matters.reserved = (level, par) => optimum(without.reserved(level)) < par`. If `optimum` throws "search too large to check", record a warning, not a problem (`across-the-disk`, `broken-workspace`, `split-workspace` hit that today). `homes` stays soft.

- [ ] **Step 4: Rework the three boards with the generator**

Keep each `id`, `name`, `mechanic: 'reserved'` and `par`. Keep the board length within ±2 of today and keep homes on two or three files.

| Level | Today | Constraint |
| --- | --- | --- |
| `scattered-gaps` | par 3, 24 sectors | Allocation chapter: no split needed. |
| `blocked-lanes` | par 4, 13 sectors | Move order chapter: no split needed; trap rate ≥ .5. |
| `pocket-change` | par 4, 20 sectors | Extra. |

Run e.g. `node tools/generate.js reserved --par 4 --length 13 --count 20`. Pick the candidate with the highest trap rate, then the fewest lines. If none appears within `--tries 40000` at the same par, accept par ±1 and give the level a new id (`<old-id>-ii`) so old best scores do not carry over; say so in the commit message.

Update goals so they still describe the board. Update the README paragraph: reserved now fails, homes still warns.

- [ ] **Step 5: Run everything**

Run: `node tests/tools.js && node tools/check-levels.js && node tools/badges.js --write badges.js && node tools/check-levels.js --badges && node tests/behavior.js && node tests/play-all.js`
Expected: all pass, and the warning list no longer names these three levels.

- [ ] **Step 6: Commit** — "Make reserved sectors change par in the three decoration levels"

---

### Task 5: Docs, publish, review

**Files:**
- Modify: `docs/campaign-outline.md` (roadmap phase 2 → this plan; "What the campaign does today" gets a one-line "Phase 2 done" note), `README.md` (`levels.js` row mentions `extras` and `summary`)

- [ ] **Step 1:** Update both docs.
- [ ] **Step 2:** Run the full suite once more (command from Task 4 Step 5). Expected: all pass.
- [ ] **Step 3:** Rebuild `scratchpad/game/` (copy js/css, rebuild `index.html` from the `<body>` range) and republish the playable artifact to the same URL.
- [ ] **Step 4:** Commit and push — "Document the phase 2 campaign order".
- [ ] **Step 5:** Fresh-subagent review of the whole branch diff since `34b8990`, against this plan and the spec.
