import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureGatewayDefaultModel, installIntegration, integrationStatus, uninstallIntegration } from '../src/integration.js';

function withIntegrationFixture(initialConfig, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-int-'));
  const codexHome = path.join(root, 'codex');
  const routerHome = path.join(root, '.codexrouter');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), initialConfig);
  const prevCodex = process.env.CODEX_HOME;
  const prevRouter = process.env.CODEXROUTER_HOME;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEXROUTER_HOME = routerHome;
  try {
    run({ codexHome, routerHome });
  } finally {
    if (prevCodex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prevCodex;
    if (prevRouter === undefined) delete process.env.CODEXROUTER_HOME; else process.env.CODEXROUTER_HOME = prevRouter;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('integration patches and restores unrelated native Codex config lines', () => {
  withIntegrationFixture('model = "gpt-native"\n[features]\nfoo = true\n', ({ codexHome }) => {
    installIntegration({ port: 19001 });
    const installed = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    assert.match(installed, /openai_base_url = "http:\/\/127\.0\.0\.1:19001\/v1"/);
    assert.match(installed, /model_catalog_json = /);
    assert.match(installed, /^model = "codexrouter\/gateway"$/m);
    assert.equal(integrationStatus().gatewayDefault, true);
    uninstallIntegration();
    const restored = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    assert.equal(restored, 'model = "gpt-native"\n[features]\nfoo = true\n');
  });
});

test('legacy integration can migrate a native model to the Jev gateway and restore it later', () => {
  withIntegrationFixture('model = "gpt-5.6-sol"\n[features]\nfoo = true\n', ({ codexHome, routerHome }) => {
    const configPath = path.join(codexHome, 'config.toml');
    installIntegration({ port: 19001 });

    const journalPath = path.join(routerHome, 'integration.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    delete journal.previous.model;
    delete journal.installed.model;
    journal.version = 1;
    fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

    const legacyConfig = fs.readFileSync(configPath, 'utf8').replace(
      'model = "codexrouter/gateway"',
      'model = "gpt-5.6-sol"',
    );
    fs.writeFileSync(configPath, legacyConfig);

    const before = integrationStatus();
    assert.equal(before.installed, true);
    assert.equal(before.gatewayDefault, false);
    assert.equal(before.activeModel, 'gpt-5.6-sol');

    const repair = ensureGatewayDefaultModel();
    assert.equal(repair.changed, true);
    assert.equal(repair.previousModel, 'gpt-5.6-sol');
    assert.match(fs.readFileSync(configPath, 'utf8'), /^model = "codexrouter\/gateway"$/m);
    assert.equal(integrationStatus().gatewayDefault, true);

    uninstallIntegration();
    const restored = fs.readFileSync(configPath, 'utf8');
    assert.equal(restored, 'model = "gpt-5.6-sol"\n[features]\nfoo = true\n');
  });
});

test('integration collapses identical duplicate managed settings', () => {
  withIntegrationFixture([
    'openai_base_url = "http://127.0.0.1:17842/v1"',
    'model_catalog_json = "/tmp/router-catalog.json"',
    'openai_base_url = "http://127.0.0.1:17842/v1"',
    'model_catalog_json = "/tmp/router-catalog.json"',
    '[features]',
    'foo = true',
    '',
  ].join('\n'), ({ codexHome }) => {
    installIntegration({ port: 19001 });
    const installed = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    assert.equal((installed.match(/^openai_base_url = /gm) || []).length, 1);
    assert.equal((installed.match(/^model_catalog_json = /gm) || []).length, 1);
    uninstallIntegration();
  });
});

test('uninstall drops stale Router integration values and Router-only model selection', () => {
  withIntegrationFixture('', ({ codexHome, routerHome }) => {
    const configPath = path.join(codexHome, 'config.toml');
    const staleCatalog = path.join(routerHome, 'model-catalog.json');
    fs.writeFileSync(configPath, [
      'model = "codexrouter/gateway"',
      'openai_base_url = "http://127.0.0.1:17841/v1"',
      `model_catalog_json = ${JSON.stringify(staleCatalog)}`,
      '[features]',
      'foo = true',
      '',
    ].join('\n'));

    installIntegration({ port: 19001 });
    uninstallIntegration();

    const restored = fs.readFileSync(configPath, 'utf8');
    assert.equal(restored, '[features]\nfoo = true\n');
    assert.doesNotMatch(restored, /codexrouter\//);
    assert.doesNotMatch(restored, /openai_base_url/);
    assert.doesNotMatch(restored, /model_catalog_json/);
  });
});

test('uninstall preserves pre-existing non-Router endpoint, catalog and native model', () => {
  const original = [
    'model = "gpt-native"',
    'openai_base_url = "https://example.test/v1"',
    'model_catalog_json = "/tmp/native-catalog.json"',
    '[features]',
    'foo = true',
    '',
  ].join('\n');

  withIntegrationFixture(original, ({ codexHome }) => {
    installIntegration({ port: 19001 });
    uninstallIntegration();
    const restored = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    assert.equal(restored, original);
  });
});

test('uninstall still fails closed if a managed value changed after install', () => {
  withIntegrationFixture('[features]\nfoo = true\n', ({ codexHome }) => {
    installIntegration({ port: 19001 });
    const configPath = path.join(codexHome, 'config.toml');
    const changed = fs.readFileSync(configPath, 'utf8').replace(
      'openai_base_url = "http://127.0.0.1:19001/v1"',
      'openai_base_url = "http://127.0.0.1:19999/v1"',
    );
    fs.writeFileSync(configPath, changed);
    assert.throws(() => uninstallIntegration(), /changed after CodexRouter install|changed after install/);
  });
});
