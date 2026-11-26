// End-to-end: play every level's optimal line through real clicks and check it clears at par.
//   node tests/play-all.js   (needs Playwright with Chromium)
const {chromium} = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 420, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  // Every campaign and Extra level, then one daily board from each weekday tier (Monday 2026-11-30 to Sunday 2026-12-06).
  const ids = await page.evaluate(() => [...campaign, ...extraLevels].map(l => l.id));
  const dailies = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'].map(date => 'daily:' + date);
  let failures = 0;
  for (const id of [...ids, ...dailies]) {
    await page.evaluate(target => openLevel(target.startsWith('daily:') ? dailyLevel(target.slice(6)) : findLevel(target)), id);
    // A daily with rules this save has not learned opens the rule card first.
    if (await page.evaluate(() => ui['rules-dialog'].open)) await page.click('#rules-start');
    const plan = await page.evaluate(() => E.solve(level).path);
    for (const move of plan) {
      await page.keyboard.press('Escape');
      const cell = index => page.locator('.cell').nth(index).click();
      if (move.type === 'paste') {
        await page.click('#clipboard');
      } else {
        await cell(move.from);
        if (move.split) {
          await cell(move.from);
          if (move.length > 1) await cell(move.from + move.length - 1);
        }
      }
      if (move.type === 'cut') await page.click('#clipboard');
      else if (move.nudge) await cell(move.to > move.from ? move.to + move.length - 1 : move.to);
      else await cell(move.to);
    }
    const result = await page.evaluate(() => ({done: E.solved(level, state), cost: stats.cost, par: level.par, status: ui.status.textContent}));
    const ok = result.done && result.cost <= result.par;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(26)} cost ${result.cost} par ${result.par}${ok ? '' : ' · ' + result.status}`);
  }
  if (errors.length) console.log('Page errors:\n' + errors.join('\n'));
  await browser.close();
  process.exit(failures || errors.length ? 1 : 0);
})();
