# Fixed Disk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every level shows the same 6×4 board. The level's sectors sit in one unbroken stretch of it, and a track shows how each row continues into the next.

**Architecture:** The engine stays linear. It stops padding boards to a multiple of 6 and gains `placement(level)`, which says where the board's sectors sit in the 24-sector frame. The UI renders 24 frame slots: partition sectors are `.cell` buttons, the rest are inert `.void` slots. An SVG track behind the cells draws the read path from cell geometry.

**Tech Stack:** Plain browser JavaScript, no build step. Node for tools. Playwright (pre-installed Chromium) for browser tests.

**Spec:** `docs/campaign-outline.md`, section "Principle 1: a fixed disk".

## Global Constraints

- The frame is always 6 columns by 4 rows, 24 sectors. `COLUMNS` stays 6.
- A partition is contiguous. Unallocated sectors sit only before and after it.
- Default placement: one-row puzzles in row 2, centered horizontally (left-biased when the gap is odd). Two-row puzzles in rows 2–3. Three- and four-row puzzles start in row 1.
- A level may set `offset`: the number of unallocated sectors before the partition. It overrides the default.
- Unallocated sectors are never destinations, never focusable, never count as free space, and look different from reserved sectors (faint dashed outline, no fill).
- Level data keeps 1-based sector numbers relative to the board, not the frame. No level data changes in this plan.
- The board's on-screen size must not change between levels. The user's rule: UI must not jitter.
- Every par and badge target stays the same.
- UI copy follows the README's style: short sentences, active voice.

## Review Focus

- **Saved attempts from before this change.** Their cells carry the old reserved padding. Opening such a level must start fresh, not render a broken board. Test in Task 2.
- **Landscape side-sheet layout.** The board must also keep one size across levels at 844×390. Test in Task 3.
- **The daily puzzle.** It uses the same frame and placement as campaign levels. Test in Task 3.
- **Arrow keys at a partition edge.** Up or Down onto an unallocated slot leaves focus where it is. It does not jump to the last cell. Test in Task 3.
- **Cracked sectors that fail.** A failed sector becomes reserved but stays a `.cell`. The slot count never changes. Test in Task 3.

---

### Task 1: Engine placement and no padding

**Files:**
- Modify: `engine.js:6` (constants), `engine.js:36-46` (`initialState`), `engine.js:266` (exports)
- Modify: `tools/check-levels.js:70-77` (validation)
- Modify: `README.md` (Mechanics table)
- Test: `tests/tools.js`

**Interfaces:**
- Produces: `E.FRAME_ROWS = 4`, `E.FRAME = 24`, `E.placement(level) -> {offset: number, length: number}`. `E.initialState(level).cells.length` equals `E.parseBoard(level.board).length`.

- [ ] **Step 1: Write the failing tests** at the end of `tests/tools.js`

```js
// Placement in the fixed 24-sector frame.
const at = (board, extra) => E.placement({board, ...extra});
assert.deepStrictEqual(at('A.A'), {offset: 7, length: 3});      // row 2, centered
assert.deepStrictEqual(at('AB'), {offset: 8, length: 2});
assert.deepStrictEqual(at('A.A.'), {offset: 7, length: 4});
assert.deepStrictEqual(at('AA.AA'), {offset: 6, length: 5});    // odd gap leans left
assert.deepStrictEqual(at('AA..AA'), {offset: 6, length: 6});
assert.deepStrictEqual(at('A2.A1.'), {offset: 7, length: 4}); // a fragment digit is not a sector
assert.deepStrictEqual(at('A.AAAAAA'), {offset: 6, length: 8});  // two rows: rows 2–3
assert.deepStrictEqual(at('A.AAACCC.BBBDD'), {offset: 0, length: 14}); // three rows start in row 1
assert.deepStrictEqual(at('.#B#...BB######A#AABA.##'), {offset: 0, length: 24});
assert.deepStrictEqual(at('A.AA..', {offset: 9}), {offset: 9, length: 6});
// Boards are no longer padded.
assert.strictEqual(E.initialState({board: 'A.A'}).cells.length, 3);
assert.strictEqual(E.initialState({board: 'A.AAACCC.BBBDD'}).cells.length, 14);
```

- [ ] **Step 2: Run to verify failure**

Run: `node tests/tools.js`
Expected: FAIL with `E.placement is not a function`.

- [ ] **Step 3: Implement**

In `engine.js`: add `const FRAME_ROWS = 4; const FRAME = COLUMNS * FRAME_ROWS;`. Delete the padding loop in `initialState`. Add `placement(level)`:

```js
function placement(level) {
  const length = parseBoard(level.board).length;
  if (Number.isInteger(level.offset)) return {offset: level.offset, length};
  const rows = Math.ceil(length / COLUMNS);
  const startRow = Math.floor((FRAME_ROWS - rows) / 2);
  return {offset: startRow * COLUMNS + (rows === 1 ? Math.floor((COLUMNS - length) / 2) : 0), length};
}
```

Export `FRAME_ROWS`, `FRAME`, `placement`.

In `tools/check-levels.js`, in the per-level loop, fail when the board does not fit:
`const {offset, length} = E.placement(level); if (offset < 0 || offset + length > E.FRAME) fail(\`board does not fit the ${E.FRAME}-sector frame at offset ${offset}\`);`
Also fail when `level.offset` is set but is not a non-negative integer.

In `README.md`, add a row to the Mechanics table: `| \`offset: 9\` | Nine unallocated sectors come before the board in the 6×4 frame. Without it, the board is centered. |`. Under the table, add one sentence: "Every board sits in a fixed 6×4 frame of 24 sectors. Sectors outside the board are unallocated."

- [ ] **Step 4: Verify**

Run: `node tests/tools.js && node tools/check-levels.js && node tools/check-levels.js --badges`
Expected: no assertion errors. Checker prints `All 115 levels pass.` and badge targets verify unchanged.

Run: `node -e "const E=require('./engine.js');console.log(E.placement({board:'A'.repeat(20),offset:6}))"` then confirm a temporary level with that board and offset makes the checker fail with "does not fit". Revert the temporary level.

- [ ] **Step 5: Commit**

```bash
git add engine.js tools/check-levels.js README.md tests/tools.js
git commit -m "Place boards in a fixed 24-sector frame; stop padding"
```

---

### Task 2: Drop saved attempts from the padded format

**Files:**
- Modify: `game.js:135-140` (`start`)
- Test: `tests/behavior.js`

**Interfaces:**
- Consumes: `E.initialState(level)` from Task 1 (unpadded).

- [ ] **Step 1: Write the failing test** in `tests/behavior.js`, before `check('no page errors', …)`

```js
// An attempt saved with the old reserved padding starts fresh.
await get(() => {
  const target = findLevel('tight-fit');
  const padded = [...E.parseBoard(target.board), '#', '#', '#', '#'];
  progress.attempts['tight-fit'] = {signature: signature(target), state: {cells: padded, clip: null, wear: null, nudges: 0}, stats: {moves: 3, splits: 0, cost: 3, travel: 0}, history: []};
});
await open('tight-fit');
check('padded saved attempt starts fresh', await get(() => state.cells.length === 14 && stats.moves === 0));
```

- [ ] **Step 2: Run to verify failure**

Run: `node tests/behavior.js`
Expected: `FAIL padded saved attempt starts fresh`.

- [ ] **Step 3: Implement**

In `start`, an attempt is usable only when its signature matches and `attempt.state.cells.length === E.parseBoard(target.board).length`.

- [ ] **Step 4: Verify**

Run: `node tests/behavior.js`
Expected: every line `ok`.

- [ ] **Step 5: Commit**

```bash
git add game.js tests/behavior.js
git commit -m "Start fresh when a saved attempt has the old board padding"
```

---

### Task 3: Render the 24-sector frame

**Files:**
- Modify: `game.js` — `buildBoard` (~426), `moveFocus` (~451), `renderBoard` (~601), `animateMove` (~693); add `ui.cells`
- Modify: `console.css` — add `.void`; `.board` rules
- Test: `tests/behavior.js`

**Interfaces:**
- Consumes: `E.placement(level)`, `E.FRAME` from Task 1.
- Produces: `ui.cells` — array of the partition's `.cell` buttons, index equal to state index. `frameOffset` — module-level number set in `buildBoard`. Every former use of `ui.board.children` as a cell list uses `ui.cells`.

- [ ] **Step 1: Write the failing tests** in `tests/behavior.js`

```js
// Every level shows the same 24-slot frame.
const slots = () => get(() => ({all: ui.board.querySelectorAll(':scope > .cell, :scope > .void').length, cells: ui.board.querySelectorAll(':scope > .cell').length, first: [...ui.board.querySelectorAll(':scope > .cell, :scope > .void')].findIndex(n => n.classList.contains('cell'))}));
for (const [id, length, first] of [['join-two-blocks', 3, 7], ['tight-fit', 14, 0], ['split-workspace', 24, 0]]) {
  await open(id);
  const s = await slots();
  check(`${id} fills the frame`, s.all === 24 && s.cells === length && s.first === first, JSON.stringify(s));
}
await get(() => openLevel(dailyLevel()));
check('daily puzzle fills the frame', (await slots()).all === 24);

// The board keeps one size across levels, in portrait and in landscape.
for (const size of [{width: 420, height: 900}, {width: 844, height: 390}]) {
  await page.setViewportSize(size);
  const rects = [];
  for (const id of ['join-two-blocks', 'warm-up', 'split-workspace']) {
    await open(id);
    rects.push(await get(() => { const r = ui.board.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); }));
  }
  check(`board size is fixed at ${size.width}×${size.height}`, new Set(rects).size === 1, rects.join(' | '));
}
await page.setViewportSize({width: 420, height: 900});

// Unallocated slots do nothing.
await open('join-two-blocks');
await cell(0).click();
await page.locator('.board > .void').first().click({force: true});
check('tapping an unallocated slot makes no move', await get(() => stats.moves === 0));

// Up/Down onto an unallocated slot keeps focus in place.
await cell(0).focus();
await page.keyboard.press('ArrowDown');
check('ArrowDown off the partition keeps focus', await get(() => document.activeElement === ui.cells[0]));

// Row wrap follows the frame column, not the board index.
await get(() => openLevel({id: 'test-wrap', mechanic: 'basics', chapter: 'Test', name: 'Wrap', goal: '', par: 1, board: 'A.AA..', offset: 9}));
check('wrap marks use the frame column', await get(() => ui.cells[2].classList.contains('wrap-out') && ui.cells[3].classList.contains('wrap-in')));

// A failed cracked sector stays a cell.
await open('cracked');
await get(() => { for (const move of E.solve(level).path) perform(move); });
check('failed cracked sector keeps the frame', (await slots()).all === 24 && (await slots()).cells === 4);
```

If `openLevel` fails on the ad-hoc `test-wrap` level because a lookup expects a campaign id, push the level into `campaign` inside the same `evaluate` first. Change the existing arrow-key check to `document.activeElement === ui.cells[6]`.

- [ ] **Step 2: Run to verify failure**

Run: `node tests/behavior.js`
Expected: FAIL on the frame, size, unallocated, focus, and wrap checks.

- [ ] **Step 3: Implement**

`buildBoard`: read `{offset}` from `E.placement(level)` into `frameOffset`. For frame index `f` from 0 to `E.FRAME - 1`, append a `.cell` button (built as today, with state index `f - frameOffset`) when `f` is inside the partition. Otherwise append `<div class="void" aria-hidden="true">` with no handlers. Collect the buttons into `ui.cells`.

`renderBoard`: guard on `ui.cells.length !== cells.length`, iterate `ui.cells`, and compute `column = (frameOffset + index) % E.COLUMNS`.

`moveFocus`: Left, Right, Home, End clamp as today. For Up and Down, do nothing when `index ± COLUMNS` falls outside `0 … cells.length - 1`. Use `ui.cells`.

`animateMove`: use `ui.cells`.

CSS: `.void` matches `.cell` sizing (`aspect-ratio: 1; max-height: 60px; min-width: 0; border-radius: 4px`), with `border: 1px dashed #2e2640; background: transparent; pointer-events: none`.

- [ ] **Step 4: Verify**

Run: `node tests/behavior.js && node tests/play-all.js`
Expected: every line `ok`. `play-all` clears every level at par.

- [ ] **Step 5: Commit**

```bash
git add game.js console.css tests/behavior.js
git commit -m "Render every level in a fixed 6x4 frame"
```

---

### Task 4: Read-path track

**Files:**
- Modify: `game.js` — add `drawTrack()`; call it from `buildBoard`; a `ResizeObserver` on `ui.board`
- Modify: `console.css` — `.track`, `.track-row`, `.track-wrap`, `.live`; widen `.board` side padding
- Test: `tests/behavior.js`

**Interfaces:**
- Consumes: `ui.cells`, `frameOffset` from Task 3; the `.void` slots' positions.
- Produces: one `<svg class="track">` inside `.board`, holding 4 `path.track-row` and 3 `path.track-wrap` elements.

- [ ] **Step 1: Write the failing tests** in `tests/behavior.js`

```js
// The track draws every row and every row break. Breaks inside the board are live.
const track = () => get(() => ({rows: ui.board.querySelectorAll('.track-row').length, wraps: ui.board.querySelectorAll('.track-wrap').length, live: ui.board.querySelectorAll('.track-wrap.live').length}));
await open('warm-up'); // 17 sectors at offset 0: breaks after sectors 6 and 12 are inside
check('track on warm-up', JSON.stringify(await track()) === JSON.stringify({rows: 4, wraps: 3, live: 2}), JSON.stringify(await track()));
await open('join-two-blocks');
check('track on a one-row board has no live break', (await track()).live === 0);
// The track follows the board when the viewport changes.
await open('warm-up');
const before = await get(() => ui.board.querySelector('.track-wrap').getAttribute('d'));
await page.setViewportSize({width: 360, height: 800});
await page.waitForFunction(old => ui.board.querySelector('.track-wrap').getAttribute('d') !== old, before);
check('track redraws on resize', true);
await page.setViewportSize({width: 420, height: 900});
```

- [ ] **Step 2: Run to verify failure**

Run: `node tests/behavior.js`
Expected: FAIL on the track checks.

- [ ] **Step 3: Implement `drawTrack()` in `game.js`**

Measure every frame slot (cells and voids) relative to `ui.board`. Build the paths in board pixel coordinates:
- `track-row` r: a horizontal line through the row's center, from the left gutter to the right gutter. It is `live` when any partition sector is in the row.
- `track-wrap` r (r = 0…2): from the right gutter at row r's center, down to the middle of the gap below row r, left to the left gutter, then down to row r+1's center. It is `live` when frame sectors `6r + 5` and `6r + 6` (0-based) are both in the partition.

The gutters are the middle of the board's side padding. Rebuild the SVG in `buildBoard` and from a `ResizeObserver` on `ui.board`.

CSS: `.track { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }`. Give `.cell` and `.void` `z-index: 1`. Paths have `fill: none; stroke-width: 2; stroke: #2a2040`. `.live` uses `stroke: var(--arcade); stroke-opacity: .45`. Set `.board` `padding-inline` to 12px, and 8px under the existing `max-width: 355px` rule. Keep the `wrap-in` / `wrap-out` glyphs on runs.

- [ ] **Step 4: Verify**

Run: `node tests/behavior.js && node tests/play-all.js`
Expected: every line `ok`.

Take review screenshots of `join-two-blocks`, `warm-up` and `split-workspace` at 420×900, and of `warm-up` at 844×390, at `deviceScaleFactor: 2`. Save them to the scratchpad and send them to the user. Confirm by eye that the track is visible in the gaps and gutters, and that cells cover it.

- [ ] **Step 5: Commit**

```bash
git add game.js console.css tests/behavior.js
git commit -m "Draw the read path between rows"
```
