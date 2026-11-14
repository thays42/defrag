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
  check('hinted clear records best but no star', await get(() => progress.best['find-home'] === 1 && progress.clean['find-home'] === undefined && medal(levelById.get('find-home')) === 'cleared'));

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
  check('clean clear earns star', await get(() => medal(levelById.get('join-two-blocks')) === 'par'));
  await page.evaluate(() => showCatalog());
  check('Levels shows the star', (await page.locator('#levels button', {hasText: 'Join two blocks'}).textContent()).includes('★'));

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
