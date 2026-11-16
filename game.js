// Defrag game UI. Rules live in engine.js; level data in levels.js and daily.js.
const E = DefragEngine;
const campaign = chapters.flatMap(({name, levels}) => levels.map(level => ({...level, chapter: name})));
const extraLevels = extras.levels.map(level => ({...level, chapter: extras.name, extra: true}));
const levelById = new Map([...campaign, ...extraLevels].map(level => [level.id, level]));
// Old saves keyed scores by position in the campaign as it stood then. Frozen so reordering chapters never re-credits them.
const LEGACY_IDS = ['join-two-blocks', 'move-a-run', 'split-a-run', 'find-home', 'two-files', 'reserved-intro', 'scattered-gaps', 'warm-up',
  'required-split', 'borrow-a-home', 'park-a-pair', 'choose-what-to-park', 'make-a-parking-spot', 'save-the-gap', 'a-can-wait', 'b-can-wait',
  'required-split-revisited', 'beat-par', 'one-sector-off', 'two-splits', 'four-files', 'free-the-pair', 'trade-places', 'tight-fit',
  'blocked-lanes', 'broken-workspace', 'across-the-disk', 'pocket-change', 'split-workspace', 'cut-across'];
const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
ui.cells = [];
// Cell positions change with the board's size, so the track is redrawn on resize.
new ResizeObserver(() => drawTrack()).observe(ui.board);
const progressKey = 'defrag-progress-v3';


let progress = loadProgress();
let level;
let frameOffset = 0; // unallocated slots before the level's first sector
let state;
let stats;
let history;
let hinted;
let selection = null; // {kind: 'board', range: [first, last]} or {kind: 'clip'}
let anchor = null;
let notice = '';
let hint = null;
let preview = null;
let deadEnd = false;
let motionEffects = [];
let audioContext;
let hintToken = 0;
let result = null; // What a clear changed, for the results sheet. Null when no sheet is due.
let resultTimers = [];
const soundEffects = {move: [330, 494], split: [220, 392], undo: [392, 262], clear: [392, 523, 659, 784],
  star1: [523, 784], star2: [659, 988], star3: [784, 1175], best: [988, 1319, 1568]};

// ---------- Progress ----------

function loadProgress() {
  const fresh = {version: 3, current: campaign[0].id, best: {}, clean: {}, attempts: {}, hinted: {}, badges: {}, sound: false, parExplained: false, hintWarned: false};
  try {
    const saved = JSON.parse(localStorage.getItem(progressKey));
    if (saved?.version === 3) return {...fresh, ...saved, hinted: saved.hinted ?? {}, badges: saved.badges ?? {}};
    // Older saves keyed scores by array position in the first 30 levels.
    const legacy = JSON.parse(localStorage.getItem('defrag-campaign-v2')) ?? shiftV1(JSON.parse(localStorage.getItem('defrag-campaign-v1')));
    if (legacy && Number.isInteger(legacy.level) && legacy.best) {
      const idAt = index => LEGACY_IDS[index];
      for (const [index, score] of Object.entries(legacy.best)) {
        const id = idAt(Number(index));
        if (id) fresh.best[id] = fresh.clean[id] = score;
      }
      fresh.current = idAt(legacy.level) ?? fresh.current;
      fresh.sound = Boolean(legacy.sound);
    }
  } catch {}
  return fresh;
}

function shiftV1(previous) {
  if (!previous) return null;
  // Version 2 inserted two levels before the original sixth puzzle.
  const shift = index => (index < 5 ? index : index + 2);
  return {...previous, level: shift(previous.level), best: Object.fromEntries(Object.entries(previous.best).map(([i, s]) => [shift(Number(i)), s]))};
}

function persist() {
  try { localStorage.setItem(progressKey, JSON.stringify(progress)); } catch {}
}

// 1 star: cleared. 2: cleared without hints. 3: cleared without hints at or under par.
function stars(target) {
  const clean = progress.clean[target.id];
  if (clean != null) return clean <= target.par ? 3 : 2;
  return progress.best[target.id] != null ? 1 : 0;
}

// Optimization badges. Targets come from badges.js, proven by tools/badges.js; the daily puzzle has none.
const badgeRules = {
  tidy: {icon: '▭', name: 'Tidy', text: T => `free space in one stretch, score ${T} or less`, met: (s, st, T) => E.freeSpaceJoined(s) && st.cost <= T},
  unsplit: {icon: '▮', name: 'Unsplit', text: T => `no splits, score ${T} or less`, met: (s, st, T) => st.splits === 0 && st.cost <= T},
  light: {icon: '↝', name: 'Light touch', text: T => `travel ${T} sectors or less`, met: (s, st, T) => st.travel <= T},
  few: {icon: '⁂', name: 'Few moves', text: T => `moves plus splits ${T} or less`, met: (s, st, T) => st.moves + st.splits <= T},
  under: {icon: '✦', name: 'Under par', text: T => `score ${T} or less`, met: (s, st, T) => st.cost <= T},
};

function offeredBadges(target) {
  if (target.daily) return [];
  const pool = (typeof badgePool !== 'undefined' && badgePool[target.id]) || {};
  return Object.keys(badgeRules).filter(id => pool[id] !== undefined).map(id => ({id, target: pool[id]}));
}

function earnedOnClear(target, finalState, finalStats) {
  return offeredBadges(target).filter(({id, target: T}) => badgeRules[id].met(finalState, finalStats, T)).map(({id}) => id);
}

// Badge chips for a level, filled when earned. Shown only once the level has been cleared.
function badgeChips(target, {long = false} = {}) {
  const earned = new Set(progress.badges[target.id] ?? []);
  return offeredBadges(target).map(({id, target: T}) => {
    const rule = badgeRules[id];
    const chip = document.createElement(long ? 'li' : 'span');
    chip.className = 'badge';
    chip.dataset.earned = earned.has(id);
    const label = `${rule.name}: ${rule.text(T)}${earned.has(id) ? ' (earned)' : ''}`;
    if (long) chip.textContent = `${rule.icon} ${rule.name}: ${rule.text(T)} ${earned.has(id) ? '✓' : ''}`.trim();
    else Object.assign(chip, {textContent: rule.icon, title: label, ariaLabel: label});
    return chip;
  });
}

const starText = count => '★'.repeat(count) + '☆'.repeat(3 - count);
const starTotal = () => campaign.reduce((sum, item) => sum + stars(item), 0);

// ---------- Daily puzzle ----------

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dailyLevel() {
  const date = today();
  const day = Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
  const source = dailyPool[day % dailyPool.length];
  return {...source, id: 'daily-' + date, chapter: 'Daily puzzle', name: date, date, daily: true,
    goal: 'A new disk every day. Join each file inside its home.'};
}

// The level after this one on its own path: the main campaign, or the Extra set. Null at the end of either.
function nextLevel(item) {
  const path = item.extra ? extraLevels : campaign;
  const position = path.findIndex(other => other.id === item.id);
  return position < 0 ? null : path[position + 1] ?? null;
}

function nextText(item) {
  if (item.daily) return 'Copy result';
  if (nextLevel(item)) return 'Next puzzle →';
  return item.extra ? 'Back to levels' : 'Finish campaign';
}

function findLevel(id) {
  if (id?.startsWith('daily-')) return dailyLevel().id === id ? dailyLevel() : null;
  return levelById.get(id) ?? null;
}

// ---------- Game state ----------

const emptyStats = () => ({moves: 0, splits: 0, cost: 0, travel: 0});

// Everything that defines a level's rules. A saved attempt is only resumed if this still matches.
function signature(target) {
  const {board, homes, clipboard, cost, consolidate, locked, fragile, links, nudges} = target;
  return JSON.stringify({board, homes, clipboard, cost, consolidate, locked, fragile, links, nudges});
}

function start(target, attempt) {
  stopMotion();
  hideResult();
  level = target;
  // Saves from before the fixed frame padded the board with reserved sectors. They start fresh.
  const usable = attempt && attempt.signature === signature(target) && attempt.state.cells.length === E.parseBoard(target.board).length;
  state = usable ? attempt.state : E.initialState(level);
  // Older saves have no travel count; it starts from 0.
  stats = usable ? {...emptyStats(), ...attempt.stats} : emptyStats();
  history = usable ? attempt.history.map(entry => ({...entry, stats: {...emptyStats(), ...entry.stats}})) : [];
  // Hint use is remembered per level until the next clear, so leaving and coming back does not erase it.
  hinted = Boolean(progress.hinted[level.id]);
  if (!level.daily) progress.current = level.id;
  buildBoard();
  clearSelection();
  checkDeadEnd();
  save();
  render();
}

function openLevel(target) {
  start(target, progress.attempts[target.id]);
  showScreen('game', ui.board.querySelector('[tabindex="0"]'));
}

function save() {
  if (history.length && !E.solved(level, state)) {
    progress.attempts[level.id] = {signature: signature(level), state, stats, history};
  } else {
    delete progress.attempts[level.id];
  }
  persist();
}

function clearSelection() {
  selection = null;
  anchor = null;
  notice = '';
  hint = null;
  preview = null;
}

const finished = () => E.solved(level, state);

function selectedRange() {
  return selection?.kind === 'board' ? selection.range : null;
}

function selectedLength() {
  if (selection?.kind === 'clip') return state.clip.length;
  const range = selectedRange();
  return range ? range[1] - range[0] + 1 : 0;
}

// The move that lands the current selection at sector `to`, or null.
function moveTo(to) {
  if (!selection || finished()) return null;
  if (selection.kind === 'clip') {
    return E.landing(state, null, state.clip.length, to) ? {type: 'paste', length: state.clip.length, to, cost: 1} : null;
  }
  const [first, last] = selection.range;
  const length = last - first + 1;
  const fit = E.landing(state, first, length, to);
  if (!fit) return null;
  const split = isSplit();
  return {type: 'move', from: first, length, to, split, nudge: fit.nudge, cost: E.moveCost(level, first, to, split)};
}

// What the next move will add to the score, shown before the tap that commits it.
// Seek moves differ by destination, and their marks already show the cost, so they show one only on a preview.
function pendingCost() {
  if (preview) return preview.cost;
  if (!selection || level.cost === 'seek') return null;
  const costs = state.cells.map((_, index) => moveTo(index)?.cost).filter(cost => cost !== undefined);
  return costs.length ? Math.min(...costs) : null;
}

function isSplit() {
  const [first, last] = selection.range;
  const [runFirst, runLast] = E.runAt(state.cells, first);
  return first !== runFirst || last !== runLast;
}

function nudgeMove(direction) {
  const range = selectedRange();
  if (!range || state.nudges <= 0) return null;
  const move = moveTo(range[0] + direction);
  return move?.nudge ? move : null;
}

// The move a tap on sector `index` makes. A nudge is tapped on the empty sector the run
// slides into. If a plain move also starts there, the plain move wins: it spends no nudge.
function moveAt(index) {
  const plain = moveTo(index);
  if (plain && !plain.nudge) return plain;
  const range = selectedRange();
  if (!range) return null;
  if (index === range[0] - 1) return nudgeMove(-1);
  if (index === range[1] + 1) return nudgeMove(1);
  return null;
}

function cutMove() {
  const range = selectedRange();
  if (!level.clipboard || !range || state.clip || finished()) return null;
  const split = isSplit();
  return {type: 'cut', from: range[0], length: range[1] - range[0] + 1, split, cost: 1 + (split ? 1 : 0)};
}

function perform(move) {
  const from = move.type === 'paste' ? null : move.from;
  history.push({state, stats});
  state = E.apply(level, state, move);
  stats = {moves: stats.moves + 1, splits: stats.splits + (move.split ? 1 : 0), cost: stats.cost + move.cost, travel: stats.travel + E.travelOf(move)};
  clearSelection();
  const done = finished();
  if (done) {
    result = {
      previousBest: progress.best[level.id],
      previousBadges: new Set(progress.badges[level.id] ?? []),
      previousTotal: level.daily ? null : starTotal(),
      previousStars: stars(level),
    };
    progress.best[level.id] =Math.min(stats.cost, progress.best[level.id] ?? Infinity);
    if (!hinted) {
      progress.clean[level.id] = Math.min(stats.cost, progress.clean[level.id] ?? Infinity);
      const earned = earnedOnClear(level, state, stats);
      if (earned.length) progress.badges[level.id] = [...new Set([...(progress.badges[level.id] ?? []), ...earned])];
    }
    delete progress.hinted[level.id];
  } else {
    notice = describeMove(move);
  }
  checkDeadEnd();
  save();
  render();
  if (move.type !== 'cut') animateMove(from, move.to, move.length, done);
  playSound(done ? 'clear' : move.split ? 'split' : 'move');
  if (done) showResult();
}

function describeMove(move) {
  const tokens = move.type === 'paste' ? null : state.cells.slice(move.to, move.to + move.length);
  const file = E.letterOf(move.type === 'cut' ? state.clip[0] : tokens[0]);
  const where = `sector${move.length > 1 ? 's' : ''} ${move.to + 1}${move.length > 1 ? '–' + (move.to + move.length) : ''}`;
  if (move.type === 'cut') return `Lifted ${file}. To place it, choose Clipboard, then a destination.`;
  if (move.type === 'paste') return `Placed ${file} from the clipboard in ${where}.`;
  return `${move.nudge ? 'Nudged' : 'Moved'} ${file} to ${where}.`;
}

// Cracked sectors can make a puzzle unwinnable. Say so instead of letting the player flail.
// A search that hits its size limit proves nothing, so it never counts as a dead end.
function checkDeadEnd() {
  if (!level.fragile?.length || finished()) {
    deadEnd = false;
    return;
  }
  const result = E.solve(level, state, {limit: 2e5});
  deadEnd = result.cost === null && !result.aborted;
}

// ---------- Input ----------

function tap(index) {
  if (finished()) return;
  const token = state.cells[index];
  const move = moveAt(index);
  if (move) return perform(move);
  // A hint pre-selects its run. Tapping that run again would start a split, so keep the hint instead.
  const range = selectedRange();
  if (hint && range && index >= range[0] && index <= range[1]) return;
  notice = '';
  hint = null;
  if (E.isFile(token) && token !== E.RESERVED) {
    if (E.info(level).locked.has(E.letterOf(token))) {
      notice = 'System files are locked. Work around them.';
    } else {
      selectAt(index);
    }
  } else if (token === E.RESERVED) {
    clearSelection();
    notice = state.wear?.[index] === 0 ? 'This cracked sector has failed. Nothing can land here.' : 'Reserved sector. Nothing can land here.';
  } else if (selection) {
    // Choosing empty space that is not a destination cancels the selection.
    clearSelection();
    notice = 'Selection cancelled.';
  }
  render();
}

function selectAt(index) {
  const run = E.runAt(state.cells, index);
  const [first, last] = run;
  const range = selectedRange();
  const sameRun = range && range[0] >= first && range[0] <= last;
  if (!sameRun) {
    selection = {kind: 'board', range: run};
    anchor = null;
  } else if (first === last) {
    clearSelection();
  } else if (anchor === null) {
    anchor = index;
    selection = {kind: 'board', range: [index, index]};
  } else if (anchor === index) {
    anchor = null;
    selection = {kind: 'board', range: run};
  } else {
    selection = {kind: 'board', range: [Math.min(anchor, index), Math.max(anchor, index)]};
  }
}

function tapClipboard() {
  if (finished()) return;
  const cut = cutMove();
  if (cut) return perform(cut);
  if (state.clip) {
    if (selection?.kind === 'board') {
      notice = 'The clipboard holds one run. Place it first.';
      render();
      return;
    }
    selection = selection?.kind === 'clip' ? null : {kind: 'clip'};
    anchor = null;
    notice = '';
    hint = null;
  } else {
    notice = 'Select a run on the disk first, then choose Clipboard.';
  }
  render();
}

function undo() {
  if (!history.length) return;
  stopMotion();
  hideResult();
  ({state, stats} = history.pop());
  clearSelection();
  notice = 'Undone.';
  checkDeadEnd();
  save();
  render();
  playSound('undo');
}

function restart() {
  if (!history.length && !selection) return;
  stopMotion();
  hideResult();
  // Restarting is itself undoable.
  if (history.length || stats.moves) history.push({state, stats});
  if (finished()) {
    history = [];
    hinted = false;
  }
  state = E.initialState(level);
  stats = emptyStats();
  clearSelection();
  notice = 'Restarted. Undo brings your moves back.';
  checkDeadEnd();
  save();
  render();
}

// Hints search on the main thread, so the search stops at this many states rather than freeze the page.
// The hardest campaign level needs under 2e5 from its start and after any first move (tests/tools.js).
let hintLimit = 3e5;

async function showHint() {
  if (finished()) return;
  // Say what a hint costs before the first one. A level that already used a hint has nothing left to lose.
  if (!progress.hintWarned && !hinted) {
    progress.hintWarned = true;
    save();
    notice = 'A hint caps this level at one star. Tap Hint again to use one.';
    render();
    return;
  }
  const token = ++hintToken;
  notice = 'Thinking…';
  render();
  const asked = {level, state};
  await new Promise(resolve => setTimeout(resolve, 30));
  // The player may have moved, finished or switched levels while we waited.
  if (token !== hintToken || asked.level !== level || asked.state !== state || finished()) return;
  const result = E.solve(level, state, {limit: hintLimit});
  clearSelection();
  if (result.aborted) {
    notice = 'Too many options to hint from here. Undo a move, or restart.';
    render();
    return;
  }
  if (!result.path) {
    notice = 'No solution from here. Undo or restart.';
    render();
    return;
  }
  hinted = true;
  progress.hinted[level.id] = true;
  const move = result.path[0];
  hint = move;
  if (move.type === 'paste') selection = {kind: 'clip'};
  else selection = {kind: 'board', range: [move.from, move.from + move.length - 1]};
  const file = move.type === 'paste' ? E.letterOf(state.clip[0]) : E.letterOf(state.cells[move.from]);
  const where = to => `sector${move.length > 1 ? 's' : ''} ${to + 1}${move.length > 1 ? '–' + (to + move.length) : ''}`;
  const blocks = move.split ? `${move.length} block${move.length > 1 ? 's' : ''} of ${file}` : file;
  notice = 'Hint: ' + (move.type === 'cut' ? `lift ${blocks} onto the clipboard.` :
    move.type === 'paste' ? `place ${file} from the clipboard in ${where(move.to)}.` :
    move.nudge ? `nudge ${blocks} ${move.to > move.from ? 'right' : 'left'}.` :
    `move ${blocks} to ${where(move.to)}.`) + ` Best finish:\u00a0${stats.cost + result.cost}.`;
  if (move.split) anchor = null;
  save();
  render();
}

// ---------- Rendering ----------

// The board is a fixed frame of 24 slots. The level's sectors fill one unbroken stretch of it.
// ui.cells holds the level's sector buttons, indexed like state.cells. Other slots are unallocated.
function buildBoard() {
  ui.board.replaceChildren();
  frameOffset = E.placement(level).offset;
  ui.cells = [];
  for (let slot = 0; slot < E.FRAME; slot++) {
    const index = slot - frameOffset;
    if (index < 0 || index >= state.cells.length) {
      ui.board.append(Object.assign(document.createElement('div'), {className: 'void', ariaHidden: 'true'}));
      continue;
    }
    const button = document.createElement('button');
    button.className = 'cell';
    button.tabIndex = index === 0 ? 0 : -1;
    button.onclick = () => tap(index);
    // Preview only on mouse hover and keyboard focus. On touch, changing the cell on
    // the first tap makes mobile browsers treat it as a hover and drop the click.
    button.onpointerenter = event => { if (event.pointerType === 'mouse') setPreview(index); };
    button.onpointerleave = event => { if (event.pointerType === 'mouse') setPreview(null); };
    button.onfocus = () => { if (button.matches(':focus-visible')) setPreview(index); };
    button.onblur = () => setPreview(null);
    button.onkeydown = event => moveFocus(event, index);
    ui.board.append(button);
    ui.cells.push(button);
  }
  drawTrack();
}

// The read path: a line through each row, and a link from each row's end to the next row's start.
// It sits behind the cells, so it shows in the gaps and gutters. Links inside the level are live.
function drawTrack() {
  const slots = [...ui.board.querySelectorAll(':scope > .cell, :scope > .void')];
  const box = ui.board.getBoundingClientRect();
  if (slots.length !== E.FRAME || !box.width) return;
  const left = box.left + ui.board.clientLeft;
  const top = box.top + ui.board.clientTop;
  const rects = slots.map(slot => slot.getBoundingClientRect());
  const width = ui.board.clientWidth;
  const leftGutter = (rects[0].left - left) / 2;
  const rightGutter = (rects[E.COLUMNS - 1].right - left + width) / 2;
  const middle = r => rects[r * E.COLUMNS].top - top + rects[r * E.COLUMNS].height / 2;
  const inside = slot => slot >= frameOffset && slot < frameOffset + state.cells.length;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'track');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `0 0 ${width} ${ui.board.clientHeight}`);
  const path = (kind, d, live) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('class', kind + (live ? ' live' : ''));
    line.setAttribute('d', d);
    svg.append(line);
  };
  const center = slot => rects[slot].left - left + rects[slot].width / 2;
  for (let r = 0; r < E.FRAME_ROWS; r++) {
    path('track-row', `M${leftGutter} ${middle(r)}H${rightGutter}`, false);
    // The live part spans only the level's own sectors, out to a gutter where the run continues.
    const own = Array.from({length: E.COLUMNS}, (_, c) => r * E.COLUMNS + c).filter(inside);
    if (!own.length) continue;
    const first = own[0], last = own[own.length - 1];
    const from = first % E.COLUMNS === 0 && inside(first - 1) ? leftGutter : center(first);
    const to = last % E.COLUMNS === E.COLUMNS - 1 && inside(last + 1) ? rightGutter : center(last);
    path('track-run', `M${from} ${middle(r)}H${to}`, true);
  }
  for (let r = 0; r < E.FRAME_ROWS - 1; r++) {
    const end = (r + 1) * E.COLUMNS - 1;
    const gap = (rects[end].bottom + rects[end + 1].top) / 2 - top;
    path('track-wrap', `M${rightGutter} ${middle(r)}V${gap}H${leftGutter}V${middle(r + 1)}`, inside(end) && inside(end + 1));
  }
  ui.board.querySelector(':scope > .track')?.remove();
  ui.board.prepend(svg);
}

function setPreview(index) {
  const move = index === null ? null : moveAt(index);
  const key = move ? move.to : null;
  if ((preview?.to ?? null) === key) return;
  preview = move;
  renderBoard();
}

function moveFocus(event, index) {
  const steps = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -E.COLUMNS, ArrowDown: E.COLUMNS, Home: -index, End: state.cells.length - 1 - index};
  if (!(event.key in steps)) return;
  event.preventDefault();
  const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
  // Up or down onto an unallocated slot stays put.
  if (vertical && (index + steps[event.key] < 0 || index + steps[event.key] >= state.cells.length)) return;
  const next = Math.max(0, Math.min(state.cells.length - 1, index + steps[event.key]));
  const cells = ui.cells;
  cells[index].tabIndex = -1;
  cells[next].tabIndex = 0;
  cells[next].focus();
}

function render() {
  const focused = document.activeElement;
  const done = finished();
  // The header shows the chapter above the level name. The board shows the goal, so its sentence is for screen readers.
  const [section, name] = level.daily ? ['Daily puzzle', level.date] : [level.chapter, level.name];
  // Two lines always: the chapter above, the level name below. Neither wraps or is cut off.
  ui.title.replaceChildren(
    Object.assign(document.createElement('span'), {className: 'title-chapter', textContent: section}),
    Object.assign(document.createElement('span'), {className: 'title-name', textContent: name}));
  ui.title.setAttribute('aria-label', `${section}: ${name}`);
  ui.goal.textContent = level.goal;
  renderRules();
  ui.stats.hidden = false;
  ui.score.textContent = stats.cost;
  const pending = pendingCost();
  ui['score-pending'].hidden = pending === null;
  ui['score-pending'].textContent = pending === null ? '' : `+${pending}`;
  ui['score-pending'].dataset.split = selection?.kind === 'board' && isSplit();
  if (pending === null) ui.score.removeAttribute('aria-label');
  else ui.score.setAttribute('aria-label', `${stats.cost}, next move costs ${pending}`);
  ui.par.textContent = level.par;
  renderCounters();
  ui.next.hidden = !done;
  // Once cleared, the results sheet carries the stars and badges. The button below the board reopens it.
  ui.badges.hidden = true;
  ui['result-open'].hidden = !done || !result;
  // The sheet is drawn over these buttons, so a swipe reveals them. Inert keeps them out of reach until then.
  ui['cleared-actions'].inert = !ui.result.hidden;
  if (done && result) ui['result-open'].textContent = `${starText(hinted ? 1 : stats.cost <= level.par ? 3 : 2)}  Results`;
  ui.next.textContent = nextText(level);
  ui.board.dataset.cleared = done;
  ui.status.dataset.cleared = done;
  ui.status.dataset.warning = deadEnd && !notice;
  ui.status.textContent = notice || (done ? clearMessage() : deadEnd ? 'A cracked sector you still need will fail. This disk can’t be solved. Undo or restart.' : selection ? selectionPrompt() : (stats.moves === 0 && level.prompt) || blocker() || 'Select a file block to pick up its run.');
  ui.undo.disabled = !history.length;
  ui.reset.disabled = !history.length && !selection;
  ui.hint.disabled = done;
  renderClipboard();
  renderNudges();
  renderBoard();
  // A control that just became disabled drops focus to the page. Put it back on the board.
  if (focused?.disabled || (focused === document.body && !ui.game.hidden && ui.game.contains(lastFocus))) {
    ui.board.querySelector('[tabindex="0"]')?.focus();
  }
}

let lastFocus = null;
document.addEventListener('focusin', event => { lastFocus = event.target; });

// Files that meet every rule of their own, including the links they take part in.
function doneFiles() {
  const files = new Set(E.info(level).files.filter(file => E.fileSettled(level, state, file)));
  for (const [before, after] of level.links ?? []) {
    if (!E.linksMet({links: [[before, after]]}, state)) {
      files.delete(before);
      files.delete(after);
    }
  }
  return files;
}

// When nothing else is being said, name what still stands between the player and a clear.
function blocker() {
  if (state.clip) return `To place ${E.letterOf(state.clip[0])}, choose Clipboard, then a destination.`;
  for (const file of E.info(level).movable) {
    const [first, last] = [state.cells.findIndex(t => E.isFile(t) && E.letterOf(t) === file), state.cells.findLastIndex(t => E.isFile(t) && E.letterOf(t) === file)];
    const run = state.cells.slice(first, last + 1);
    const joined = run.length === E.info(level).counts[file] && run.every(t => E.isFile(t) && E.letterOf(t) === file);
    if (joined && run.some((t, i) => t.length > 1 && Number(t.slice(1)) !== i + 1)) return `${file} is joined but out of order. The lowest number goes on the left.`;
    if (joined && level.homes?.[file] && !E.fileSettled(level, state, file)) return `${file} is joined but not home. Move it onto the ${file} sectors.`;
  }
  const settled = E.info(level).movable.every(file => E.fileSettled(level, state, file));
  if (!settled) return null;
  for (const [before, after] of level.links ?? []) {
    if (!E.linksMet({links: [[before, after]]}, state)) return `Every file is joined, but ${after} must start right after ${before}.`;
  }
  if (level.consolidate && !E.freeSpaceJoined(state)) return 'Every file is joined, but the free space is in more than one piece.';
  return null;
}

function clearMessage() {
  // Only the result against par. The title, Next button and score already say the rest.
  const score = stats.cost;
  const earned = hinted ? 1 : score <= level.par ? 3 : 2;
  const versus = score < level.par ? `${level.par - score} under par` : score === level.par ? 'Par met' : `${score - level.par} over par`;
  return `${versus} ${starText(earned)}` + (hinted ? ' · hint used' : '');
}

// Chips for the level's special rules. Stateful chips (links, free space) always show, since they track progress.
// The clipboard button and the nudge counter name their own mechanics.
function renderRules() {
  const chips = [];
  for (const [before, after] of level.links ?? []) {
    chips.push({text: `${before}→${after}`, label: `Link: ${after} must start right after ${before}`, met: E.linksMet({links: [[before, after]]}, state)});
  }
  if (level.consolidate) chips.push({text: 'Free space together', label: 'Free space must be in one stretch', met: E.freeSpaceJoined(state)});
  if (level.cost === 'seek') chips.push({text: 'Seek cost', label: 'Moves cost the distance travelled'});
  if (/[1-9]/.test(level.board)) chips.push({text: 'In number order', label: 'Fragments must finish in number order'});
  if (level.fragile?.length) chips.push({text: 'Cracked sectors', label: 'Cracked sectors fail when emptied'});
  ui.rules.replaceChildren(...chips.map(({text, label, met}) => {
    const chip = Object.assign(document.createElement('span'), {textContent: met ? text + ' ✓' : text});
    if (met !== undefined) chip.dataset.met = met;
    chip.setAttribute('aria-label', label + (met === undefined ? '' : met ? ', met' : ', not met yet'));
    chip.setAttribute('role', 'note');
    return chip;
  }));
  ui.rules.hidden = !chips.length;
}

// Counters beside the score. Each badge that needs one shows its icon, the count and the target,
// and turns coral once the count passes the target. Seek levels without Few moves still count moves and splits,
// since there the score is distance, not moves.
function renderCounters() {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const counters = offeredBadges(level).flatMap(({id, target: T}) => {
    const {icon, name} = badgeRules[id];
    if (id === 'unsplit') return [{text: `${icon} ${plural(stats.splits, 'split')}`, over: stats.splits > 0, label: `${name} badge: ${plural(stats.splits, 'split')}, none allowed`}];
    if (id === 'light') return [{text: `${icon} ${stats.travel}/${T} travel`, over: stats.travel > T, label: `${name} badge: ${stats.travel} of ${T} sectors travelled`}];
    if (id === 'few') return [{text: `${icon} ${stats.moves + stats.splits}/${T} moves+splits`, over: stats.moves + stats.splits > T, label: `${name} badge: ${stats.moves + stats.splits} of ${T} moves plus splits`}];
    return [];
  });
  const parts = counters.map(({text, over, label}) => {
    const part = Object.assign(document.createElement('span'), {textContent: text});
    part.dataset.over = over;
    part.setAttribute('aria-label', label);
    return part;
  });
  if (level.cost === 'seek' && !counters.length) parts.push(document.createTextNode(`${plural(stats.moves, 'move')} · ${plural(stats.splits, 'split')}`));
  ui['stat-detail'].replaceChildren(...parts.flatMap((part, i) => (i ? [document.createTextNode(' · '), part] : [part])));
}

function renderClipboard() {
  ui.clipboard.hidden = !level.clipboard;
  if (!level.clipboard) return;
  const slot = ui['clip-contents'];
  slot.replaceChildren();
  if (state.clip) {
    for (const token of state.clip) slot.append(tile(token));
  } else {
    slot.textContent = 'empty';
  }
  // A full clipboard wears the held file's color, so the waiting run is never out of mind.
  ui.clipboard.classList.toggle('full', Boolean(state.clip));
  if (state.clip) ui.clipboard.dataset.file = E.letterOf(state.clip[0]);
  else delete ui.clipboard.dataset.file;
  ui.clipboard.setAttribute('aria-pressed', selection?.kind === 'clip');
  ui.clipboard.classList.toggle('ready', Boolean(cutMove()));
  ui.clipboard.classList.toggle('hinted', hint?.type === 'cut');
  ui.clipboard.setAttribute('aria-label', 'Clipboard, ' + (state.clip ? 'holding ' + state.clip.join(' ') + '. Press to choose where to place it' : cutMove() ? 'empty. Press to lift the selected run' : 'empty'));
}

function renderNudges() {
  ui.nudges.hidden = !(level.nudges > 0);
  if (ui.nudges.hidden) return;
  ui['nudge-count'].textContent = `Nudges: ${state.nudges}`;
}

function tile(token) {
  const span = document.createElement('span');
  span.className = 'mini';
  span.dataset.file = E.letterOf(token);
  span.textContent = token;
  return span;
}

function renderBoard() {
  const {cells} = state;
  // Rebuilding the board blurs the old focused cell; skip that render.
  if (ui.cells.length !== cells.length) return;
  const homes = Object.entries(level.homes ?? {});
  const settled = doneFiles();
  const range = selectedRange();
  const length = selectedLength();
  const ghostFrom = preview ?? (hint && hint.type !== 'cut' ? hint : null);
  const ghostTokens = ghostFrom && (ghostFrom.type === 'paste' ? state.clip : cells.slice(ghostFrom.from, ghostFrom.from + ghostFrom.length));
  const fragile = new Set(level.fragile ?? []);
  const locked = E.info(level).locked;
  ui.cells.forEach((button, index) => {
    const token = cells[index];
    const reserved = token === E.RESERVED;
    const empty = token === E.EMPTY;
    const file = !reserved && !empty ? E.letterOf(token) : null;
    const failed = reserved && state.wear?.[index] === 0;
    const destination = !reserved && Boolean(length) && Boolean(moveAt(index));
    const selected = Boolean(range) && index >= range[0] && index <= range[1];
    const ghostIndex = ghostFrom ? index - ghostFrom.to : -1;
    const ghost = ghostFrom && ghostIndex >= 0 && ghostIndex < ghostFrom.length ? ghostTokens[ghostIndex] : null;
    const home = homes.find(([, [a, b]]) => index + 1 >= a && index + 1 <= b)?.[0];
    const same = other => file && E.isFile(other ?? '.') && E.letterOf(other) === file;
    const column = (frameOffset + index) % E.COLUMNS;
    button.dataset.file = reserved ? '#' : empty ? '.' : file;
    if (home) button.dataset.home = home;
    else delete button.dataset.home;
    if (ghost) button.dataset.ghost = E.letterOf(ghost);
    else delete button.dataset.ghost;
    button.setAttribute('aria-disabled', reserved);
    button.classList.toggle('destination', destination);
    button.classList.toggle('anchor', anchor === index);
    button.classList.toggle('settled', Boolean(file) && settled.has(file) && !locked.has(file));
    button.classList.toggle('locked', Boolean(file) && locked.has(file));
    button.classList.toggle('cracked', fragile.has(index + 1) && !reserved);
    button.classList.toggle('failed', failed);
    button.classList.toggle('hint-target', Boolean(hint) && hint.type !== 'cut' && ghostIndex >= 0 && ghostIndex < (hint?.length ?? 0) && ghostFrom === hint);
    button.classList.toggle('join-left', same(cells[index - 1]) && column !== 0);
    button.classList.toggle('join-right', same(cells[index + 1]) && column !== E.COLUMNS - 1);
    button.classList.toggle('wrap-in', same(cells[index - 1]) && column === 0);
    button.classList.toggle('wrap-out', same(cells[index + 1]) && column === E.COLUMNS - 1);
    button.setAttribute('aria-pressed', selected);
    const landing = destination ? moveAt(index) : null;
    // A nudge shows its direction. In seek levels a destination shows what the move would cost.
    const mark = !landing ? '' : landing.nudge ? (landing.to < landing.from ? '←' : '→') : level.cost === 'seek' ? String(landing.cost) : '↓';
    const shown = ghost ?? (empty ? mark : reserved ? (failed ? '✕' : '') : token);
    button.replaceChildren(document.createTextNode(shown[0] ?? ''));
    if (shown.length > 1) button.append(Object.assign(document.createElement('sub'), {textContent: shown.slice(1)}));
    const writes = fragile.has(index + 1) && !reserved ? state.wear[index] : null;
    if (writes !== null) button.append(Object.assign(document.createElement('span'), {className: 'writes', textContent: writes}));
    const parts = [`Sector ${index + 1}`];
    const fills = landing && (landing.length > 1 ? `fills sectors ${landing.to + 1}–${landing.to + landing.length}` : `fills sector ${landing.to + 1}`);
    const kind = landing?.nudge ? `nudge ${landing.to < landing.from ? 'left' : 'right'}, uses 1 of ${state.nudges} nudges` : 'destination';
    parts.push(reserved ? (failed ? 'failed' : 'reserved') : empty ? (landing ? `${kind}, ${fills}, costs ${landing.cost}` : 'empty') : `file ${token}`);
    if (selected) parts.push('selected');
    if (file && locked.has(file)) parts.push('locked');
    if (file && settled.has(file) && !locked.has(file)) parts.push('settled');
    if (home) parts.push(home + ' home');
    if (writes !== null) parts.push(`cracked, ${writes} write${writes === 1 ? '' : 's'} left`);
    if (anchor === index) parts.push('split start');
    button.setAttribute('aria-label', parts.join(', '));
  });
}

// Kept to three short lines at phone width, so the status line never changes height.
function selectionPrompt() {
  const nudgeable = nudgeMove(-1) || nudgeMove(1);
  const hasDestination = state.cells.some((_, index) => moveTo(index) && !moveTo(index).nudge);
  const tools = [cutMove() ? 'lift it with Clipboard' : null, nudgeable ? 'tap an arrow to nudge' : null].filter(Boolean);
  const extra = tools.length ? ', or ' + tools.join(' or ') : '';
  const stuck = tools.length ? tools[0][0].toUpperCase() + tools[0].slice(1) + (tools[1] ? ', or ' + tools[1] : '') + '.' : 'Tap empty space to cancel.';
  if (selection.kind === 'clip') return hasDestination ? 'Choose where to place the clipboard run.' : 'No gap fits the clipboard run yet.';
  if (anchor !== null) {
    return hasDestination
      ? 'Choose a destination, or tap another block to extend the split.'
      : 'No gap fits. Tap another block, or the marked one for the whole run.';
  }
  if (selection.range[0] === selection.range[1]) return hasDestination ? `Choose a destination${extra}.` : `No gap fits. ${stuck}`;
  if (level.tutorial === 'split') return 'Tap an outside block of the run to split it off.';
  return hasDestination
    ? `Choose a destination, or tap a block to split it off (+1)${extra}.`
    : `No gap fits the whole run. Tap a block to split it off (+1)${extra}.`;
}

// ---------- Motion and sound ----------

function stopMotion() {
  for (const effect of motionEffects) effect.cancel();
  motionEffects = [];
}

function animateMove(first, destination, length, done) {
  stopMotion();
  const cells = ui.cells;
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !cells[0]?.animate) return;
  const origin = first === null ? ui.clipboard : null;
  for (let offset = 0; offset < length; offset++) {
    const from = origin ?? cells[first + offset];
    const tileNode = cells[destination + offset];
    const a = from.getBoundingClientRect();
    const b = tileNode.getBoundingClientRect();
    motionEffects.push(tileNode.animate([
      {transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(.94)`, filter: 'brightness(1.22)', zIndex: 2},
      {transform: 'translate(0, 0) scale(1.06)', filter: 'brightness(1.4)', zIndex: 2, offset: 0.78},
      {transform: 'none', filter: 'brightness(1)', zIndex: 2},
    ], {duration: 220, easing: 'cubic-bezier(.18,.68,.24,1)'}));
  }
  if (!done) return;
  cells.forEach((tileNode, index) => {
    if (!E.isFile(state.cells[index])) return;
    motionEffects.push(tileNode.animate([
      {transform: 'translateY(0)', filter: 'brightness(1)'},
      {transform: 'translateY(-5px)', filter: 'brightness(1.4)'},
      {transform: 'translateY(0)', filter: 'brightness(1)'},
    ], {duration: 230, delay: 240 + index * Math.min(24, 360 / cells.length), easing: 'ease-out'}));
  });
}

async function playSound(name) {
  if (!progress.sound) return;
  const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Audio) return;
  try {
    audioContext ??= new Audio();
    if (audioContext.state !== 'running') await audioContext.resume();
    const begin = audioContext.currentTime;
    soundEffects[name].forEach((frequency, index) => {
      const time = begin + index * 0.055;
      const tone = audioContext.createOscillator();
      const volume = audioContext.createGain();
      tone.type = 'triangle';
      tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0.001, time);
      volume.gain.exponentialRampToValueAtTime(0.045, time + 0.012);
      volume.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
      tone.connect(volume).connect(audioContext.destination);
      tone.start(time);
      tone.stop(time + 0.1);
      tone.onended = () => { tone.disconnect(); volume.disconnect(); };
    });
  } catch {}
}

function updateSoundButton() {
  ui.sound.textContent = progress.sound ? 'SFX ON' : 'SFX';
  ui.sound.setAttribute('aria-pressed', Boolean(progress.sound));
}

// ---------- Results sheet ----------

const reducedMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// Native haptics when wrapped as an iOS app (Capacitor), the Vibration API elsewhere, silence otherwise.
function haptic(kind) {
  const native = globalThis.Capacitor?.Plugins?.Haptics;
  try {
    if (native) return kind === 'success' ? native.notification({type: 'SUCCESS'}) : native.impact({style: kind === 'heavy' ? 'HEAVY' : 'LIGHT'});
    navigator.vibrate?.(kind === 'success' ? [12, 60, 18] : 10);
  } catch {}
}

const starIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.4l2.95 6.1 6.65.83-4.9 4.6 1.27 6.62L12 17.3l-5.97 3.25 1.27-6.62-4.9-4.6 6.65-.83z"/></svg>';

// Timeline, in ms after the clear. The sheet waits for the board's clear wave.
const beat = {sheet: 650, star: 950, starGap: 230, tag: 1700, best: 1850, badges: 1950, total: 2150};

function later(ms, action) {
  resultTimers.push(setTimeout(action, ms));
}

function showResult() {
  const score = stats.cost;
  const earned = hinted ? 1 : score <= level.par ? 3 : 2;
  const motion = !reducedMotion();
  const sheet = ui.result;
  const at = (node, ms) => { node.style.setProperty('--delay', `${ms}ms`); return node; };
  const {previousBest, previousBadges, previousTotal, previousStars} = result;
  // Stars are a ladder: each needs the one before it. A missed star says what fell short, and a line
  // under the stars states the rule, so a hinted clear at par never looks like it earned the par star.
  const conditions = [
    'Clear',
    hinted ? 'Hint used' : 'No hints',
    hinted ? 'Par, no hints' : score <= level.par ? 'Par' : 'Over par',
  ];
  ui['result-why'].textContent = hinted
    ? 'A hint caps this clear at one star. Retry without hints for ★★★.'
    : score > level.par ? `Finish in ${level.par} or fewer, without hints, for ★★★.` : '';
  ui['result-why'].hidden = earned === 3;
  at(ui['result-why'], beat.tag);
  // The first sheet defines par once. A level whose par can be beaten says so every time.
  const note = [];
  if (!progress.parExplained) {
    note.push('Par is the best possible score. Lower is better.');
    progress.parExplained = true;
    save();
  }
  if (level.beatable) note.push('Par can be beaten on this level.');
  ui['result-note'].textContent = note.join(' ');
  ui['result-note'].hidden = !note.length;
  at(ui['result-note'], beat.tag);

  sheet.classList.toggle('skip', !motion);
  sheet.style.animation = sheet.style.transform = '';
  sheet.dataset.stars = earned;
  at(sheet, beat.sheet);
  ui['result-kicker'].textContent = level.daily ? `Daily · ${level.date}` : level.name;
  ui['result-title'].textContent = earned === 3 ? 'Optimized' : 'Defragmented';
  ui['result-stars'].replaceChildren(...conditions.map((text, i) => {
    const item = at(document.createElement('li'), beat.star + i * beat.starGap);
    item.dataset.earned = i < earned;
    item.innerHTML = starIcon + (i < earned ? '<i></i>'.repeat(8) : '');
    item.append(Object.assign(document.createElement('span'), {textContent: text}));
    item.setAttribute('aria-label', `${text}: ${i < earned ? 'earned' : 'missed'}`);
    return item;
  }));

  ui['result-par'].textContent = level.par;
  const versus = ui['result-versus'];
  // At par the score row already says it all; the tag only shows a difference.
  versus.textContent = score < level.par ? `${level.par - score} under par` : score === level.par ? '' : `${score - level.par} over par`;
  versus.hidden = score === level.par;
  versus.dataset.tone = score < level.par ? 'under' : score === level.par ? 'par' : 'over';
  at(versus, beat.tag);
  const newBest = previousBest != null && score < previousBest;
  ui['result-best'].hidden = !newBest;
  at(ui['result-best'], beat.best);

  const offered = offeredBadges(level);
  const owned = new Set(progress.badges[level.id] ?? []);
  ui['result-badges'].replaceChildren(...offered.map(({id, target: T}, i) => {
    const rule = badgeRules[id];
    const chip = at(document.createElement('li'), beat.badges + i * 90);
    chip.dataset.earned = owned.has(id);
    chip.dataset.new = owned.has(id) && !previousBadges.has(id);
    chip.textContent = `${rule.icon} ${rule.name}`;
    chip.title = `${rule.name}: ${rule.text(T)}`;
    chip.setAttribute('aria-label', `${rule.name}: ${rule.text(T)}, ${chip.dataset.new === 'true' ? 'new' : owned.has(id) ? 'earned' : 'not earned'}`);
    return chip;
  }));
  ui['result-badges'].hidden = !offered.length;

  const total = ui['result-total'];
  // Extra levels sit outside the campaign total, so the sheet does not show it for them.
  const after = level.daily || level.extra ? null : starTotal();
  const best = previousStars > earned ? `Your best here: ${starText(previousStars)}` : '';
  const totalText = count => [best, after == null ? '' : `★ ${count} of ${3 * campaign.length}`].filter(Boolean).join(' · ');
  total.hidden = !totalText(after);
  at(total, beat.total);

  ui['result-next'].textContent = nextText(level);
  const missingBadge = offered.some(({id}) => !owned.has(id));
  ui['result-retry'].textContent = earned < 3 ? 'Retry for ★★★' : missingBadge ? 'Retry for badges' : 'Replay';

  // Final values first, so a skip or reduced motion only has to stop the timeline.
  const final = () => {
    ui['result-score'].textContent = score;
    total.textContent = totalText(after);
  };
  result.finish = final;
  sheet.hidden = false;
  // A sheet that overflows must scroll, so it gives up vertical swipes there. The landscape side sheet still swipes sideways.
  sheet.style.touchAction = sheet.scrollHeight > sheet.clientHeight ? 'pan-y' : '';
  ui['cleared-actions'].inert = true;
  ui['result-next'].focus({preventScroll: true});
  if (!motion) {
    final();
    haptic('success');
    return;
  }
  ui['result-score'].textContent = 0;
  total.textContent = totalText(previousTotal);
  later(beat.sheet, () => haptic('success'));
  for (let i = 0; i < earned; i++) {
    later(beat.star + i * beat.starGap + 140, () => { playSound(`star${i + 1}`); haptic('light'); });
  }
  const countTime = earned * beat.starGap + 200;
  for (let k = 1; k <= score; k++) later(beat.star + (k * countTime) / score, () => { ui['result-score'].textContent = k; });
  if (newBest) later(beat.best, () => { playSound('best'); haptic('heavy'); });
  for (let count = previousTotal + 1; after != null && count <= after; count++) {
    later(beat.total + (count - previousTotal) * 120, () => { total.textContent = totalText(count); });
  }
  later(beat.total + 600, final);
}

// Any tap or key on the sheet jumps the timeline to its end.
function skipResult() {
  if (ui.result.hidden || ui.result.classList.contains('skip')) return;
  for (const timer of resultTimers) clearTimeout(timer);
  resultTimers = [];
  ui.result.classList.add('skip');
  result?.finish();
}

function hideResult() {
  for (const timer of resultTimers) clearTimeout(timer);
  resultTimers = [];
  result = null;
  ui.result.hidden = true;
}

// ---------- Screens ----------

function showScreen(screen, focusTarget) {
  stopMotion();
  hideResult();
  for (const name of ['menu', 'catalog', 'game', 'ending']) ui[name].hidden = name !== screen;
  focusTarget?.focus();
}

function nextUncleared() {
  return campaign.find(item => progress.best[item.id] == null);
}

function showMenu(moveFocus = true) {
  const cleared = campaign.filter(item => progress.best[item.id] != null).length;
  const resume = nextUncleared() ?? findLevel(progress.current) ?? campaign[0];
  ui.continue.textContent = cleared || Object.keys(progress.attempts).length ? 'Continue' : 'Play';
  // Non-breaking spaces keep each figure whole when the line wraps.
  ui['resume-detail'].textContent = `${resume.name} · ${cleared}/${campaign.length}\u00a0cleared · ${starTotal()}/${3 * campaign.length}\u00a0★`;
  const daily = dailyLevel();
  const dailyStars = stars(daily);
  ui['daily-button'].textContent = 'Daily puzzle' + (dailyStars ? ' · ' + starText(dailyStars) + ' ' + progress.best[daily.id] : '');
  showScreen('menu', moveFocus ? ui.continue : null);
}

// Levels in campaign order, one group per chapter, then the Extra set.
function showCatalog() {
  ui.levels.replaceChildren();
  for (const group of [...chapters, extras]) {
    const members = group.levels.map(({id}) => levelById.get(id));
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    const done = members.filter(item => progress.best[item.id] != null).length;
    heading.textContent = `${group.name} · ${done}/${members.length}`;
    const summary = Object.assign(document.createElement('p'), {className: 'rule', textContent: group.summary});
    section.append(heading, summary);
    for (const item of members) {
      const button = document.createElement('button');
      const name = Object.assign(document.createElement('span'), {textContent: item.name});
      const result = document.createElement('small');
      const earned = stars(item);
      const best = progress.best[item.id];
      result.textContent = earned ? `${starText(earned)} ${best} / par ${item.par}` : progress.attempts[item.id] ? `In progress · par ${item.par}` : `Par ${item.par}`;
      if (item.intro) name.append(Object.assign(document.createElement('em'), {textContent: ' tutorial'}));
      // Badges sit under the score on the right, so long names never push them onto a cut-off line.
      const side = Object.assign(document.createElement('span'), {className: 'side'});
      side.append(result);
      const chips = best != null ? badgeChips(item) : [];
      if (chips.length) {
        const row = Object.assign(document.createElement('span'), {className: 'badges'});
        row.append(...chips);
        side.append(row);
      }
      button.dataset.stars = earned;
      button.append(name, side);
      button.onclick = () => openLevel(item);
      section.append(button);
    }
    ui.levels.append(section);
  }
  ui.levels.scrollTop = 0;
  showScreen('catalog', ui['catalog-back']);
}

function showEnding() {
  const total = starTotal();
  // Finish campaign is reachable with levels still open, for example after new levels are added to a finished campaign.
  const cleared = campaign.filter(item => progress.best[item.id] != null).length;
  const clearedText = cleared === campaign.length ? `all ${campaign.length} levels` : `${cleared} of ${campaign.length} levels`;
  ui['ending-detail'].textContent = `You cleared ${clearedText} and earned ${total} of ${3 * campaign.length} ★. ` +
    (total < 3 * campaign.length ? 'Levels lists every puzzle by chapter, plus an Extra set, so you can chase the stars you missed.' : 'Every star collected. The daily puzzle has a new disk every day.');
  showScreen('ending', ui['ending-levels']);
}

function showHelp() {
  const used = new Set([level?.mechanic]);
  if (level) {
    if (level.homes && Object.keys(level.homes).length) used.add('homes');
    if (state.cells.includes(E.RESERVED)) used.add('reserved');
    if (level.clipboard) used.add('clipboard');
    if (level.cost === 'seek') used.add('seek');
    if (level.consolidate) used.add('consolidate');
    if (level.locked) used.add('system');
    if (level.fragile) used.add('fragile');
    if (level.links) used.add('links');
    if (level.nudges) used.add('nudge');
    if (/[1-9]/.test(level.board)) used.add('ordered');
  }
  const specials = mechanics.filter(m => used.has(m.id) && !['basics', 'splitting'].includes(m.id));
  ui['help-level'].hidden = !specials.length || ui.game.hidden;
  ui['help-rules'].replaceChildren(...specials.map(m => {
    const row = document.createElement('div');
    row.append(Object.assign(document.createElement('dt'), {textContent: m.name}), Object.assign(document.createElement('dd'), {textContent: m.rule}));
    return row;
  }));
  ui['help-dialog'].showModal();
}

async function shareDaily() {
  const text = `Defrag daily ${level.date} · score ${stats.cost} (par ${level.par}) ${starText(hinted ? 1 : stats.cost <= level.par ? 3 : 2)}`;
  try {
    await navigator.clipboard.writeText(text);
    notice = 'Result copied: ' + text;
  } catch {
    notice = text;
  }
  render();
}

// ---------- Wiring ----------

ui.continue.onclick = () => openLevel(nextUncleared() ?? findLevel(progress.current) ?? campaign[0]);
ui['levels-button'].onclick = ui['game-levels'].onclick = ui['ending-levels'].onclick = showCatalog;
ui['daily-button'].onclick = ui['ending-daily'].onclick = () => openLevel(dailyLevel());
ui['game-back'].onclick = ui['catalog-back'].onclick = ui['ending-menu'].onclick = () => showMenu();
ui.next.onclick = () => {
  if (level.daily) return shareDaily();
  const next = nextLevel(level);
  if (next) return openLevel(next);
  return level.extra ? showCatalog() : showEnding();
};
ui['result-next'].onclick = async () => {
  if (level.daily) {
    await shareDaily();
    ui['result-next'].textContent = 'Result copied ✓';
    return;
  }
  ui.next.onclick();
};
ui['result-retry'].onclick = () => {
  restart();
  ui.board.querySelector('[tabindex="0"]')?.focus();
};
function closeResult() {
  skipResult();
  ui.result.hidden = true;
  ui.result.style.transform = '';
  render();
  ui['result-open'].focus();
}
ui['result-close'].onclick = closeResult;

// Swipe the sheet away: down in portrait, left for the landscape side sheet. A short or slow drag snaps back.
const sideSheet = () => Boolean(globalThis.matchMedia?.('(orientation: landscape) and (max-height: 500px) and (min-width: 480px)').matches);
let drag = null;
ui.result.addEventListener('pointerdown', event => {
  if (event.button !== 0 || ui.result.scrollTop > 0) return;
  drag = {id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp, side: sideSheet(), moved: false, offset: 0};
});
ui.result.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  const along = drag.side ? drag.x - event.clientX : event.clientY - drag.y;
  const across = drag.side ? event.clientY - drag.y : event.clientX - drag.x;
  if (!drag.moved) {
    if (Math.abs(along) < 8 || Math.abs(across) > Math.abs(along)) return;
    drag.moved = true;
    // Capturing the pointer also stops the button under the finger from taking the tap.
    ui.result.setPointerCapture(event.pointerId);
    ui.result.style.animation = 'none';
  }
  // Pulling the wrong way gives a little, like a rubber band.
  drag.offset = along > 0 ? along : along / 4;
  drag.speed = along / Math.max(1, event.timeStamp - drag.t);
  ui.result.style.transform = drag.side ? `translateX(${-drag.offset}px)` : `translateY(${drag.offset}px)`;
});
const endDrag = event => {
  if (!drag || event.pointerId !== drag.id) return;
  const {moved, offset, speed, side} = drag;
  drag = null;
  if (!moved) return;
  const size = side ? ui.result.offsetWidth : ui.result.offsetHeight;
  const away = event.type === 'pointerup' && (offset > size * 0.3 || (offset > 30 && speed > 0.5));
  const from = ui.result.style.transform;
  const to = away ? (side ? 'translateX(-105%)' : 'translateY(105%)') : 'none';
  if (reducedMotion() || !ui.result.animate) return away ? closeResult() : (ui.result.style.transform = '');
  ui.result.animate([{transform: from}, {transform: to}], {duration: away ? 180 : 220, easing: away ? 'ease-in' : 'cubic-bezier(.2,.9,.25,1.1)'})
    .finished.then(() => (away ? closeResult() : (ui.result.style.transform = '')), () => {});
  ui.result.style.transform = to === 'none' ? '' : to;
};
ui.result.addEventListener('pointerup', endDrag);
ui.result.addEventListener('pointercancel', endDrag);
ui['result-open'].onclick = () => {
  ui.result.style.animation = ui.result.style.transform = '';
  ui.result.hidden = false;
  ui['cleared-actions'].inert = true;
  ui['result-next'].focus({preventScroll: true});
};
ui.result.addEventListener('pointerdown', skipResult);
ui.undo.onclick = undo;
ui.reset.onclick = restart;
ui.hint.onclick = showHint;
ui.clipboard.onclick = tapClipboard;
const nudge = direction => { const move = nudgeMove(direction); if (move) perform(move); };
ui.help.onclick = ui['game-help'].onclick = showHelp;
ui.sound.onclick = () => {
  progress.sound = !progress.sound;
  persist();
  updateSoundButton();
  if (progress.sound) playSound('move');
};

// Single-key shortcuts work only while focus is on the board, so stray key presses elsewhere do nothing.
document.addEventListener('keydown', event => {
  if (ui.game.hidden || ui['help-dialog'].open || event.metaKey || event.ctrlKey || event.altKey) return;
  if (!ui.result.hidden) {
    if (event.key === 'Escape') ui['result-close'].click();
    else skipResult();
    return;
  }
  if (event.key !== 'Escape' && !ui.board.contains(event.target)) return;
  const actions = {
    z: undo, r: restart, h: showHint, c: tapClipboard, '?': showHelp,
    '[': () => nudge(-1), ']': () => nudge(1),
    Escape: () => { clearSelection(); render(); },
  };
  const action = actions[event.key] ?? actions[event.key.toLowerCase()];
  if (!action || (event.key.toLowerCase() === 'c' && !level.clipboard)) return;
  event.preventDefault();
  action();
});

updateSoundButton();
showMenu(false);
