#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { codexBinary, fetchNativeCatalog, inspectAuth, loginStatus } from '../src/auth.js';
import { aliasSlug, buildCombinedCatalog } from '../src/catalog.js';
import { startRouter } from '../src/router.js';
import { loadRegistry } from '../src/store.js';

const SUCCESS = 'CODEXROUTER_E2E_OK';
const PORT = Number(process.env.CODEXROUTER_E2E_PORT || 17942);

if (process.platform !== 'darwin' && process.env.CODEXROUTER_E2E_ALLOW_NON_MAC !== '1') {
  console.error('This E2E is intended for macOS. Set CODEXROUTER_E2E_ALLOW_NON_MAC=1 to override.');
  process.exit(2);
}

const registry = loadRegistry();
const requested = process.argv.slice(2);
const accounts = requested.length
  ? requested.map(name => {
      const needle = name.toLowerCase();
      const account = registry.accounts.find(item => item.id.toLowerCase() === needle || item.label.toLowerCase() === needle);
      if (!account) throw new Error(`Unknown account: ${name}`);
      return account;
    })
  : registry.accounts.slice(0, 2);

if (accounts.length !== 2) {
  throw new Error('The real E2E requires exactly two configured accounts. Pass two account labels/ids or configure at least two accounts in the desktop app.');
}
if (accounts[0].id === accounts[1].id) throw new Error('Choose two different accounts.');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-e2e-'));
const temporaryCatalogPath = path.join(scratch, 'model-catalog.json');

console.log(`CodexRouter real E2E: ${accounts[0].label} ↔ ${accounts[1].label}`);
for (const account of accounts) {
  const identity = inspectAuth(account.codexHome);
  const status = loginStatus(account.codexHome);
  console.log(`✓ ${account.label}: ${identity.email || 'authenticated'} · ${identity.plan || 'plan unknown'} · ${status}`);
}

const accountCatalogs = accounts.map(account => ({
  account,
  catalog: fetchNativeCatalog(account.codexHome),
}));
const commonModel = selectCommonModel(accountCatalogs);
if (!commonModel) throw new Error('The selected accounts do not expose a common list-visible Codex model.');
const combinedCatalog = buildCombinedCatalog(accountCatalogs, accounts[0].id);
fs.writeFileSync(temporaryCatalogPath, `${JSON.stringify(combinedCatalog, null, 2)}\n`, { mode: 0o600 });
console.log(`✓ Common native model: ${commonModel}`);

const server = startRouter({ port: PORT });
if (!server.listening) await once(server, 'listening');
console.log(`✓ Test router: http://127.0.0.1:${PORT}/v1`);

let failed = false;
try {
  for (const account of accounts) {
    const alias = aliasSlug(account.id, commonModel);
    const outputFile = path.join(scratch, `${account.id}.txt`);
    console.log(`→ ${alias}`);
    const result = await runCodexExec({
      accountHome: accounts[0].codexHome,
      alias,
      catalogFile: temporaryCatalogPath,
      outputFile,
    });
    if (result.code !== 0) {
      throw new Error(`Codex exec failed for ${account.label} (code ${result.code}).\n${tail(result.stderr || result.stdout)}`);
    }
    const answer = fs.readFileSync(outputFile, 'utf8').trim();
    if (answer !== SUCCESS) {
      throw new Error(`Unexpected response through ${account.label}: ${JSON.stringify(answer)}`);
    }
    console.log(`✓ Routed live request through ${account.label}`);
  }
} catch (error) {
  failed = true;
  console.error(`✗ ${error.message}`);
} finally {
  await new Promise(resolve => server.close(() => resolve()));
  fs.rmSync(scratch, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log('✓ E2E passed: both account-qualified model aliases completed real Codex requests.');

function models(catalog) {
  return Array.isArray(catalog) ? catalog : Array.isArray(catalog?.models) ? catalog.models : [];
}

function selectCommonModel(accountCatalogs) {
  const lists = accountCatalogs.map(({ catalog }) => new Set(
    models(catalog)
      .filter(model => model && typeof model.slug === 'string' && (!model.visibility || model.visibility === 'list'))
      .map(model => model.slug),
  ));
  if (!lists.length) return null;
  const common = [...lists[0]].filter(slug => lists.every(set => set.has(slug)));
  return common.find(slug => slug === 'gpt-5.6-sol')
    || common.find(slug => slug.includes('gpt-5.6'))
    || common[0]
    || null;
}

function runCodexExec({ accountHome, alias, catalogFile, outputFile }) {
  const args = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '-m', alias,
    '-c', `openai_base_url="http://127.0.0.1:${PORT}/v1"`,
    '-c', `model_catalog_json="${escapeToml(catalogFile)}"`,
    '--output-last-message', outputFile,
    `Respond with exactly ${SUCCESS} and nothing else. Do not call tools.`,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(codexBinary(), args, {
      env: { ...process.env, CODEX_HOME: accountHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-65_536); });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-65_536); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? (signal ? 1 : 0), signal, stdout, stderr });
    });
  });
}

function escapeToml(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function tail(value, max = 2500) {
  const text = String(value || '').trim();
  return text.length > max ? text.slice(-max) : text;
}
