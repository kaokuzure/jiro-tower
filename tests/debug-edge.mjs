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

await page.evaluate(() => {
  const g = window.__jiroGame;
  g.aimAngle = 0;
  g.aimX = 336;
  g.drop();
});
await sleep(6000);

const l0 = await page.evaluate(() => window.__jiroGame.lives);
await page.evaluate(() => {
  const g = window.__jiroGame;
  const c = g.pieces[0];
  c.position.x = 780;
  c.position.y = 580;
  c.positionPrev.x = 780;
  c.positionPrev.y = 575;
  c.velocity.x = 2;
  c.velocity.y = 2;
});
for (let i = 0; i < 8; i++) {
  await sleep(500);
  const s = await page.evaluate(() => {
    const g = window.__jiroGame;
    const b = g.pieces[0];
    return {
      phase: g.phase,
      lives: g.lives,
      n: g.pieces.length,
      x: b ? Math.round(b.position.x) : null,
      y: b ? Math.round(b.position.y) : null,
      vy: b ? +b.velocity.y.toFixed(1) : null,
    };
  });
  console.log(JSON.stringify(s));
}
console.log('lives start:', l0);
await browser.close();
