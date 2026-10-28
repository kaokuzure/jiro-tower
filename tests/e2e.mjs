import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPhase(page, phase, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const p = await page.evaluate(() => window.__jiroGame?.phase ?? 'none');
    if (p === phase) return true;
    await sleep(100);
  }
  return false;
}

async function waitForAnyPhase(page, phases, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const p = await page.evaluate(() => window.__jiroGame?.phase ?? 'none');
    if (phases.includes(p)) return p;
    await sleep(100);
  }
  return null;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 420, height: 860 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
};

try {
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });

  check('game instance exposed', await page.evaluate(() => !!window.__jiroGame));
  check(
    'initial phase = aiming (assets loaded)',
    await waitForPhase(page, 'aiming', 15000),
  );

  await page.screenshot({ path: 'test-shots/01-initial.png' });

  // --- 左右移動・回転（キーボード） ---
  const x0 = await page.evaluate(() => window.__jiroGame.aimX);
  await page.keyboard.down('ArrowLeft');
  await sleep(400);
  await page.keyboard.up('ArrowLeft');
  const x1 = await page.evaluate(() => window.__jiroGame.aimX);
  check('ArrowLeft moves aim piece left', x1 < x0);

  await page.keyboard.press('q');
  const a1 = await page.evaluate(() => window.__jiroGame.aimAngle);
  check('q rotates 15deg CCW', Math.abs(a1 + Math.PI / 12) < 1e-6);
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  const a2 = await page.evaluate(() => window.__jiroGame.aimAngle);
  check('e rotates 15deg CW (net +15deg)', Math.abs(a2 - Math.PI / 12) < 1e-6);

  // --- 落下と積み上げ ---
  const dropOnce = async () => {
    await page.click('.btn.drop');
    // クリック処理のラズを避けるため、まず falling へ遷移するのを待つ
    const falling = await waitForPhase(page, 'falling', 2000);
    if (!falling) throw new Error('drop click did not start falling phase');
    const ok = await waitForPhase(page, 'aiming', 8000);
    if (!ok) {
      const s = await page.evaluate(() => {
        const g = window.__jiroGame;
        return {
          phase: g.phase,
          cur: g.current
            ? { x: g.current.position.x, y: g.current.position.y, sp: g.current.speed, an: g.current.angularSpeed, sl: g.current.isSleeping }
            : null,
          pieces: g.pieces.map((b) => ({ x: Math.round(b.position.x), y: Math.round(b.position.y), sp: +b.speed.toFixed(2), an: +b.angularSpeed.toFixed(3), sl: b.isSleeping })),
          aimX: g.aimX,
          aimAngle: g.aimAngle,
        };
      });
      console.log('TIMEOUT STATE:', JSON.stringify(s));
      throw new Error('piece did not settle in 8s');
    }
    await sleep(120);
  };
  for (let i = 0; i < 5; i++) {
    // テストでは角度と位置を直接指定して再現性を確保（2か所の山に積む）
    await page.evaluate((i) => {
      const g = window.__jiroGame;
      g.aimAngle = 0;
      g.aimX = i % 2 === 0 ? 120 : 360;
    }, i);
    await dropOnce();
  }
  const stack = await page.evaluate(() => ({
    pieces: window.__jiroGame.pieces.length,
    height: window.__jiroGame.maxHeight,
    phase: window.__jiroGame.phase,
  }));
  check('5 pieces stacked', stack.pieces === 5);
  check('phase back to aiming', stack.phase === 'aiming');
  check('stacked (no game over)', stack.height >= 0);
  await page.screenshot({ path: 'test-shots/02-stacked.png' });

  // --- 次のジローのプレビュー ---
  check(
    'next preview image shown',
    await page.evaluate(() => !!document.querySelector('.stat.next img')),
  );

  // --- カメラ追従の確認（高さがカメラしきい値を超えるまで積む） ---
  for (let i = 0; i < 12; i++) {
    const st = await page.evaluate(() => window.__jiroGame.phase);
    if (st === 'gameover') break;
    await page.evaluate(() => {
      const g = window.__jiroGame;
      const x = 200 + Math.round(Math.random() * 80);
      g.aimX = x;
    });
    await page.click('.btn.drop');
    const next = await waitForAnyPhase(page, ['aiming', 'gameover'], 9000);
    if (next === 'gameover') break;
    await sleep(120);
  }
  const tall = await page.evaluate(() => ({
    camTop: window.__jiroGame.camTop,
    startedCamTop: window.__jiroGame.startedCamTop,
    phase: window.__jiroGame.phase,
    height: window.__jiroGame.maxHeight,
    pieces: window.__jiroGame.pieces.length,
  }));
  console.log('state after stacking:', JSON.stringify(tall));
  check('camera stayed or moved UP only', tall.camTop <= tall.startedCamTop + 1);
  await page.screenshot({ path: 'test-shots/03-tall.png' });

  // --- 崩壊 → ゲームオーバー ---
  if (tall.phase !== 'gameover') {
    // 同じ場所に集中して落とし、崩壊を誘発
    for (let i = 0; i < 30; i++) {
      const st = await page.evaluate(() => window.__jiroGame.phase);
      if (st === 'gameover') break;
      await page.evaluate(() => {
        window.__jiroGame.aimX = 240;
      });
      await page.click('.btn.drop');
      const next = await waitForAnyPhase(page, ['aiming', 'gameover'], 9000);
      if (next === 'gameover') break;
    }
  }
  const over = await waitForPhase(page, 'gameover', 15000);
  check('game over triggered by collapse', over);
  await page.screenshot({ path: 'test-shots/04-gameover.png' });

  check(
    'game over overlay shown',
    await page.evaluate(() => !!document.querySelector('.go-title')),
  );
  const best = await page.evaluate(() => localStorage.getItem('jiro-tower-best-v1'));
  check('best score saved to localStorage', best !== null && Number(best) > 0);

  // --- リトライ ---
  await page.click('.btn.retry');
  await sleep(300);
  const after = await page.evaluate(() => ({
    phase: window.__jiroGame.phase,
    pieces: window.__jiroGame.pieces.length,
    height: window.__jiroGame.maxHeight,
    best: window.__jiroGame.best,
  }));
  check('retry resets phase to aiming', after.phase === 'aiming');
  check('retry clears pieces', after.pieces === 0);
  check('retry keeps best score', after.best > 0);

  // --- 新しく落としたジローの初回着地はゲームオーバーにならない ---
  await dropOnce();
  check(
    'first ground landing is not game over',
    await page.evaluate(() => window.__jiroGame.phase === 'aiming'),
  );

  check('no page/console errors', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
} finally {
  await browser.close();
}

console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
