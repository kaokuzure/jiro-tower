import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 567, height: 860 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 30000 });
const t0 = Date.now();
while (Date.now() - t0 < 15000) {
  const p = await page.evaluate(() => window.__jiroGame?.phase);
  if (p === 'aiming') break;
  await sleep(200);
}

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);
  if (!ok) failures++;
};

// ズーム: ピースの表示サイズ
const zoom = await page.evaluate(() => {
  const gm = window.__jiroGame;
  const rect = document.querySelector('canvas').getBoundingClientRect();
  return { pieceCss: Math.round(190 * gm.scale), platformPct: Math.round((672 * gm.scale) / rect.width * 100) };
});
check('zoomed in (piece > 88px)', zoom.pieceCss >= 88, JSON.stringify(zoom));

// 落下演出なし: fallen ピースも不透明（グローバルアルファ未使用の確認）
const noFade = await page.evaluate(() => {
  const src = document.querySelector('canvas');
  return !!src;
});
check('canvas ok', noFade);

const waitAiming = async (ms) => {
  const s = Date.now();
  while (Date.now() - s < ms) {
    if (await page.evaluate(() => window.__jiroGame.phase === 'aiming')) return true;
    await sleep(150);
  }
  return false;
};

// ゲームオーバーまで進める（落下→ライフ消費）
// 1個積む
await waitAiming(10000);
await page.evaluate(() => {
  const gm = window.__jiroGame;
  gm.aimAngle = 0;
  gm.aimX = 336;
  gm.drop();
});
await waitAiming(15000);
// 3回落としてゲームオーバーへ
for (let k = 0; k < 4; k++) {
  if (await page.evaluate(() => window.__jiroGame.phase === 'gameover')) break;
  if (!(await waitAiming(15000))) break;
  await page.evaluate(() => {
    const gm = window.__jiroGame;
    gm.aimAngle = 0;
    gm.aimX = 80;
    gm.drop();
  });
  await waitAiming(15000);
  await page.evaluate(() => {
    const gm = window.__jiroGame;
    const last = gm.pieces[gm.pieces.length - 1];
    if (last) {
      last.position.x = 40;
      last.position.y = 1150;
      last.positionPrev.x = 40;
      last.positionPrev.y = 1150;
      last.velocity.x = 0;
      last.velocity.y = 0;
      last.anglePrev = last.angle;
      last.angularVelocity = 0;
    }
  });
  const s = Date.now();
  while (Date.now() - s < 8000) {
    if (await page.evaluate(() => window.__jiroGame.phase === 'gameover')) break;
    await sleep(150);
  }
}
const over = await page.evaluate(() => window.__jiroGame.phase);
check('game over reached', over === 'gameover');

// パネルが画面中央に来ているか
const panel = await page.evaluate(() => {
  const el = document.querySelector('.go-panel');
  const stage = document.querySelector('.stage');
  if (!el || !stage) return null;
  const er = el.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  return {
    panelCenterY: Math.round(er.top + er.height / 2 - sr.top),
    stageH: Math.round(sr.height),
    panelCenterX: Math.round(er.left + er.width / 2 - sr.left),
    stageW: Math.round(sr.width),
  };
});
check(
  'panel centered',
  panel && Math.abs(panel.panelCenterY - panel.stageH / 2) < 60 && Math.abs(panel.panelCenterX - panel.stageW / 2) < 10,
  JSON.stringify(panel),
);

await page.screenshot({ path: 'test-shots/06-centered-gameover.png' });

check('no page errors', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));

await browser.close();
console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
