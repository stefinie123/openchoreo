// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { test } from '@playwright/test';
import { kubectl } from '../../fixtures/kube';

const CP_NS = 'openchoreo-control-plane';
const ROLLOUT_TIMEOUT_MS = 300_000;

// Teardown for the `poll-mode-setup` project (runs after catalog-sync finishes).
// Restores the suite's default event-driven config (600s periodic + events ON)
// so a local re-run of `npm test` against the SAME cluster starts clean — the
// main suite must again rely on events, not the 60s poll left behind by the
// setup. Entirely best-effort: the ephemeral CI cluster is torn down after the
// run, so a failure here must never fail the suite.
test('restore Backstage to event-driven mode (600s sync, events on)', async () => {
  test.setTimeout(ROLLOUT_TIMEOUT_MS + 60_000);

  kubectl(['scale', 'deploy/event-forwarder', '--replicas=1', '-n', CP_NS], {
    check: false,
  });
  kubectl(
    [
      'set',
      'env',
      'deploy/backstage',
      'OPENCHOREO_CATALOG_SYNC_FREQUENCY=600',
      'OPENCHOREO_EVENTS_ENABLED=true',
      '-n',
      CP_NS,
    ],
    { check: false },
  );
  kubectl(
    [
      'rollout',
      'status',
      'deploy/backstage',
      '-n',
      CP_NS,
      `--timeout=${ROLLOUT_TIMEOUT_MS / 1000}s`,
    ],
    { timeoutMs: ROLLOUT_TIMEOUT_MS, check: false },
  );
});
