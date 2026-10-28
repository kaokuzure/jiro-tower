import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 420, height: 860 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => console.log('console-' + m.type() + ':', m.text()));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

const start = Date.now();
while (Date.now() - start < 15000) {
  const p = await page.evaluate(() => window.__jiroGame?.phase);
  if (p === 'aiming') break;
  await sleep(150);
}
console.log('phase ready');

const x0 = await page.evaluate(() => window.__jiroGame.aimX);
await page.keyboard.down('ArrowLeft');
await sleep(400);
await page.keyboard.up('ArrowLeft');
const x1 = await page.evaluate(() => window.__jiroGame.aimX);
console.log('aimX', x0, '->', x1);
await page.keyboard.press('q');
await page.keyboard.press('e');
await page.keyboard.press('e');
console.log('aimAngle', await page.evaluate(() => window.__jiroGame.aimAngle));

await page.click('.btn.drop');
for (let i = 0; i < 10; i++) {
  await sleep(1000);
  const s = await page.evaluate(() => {
    const g = window.__jiroGame;
    const c = g.current;
    return {
      phase: g.phase,
      cur: c
        ? { x: Math.round(c.position.x), y: Math.round(c.position.y), sp: +c.speed.toFixed(2), an: +c.angularSpeed.toFixed(3), sl: c.isSleeping }
        : null,
      pieces: g.pieces.map((b) => ({ x: Math.round(b.position.x), y: Math.round(b.position.y), sp: +b.speed.toFixed(2), an: +b.angularSpeed.toFixed(3), sl: b.isSleeping })),
    };
  });
  console.log(JSON.stringify(s));
  if (s.phase === 'aiming') break;
}
await browser.close();
