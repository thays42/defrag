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
  check('arrow keys move focus', await get(() => document.activeElement === ui.board.children[6]));

  // Hints mark the attempt, and a hinted clear earns no star.
  await open('find-home');
  await page.keyboard.press('h');
  await page.waitForFunction(() => hint !== null);
  await page.evaluate(() => perform(hint));
  check('hinted clear records best but no star', await get(() => progress.best['find-home'] === 1 && progress.clean['find-home'] === undefined && stars(levelById.get('find-home')) === 1));

  // Hint use survives leaving and reopening the level.
  await open('tight-fit');
  await page.click('#hint');
  await page.waitForFunction(() => hint !== null);
  await page.evaluate(() => showMenu());
  await open('tight-fit');
  check('hint flag survives reopening', await get(() => hinted === true));

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
  check('menu totals stars out of three per level', /\d+ of \d+ ★/.test(resume) && resume.includes(`of ${await get(() => 3 * campaign.length)} ★`), resume);

  // The daily share text carries the star string.
  const shared = await page.evaluate(async () => { openLevel(dailyLevel()); await shareDaily(); return notice; });
  check('daily share shows stars', /[★☆]{3}/.test(shared), shared);

  // Cracked sectors: a dead end is announced.
  await open('failing-drive');
  await cell(3).click();
  await cell(2).click();
  const dead = await get(() => ({deadEnd, status: ui.status.textContent, solvable: E.solve(level, state).cost !== null}));
  check('dead end matches solver', dead.deadEnd === !dead.solvable, JSON.stringify(dead));

  // Levels screen: grouped by mechanic and sorted by par inside each group.
  await page.evaluate(() => showCatalog());
  const groups = await page.$$eval('#levels section', sections => sections.map(s => ({
    name: s.querySelector('h3').textContent,
    pars: [...s.querySelectorAll('button small')].map(x => Number(x.textContent.match(/(\d+)\s*$/)[1])),
  })));
  check('one group per mechanic', groups.length === 12, groups.map(g => g.name).join(', '));
  check('each group sorted by par', groups.every(g => g.pars.every((p, i) => i === 0 || g.pars[i - 1] <= p)), JSON.stringify(groups));

  // Old index-based saves migrate to ids.
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('defrag-campaign-v2', JSON.stringify({level: 23, best: {0: 1, 23: 9}, sound: true}));
  });
  await page.reload();
  const migrated = await get(() => ({best: progress.best, current: progress.current, sound: progress.sound}));
  check('v2 save migrates', migrated.best['join-two-blocks'] === 1 && migrated.best['tight-fit'] === 9 && migrated.current === 'tight-fit' && migrated.sound, JSON.stringify(migrated));

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
  check('Results button reopens the sheet', await page.locator('#result').isVisible() && await page.locator('#result-open').isHidden());

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
