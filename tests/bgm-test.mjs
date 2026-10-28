import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 420, height: 860 },
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

const g = await page.evaluate(() => !!window.__jiroGame);
check('game ready', g);

// 台地幅（世界幅が1.4倍の672になっているか）
const plat = await page.evaluate(() => {
  const gm = window.__jiroGame;
  const rect = document.querySelector('canvas').getBoundingClientRect();
  return { css: Math.round(672 * gm.scale), pct: Math.round((672 * gm.scale) / rect.width * 100) };
});
check('platform 1.4x wider', plat.css >= 260 && plat.pct >= 42 && plat.pct <= 80, JSON.stringify(plat));

// BGM ボタン
const bgm = await page.evaluate(() => !!document.querySelector('.btn-bgm'));
check('bgm button exists', bgm);

// クリックで BGM 再生開始
await page.click('.btn-bgm'); // 一旦オフ
await sleep(300);
await page.click('.btn-bgm'); // オンに戻す（ユーザー操作として再生許可が出る）
await sleep(1000);
const audio = await page.evaluate(() => {
  const a = window.__bgm;
  return { exists: !!a, paused: a ? a.paused : null, t: a ? a.currentTime : null, loop: a ? a.loop : null, vol: a ? a.volume : null };
});
check('bgm playing after gesture', audio.exists && audio.paused === false && audio.t > 0, JSON.stringify(audio));
check('bgm loop enabled', audio.loop === true);
check('bgm volume 0.4', audio.vol === 0.4);

// オフにすると停止する
await page.evaluate(() => document.querySelector('.btn-bgm').click());
await sleep(400);
const offState = await page.evaluate(() => {
  const a = window.__bgm;
  return { paused: a ? a.paused : null, stored: localStorage.getItem('jiro-tower-bgm') };
});
check('bgm pauses when toggled off', offState.paused === true && offState.stored === 'off', JSON.stringify(offState));

check('no page errors', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));

await browser.close();
console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
