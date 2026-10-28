// 背景が不透明化してしまった生成画像から、端からつながる背景色を除去する。
// 使い方: node scripts/remove-bg.mjs jiro_03.png jiro_07.png ...
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'assets-src', 'jiros');

// 背景色の許容差（RGB距離）
const TOL = 34;

for (const file of process.argv.slice(2)) {
  const png = PNG.sync.read(readFileSync(join(SRC, file)));
  const { width: w, height: h, data } = png;
  const visited = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (!visited[i]) stack.push(i);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

  let removed = 0;
  while (stack.length) {
    const i = stack.pop();
    if (visited[i]) continue;
    visited[i] = 1;
    const p = i * 4;
    const a = data[p + 3];
    if (a === 0) {
      // すでに透明なら背景とみなして隣接へ
    } else {
      const x = i % w, y = (i / w) | 0;
      // 近傍の不透明背景色をサンプル（チェック柄対策: 近傍平均との差で判定）
      let isBg;
      if (a < 255) {
        isBg = false;
      } else {
        const r = data[p], g = data[p + 1], b = data[p + 2];
        // 背景候補色（白系 or 黒系）との距離
        const dWhite = Math.hypot(r - 255, g - 255, b - 255);
        const dGray = Math.hypot(r - 204, g - 204, b - 204);
        const dBlack = Math.hypot(r, g, b);
        isBg = (dWhite < TOL || dGray < TOL || dBlack < TOL);
      }
      if (!isBg && data[p + 3] !== 0) continue;
    }
    data[p + 3] = 0;
    removed++;
    const x = i % w, y = (i / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  writeFileSync(join(SRC, file), PNG.sync.write(png));
  console.log(`${file}: removed ${removed} px (${Math.round((removed / (w * h)) * 100)}%)`);
}
