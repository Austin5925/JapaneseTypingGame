import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke E2E for the desktop app's web build (no Tauri runtime).
 *
 * Why web-preview only: a real Tauri E2E needs a desktop GUI runner +
 * the Rust binary built per platform; that's a separate sprint with its
 * own CI cost. This config exercises the React + Phaser shell against a
 * vite preview server so we can catch shell-level regressions (route
 * registration, retro shell render, page mount) without booting the
 * native window.
 *
 * Tauri `invoke` will reject in web preview because there's no IPC
 * runtime; spec files should expect this and assert against the React
 * fallback / error states rather than the populated views. A minimal
 * smoke (page renders, shell visible, no JS exceptions) is what we ship
 * for v0.7.0 — richer flows arrive once we wire a Tauri-mode runner.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    // `vite preview` serves the production build of apps/desktop. We rely on
    // the upstream `pnpm build` step having run beforehand; in CI the
    // workflow already runs it. Locally: `pnpm build && pnpm test:e2e`.
    command: 'pnpm --filter @kana-typing/desktop preview --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
