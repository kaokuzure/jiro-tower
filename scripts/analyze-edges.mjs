import { PNG } from 'pngjs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIRS = [
  'C:/jukiwk/99_素材/tmp/aaaa',
  'C:/Users/juki/.verdent/verdent-projects/cjukiwk99tmpaaaa/public/jiros',
];

for (const dir of DIRS) {
  console.log(`\n=== ${dir} ===`);
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  for (const file of files) {
    const png = PNG.sync.read(readFileSync(join(dir, file)));
    const { width, height, data } = png;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (data[row + x * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const touchBottom = maxY === height - 1;
    const touchTop = minY === 0;
    const touchL = minX === 0;
    const touchR = maxX === width - 1;
    // 下端行の不透明率（切れていたら高密度）
    let opaqueBottom = 0;
    if (touchBottom) {
      const row = (height - 1) * width * 4;
      for (let x = minX; x <= maxX; x++) if (data[row + x * 4 + 3] > 200) opaqueBottom++;
    }
    const bottomDensity = touchBottom ? Math.round((opaqueBottom / (maxX - minX + 1)) * 100) : 0;
    console.log(
      `${file}: ${width}x${height} content=[${minX},${minY}..${maxX},${maxY}] bottom-cut=${touchBottom ? `YES(density ${bottomDensity}%)` : 'no'} top=${touchTop ? 'Y' : '-'} L=${touchL ? 'Y' : '-'} R=${touchR ? 'Y' : '-'}`,
    );
  }
}
