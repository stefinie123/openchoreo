// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0

import { test, expect, storageStateFor } from '../../fixtures/auth';
import { kApplyYAML, kDelete } from '../../fixtures/kube';
import { CatalogTablePO } from '../../po/catalogTable';

const ts = Date.now().toString(36);
const PROJECT_NAME = `ui-catsync-${ts}`;
const COMPONENT_NAME = `kubectl-component-${ts}`;
const PRE_BUILT_IMAGE = 'ghcr.io/openchoreo/sample-greeter:latest';

// Both the Project and its Components live in the same OpenChoreo API
// namespace (`default` here). The OpenChoreo catalog provider lists
// components via GET /api/v1/namespaces/{projectNamespace}/components?project=
// (catalog-backend-module-openchoreo OpenChoreoEntityProvider), so a
// kubectl-seeded Component must sit in the project's namespace with
// spec.owner.projectName — NOT in a separate per-project namespace, or the
// provider's query never returns it.
const seedYAML = `
apiVersion: openchoreo.dev/v1alpha1
kind: Project
metadata:
  name: ${PROJECT_NAME}
  namespace: default
spec:
  deploymentPipelineRef:
    name: default
  type:
    kind: ClusterProjectType
    name: default
---
apiVersion: openchoreo.dev/v1alpha1
kind: Component
metadata:
  name: ${COMPONENT_NAME}
  namespace: default
spec:
  owner:
    projectName: ${PROJECT_NAME}
  componentType:
    kind: ComponentType
    name: deployment/web-app
  parameters:
    image: ${PRE_BUILT_IMAGE}
`;

test.describe('catalog-sync: kubectl-applied component appears in Backstage catalog', () => {
  test.beforeAll(async ({ mintAuthState }) => {
    await mintAuthState('pe');
  });
  test.use({ storageState: storageStateFor('pe') });

  test.afterAll(async () => {
    kDelete('component', COMPONENT_NAME, 'default');
    kDelete('project', PROJECT_NAME, 'default');
  });

  test('component applied via kubectl shows up after catalog refresh', async ({
    page,
  }) => {
    // This spec proves the PERIODIC full-sync path in isolation. It runs only
    // after the `poll-mode-setup` project has flipped Backstage into poll-only
    // mode — events OFF and the scheduled poll lowered to 60s (see
    // specs/catalog/reconfigure-poll-mode.setup.ts) — so a kubectl-created
    // component can only appear via the poll, not the event-driven delta path.
    // Budget the poll at a couple of cycles plus catalog-stitch slack (60s
    // frequency → typically visible within ~90s); the test timeout must exceed
    // the poll.
    test.setTimeout(240_000);
    kApplyYAML(seedYAML);

    const catalog = new CatalogTablePO(page);

    // Pre-filter to the Component kind. This must use the URL: the Kind picker
    // doesn't list "Component" until a component has synced, which is exactly
    // what this test is waiting for — so there is no click path here.
    await catalog.gotoKind('component');

    // Reload on each attempt to re-query until the kubectl-created row appears
    // — give it a few 60s poll cycles plus slack.
    await expect
      .poll(
        async () => {
          await catalog.reload();
          return page
            .getByRole('link', { name: COMPONENT_NAME, exact: true })
            .count();
        },
        { timeout: 180_000, intervals: [10_000, 15_000, 20_000] },
      )
      .toBeGreaterThan(0);

    await catalog.openByName(COMPONENT_NAME);
    await expect(
      page.getByRole('heading', { name: COMPONENT_NAME, exact: false }).first(),
    ).toBeVisible();
  });
});
