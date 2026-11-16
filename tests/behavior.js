// Behavior checks for the UI fixes. Run: node tests/behavior.js
const {chromium} = require('playwright');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' · ' + detail}`);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 420, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const open = id => page.evaluate(target => openLevel(findLevel(target)), id);
  const cell = index => page.locator('.cell').nth(index);
  const get = fn => page.evaluate(fn);

  // Tapping empty space cancels a multi-block selection.
  await open('tight-fit');
  await cell(2).click();
  await cell(8).click();
  check('empty tap cancels selection', await get(() => selection === null));
  await cell(2).click();
  await page.keyboard.press('Escape');
  check('Esc cancels selection', await get(() => selection === null));

  // Restart is undoable.
  await cell(0).click();
  await cell(1).click();
  await page.click('#reset');
  check('restart resets the board', await get(() => stats.moves === 0 && state.cells[0] === 'A'));
  await page.click('#undo');
  check('undo reverses a restart', await get(() => stats.moves === 1 && state.cells[1] === 'A'));
  await page.keyboard.press('z');
  check('Z ignored when focus is off the board', await get(() => stats.moves === 1));
  await cell(0).focus();
  await page.keyboard.press('z');
  check('Z undoes with focus on the board', await get(() => stats.moves === 0));

  // Focus is rescued when the focused control becomes disabled.
  await cell(0).click();
  await cell(1).click();
  await page.focus('#undo');
  await page.keyboard.press('Enter');
  check('focus returns to the board when Undo disables', await get(() => ui.board.contains(document.activeElement)));

  // Arrow keys move focus across the board.
  await cell(0).focus();
  await page.keyboard.press('ArrowDown');
  check('arrow keys move focus', await get(() => document.activeElement === ui.cells[6]));

  // Hints mark the attempt, and a hinted clear earns no star.
  await open('find-home');
  await page.keyboard.press('h');
  await page.waitForTimeout(80);
  check('first hint warns instead of hinting', await get(() => hint === null && !hinted && ui.status.textContent === 'A hint caps this level at one star. Tap Hint again to use one.'), await get(() => ui.status.textContent));
  check('warning is remembered', await get(() => progress.hintWarned === true));
  await page.keyboard.press('h');
  await page.waitForFunction(() => hint !== null);
  check('hint text is visible', await get(() => ui.status.textContent.startsWith('Hint:') && getComputedStyle(ui.status).color !== 'rgba(0, 0, 0, 0)'));
  const hintRange = await get(() => [...selection.range]);
  await cell(hintRange[0]).click();
  check('tapping the hinted run keeps the hint instead of starting a split', await get(() => hint !== null && anchor === null));
  await page.evaluate(() => perform(hint));
  check('hinted clear records best but no star', await get(() => progress.best['find-home'] === 1 && progress.clean['find-home'] === undefined && stars(levelById.get('find-home')) === 1));

  // Hint use survives leaving and reopening the level.
  await open('tight-fit');
  await page.click('#hint');
  await page.waitForFunction(() => hint !== null);
  await page.evaluate(() => showMenu());
  await open('tight-fit');
  check('hint flag survives reopening', await get(() => hinted === true));
  // The warning shows once ever, not once per level.
  await open('warm-up');
  await page.click('#hint');
  await page.waitForFunction(() => hint !== null);
  check('second level hints without a warning', await get(() => ui.status.textContent.startsWith('Hint:')));
  // A level that already used a hint has lost its stars, so it never warns.
  await page.evaluate(() => { progress.hintWarned = false; });
  await open('tight-fit');
  await page.click('#hint');
  await page.waitForFunction(() => hint !== null);
  check('an already hinted level does not warn', await get(() => ui.status.textContent.startsWith('Hint:') && progress.hintWarned === false));
  await page.evaluate(() => { progress.hintWarned = true; save(); });

  // A hint search too large to finish stops at its limit and says so, instead of freezing the page.
  check('hint search has a state limit', await get(() => typeof hintLimit === 'number' && hintLimit > 0 && hintLimit <= 3e5));
  await open('cut-across');
  const cappedHint = await page.evaluate(async () => {
    const saved = hintLimit;
    hintLimit = 50;
    await showHint();
    hintLimit = saved;
    return {notice, hint, hinted};
  });
  check('a capped hint explains itself and costs nothing', cappedHint.notice === 'Too many options to hint from here. Undo a move, or restart.' && cappedHint.hint === null && cappedHint.hinted === false, JSON.stringify(cappedHint));

  // A hint that resolves after the level changed is dropped.
  await open('find-home');
  await page.evaluate(() => { showHint(); openLevel(findLevel('two-files')); });
  await page.waitForTimeout(150);
  check('stale hint is dropped', await get(() => level.id === 'two-files' && !hinted && hint === null));
  await open('join-two-blocks');
  const raced = await page.evaluate(async () => { showHint(); tap(0); tap(1); await new Promise(r => setTimeout(r, 150)); return finished(); });
  check('hint racing a finish does not crash', raced && !errors.length, errors.join('; '));

  // A check mark only appears when a file meets all its own rules, links included.
  await open('chained');
  check('no check mark while a link is unmet', await get(() => !document.querySelector('.cell.settled')));

  // A clean clear earns a star that shows in Levels.
  await open('join-two-blocks');
  await cell(0).click();
  await cell(1).click();
  check('clean clear at par earns three stars', await get(() => stars(levelById.get('join-two-blocks')) === 3));
  await page.evaluate(() => showCatalog());
  check('Levels shows three stars', (await page.locator('#levels button', {hasText: 'Join two blocks'}).textContent()).includes('★★★'));

  // Stars come from saved scores: 1 cleared, 2 without hints, 3 without hints at par.
  const starsFor = await page.evaluate(() => {
    const target = levelById.get('tight-fit');
    const saved = {best: {...progress.best}, clean: {...progress.clean}};
    const read = (best, clean) => {
      progress.best[target.id] = best;
      if (clean === undefined) delete progress.clean[target.id]; else progress.clean[target.id] = clean;
      return stars(target);
    };
    const result = [read(undefined, undefined), read(20, undefined), read(12, 12), read(9, 9)];
    delete progress.best[target.id];
    Object.assign(progress, saved);
    return result;
  });
  check('stars: none, hinted, clean, par', JSON.stringify(starsFor) === '[0,1,2,3]', JSON.stringify(starsFor));
  check('starText draws filled and empty stars', await get(() => starText(2) === '★★☆' && starText(0) === '☆☆☆'));
  await page.evaluate(() => showMenu(false));
  const resume = await get(() => ui['resume-detail'].textContent);
  check('menu totals stars out of three per level', resume.includes(`/${await get(() => 3 * campaign.length)}\u00a0★`), resume);

  // The daily share text carries the star string.
  const shared = await page.evaluate(async () => { openLevel(dailyLevel()); await shareDaily(); return notice; });
  check('daily share shows stars', /[★☆]{3}/.test(shared), shared);

  // Cracked sectors: a dead end is announced.
  await open('failing-drive');
  await cell(3).click();
  await cell(2).click();
  const dead = await get(() => ({deadEnd, status: ui.status.textContent, solvable: E.solve(level, state).cost !== null}));
  check('dead end matches solver', dead.deadEnd === !dead.solvable, JSON.stringify(dead));

  // Levels screen: one group per chapter in campaign order, then the Extra set.
  await page.evaluate(() => showCatalog());
  const groups = await page.$$eval('#levels section', sections => sections.map(s => ({
    name: s.querySelector('h3').textContent,
    summary: s.querySelector('.rule')?.textContent,
  })));
  const chapterNames = await get(() => [...chapters.map(c => c.name), 'Extra']);
  check('one group per chapter, then Extra', groups.map(g => g.name.split(' · ')[0]).join('|') === chapterNames.join('|'), groups.map(g => g.name).join(', '));
  check('each group shows its summary', groups.every(g => g.summary));
  const listed = await page.$$eval('#levels section button > span:first-child', spans => spans.map(s => s.firstChild.textContent));
  check('catalog lists levels in campaign order', listed.join('|') === (await get(() => [...campaign, ...extraLevels].map(l => l.name))).join('|'), listed.join('|'));

  // Extra levels chain to each other, then return to Levels. Their stars stay out of the campaign total.
  const solveAndNext = id => page.evaluate(target => { openLevel(levelById.get(target)); for (const m of E.solve(level, state).path) perform(m); ui.next.click(); return {id: level.id, catalog: !ui.catalog.hidden}; }, id);
  check('next on an Extra level opens the next Extra', (await solveAndNext('trade-places')).id === 'broken-workspace');
  check('next on the last Extra opens the catalog', (await solveAndNext('pocket-change')).catalog);
  const extraTotal = await page.evaluate(() => { const saved = {...progress.best}; showMenu(false); const before = ui['resume-detail'].textContent; for (const l of extraLevels) progress.best[l.id] = l.par; showMenu(false); const after = ui['resume-detail'].textContent; progress.best = saved; return {before, after}; });
  check('menu total ignores Extra stars', extraTotal.before === extraTotal.after, JSON.stringify(extraTotal));
  const ending = await page.evaluate(() => { const saved = progress.best; progress.best = {[campaign.at(-1).id]: campaign.at(-1).par}; showEnding(); const text = ui['ending-detail'].textContent; progress.best = saved; return text; });
  check('ending never claims a full clear that is not true', !/cleared all/.test(ending) && ending.includes(`1 of ${await get(() => campaign.length)} levels`), ending);
  check('last Extra says where Next goes', await page.evaluate(() => { openLevel(levelById.get('pocket-change')); for (const m of E.solve(level, state).path) perform(m); return ui.next.textContent === 'Back to levels'; }));

  // Old index-based saves migrate to ids.
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('defrag-campaign-v2', JSON.stringify({level: 23, best: {0: 1, 23: 9}, sound: true}));
  });
  await page.reload();
  const migrated = await get(() => ({best: progress.best, current: progress.current, sound: progress.sound}));
  check('v2 save migrates', migrated.best['join-two-blocks'] === 1 && migrated.best['tight-fit'] === 9 && migrated.current === 'tight-fit' && migrated.sound, JSON.stringify(migrated));
  check('legacy order is frozen', await get(() => LEGACY_IDS.length === 30 && LEGACY_IDS[23] === 'tight-fit' && LEGACY_IDS[2] === 'split-a-run'));
  check('extra levels open by id', await get(() => levelById.get('pocket-change')?.extra === true));
  await get(() => openLevel(levelById.get('long-way-round')));
  check('seek chip shows on seek levels', await get(() => [...ui.rules.children].some(c => c.textContent === 'Seek cost')));
  await get(() => showMenu(false));

  // Continue goes to the first level not yet cleared.
  await page.click('#continue');
  check('continue opens first uncleared level', await get(() => level.id === 'move-a-run'));

  // The page still works with storage blocked.
  const blocked = await browser.newPage();
  await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', {get() { throw new Error('blocked'); }}));
  const blockedErrors = [];
  blocked.on('pageerror', error => blockedErrors.push(error.message));
  await blocked.goto(url);
  await blocked.click('#continue');
  check('works without storage', !blockedErrors.length && await blocked.evaluate(() => level.id === 'join-two-blocks'), blockedErrors.join('; '));

  // ---------- Badges ----------
  // Play the optimal line from here. `rank` picks a two-cost ordering: 'travel' (light touch) or 'ops' (few moves).
  const play = (options = {}) => page.evaluate(({rank, ...opts}) => {
    const prices = {travel: m => E.travelOf(m) * 64 + m.cost, ops: m => (1 + (m.split ? 1 : 0)) * 64 + m.cost};
    if (rank) Object.assign(opts, {price: prices[rank], maxCost: 12800, minPrice: 65});
    for (const move of E.solve(level, state, opts).path) perform(move);
  }, options);
  const fresh = async () => { await page.evaluate(() => localStorage.clear()); await page.reload(); };

  // An old v3 save: no badges field, and an attempt whose stats lack travel.
  await fresh();
  await open('free-the-pair');
  await page.evaluate(() => {
    perform(E.solve(level, state).path[0]);
    const saved = JSON.parse(localStorage.getItem(progressKey));
    delete saved.badges;
    delete saved.attempts['free-the-pair'].stats.travel;
    for (const entry of saved.attempts['free-the-pair'].history) delete entry.stats.travel;
    localStorage.setItem(progressKey, JSON.stringify(saved));
  });
  await page.reload();
  await open('free-the-pair');
  await page.evaluate(() => perform(E.solve(level, state).path[0]));
  const old = await get(() => ({travel: stats.travel, moves: stats.moves, badges: progress.badges}));
  check('old save resumes with finite travel', Number.isFinite(old.travel) && old.moves === 2 && JSON.stringify(old.badges) === '{}', JSON.stringify(old));

  // An attempt saved for an older board is discarded; scores and stars stay.
  await page.evaluate(() => {
    progress.best['tight-fit'] = 9;
    progress.clean['tight-fit'] = 9;
    progress.attempts['tight-fit'] = {signature: 'an older board', state: E.initialState({board: 'A.A'}), stats: {moves: 3, splits: 0, cost: 3}, history: []};
    persist();
  });
  await page.reload();
  await open('tight-fit');
  check('stale attempt opens fresh and keeps stars', await get(() => stats.moves === 0 && stars(level) === 3));

  // A qualifying hint-free clear earns the badge.
  await fresh();
  await open('free-the-pair');
  check('badges hidden before the first clear', !(await page.locator('#badges .badge').count()));
  await page.evaluate(() => showCatalog());
  check('Levels row hides badges before the first clear', !(await page.locator('#levels button', {hasText: 'Free the pair'}).locator('.badge').count()));
  await open('free-the-pair');
  await play({whole: true});
  check('unsplit line earns the unsplit badge', await get(() => (progress.badges['free-the-pair'] ?? []).includes('unsplit')));
  check('clear shows the offered badge as earned', await page.locator('#result-badges li[data-earned=true]').count() === 1);
  await page.evaluate(() => showCatalog());
  check('Levels row shows the earned badge', await page.locator('#levels button', {hasText: 'Free the pair'}).locator('.badge[data-earned=true]').count() === 1);

  // A par clear shows the badge it did not earn as outlined.
  await open('one-sector-off');
  await play();
  const outlined = await get(() => ({earned: progress.badges['one-sector-off'] ?? [], shown: [...document.querySelectorAll('#result-badges li')].map(b => b.dataset.earned)}));
  check('par clear earns no trade-off badge', !outlined.earned.length && outlined.shown.length === 2 && outlined.shown.every(e => e === 'false'), JSON.stringify(outlined));

  // A hinted clear earns no badge and one star.
  await fresh();
  await open('free-the-pair');
  await page.click('#hint');
  await page.click('#hint'); // the first press after a fresh save only warns
  await page.waitForFunction(() => hint !== null);
  await play({whole: true});
  check('hinted clear earns no badge', await get(() => !(progress.badges['free-the-pair'] ?? []).length && stars(level) === 1));

  // A level that offers no badges shows none.
  await open('warm-up');
  await play();
  check('no badges on a level without any', await get(() => finished()) && !(await page.locator('#result-badges li').count()) && await page.locator('#result-badges').isHidden());

  // Light touch and few moves track travel and operations.
  await open('head-travel');
  await play({rank: 'ops'});
  check('few-moves line earns few', await get(() => (progress.badges['head-travel'] ?? []).includes('few')));
  await open('driver-stack');
  await play({rank: 'travel'});
  await open('driver-stack');
  const detail = await get(() => ui['stat-detail']?.textContent ?? document.querySelector('.stats')?.textContent);
  check('travel shows on a cleared Light touch level', /\d+ travel/.test(detail), detail);
  await open('driver-stack');
  await play({rank: 'travel'});
  check('light-touch line earns light', await get(() => (progress.badges['driver-stack'] ?? []).includes('light') && stats.travel === badgePool['driver-stack'].light));

  // Tidy and Under par play-throughs.
  await open('choose-what-to-park');
  await page.evaluate(() => { const lv = {...level, consolidate: true}; for (const move of E.solve(lv, state).path) perform(move); });
  check('tidy line earns tidy', await get(() => (progress.badges['choose-what-to-park'] ?? []).includes('tidy') && stats.cost === badgePool['choose-what-to-park'].tidy));
  await open('beat-par');
  await play();
  check('optimal line on a beatable level earns under par', await get(() => (progress.badges['beat-par'] ?? []).includes('under') && stats.cost < level.par));

  // A clear opens the results sheet; any tap skips its timeline; Retry and close dismiss it.
  await open('free-the-pair');
  await page.evaluate(() => { for (const m of E.solve(level).path) perform(m); });
  check('clear opens the results sheet', await page.locator('#result').isVisible());
  check('board buttons wait inert under the sheet', await get(() => !ui.next.hidden && !ui['result-open'].hidden && ui['cleared-actions'].inert));
  await page.locator('#result-stars').click();
  const sheet = await get(() => ({skip: ui.result.classList.contains('skip'), score: ui['result-score'].textContent, earned: [...document.querySelectorAll('#result-stars li')].map(li => li.dataset.earned)}));
  check('tap skips to the final results', sheet.skip && sheet.score === String(await get(() => stats.cost)) && sheet.earned.join() === 'true,true,true', JSON.stringify(sheet));
  await page.click('#result-retry');
  check('retry hides the sheet and restarts', await page.locator('#result').isHidden() && await get(() => stats.moves === 0));
  await page.evaluate(() => { for (const m of E.solve(level).path) perform(m); });
  await page.keyboard.press('Escape');
  check('Esc hides the sheet and keeps the clear', await page.locator('#result').isHidden() && await get(() => finished()));
  await page.evaluate(() => { undo(); for (const m of E.solve(level, state).path) perform(m); });
  await page.click('#result-close');
  check('close reveals the board with Next', await page.locator('#result').isHidden() && await page.locator('#next').isVisible());
  check('cleared board hides the par-met pill and inline badges', await page.locator('#badges').isHidden() && (await page.locator('#status').boundingBox()).height <= 1);
  await page.click('#result-open');
  check('Results button reopens the sheet', await page.locator('#result').isVisible() && await get(() => ui['cleared-actions'].inert));
  const box = await page.locator('#result').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  for (let dy = 10; dy <= 30; dy += 10) await page.mouse.move(box.x + box.width / 2, box.y + 40 + dy);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('a short swipe snaps the sheet back', await page.locator('#result').isVisible());
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  for (let dy = 20; dy <= box.height * 0.6; dy += 20) await page.mouse.move(box.x + box.width / 2, box.y + 40 + dy);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('swiping down dismisses the sheet', await page.locator('#result').isHidden() && await page.locator('#result-open').isVisible() && await get(() => !ui['cleared-actions'].inert));
  await open('two-files');
  await page.evaluate(() => { const extra = E.moves(level, state).at(-1); perform(extra); for (const m of E.solve(level, state).path) perform(m); });
  const missed = await get(() => ({cost: stats.cost, par: level.par, labels: [...document.querySelectorAll('#result-stars li')].map(li => li.dataset.earned + ':' + li.querySelector('span').textContent)}));
  check('a missed par star says over par', missed.labels[2] === 'false:Over par' && missed.cost > missed.par, JSON.stringify(missed));
  await page.click('#result-retry');
  await page.evaluate(() => { hinted = true; for (const m of E.solve(level, state).path) perform(m); });
  const capped = await get(() => ({cost: stats.cost, par: level.par, why: ui['result-why'].textContent, labels: [...document.querySelectorAll('#result-stars li')].map(li => li.dataset.earned + ':' + li.querySelector('span').textContent)}));
  check('a hinted clear at par explains the one-star cap', capped.cost === capped.par && capped.labels.join() === 'true:Clear,false:Hint used,false:Par, no hints' && /hint caps/i.test(capped.why), JSON.stringify(capped));

  // The action buttons never move while playing: the status line has a fixed height.
  const shifts = [];
  for (const id of ['warm-up', 'park-a-pair', 'scattered-gaps-ii', 'no-room-at-all']) {
    await open(id);
    const y = () => get(() => Math.round(ui.hint.getBoundingClientRect().top));
    const start = await y();
    await page.click('#hint');
    await page.waitForFunction(() => hint !== null);
    shifts.push(await y() - start);
    await get(() => { clearSelection(); render(); });
    await cell(await get(() => state.cells.findIndex(t => /[A-R]/.test(t)))).click();
    shifts.push(await y() - start);
    await get(() => perform(E.solve(level, state).path[0]));
    shifts.push(await y() - start);
  }
  check('action buttons stay put through hint, select and move', shifts.every(d => d === 0), JSON.stringify(shifts));

  // An attempt saved with the old reserved padding starts fresh.
  await get(() => {
    const target = findLevel('tight-fit');
    const padded = [...E.parseBoard(target.board), '#', '#', '#', '#'];
    progress.attempts['tight-fit'] = {signature: signature(target), state: {cells: padded, clip: null, wear: null, nudges: 0}, stats: {moves: 3, splits: 0, cost: 3, travel: 0}, history: []};
  });
  await open('tight-fit');
  check('padded saved attempt starts fresh', await get(() => state.cells.length === 14 && stats.moves === 0));

  // Every level shows the same 24-slot frame.
  const slots = () => get(() => {
    const all = [...ui.board.querySelectorAll(':scope > .cell, :scope > .void')];
    return {all: all.length, cells: all.filter(n => n.classList.contains('cell')).length, first: all.findIndex(n => n.classList.contains('cell'))};
  });
  for (const [id, length, first] of [['join-two-blocks', 3, 7], ['tight-fit', 14, 0], ['split-workspace', 24, 0]]) {
    await open(id);
    const s = await slots();
    check(`${id} fills the frame`, s.all === 24 && s.cells === length && s.first === first, JSON.stringify(s));
  }
  await get(() => openLevel(dailyLevel()));
  check('daily puzzle fills the frame', (await slots()).all === 24);

  // The board keeps one size across levels, in portrait and in landscape. (A long title that wraps still moves it down.)
  for (const size of [{width: 420, height: 900}, {width: 844, height: 390}]) {
    await page.setViewportSize(size);
    const rects = [];
    for (const id of ['join-two-blocks', 'warm-up', 'split-workspace']) {
      await open(id);
      rects.push(await get(() => { const r = ui.board.getBoundingClientRect(); return [r.width, r.height].map(Math.round).join(','); }));
    }
    check(`board size is fixed at ${size.width}x${size.height}`, new Set(rects).size === 1, rects.join(' | '));
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
  const cracked = await slots();
  check('failed cracked sector keeps the frame', cracked.all === 24 && cracked.cells === 4, JSON.stringify(cracked));

  // The track draws every row and every row break. Breaks inside the board are live.
  const track = () => get(() => ({rows: ui.board.querySelectorAll('.track-row').length, wraps: ui.board.querySelectorAll('.track-wrap').length, live: ui.board.querySelectorAll('.track-wrap.live').length}));
  await open('warm-up'); // 17 sectors at offset 0: the breaks after sectors 6 and 12 are inside
  const warm = await track();
  check('track on warm-up', JSON.stringify(warm) === JSON.stringify({rows: 4, wraps: 3, live: 2}), JSON.stringify(warm));
  await open('join-two-blocks');
  check('track on a one-row board has no live break', (await track()).live === 0);
  // The track follows the board when the viewport changes.
  await open('warm-up');
  const before = await get(() => ui.board.querySelector('.track-wrap').getAttribute('d'));
  await page.setViewportSize({width: 360, height: 800});
  const redrawn = await page.waitForFunction(old => ui.board.querySelector('.track-wrap').getAttribute('d') !== old, before, {timeout: 3000}).then(() => true, () => false);
  check('track redraws on resize', redrawn);
  await page.setViewportSize({width: 420, height: 900});

  // The clear sweep paints over the cells, not behind them.
  await open('join-two-blocks');
  await get(() => { for (const move of E.solve(level).path) perform(move); });
  const sweep = await get(() => Number(getComputedStyle(ui.board, '::after').zIndex) > Number(getComputedStyle(ui.cells[0]).zIndex));
  check('clear sweep sits above the cells', sweep);

  // The board does not move between levels: same top edge on every level, at three screen sizes.
  for (const size of [{width: 420, height: 900}, {width: 360, height: 640}, {width: 844, height: 390}]) {
    await page.setViewportSize(size);
    const tops = await get(() => {
      const out = {};
      for (const target of [...campaign, ...extraLevels, dailyLevel()]) {
        openLevel(target);
        const top = Math.round(ui.board.getBoundingClientRect().top);
        (out[top] ??= []).push(target.id);
      }
      return out;
    });
    const summary = Object.entries(tops).map(([top, ids]) => `${top}: ${ids.length} (${ids[0]})`).join(' | ');
    check(`board top is fixed at ${size.width}x${size.height}`, Object.keys(tops).length === 1, summary);
  }
  await page.setViewportSize({width: 420, height: 900});
  // Filling the clipboard does not move the board either.
  await open('no-room-at-all');
  const clipTop = () => get(() => Math.round(ui.board.getBoundingClientRect().top));
  const emptyClip = await clipTop();
  await get(() => perform(E.solve(level).path[0]));
  check('a full clipboard keeps the board in place', await get(() => state.clip !== null) && await clipTop() === emptyClip);

  // Undo, Restart and Hint sit at the bottom of the screen, in the same place on every level.
  for (const size of [{width: 420, height: 900}, {width: 360, height: 640}]) {
    await page.setViewportSize(size);
    const placed = await get(() => {
      const tops = new Set();
      for (const target of [...campaign, ...extraLevels, dailyLevel()]) {
        openLevel(target);
        tops.add(Math.round(document.querySelector('.actions').getBoundingClientRect().top));
      }
      const console_ = document.querySelector('.console');
      const inner = console_.getBoundingClientRect().bottom - parseFloat(getComputedStyle(console_).paddingBottom) - console_.clientTop;
      const gap = inner - document.querySelector('.actions').getBoundingClientRect().bottom;
      return {tops: tops.size, gap: Math.round(gap), screenGap: Math.round(innerHeight - console_.getBoundingClientRect().bottom)};
    });
    check(`action row is fixed at the bottom at ${size.width}x${size.height}`, placed.tops === 1 && Math.abs(placed.gap) <= 1 && placed.screenGap <= 24, JSON.stringify(placed));
  }
  await page.setViewportSize({width: 420, height: 900});

  // The title is two whole lines on every level: chapter above, level name below. Nothing is cut off.
  for (const size of [{width: 360, height: 640}, {width: 844, height: 390}]) {
    await page.setViewportSize(size);
    const title = await get(() => {
      const heights = new Set(), cut = [];
      for (const target of [...campaign, ...extraLevels, dailyLevel()]) {
        openLevel(target);
        heights.add(Math.round(ui.title.getBoundingClientRect().height));
        for (const part of ui.title.children) if (part.scrollWidth > part.clientWidth + 1 || part.getBoundingClientRect().right > ui.title.getBoundingClientRect().right + 1) cut.push(target.id);
        if (ui.title.textContent.includes(' / ')) cut.push(target.id + ' (slash)');
      }
      const [chapter, name] = ui.title.children;
      return {heights: heights.size, cut, stacked: chapter.getBoundingClientRect().bottom <= name.getBoundingClientRect().top + 1};
    });
    check(`title is two whole lines at ${size.width}x${size.height}`, title.heights === 1 && !title.cut.length && title.stacked, JSON.stringify(title));
  }
  await page.setViewportSize({width: 420, height: 900});

  // A badge counter names its badge and target, and turns coral once past it.
  await open('choose-what-to-park'); // offers Light touch, travel 8 or less
  check('travel counter shows its badge and target', await get(() => ui['stat-detail'].textContent.trim() === '↝ 0/8 travel' && ui['stat-detail'].querySelector('[data-over]').dataset.over === 'false'),
    await get(() => ui['stat-detail'].textContent));
  await get(() => { stats.travel = 9; render(); });
  check('travel counter turns coral past its target', await get(() => ui['stat-detail'].querySelector('[data-over]').dataset.over === 'true'));
  check('travel counter says what it tracks', await get(() => ui['stat-detail'].querySelector('[data-over]').getAttribute('aria-label') === 'Light touch badge: 9 of 8 sectors travelled'));
  await open('one-sector-off'); // offers Unsplit and Light touch
  check('two counters show side by side', await get(() => ui['stat-detail'].textContent.trim() === '▮ 0 splits · ↝ 0/16 travel'), await get(() => ui['stat-detail'].textContent));
  await open('join-two-blocks'); // offers no badge
  check('no counter without a badge', await get(() => ui['stat-detail'].textContent === ''));

  // ---------- First-time player fixes ----------

  // The first results sheet defines par. Later sheets do not repeat it.
  await fresh();
  await open('join-two-blocks');
  await page.evaluate(() => perform(E.moves(level, state)[0]));
  await page.waitForFunction(() => !ui.result.hidden);
  check('first results sheet defines par', await get(() => !ui['result-note'].hidden && ui['result-note'].textContent === 'Par is the best possible score. Lower is better.'));
  check('par note is remembered', await get(() => progress.parExplained === true));
  await open('move-a-run');
  await page.evaluate(() => { for (const m of E.solve(level, state).path) perform(m); });
  await page.waitForFunction(() => !ui.result.hidden);
  check('later sheets skip the par note', await get(() => ui['result-note'].hidden));
  // A beatable level says so on every sheet.
  await open('beat-par');
  await page.evaluate(() => { for (const m of E.solve(level, state).path) perform(m); });
  await page.waitForFunction(() => !ui.result.hidden);
  check('beatable level says par can be beaten', await get(() => !ui['result-note'].hidden && ui['result-note'].textContent === 'Par can be beaten on this level.'));

  // A joined file outside its home says why it is not done, and looks different from a settled file.
  await open('find-home');
  check('joined but not home is explained', await get(() => blocker() === 'A is joined but not home. Move it onto the A sectors.'), await get(() => String(blocker())));
  const joinedShadow = await get(() => getComputedStyle(ui.cells[1]).boxShadow); // cell 0 may carry the focus ring
  await open('two-files');
  await page.evaluate(() => perform(E.moves(level, state).find(m => m.type === 'move' && m.from === 1 && m.to === 5 && !m.split)));
  const settledShadow = await get(() => (ui.cells[4].classList.contains('settled') ? getComputedStyle(ui.cells[4]).boxShadow : 'not settled'));
  check('settled cells have a ring that joined cells lack', settledShadow !== joinedShadow, `${joinedShadow} / ${settledShadow}`);
  check('a file joined and home gives no home blocker', await get(() => !/not home/.test(String(blocker()))));

  // The score shows what the next move will cost, and a split shows its extra point before it commits.
  await open('find-home');
  await page.evaluate(() => tap(0));
  check('selected run previews +1', await get(() => pendingCost() === 1 && ui['score-pending'].textContent === '+1' && !ui['score-pending'].hidden));
  await page.evaluate(() => tap(1));
  check('pending split previews +2', await get(() => anchor !== null && pendingCost() === 2 && ui['score-pending'].textContent === '+2' && ui['score-pending'].dataset.split === 'true'));
  check('score label states the pending cost', await get(() => ui.score.getAttribute('aria-label') === '0, next move costs 2'));
  await page.evaluate(() => { clearSelection(); render(); });
  check('no selection hides the pending score', await get(() => ui['score-pending'].hidden));
  await open('short-hops'); // seek destinations show their own costs
  await page.evaluate(() => tap(0));
  check('seek level shows no pending score without a preview', await get(() => selection !== null && pendingCost() === null && ui['score-pending'].hidden));
  // A hover preview must not leave a stale number behind on the next full render.
  await page.evaluate(() => { const to = state.cells.findIndex((_, i) => moveAt(i)); setPreview(to); render(); setPreview(null); });
  check('seek preview leaves no stale pending score', await get(() => ui['score-pending'].hidden && !ui.score.hasAttribute('aria-label')));
  await open('required-split');
  await page.evaluate(() => tap(4));
  check('split prompt states the extra point', await get(() => /split it off \(\+1\)/.test(ui.status.textContent)), await get(() => ui.status.textContent));

  // After a lift, the status names the second tap, and the full clipboard stands out.
  await open('no-room-at-all');
  await page.evaluate(() => tap(0));
  await page.click('#clipboard');
  check('lift names the two-step place', await get(() => ui.status.textContent === 'Lifted A. To place it, choose Clipboard, then a destination.'), await get(() => ui.status.textContent));
  check('full clipboard is marked', await get(() => ui.clipboard.classList.contains('full') && ui.clipboard.dataset.file === 'A'));
  check('lift status fits its box', await get(() => ui.status.scrollHeight <= ui.status.clientHeight));
  check('blocker names the clipboard step', await get(() => blocker() === 'To place A, choose Clipboard, then a destination.'));
  await page.evaluate(() => { const place = E.moves(level, state).filter(m => m.type === 'move'); perform(place[0]); perform(E.moves(level, state).find(m => m.type === 'paste')); });
  check('empty clipboard drops the mark', await get(() => !ui.clipboard.classList.contains('full') && !('file' in ui.clipboard.dataset)));

  check('no page errors', !errors.length, errors.join('; '));

  // Touch: one tap selects, one tap moves. A touch never sets a preview.
  const touch = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
  await touch.goto(url);
  await touch.evaluate(() => openLevel(findLevel('tight-fit')));
  const touchCell = index => touch.locator('.cell').nth(index);
  await touchCell(0).tap();
  await touchCell(1).tap();
  check('touch moves on a single tap', await touch.evaluate(() => stats.moves === 1 && preview === null));

  // Mouse hover still previews a destination.
  await open('tight-fit');
  await cell(0).click();
  await cell(1).hover();
  check('mouse hover previews', await get(() => preview?.to === 1));
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
