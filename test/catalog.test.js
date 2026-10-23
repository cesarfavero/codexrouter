import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GATEWAY_SLUG, buildGatewayCatalog, chooseNativeModel, summarizeNativeModels, syncCatalogAsync } from '../src/catalog.js';
import { catalogPath } from '../src/paths.js';
import { loadRegistry, registerAccount, updateAccount } from '../src/store.js';

test('gateway catalog exposes the gateway and active account native models', () => {
  const cesar = {
    models: [
      { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', visibility: 'list', context_window: 100, is_default: true },
      { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', context_window: 80, use_responses_lite: false },
    ],
  };
  const eduardo = {
    models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', context_window: 80 }],
  };

  const result = buildGatewayCatalog([
    { account: { id: 'cesar', label: 'Cesar', preferredModel: 'gpt-5.6-sol' }, catalog: cesar },
    { account: { id: 'eduardo', label: 'Eduardo', preferredModel: 'gpt-5.5' }, catalog: eduardo },
  ], 'cesar');

  assert.equal(result.models.length, 3);
  assert.equal(result.models[0].slug, GATEWAY_SLUG);
  assert.equal(result.models[0].display_name, 'Router');
  assert.equal(result.models[0].context_window, 100);
  assert.equal(result.models[0].use_responses_lite, false);
  assert.equal(result.models[1].slug, 'gpt-5.6-sol');
  assert.equal(result.models[1].display_name, 'Router · GPT-5.6 Sol');
  assert.equal(result.models[2].slug, 'gpt-5.5');
  assert.equal(result.models[2].use_responses_lite, false);
  assert.equal(result.models.some(model => model.slug.startsWith('codexrouter/eduardo/')), false);
});

test('native model selection respects preference then catalog default', () => {
  const source = {
    models: [
      { slug: 'gpt-default', visibility: 'list', is_default: true },
      { slug: 'gpt-preferred', visibility: 'list' },
    ],
  };
  assert.equal(chooseNativeModel(source, 'gpt-preferred'), 'gpt-preferred');
  assert.equal(chooseNativeModel(source, 'missing'), 'gpt-preferred');
});

test('summarizes only selectable native models', () => {
  const result = summarizeNativeModels({ models: [
    { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', visibility: 'list' },
    { slug: 'hidden', visibility: 'hide' },
    { slug: 'codexrouter/gateway', visibility: 'list' },
  ] });
  assert.deepEqual(result, [{ slug: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]);
});

test('async catalog refresh discovers current CLI models and keeps a valid user choice', { skip: process.platform === 'win32' }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-model-refresh-'));
  const previousHome = process.env.CODEXROUTER_HOME;
  const previousCodexBin = process.env.CODEX_BIN;
  try {
    const binary = path.join(directory, 'codex');
    fs.writeFileSync(binary, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ models: [\n  { slug: 'gpt-old', visibility: 'list', display_name: 'Old' },\n  { slug: 'gpt-new', visibility: 'list', display_name: 'New' },\n] }));\n`);
    fs.chmodSync(binary, 0o755);
    process.env.CODEXROUTER_HOME = directory;
    process.env.CODEX_BIN = binary;
    fs.writeFileSync(path.join(directory, 'accounts.json'), JSON.stringify({ version: 1, defaultAccountId: null, accounts: [] }));
    const account = registerAccount('Test account');
    updateAccount(account.id, { preferredModel: 'gpt-old', modelSelectionSource: 'user' });

    await syncCatalogAsync(loadRegistry());

    const updated = loadRegistry().accounts[0];
    assert.equal(updated.preferredModel, 'gpt-old');
    assert.deepEqual(updated.availableModels.map(model => model.slug), ['gpt-old', 'gpt-new']);
    const gateway = JSON.parse(fs.readFileSync(catalogPath(), 'utf8'));
    assert.deepEqual(gateway.models.map(model => model.slug), [GATEWAY_SLUG, 'gpt-old', 'gpt-new']);
  } finally {
    if (previousHome === undefined) delete process.env.CODEXROUTER_HOME;
    else process.env.CODEXROUTER_HOME = previousHome;
    if (previousCodexBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previousCodexBin;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('async refresh keeps the existing gateway when the active account catalog is unavailable', { skip: process.platform === 'win32' }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-catalog-fallback-'));
  const previousHome = process.env.CODEXROUTER_HOME;
  const previousCodexBin = process.env.CODEX_BIN;
  try {
    const binary = path.join(directory, 'codex');
    fs.writeFileSync(binary, `#!/usr/bin/env node\nif (process.env.CODEX_HOME.includes('/accounts/active/')) process.exit(1);\nprocess.stdout.write(JSON.stringify({ models: [{ slug: 'fallback-model', visibility: 'list' }] }));\n`);
    fs.chmodSync(binary, 0o755);
    process.env.CODEXROUTER_HOME = directory;
    process.env.CODEX_BIN = binary;
    fs.writeFileSync(path.join(directory, 'accounts.json'), JSON.stringify({ version: 1, defaultAccountId: null, accounts: [] }));
    registerAccount('Active');
    registerAccount('Fallback');
    const previousCatalog = { models: [{ slug: GATEWAY_SLUG, visibility: 'list' }] };
    fs.writeFileSync(catalogPath(), JSON.stringify(previousCatalog));

    await assert.rejects(syncCatalogAsync(loadRegistry()), /active account.*did not return/i);

    assert.deepEqual(JSON.parse(fs.readFileSync(catalogPath(), 'utf8')), previousCatalog);
  } finally {
    if (previousHome === undefined) delete process.env.CODEXROUTER_HOME;
    else process.env.CODEXROUTER_HOME = previousHome;
    if (previousCodexBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previousCodexBin;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
