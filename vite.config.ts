import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // file:// プレビューでも動くよう、単一の非モジュールバンドル（IIFE）に出力する
    rollupOptions: {
      output: {
        format: 'iife',
      },
    },
  },
});
