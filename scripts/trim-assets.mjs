// assets-src/jiros/ の元画像を処理して public/jiros/ へ出力する。
// 1. 下端で切断されている画像（コンテンツが最下行に接し、かつ密度が高い）は
//    下方へアルファフェード延長して「硬い切断面」をなくす
// 2. 全画像の透明余白をトリミング
// 3. manifest.json と meta.json（当たり判定用の高さ）を出力
import { PNG } from 'pngjs';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'assets-src', 'jiros');
const DST = join(process.cwd(), 'public', 'jiros');
const ALPHA_THRESHOLD = 8;
const BOTTOM_DENSITY_CUT = 15; // 最下行の不透明率がこの%以上なら「切断」とみなす
const FADE_RATIO = 0.16; // 延長の長さ（画像高に対する比率）
const NO_FADE = new Set(['jiro_01.png', 'jiro_03.png', 'jiro_07.png']); // フェード延長しない（元絵 or 足まで完成済み）

function bbox(png) {
  const { width, height, data } = png;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

function bottomDensity(png, bb) {
  if (bb.maxY !== png.height - 1) return 0;
  const row = (png.height - 1) * png.width * 4;
  let n = 0;
  for (let x = bb.minX; x <= bb.maxX; x++) if (png.data[row + x * 4 + 3] > 200) n++;
  return (n / (bb.maxX - bb.minX + 1)) * 100;
}

function crop(png, bb) {
  const w = bb.maxX - bb.minX + 1;
  const h = bb.maxY - bb.minY + 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const srcStart = ((bb.minY + y) * png.width + bb.minX) * 4;
    png.data.copy(out.data, y * w * 4, srcStart, srcStart + w * 4);
  }
  return out;
}

// 下端をぼかし延長する（元の描画内容は変えず、下にフェードを追加）
function extendFade(png, fadeH) {
  const { width, height, data } = png;
  const out = new PNG({ width, height: height + fadeH });
  data.copy(out.data, 0);
  for (let x = 0; x < width; x++) {
    const bi = ((height - 1) * width + x) * 4;
    if (data[bi + 3] < 40) continue; // その列の最下行がほぼ透明なら延長しない
    const r = data[bi], g = data[bi + 1], b = data[bi + 2];
    for (let k = 1; k <= fadeH; k++) {
      const t = k / (fadeH + 1);
      const a = Math.max(0, Math.round(235 * (1 - t) * (1 - t)));
      const oi = ((height - 1 + k) * width + x) * 4;
      out.data[oi] = r;
      out.data[oi + 1] = g;
      out.data[oi + 2] = b;
      out.data[oi + 3] = a;
    }
  }
  return out;
}

if (!existsSync(DST)) mkdirSync(DST, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.png')).sort();
const meta = {};

for (const file of files) {
  let png = PNG.sync.read(readFileSync(join(SRC, file)));
  let bb = bbox(png);
  if (bb.maxX < 0) {
    console.log(`skip (empty): ${file}`);
    continue;
  }

  // 下端切断の検出（トリミング前に判定）
  const density = bottomDensity(png, bb);
  let fadeH = 0;
  if (density >= BOTTOM_DENSITY_CUT && !NO_FADE.has(file)) {
    fadeH = Math.max(12, Math.round(((bb.maxY - bb.minY + 1) * FADE_RATIO)));
    png = extendFade(png, fadeH);
    bb = bbox(png);
    console.log(`fade-extended: ${file} (bottom density ${Math.round(density)}%, +${fadeH}px)`);
  }

  const cropped = crop(png, bb);
  writeFileSync(join(DST, file), PNG.sync.write(cropped));
  meta[file] = { fadeH };
  console.log(`trimmed: ${file} ${png.width}x${png.height} -> ${cropped.width}x${cropped.height}`);
}

writeFileSync(join(DST, 'manifest.json'), JSON.stringify(files, null, 2) + '\n');
writeFileSync(join(DST, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`manifest.json / meta.json updated: ${files.length} files`);
