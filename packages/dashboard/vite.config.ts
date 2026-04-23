import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    preact(),       // JSX transform via automatic runtime + HMR
    tailwindcss(),  // Tailwind v4 — reads packages/dashboard/src/styles/theme.css
  ],
  server: {
    port: 5173,
    // D-WEBUI-13: dev loop proxies /api to the running server on :3000.
    // This sidesteps CORS during dev; HTTP_ALLOWED_ORIGINS still matters
    // when a developer hits :3000 directly from the browser.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    // CONTEXT Discretion: single bundle at demo scale.
    rollupOptions: {},
    emptyOutDir: true,
  },
});
