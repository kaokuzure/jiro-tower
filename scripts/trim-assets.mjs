// public/jiros/ の PNG の透明余白をトリミングし、manifest.json を再生成する。
// npm run build の前処理として実行される。file:// プレビューでも動くよう
// ランタイムではピクセル読み取りを行わないため、ここで事前にトリミングする。
import { PNG } from 'pngjs';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const DIR = join(process.cwd(), 'public', 'jiros');
const ALPHA_THRESHOLD = 8;

const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.png')).sort();

for (const file of files) {
  const path = join(DIR, file);
  const png = PNG.sync.read(readFileSync(path));
  const { width, height, data } = png;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
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
  if (maxX < 0 || (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1)) {
    console.log(`skip (already trimmed): ${file}`);
    continue;
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const srcStart = ((minY + y) * width + minX) * 4;
    const dstStart = y * w * 4;
    data.copy(out.data, dstStart, srcStart, srcStart + w * 4);
  }
  writeFileSync(path, PNG.sync.write(out));
  console.log(`trimmed: ${file} ${width}x${height} -> ${w}x${h}`);
}

writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(files, null, 2) + '\n');
console.log(`manifest.json updated: ${files.length} files`);
