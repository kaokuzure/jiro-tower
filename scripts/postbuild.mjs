// dist/index.html を file:// でも動く形に変換するポストビルド処理。
// - <script type="module" crossorigin src="/assets/..."> を <script src="./assets/..."> に変更
//   （file:// ではモジュールスクリプトが CORS でブロックされるため）
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const path = join(process.cwd(), 'dist', 'index.html');
let html = readFileSync(path, 'utf8');

html = html.replace(
  /<script type="module"[^>]*src="\/(assets\/[^"]+)"[^>]*><\/script>/,
  '<script defer src="./$1"></script>',
);
html = html.replaceAll('src="/assets/', 'src="./assets/');
html = html.replaceAll('href="/assets/', 'href="./assets/');

writeFileSync(path, html);
console.log('dist/index.html converted for file:// compatibility');
