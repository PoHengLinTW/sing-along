import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3300);

// Runs the built app (API serving the web app) against the compose stack. See start-server.mjs.
export default defineConfig({
  testDir: './tests',
  // One shared database and one shared storage bucket: tests run one after another.
  fullyParallel: false,
  workers: 1,
  retries: 0, // a flaky test should be fixed, not retried
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1300, height: 950 },
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node start-server.mjs',
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
