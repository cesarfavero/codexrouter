import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installIntegration, uninstallIntegration } from '../src/integration.js';

test('integration patches and restores managed Codex config lines', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-int-'));
  const codexHome = path.join(root, 'codex');
  const routerHome = path.join(root, 'router');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "gpt-native"\n[features]\nfoo = true\n');
  const prevCodex = process.env.CODEX_HOME;
  const prevRouter = process.env.CODEXROUTER_HOME;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEXROUTER_HOME = routerHome;
  try {
    installIntegration({ port: 19001 });
    const installed = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    assert.match(installed, /openai_base_url = "http:\/\/127\.0\.0\.1:19001\/v1"/);
    assert.match(installed, /model_catalog_json = /);
    uninstallIntegration();
    const restored = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    assert.equal(restored, 'model = "gpt-native"\n[features]\nfoo = true\n');
  } finally {
    if (prevCodex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prevCodex;
    if (prevRouter === undefined) delete process.env.CODEXROUTER_HOME; else process.env.CODEXROUTER_HOME = prevRouter;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
