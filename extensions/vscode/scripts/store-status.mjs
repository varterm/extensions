#!/usr/bin/env node
// Compare local package.json metadata against what each store is serving.
// Usage: node scripts/store-status.mjs [--strict] [--json]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(extDir, 'package.json'), 'utf8'));
const extensionId = `${pkg.publisher}.${pkg.name}`;

const strict = process.argv.includes('--strict');
const asJson = process.argv.includes('--json');

const local = {
  version: pkg.version,
  displayName: pkg.displayName,
  description: pkg.description,
};

async function fetchOpenVsx() {
  const url = `https://open-vsx.org/api/${pkg.publisher}/${pkg.name}/latest`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 404) {
    return { missing: true };
  }
  if (!response.ok) {
    throw new Error(`Open VSX responded ${response.status}`);
  }
  const body = await response.json();
  return {
    version: body.version,
    displayName: body.displayName,
    description: body.description,
    url: body.files?.download ? `https://open-vsx.org/extension/${pkg.publisher}/${pkg.name}` : undefined,
  };
}

async function fetchMarketplace() {
  const response = await fetch(
    'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json;api-version=3.0-preview.1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filters: [
          {
            criteria: [{ filterType: 7, value: extensionId }],
            pageNumber: 1,
            pageSize: 1,
          },
        ],
        flags: 529,
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Marketplace responded ${response.status}`);
  }
  const body = await response.json();
  const extension = body.results?.[0]?.extensions?.[0];
  if (!extension) {
    return { missing: true };
  }
  return {
    version: extension.versions?.[0]?.version,
    displayName: extension.displayName,
    description: extension.shortDescription,
    url: `https://marketplace.visualstudio.com/items?itemName=${extensionId}`,
  };
}

async function settle(label, task) {
  try {
    return { label, ...(await task) };
  } catch (error) {
    return { label, error: error instanceof Error ? error.message : String(error) };
  }
}

const [marketplace, openVsx] = await Promise.all([
  settle('VS Code Marketplace', fetchMarketplace()),
  settle('Open VSX (Cursor)', fetchOpenVsx()),
]);

if (asJson) {
  console.log(JSON.stringify({ extensionId, local, marketplace, openVsx }, null, 2));
} else {
  const show = (value) => (value === undefined || value === '' ? '(none)' : value);
  console.log(`${extensionId} — local v${local.version}`);
  console.log(`  displayName: ${show(local.displayName)}`);
  console.log(`  description: ${show(local.description)}`);

  for (const store of [marketplace, openVsx]) {
    console.log('');
    if (store.error) {
      console.log(`${store.label}: lookup failed — ${store.error}`);
      continue;
    }
    if (store.missing) {
      console.log(`${store.label}: not published yet`);
      continue;
    }
    const versionNote = store.version === local.version ? 'up to date' : `behind local v${local.version}`;
    console.log(`${store.label}: v${show(store.version)} (${versionNote})`);
    console.log(`  displayName: ${show(store.displayName)}`);
    console.log(`  description: ${show(store.description)}`);
    if (store.displayName !== local.displayName) {
      console.log('  ! displayName differs from package.json');
    }
    if (store.description !== local.description) {
      console.log('  ! description differs from package.json');
    }
    if (store.url) {
      console.log(`  ${store.url}`);
    }
  }
}

const drifted = [marketplace, openVsx].filter(
  (store) =>
    !store.error &&
    !store.missing &&
    (store.version !== local.version ||
      store.displayName !== local.displayName ||
      store.description !== local.description)
);

const failed = [marketplace, openVsx].filter((store) => store.error);

if (strict && (drifted.length || failed.length)) {
  process.exit(1);
}
