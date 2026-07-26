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
    // Several tests exercise REAL wall-clock behaviour rather than faking it:
    // the download retry schedule sleeps [2s, 4s] between attempts, the poller
    // cap test drives honest setTimeout concurrency, and the C2PA tests do
    // genuine openssl/crypto work. Their measured baselines sit at 6.3s — only
    // 3.7s under the old 10s ceiling, so a machine under parallel load tipped
    // them over and the failure looked like a bug rather than contention.
    //
    // 30s is headroom for tests that are SUPPOSED to take seconds, not cover
    // for a hang: the whole suite finishes in ~20s wall, so anything reaching
    // this ceiling is genuinely stuck and still fails loudly.
    //
    // This was briefly raised to 60s after runs where every C2PA file blew the
    // ceiling at once. That diagnosis was wrong. The machine had two `node -e
    // while(true)` busy loops pegged at 100% for over a day, plus twelve
    // orphaned spin loops — all leftovers from earlier flake testing. With them
    // killed the same suite runs in 20s idle and 54s at --maxWorkers=2, which
    // is the shape of a small CI runner, and no file comes near 30s. Raising a
    // timeout to accommodate a broken measurement just hides the next real hang.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
