// Defrag game UI. Rules live in engine.js; level data in levels.js and daily.js.
const E = DefragEngine;
const campaign = chapters.flatMap(({name, levels}) => levels.map(level => ({...level, chapter: name})));
const levelById = new Map(campaign.map(level => [level.id, level]));
const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
const progressKey = 'defrag-progress-v3';


let progress = loadProgress();
let level;
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
const soundEffects = {move: [330, 494], split: [220, 392], undo: [392, 262], clear: [392, 523, 659, 784]};

// ---------- Progress ----------

function loadProgress() {
  const fresh = {version: 3, current: campaign[0].id, best: {}, clean: {}, attempts: {}, hinted: {}, badges: {}, sound: false};
  try {
    const saved = JSON.parse(localStorage.getItem(progressKey));
    if (saved?.version === 3) return {...fresh, ...saved, hinted: saved.hinted ?? {}, badges: saved.badges ?? {}};
    // Older saves keyed scores by array position. The first 30 campaign levels kept their order.
    const legacy = JSON.parse(localStorage.getItem('defrag-campaign-v2')) ?? shiftV1(JSON.parse(localStorage.getItem('defrag-campaign-v1')));
    if (legacy && Number.isInteger(legacy.level) && legacy.best) {
      const idAt = index => (index < 30 ? campaign[index]?.id : undefined);
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
  level = target;
  const usable = attempt && attempt.signature === signature(target);
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
    progress.best[level.id] = Math.min(stats.cost, progress.best[level.id] ?? Infinity);
    if (!hinted) {
      progress.clean[level.id] = Math.min(stats.cost, progress.clean[level.id] ?? Infinity);
      const earned = earnedOnClear(level, state, stats);
      if (earned.length) progress.badges[level.id] = [...new Set([...(progress.badges[level.id] ?? []), ...earned])];
    }
    delete progress.hinted[level.id];
  } else {
    notice = describeMove(move) + ` Score ${stats.cost}.`;
  }
  checkDeadEnd();
  save();
  render();
  if (move.type !== 'cut') animateMove(from, move.to, move.length, done);
  playSound(done ? 'clear' : move.split ? 'split' : 'move');
}

function describeMove(move) {
  const tokens = move.type === 'paste' ? null : state.cells.slice(move.to, move.to + move.length);
  const file = E.letterOf(move.type === 'cut' ? state.clip[0] : tokens[0]);
  const where = `sector${move.length > 1 ? 's' : ''} ${move.to + 1}${move.length > 1 ? '–' + (move.to + move.length) : ''}`;
  if (move.type === 'cut') return `Lifted ${file} onto the clipboard.`;
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
  ({state, stats} = history.pop());
  clearSelection();
  notice = `Undone. Score ${stats.cost}.`;
  checkDeadEnd();
  save();
  render();
  playSound('undo');
}

function restart() {
  if (!history.length && !selection) return;
  stopMotion();
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

async function showHint() {
  if (finished()) return;
  const token = ++hintToken;
  notice = 'Thinking…';
  render();
  const asked = {level, state};
  await new Promise(resolve => setTimeout(resolve, 30));
  // The player may have moved, finished or switched levels while we waited.
  if (token !== hintToken || asked.level !== level || asked.state !== state || finished()) return;
  const result = E.solve(level, state);
  clearSelection();
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
    `move ${blocks} to ${where(move.to)}.`) + ` Best finish from here: ${stats.cost + result.cost}.`;
  if (move.split) anchor = null;
  save();
  render();
}

// ---------- Rendering ----------

function buildBoard() {
  ui.board.replaceChildren();
  state.cells.forEach((_, index) => {
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
  });
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
  const next = Math.max(0, Math.min(state.cells.length - 1, index + steps[event.key]));
  const cells = ui.board.children;
  cells[index].tabIndex = -1;
  cells[next].tabIndex = 0;
  cells[next].focus();
}

function render() {
  const focused = document.activeElement;
  const done = finished();
  const inCampaign = !level.daily;
  const position = campaign.findIndex(item => item.id === level.id);
  ui.chapter.textContent = level.daily ? 'Daily puzzle' : `${level.chapter} · ${position + 1} of ${campaign.length}`;
  ui.title.textContent = level.daily ? 'Daily · ' + level.date : level.name;
  ui.goal.textContent = level.goal;
  renderRules();
  ui.stats.hidden = false;
  ui.score.textContent = stats.cost;
  ui.par.textContent = level.par;
  ui['stat-detail'].textContent = [
    `${stats.moves} move${stats.moves === 1 ? '' : 's'}`,
    `${stats.splits} split${stats.splits === 1 ? '' : 's'}`,
    level.cost === 'seek' ? `${stats.cost - stats.splits} travel` : offeredBadges(level).some(b => b.id === 'light') ? `${stats.travel} travel` : null,
  ].filter(Boolean).join(' · ');
  const last = inCampaign && position === campaign.length - 1;
  ui.next.hidden = !done;
  const chips = done ? badgeChips(level, {long: true}) : [];
  ui.badges.replaceChildren(...chips);
  ui.badges.hidden = !chips.length;
  ui.next.textContent = level.daily ? 'Copy result' : last ? 'Finish campaign' : 'Next puzzle →';
  ui.board.dataset.cleared = done;
  ui.status.dataset.cleared = done;
  ui.status.dataset.warning = deadEnd && !notice;
  ui.status.textContent = notice || (done ? clearMessage() : deadEnd ? 'A cracked sector you still need will fail before you can finish. This disk can no longer be solved. Undo or restart.' : selection ? selectionPrompt() : (stats.moves === 0 && level.prompt) || blocker() || 'Select a file block to pick up its run.');
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
  if (state.clip) return 'Place the clipboard contents to finish.';
  for (const file of E.info(level).movable) {
    const [first, last] = [state.cells.findIndex(t => E.isFile(t) && E.letterOf(t) === file), state.cells.findLastIndex(t => E.isFile(t) && E.letterOf(t) === file)];
    const run = state.cells.slice(first, last + 1);
    const joined = run.length === E.info(level).counts[file] && run.every(t => E.isFile(t) && E.letterOf(t) === file);
    if (joined && run.some((t, i) => t.length > 1 && Number(t.slice(1)) !== i + 1)) return `${file} is joined but out of order. The lowest number goes on the left.`;
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

function renderRules() {
  const chips = [];
  for (const [before, after] of level.links ?? []) {
    chips.push({text: `${before}→${after}`, label: `Link: ${after} must start right after ${before}`, met: E.linksMet({links: [[before, after]]}, state)});
  }
  if (level.consolidate) chips.push({text: 'Free space together', label: 'Free space must be in one stretch', met: E.freeSpaceJoined(state)});
  if (level.cost === 'seek') chips.push({text: 'Seek cost', label: 'Moves cost the distance travelled'});
  if (/[1-9]/.test(level.board)) chips.push({text: 'In number order', label: 'Fragments must finish in number order'});
  if (level.fragile?.length) chips.push({text: 'Cracked sectors', label: 'Cracked sectors fail when emptied'});
  if (level.clipboard) chips.push({text: 'Clipboard', label: 'A clipboard can hold one run'});
  if (level.nudges) chips.push({text: 'Nudges', label: 'Nudges slide a run one sector'});
  ui.rules.replaceChildren(...chips.map(({text, label, met}) => {
    const chip = Object.assign(document.createElement('span'), {textContent: met ? text + ' ✓' : text});
    if (met !== undefined) chip.dataset.met = met;
    chip.setAttribute('aria-label', label + (met === undefined ? '' : met ? ', met' : ', not met yet'));
    chip.setAttribute('role', 'note');
    return chip;
  }));
  ui.rules.hidden = !chips.length;
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
  if (ui.board.children.length !== cells.length) return;
  const homes = Object.entries(level.homes ?? {});
  const settled = doneFiles();
  const range = selectedRange();
  const length = selectedLength();
  const ghostFrom = preview ?? (hint && hint.type !== 'cut' ? hint : null);
  const ghostTokens = ghostFrom && (ghostFrom.type === 'paste' ? state.clip : cells.slice(ghostFrom.from, ghostFrom.from + ghostFrom.length));
  const fragile = new Set(level.fragile ?? []);
  const locked = E.info(level).locked;
  [...ui.board.children].forEach((button, index) => {
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
    const column = index % E.COLUMNS;
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

function selectionPrompt() {
  const nudgeable = nudgeMove(-1) || nudgeMove(1);
  const hasDestination = state.cells.some((_, index) => moveTo(index) && !moveTo(index).nudge);
  const tools = [cutMove() ? 'lift it with Clipboard' : null, nudgeable ? 'tap an arrow to nudge it' : null].filter(Boolean);
  const extra = tools.length ? ', or ' + tools.join(' or ') : '';
  if (selection.kind === 'clip') return hasDestination ? 'Choose a destination to place the clipboard contents.' : 'No empty stretch fits the clipboard contents yet.';
  if (anchor !== null) {
    return hasDestination
      ? 'Choose a destination, or select another block in the run to extend the selection.'
      : 'No empty stretch fits. Select another block to adjust the selection, or the marked block to select the whole run.';
  }
  if (selection.range[0] === selection.range[1]) return hasDestination ? `Choose a highlighted destination${extra}.` : `No empty stretch fits${extra || '. Choose empty space to cancel'}.`;
  if (level.tutorial === 'split') return 'Select an outside block in the selected run to split it off.';
  return hasDestination
    ? `Choose a destination to move the run, or select one of its blocks to split it off${extra}.`
    : `No empty stretch fits the whole run. Select one of its blocks to split it off${extra}.`;
}

// ---------- Motion and sound ----------

function stopMotion() {
  for (const effect of motionEffects) effect.cancel();
  motionEffects = [];
}

function animateMove(first, destination, length, done) {
  stopMotion();
  const cells = [...ui.board.children];
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
    ], {duration: 230, delay: 240 + index * 24, easing: 'ease-out'}));
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

// ---------- Screens ----------

function showScreen(screen, focusTarget) {
  stopMotion();
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
  ui['resume-detail'].textContent = `${resume.name} · ${cleared} of ${campaign.length} cleared · ${starTotal()} of ${3 * campaign.length} ★`;
  const daily = dailyLevel();
  const dailyStars = stars(daily);
  ui['daily-button'].textContent = 'Daily puzzle' + (dailyStars ? ' · ' + starText(dailyStars) + ' ' + progress.best[daily.id] : '');
  showScreen('menu', moveFocus ? ui.continue : null);
}

// Levels grouped by mechanic, easiest (lowest par) first.
function showCatalog() {
  ui.levels.replaceChildren();
  const order = new Map(campaign.map((item, index) => [item.id, index]));
  for (const mechanic of mechanics) {
    const members = campaign.filter(item => item.mechanic === mechanic.id)
      .sort((a, b) => a.par - b.par || Number(Boolean(b.intro)) - Number(Boolean(a.intro)) || order.get(a.id) - order.get(b.id));
    if (!members.length) continue;
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    const done = members.filter(item => progress.best[item.id] != null).length;
    heading.textContent = `${mechanic.name} · ${done}/${members.length}`;
    const rule = Object.assign(document.createElement('p'), {className: 'rule', textContent: mechanic.rule});
    section.append(heading, rule);
    for (const item of members) {
      const button = document.createElement('button');
      const name = Object.assign(document.createElement('span'), {textContent: item.name});
      const result = document.createElement('small');
      const earned = stars(item);
      const best = progress.best[item.id];
      result.textContent = earned ? `${starText(earned)} ${best} / par ${item.par}` : progress.attempts[item.id] ? `In progress · par ${item.par}` : `Par ${item.par}`;
      if (item.intro) name.append(Object.assign(document.createElement('em'), {textContent: ' tutorial'}));
      const chips = best != null ? badgeChips(item) : [];
      if (chips.length) {
        const row = Object.assign(document.createElement('span'), {className: 'badges'});
        row.append(...chips);
        name.append(row);
      }
      button.dataset.stars = earned;
      button.append(name, result);
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
  ui['ending-detail'].textContent = `You cleared all ${campaign.length} levels and earned ${total} of ${3 * campaign.length} ★. ` +
    (total < 3 * campaign.length ? 'Levels lists every puzzle by mechanic, so you can chase the stars you missed.' : 'Every star collected. The daily puzzle has a new disk every day.');
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
  const position = campaign.findIndex(item => item.id === level.id);
  if (position === campaign.length - 1) return showEnding();
  openLevel(campaign[position + 1]);
};
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
