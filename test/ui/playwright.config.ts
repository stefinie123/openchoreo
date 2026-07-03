// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from '@playwright/test';
// Mapped into Chromium via --host-resolver-rules below so the suite runs
// without /etc/hosts edits. Shared with global-setup.ts.
import { hostResolverRules } from './fixtures/hosts';

// In ext-idp mode only the external-idp suite runs (Dex replaces Thunder as
// the OIDC provider — pre-minted Thunder storage states are unavailable).
// In normal UI mode the external-idp suite is excluded because Dex is not
// installed and the Thunder storage-state globalSetup would be skipped.
const extIdpMode = process.env.E2E_WITH_EXT_IDP === 'true';

// Shared Chromium launch config. Mapped hostnames resolve via
// --host-resolver-rules so the suite needs no /etc/hosts edits.
const chromium = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  launchOptions: {
    args: [`--host-resolver-rules=${hostResolverRules}`],
    ...(process.env.PWSLOWMO && { slowMo: Number(process.env.PWSLOWMO) }),
  },
};

// The catalog-sync spec proves the PERIODIC full-sync path, which needs the
// opposite cluster config from the rest of the suite (events OFF + a fast 60s
// poll, vs. the suite default of events ON + a 600s poll). Rather than a
// second cluster, we reconfigure in place mid-run using Playwright project
// dependencies to force the order:
//
//   ui  ->  poll-mode-setup  ->  catalog-sync
//                 └── teardown: restore-event-mode
//
//   1. `ui` runs the whole event-driven suite (everything except catalog-sync).
//   2. `poll-mode-setup` (runs only after `ui`) flips Backstage to poll-only
//      mode via kubectl and waits for the pod to restart.
//   3. `catalog-sync` (runs only after the reconfigure) exercises the poll.
//   4. `restore-event-mode` teardown flips the config back so a local re-run
//      against the same cluster starts clean again.
//
// In ext-idp mode none of this applies — only the external-idp suite runs.
const projects = extIdpMode
  ? [
      {
        name: 'chromium',
        use: chromium,
        testMatch: ['**/external-idp/**/*.spec.ts'],
      },
    ]
  : [
      {
        name: 'ui',
        use: chromium,
        testMatch: ['**/*.spec.ts'],
        testIgnore: [
          '**/external-idp/**',
          '**/catalog/catalog-sync.spec.ts',
          '**/*.setup.ts',
          '**/*.teardown.ts',
        ],
      },
      {
        name: 'poll-mode-setup',
        use: chromium,
        testMatch: ['**/catalog/reconfigure-poll-mode.setup.ts'],
        dependencies: ['ui'],
        teardown: 'restore-event-mode',
      },
      {
        name: 'catalog-sync',
        use: chromium,
        testMatch: ['**/catalog/catalog-sync.spec.ts'],
        dependencies: ['poll-mode-setup'],
      },
      {
        name: 'restore-event-mode',
        use: chromium,
        testMatch: ['**/catalog/restore-event-mode.teardown.ts'],
      },
    ];

export default defineConfig({
  testDir: './specs',
  // globalSetup mints per-role storage-state files in .auth/ before any
  // worker starts — test.use({ storageState }) only resolves after the
  // files exist on disk, so this can't live in a beforeAll hook.
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '_report' }],
  ],

  use: {
    baseURL: process.env.UI_BASE_URL ?? 'http://openchoreo.e2e-cp.local:28080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Playwright downscales videos to fit 800x800 unless a size is given —
    // record at the full viewport resolution instead.
    video: {
      mode: 'retain-on-failure',
      size: { width: 1920, height: 1080 },
    },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // Backstage's frontend bundle calls window.crypto.randomUUID() which is
  // only exposed in a "secure context". The e2e portal is plain HTTP, so a
  // polyfill is injected via an init script — see fixtures/auth.ts (test
  // contexts) and global-setup.ts (sign-in mint context).

  projects,

  outputDir: '_test-results',
});
