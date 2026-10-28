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
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
const t0 = Date.now();
while (Date.now() - t0 < 15000) {
  if (await page.evaluate(() => window.__jiroGame?.phase === 'aiming')) break;
  await sleep(200);
}

// 1個積む
await page.evaluate(() => {
  const g = window.__jiroGame;
  g.aimAngle = 0;
  g.aimX = 336;
  g.drop();
});
await sleep(6000);

// 縁に引っかけ、中心を地面より少し下 (570, 閾値580未満) に → ライフは減らない
const l0 = await page.evaluate(() => window.__jiroGame.lives);
await page.evaluate(() => {
  const g = window.__jiroGame;
  const c = g.pieces[0];
  c.position.x = 690;
  c.position.y = 570;
  c.positionPrev.x = 690;
  c.positionPrev.y = 570;
  c.velocity.x = 0;
  c.velocity.y = 0;
});
await sleep(3000);
const l1 = await page.evaluate(() => ({
  lives: window.__jiroGame.lives,
  y: Math.round(window.__jiroGame.pieces[0]?.position.y ?? -1),
  phase: window.__jiroGame.phase,
}));
console.log('hanging above threshold:', l0, '->', JSON.stringify(l1), l1.lives === l0 ? 'PASS' : 'FAIL');

// 滑り落ちて地面より下へ → ちょうど1減る
await page.evaluate(() => {
  const g = window.__jiroGame;
  const c = g.pieces[0];
  c.isSleeping = false; // テレポートでスリープのまま凍結しないよう起こす
  c.sleepThreshold = Infinity;
  c.position.x = 780; // 完全に台地の外へ
  c.position.y = 580;
  c.positionPrev.x = 780;
  c.positionPrev.y = 575;
  c.velocity.x = 2;
  c.velocity.y = 2;
});
await sleep(4000);
const l2 = await page.evaluate(() => ({
  lives: window.__jiroGame.lives,
  pieces: window.__jiroGame.pieces.length,
}));
console.log('after sliding off below ground:', l0, '->', JSON.stringify(l2), l2.lives === l0 - 1 ? 'PASS' : 'FAIL');

await browser.close();
