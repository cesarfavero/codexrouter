import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { codexBinary, inspectAuth } from './auth.js';
import { integrationStatus } from './integration.js';
import { catalogPath } from './paths.js';
import { loadRegistry } from './store.js';

export function runDoctor() {
  const checks = [];
  const codex = spawnSync(codexBinary(), ['--version'], { encoding: 'utf8' });
  checks.push({ name: 'Codex CLI', ok: codex.status === 0, detail: (codex.stdout || codex.stderr || '').trim() });
  const registry = loadRegistry();
  checks.push({ name: 'Accounts', ok: registry.accounts.length > 0, detail: `${registry.accounts.length} configured` });
  for (const account of registry.accounts) {
    try {
      const auth = inspectAuth(account.codexHome);
      checks.push({ name: `Account ${account.label}`, ok: true, detail: `${auth.email || 'signed in'}${auth.plan ? ` · ${auth.plan}` : ''}` });
    } catch (error) {
      checks.push({ name: `Account ${account.label}`, ok: false, detail: error.message });
    }
  }
  checks.push({ name: 'Model catalog', ok: fs.existsSync(catalogPath()), detail: catalogPath() });
  const integration = integrationStatus();
  checks.push({ name: 'Codex integration', ok: integration.installed, detail: integration.installed ? 'installed' : 'not installed' });
  return checks;
}
