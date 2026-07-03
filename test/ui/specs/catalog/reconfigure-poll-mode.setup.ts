// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { test } from '@playwright/test';
import { kubectl } from '../../fixtures/kube';

// Namespace the control plane (and Backstage) install into — see
// make/e2e.mk (E2E_CP_NS := openchoreo-control-plane).
const CP_NS = 'openchoreo-control-plane';
const ROLLOUT_TIMEOUT_MS = 300_000;

// Runs as a Playwright "setup" project: AFTER the whole event-driven UI suite
// (the `ui` project) and BEFORE the catalog-sync spec. It flips Backstage from
// the suite's default (10-min periodic sync + events ON) into poll-only mode
// (60s periodic + events OFF), so the catalog-sync spec proves the PERIODIC
// full-sync path in isolation — with events disabled, only the poll can surface
// a kubectl-applied resource.
//
// Both knobs are plain env vars on the Backstage deployment
// (OPENCHOREO_CATALOG_SYNC_FREQUENCY / OPENCHOREO_EVENTS_ENABLED — see the CP
// chart's templates/backstage/deployment.yaml), so this is a kubectl-only
// reconfigure; no helm upgrade is needed. Changing env rolls a new Backstage
// ReplicaSet, and OPENCHOREO_EVENTS_ENABLED is read at startup, so we wait for
// the rollout before catalog-sync runs.
test('reconfigure Backstage to poll-only mode (60s sync, events off)', async () => {
  test.setTimeout(ROLLOUT_TIMEOUT_MS + 60_000);

  // Stop the producer so no change webhooks are delivered during the poll test.
  // Best-effort: with OPENCHOREO_EVENTS_ENABLED=false the Backstage side already
  // skips event subscriptions, so this is just noise reduction — don't fail the
  // setup if the deployment name differs or it's already scaled down.
  kubectl(['scale', 'deploy/event-forwarder', '--replicas=0', '-n', CP_NS], {
    check: false,
  });

  // Flip Backstage to a fast poll with the event consumer disabled.
  kubectl([
    'set',
    'env',
    'deploy/backstage',
    'OPENCHOREO_CATALOG_SYNC_FREQUENCY=60',
    'OPENCHOREO_EVENTS_ENABLED=false',
    '-n',
    CP_NS,
  ]);

  // Wait for the new Backstage pod to become Ready before catalog-sync runs.
  kubectl(
    [
      'rollout',
      'status',
      'deploy/backstage',
      '-n',
      CP_NS,
      `--timeout=${ROLLOUT_TIMEOUT_MS / 1000}s`,
    ],
    { timeoutMs: ROLLOUT_TIMEOUT_MS },
  );
});
