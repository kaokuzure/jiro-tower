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

await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
const t0 = Date.now();
while (Date.now() - t0 < 15000) {
  if (await page.evaluate(() => window.__jiroGame?.phase === 'aiming')) break;
  await sleep(200);
}

// フェード延長ピース（jiro_01）の当たり判定と描画の整合を確認:
// jiro_01 を落とし、colliderH < 画像高であること、着地位置が自然であること
const info = await page.evaluate(() => {
  const g = window.__jiroGame;
  const a = g.assets;
  return a.map((x) => ({ w: Math.round(x.width), h: Math.round(x.height), ch: Math.round(x.colliderH) }));
});
const hasFade = info.some((x) => x.h > x.ch);
console.log('asset dims:', JSON.stringify(info));
console.log(hasFade ? 'PASS fade collider present' : 'FAIL no fade collider');

// 3個積んでスクリーンショット
const waitAiming = async (ms) => {
  const s = Date.now();
  while (Date.now() - s < ms) {
    if (await page.evaluate(() => window.__jiroGame.phase === 'aiming')) return true;
    await sleep(150);
  }
  return false;
};
for (let i = 0; i < 3; i++) {
  await waitAiming(15000);
  await page.evaluate((i) => {
    const gm = window.__jiroGame;
    gm.aimAngle = 0;
    gm.aimX = 336 + (i % 2) * 12;
    gm.drop();
  }, i);
  await waitAiming(15000);
}
const stacked = await page.evaluate(() => ({
  pieces: window.__jiroGame.pieces.length,
  lives: window.__jiroGame.lives,
}));
console.log(stacked.pieces === 3 && stacked.lives === 3 ? 'PASS stacking ok' : `FAIL ${JSON.stringify(stacked)}`);
await page.screenshot({ path: 'test-shots/07-natural-pieces.png' });
console.log(errors.length === 0 ? 'PASS no errors' : errors.join('\n'));

await browser.close();
