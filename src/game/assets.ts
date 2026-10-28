// 画像はビルド時（scripts/trim-assets.mjs）に透明余白をトリミング済み。
// ランタイムでは fetch / canvas のピクセル読み取りを行わない（file:// プレビュー互換）。
import files from '../../public/jiros/manifest.json';

export interface JiroAsset {
  url: string; // public/ からの相対パス（http・file:// の両方で動く）
  img: HTMLImageElement; // トリミング済み画像
  width: number; // 表示幅（世界ピクセル）
  height: number;
}

const MAX_DIM = 190;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`画像の読み込みに失敗しました: ${url}`));
    img.src = url;
  });
}

export async function loadJiroAssets(): Promise<JiroAsset[]> {
  const list: string[] = Array.isArray(files) ? files : [files as unknown as string];
  if (list.length === 0) throw new Error('ジロー画像が1枚もありません');

  const assets: JiroAsset[] = [];
  for (const file of list) {
    const url = `jiros/${file}`;
    const img = await loadImage(url);
    const k = MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight);
    assets.push({
      url,
      img,
      width: img.naturalWidth * k,
      height: img.naturalHeight * k,
    });
  }
  return assets;
}
