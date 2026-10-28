import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

const files = [
  'C:/Users/juki/.verdent/generate_images/edit_20261029_010615_332dc469_1.png',
  'C:/Users/juki/.verdent/generate_images/edit_20261029_010615_b4e072c7_2.png',
  'C:/Users/juki/.verdent/generate_images/edit_20261029_010615_757e1619_3.png',
];

for (const f of files) {
  const png = PNG.sync.read(readFileSync(f));
  const { width, height, data } = png;
  let opaque = 0, semi = 0, transparent = 0;
  // 四隅と中央サンプルの alpha
  const samples = {};
  const sampleAt = (x, y) => data[(y * width + x) * 4 + 3];
  samples['corner-tl'] = sampleAt(5, 5);
  samples['corner-tr'] = sampleAt(width - 6, 5);
  samples['corner-bl'] = sampleAt(5, height - 6);
  samples['corner-br'] = sampleAt(width - 6, height - 6);
  samples['mid-left'] = sampleAt(5, Math.floor(height / 2));
  samples['mid-right'] = sampleAt(width - 6, Math.floor(height / 2));
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a > 220) opaque++;
    else if (a > 8) semi++;
    else transparent++;
  }
  const total = width * height;
  console.log(
    `${f.split('/').pop()}: ${width}x${height} opaque=${((opaque / total) * 100).toFixed(1)}% semi=${((semi / total) * 100).toFixed(1)}% transparent=${((transparent / total) * 100).toFixed(1)}%`,
  );
  console.log('  corner alpha:', JSON.stringify(samples));
}
