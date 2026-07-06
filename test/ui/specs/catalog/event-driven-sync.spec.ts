// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { test, expect, storageStateFor } from '../../fixtures/auth';
import { kApplyYAML, kubectl, kDelete } from '../../fixtures/kube';
import { CatalogTablePO } from '../../po/catalogTable';

// Event-driven catalog sync — the one thing the rest of the UI suite does NOT
// cover. UI-driven creates go through the Scaffolder, which writes the entity
// straight into the catalog via the ScaffolderEntityProvider (immediate insert),
// so those flows never exercise the event-forwarder path. This spec drives the
// cluster with kubectl instead (no Scaffolder, no immediate insert), so a
// Project can only reach the catalog through the OpenChoreoEntityProvider.
//
// This project (`ui`) runs with events ON and the periodic full sync parked at
// 600s (test/ui/k3d/values-cp-ui.yaml). With the poll that far out, a change
// that shows up in the portal within BUDGET can only have arrived via the
// event-forwarder → EventDeltaApplier delta path — not the poll — which is what
// makes this an actual proof of event-driven sync. (The periodic path itself is
// covered separately by catalog-sync.spec.ts, which runs later in poll-only
// mode.)
//
// A Project surfaces in the catalog as a System entity (kind "system"); its
// display-name / description annotations map to the entity title / description.

const ts = Date.now().toString(36);
const NS = 'default';
const PROJECT_NAME = `ui-evt-${ts}`;
const DISPLAY_NAME = `Evt Renamed ${ts}`;
const DESCRIPTION = `event-driven sync description ${ts}`;

// Well under the 600s periodic sync, so a hit is attributable to events, not the
// poll. Covers event forward + EventDeltaApplier refetch + catalog stitch + the
// reload-driven re-query.
const BUDGET = 45_000;
const POLL = { timeout: BUDGET, intervals: [2_000, 3_000, 5_000] };

const projectYAML = `
apiVersion: openchoreo.dev/v1alpha1
kind: Project
metadata:
  name: ${PROJECT_NAME}
  namespace: ${NS}
spec:
  deploymentPipelineRef:
    name: default
  type:
    kind: ClusterProjectType
    name: default
`;

const rowCount = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('link', { name, exact: true }).count();

test.describe.configure({ mode: 'serial' });

test.describe('catalog-sync (event-driven): kubectl CRUD reflects in the portal without the periodic poll', () => {
  test.beforeAll(async ({ mintAuthState }) => {
    await mintAuthState('pe');
  });
  test.use({ storageState: storageStateFor('pe') });

  test.afterAll(async () => {
    kDelete('project', PROJECT_NAME, NS);
  });

  test('create: a kubectl-applied Project appears in the catalog via events', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    kApplyYAML(projectYAML);

    const catalog = new CatalogTablePO(page);
    await catalog.gotoKind('system');

    // No display-name yet, so the entity title falls back to the name.
    await expect
      .poll(async () => {
        await catalog.reload();
        return rowCount(page, PROJECT_NAME);
      }, POLL)
      .toBeGreaterThan(0);
  });

  test('update: display-name and description edits reflect via events', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    kubectl([
      'patch',
      'project',
      PROJECT_NAME,
      '-n',
      NS,
      '--type',
      'merge',
      '-p',
      JSON.stringify({
        metadata: {
          annotations: {
            'openchoreo.dev/display-name': DISPLAY_NAME,
            'openchoreo.dev/description': DESCRIPTION,
          },
        },
      }),
    ]);

    const catalog = new CatalogTablePO(page);
    await catalog.gotoKind('system');

    // The catalog Name column renders the entity title, which is now the
    // display name — so the row's link text changes from the name to it.
    await expect
      .poll(async () => {
        await catalog.reload();
        return rowCount(page, DISPLAY_NAME);
      }, POLL)
      .toBeGreaterThan(0);

    // The new description shows on the entity's About card.
    await catalog.openByName(DISPLAY_NAME);
    await expect(
      page.getByText(DESCRIPTION, { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('delete: removing the Project via kubectl clears it from the catalog via events', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    kDelete('project', PROJECT_NAME, NS);

    const catalog = new CatalogTablePO(page);
    await catalog.gotoKind('system');

    // The row (now titled by its display name) disappears once the delete
    // event removes the System entity.
    await expect
      .poll(async () => {
        await catalog.reload();
        return rowCount(page, DISPLAY_NAME);
      }, POLL)
      .toBe(0);
  });
});
