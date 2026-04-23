import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    // Phase 5 (D-WEBUI-08): keep the dashboard workspace isolated from the root
    // Vitest run. Dashboard tests live under packages/** and are run via
    // `npm run test:dashboard` (a separate Vitest process inside the workspace).
    // Without this exclude, the root run would double-collect them and fail
    // because the root config uses `environment: 'node'` while the dashboard
    // needs `environment: 'jsdom'`.
    exclude: ['packages/**', 'node_modules/**', 'dist/**'],
    coverage: {
      exclude: ['packages/dashboard/**', 'node_modules/**', 'dist/**'],
    },
    testTimeout: 10000,
  },
});
