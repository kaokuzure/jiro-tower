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

const waitAiming = async (ms) => {
  const s = Date.now();
  while (Date.now() - s < ms) {
    if (await page.evaluate(() => window.__jiroGame.phase === 'aiming')) return true;
    await sleep(150);
  }
  return false;
};

// 3個積む
for (let i = 0; i < 3; i++) {
  await waitAiming(15000);
  await page.evaluate((i) => {
    const gm = window.__jiroGame;
    gm.aimAngle = 0;
    gm.aimX = 336 + (i % 2) * 10;
    gm.drop();
  }, i);
  await waitAiming(15000);
}
const stacked = await page.evaluate(() => ({
  pieces: window.__jiroGame.pieces.length,
  lives: window.__jiroGame.lives,
}));
check('stacked 3, no lives lost', stacked.pieces === 3 && stacked.lives === 3, JSON.stringify(stacked));

// シナリオA: 積み上げ済みピースを1つだけ台地の外へ滑らせる → ライフはちょうど1減
const a0 = await page.evaluate(() => window.__jiroGame.lives);
await page.evaluate(() => {
  const gm = window.__jiroGame;
  const b = gm.pieces[0];
  // 台地の端の外へ押し出す
  b.position.x = 720;
  b.position.y = 540;
  b.positionPrev.x = 700;
  b.positionPrev.y = 540;
  b.velocity.x = 5;
  b.velocity.y = 0;
});
await sleep(4000);
const a1 = await page.evaluate(() => ({
  lives: window.__jiroGame.lives,
  phase: window.__jiroGame.phase,
}));
check('1 piece off platform = exactly 1 life lost', a1.lives === a0 - 1, `before=${a0} after=${JSON.stringify(a1)}`);

// シナリオB: 落下中のピース（current）が台地を外れて消失 → 1ライフ＆すぐ次が操作可能
const b0 = await page.evaluate(() => window.__jiroGame.lives);
await page.evaluate(() => {
  const gm = window.__jiroGame;
  gm.aimAngle = 0;
  gm.aimX = 336;
  gm.drop();
});
// falling になるのを待ってからテレポート（物理は動かさず消す）
await sleep(700);
await page.evaluate(() => {
  const gm = window.__jiroGame;
  const c = gm.current;
  if (c) {
    c.position.x = 900;
    c.position.y = 1100;
    c.positionPrev.x = 900;
    c.positionPrev.y = 1100;
    c.velocity.x = 0;
    c.velocity.y = 3;
  }
});
await sleep(4000);
const b1 = await page.evaluate(() => ({
  lives: window.__jiroGame.lives,
  phase: window.__jiroGame.phase,
  hasCurrent: !!window.__jiroGame.current,
}));
check('current piece void fall = exactly 1 life, back to aiming', b1.lives === b0 - 1 && b1.phase === 'aiming', `before=${b0} after=${JSON.stringify(b1)}`);

// シナリオC: 塔の上で地面に触れても減らない（同じ位置でジャンプさせて再着地）
const c0 = await page.evaluate(() => window.__jiroGame.lives);
await page.evaluate(() => {
  const gm = window.__jiroGame;
  // current ピースを塔の上に少しだけ浮かせて落とす（塔に接触→再着地でも台地から外れない）
  const c = gm.current;
  if (c) {
    c.position.y = 300;
    c.positionPrev.y = 300;
    c.velocity.y = 0;
  }
});
await sleep(6000);
const c1 = await page.evaluate(() => ({ lives: window.__jiroGame.lives, phase: window.__jiroGame.phase }));
check('no life lost while pieces stay on platform', c1.lives === c0, `before=${c0} after=${JSON.stringify(c1)}`);

check('no page errors', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));

await browser.close();
console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
