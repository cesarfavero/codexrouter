#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { codexBinary, fetchNativeCatalog, inspectAuth, loginStatus } from '../src/auth.js';
import { GATEWAY_SLUG, buildGatewayCatalog, chooseNativeModel, listVisibleNativeModels } from '../src/catalog.js';
import { startRouter } from '../src/router.js';
import { loadRegistry } from '../src/store.js';

const SUCCESS = 'CODEXROUTER_E2E_OK';
const PORT = Number(process.env.CODEXROUTER_E2E_PORT || 17942);

if (process.platform !== 'darwin' && process.env.CODEXROUTER_E2E_ALLOW_NON_MAC !== '1') {
  console.error('This E2E is intended for macOS. Set CODEXROUTER_E2E_ALLOW_NON_MAC=1 to override.');
  process.exit(2);
}

const sourceRegistry = loadRegistry();
const requested = process.argv.slice(2);
const selected = requested.length
  ? requested.map(name => {
      const needle = name.toLowerCase();
      const account = sourceRegistry.accounts.find(item => item.id.toLowerCase() === needle || item.label.toLowerCase() === needle);
      if (!account) throw new Error(`Unknown account: ${name}`);
      return account;
    })
  : sourceRegistry.accounts.slice(0, 2);

if (selected.length !== 2) throw new Error('The real E2E requires exactly two configured accounts.');
if (selected[0].id === selected[1].id) throw new Error('Choose two different accounts.');

console.log(`CodexRouter gateway E2E: ${selected[0].label} ↔ ${selected[1].label}`);
for (const account of selected) {
  const identity = inspectAuth(account.codexHome);
  const status = loginStatus(account.codexHome);
  console.log(`✓ ${account.label}: ${identity.email || 'authenticated'} · ${identity.plan || 'plan unknown'} · ${status}`);
}

const accountCatalogs = selected.map(account => ({ account, catalog: fetchNativeCatalog(account.codexHome) }));
const testAccounts = accountCatalogs.map(({ account, catalog }) => ({
  ...account,
  preferredModel: chooseNativeModel(catalog, account.preferredModel),
  nativeModelCount: listVisibleNativeModels(catalog).length,
}));
for (const account of testAccounts) {
  if (!account.preferredModel) throw new Error(`${account.label} has no list-visible Codex model.`);
  console.log(`✓ ${account.label} native model: ${account.preferredModel}`);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-e2e-'));
const previousHome = process.env.CODEXROUTER_HOME;
process.env.CODEXROUTER_HOME = scratch;
const temporaryCatalogPath = path.join(scratch, 'model-catalog.json');
const temporaryRegistryPath = path.join(scratch, 'accounts.json');
const testCatalogs = accountCatalogs.map(({ catalog }, index) => ({ account: testAccounts[index], catalog }));

const server = startRouter({ port: PORT });
if (!server.listening) await once(server, 'listening');
console.log(`✓ Test gateway: http://127.0.0.1:${PORT}/v1`);

let failed = false;
try {
  for (const account of testAccounts) {
    fs.writeFileSync(temporaryRegistryPath, `${JSON.stringify({
      version: 1,
      defaultAccountId: account.id,
      accounts: testAccounts,
    }, null, 2)}\n`, { mode: 0o600 });
    const gatewayCatalog = buildGatewayCatalog(testCatalogs, account.id);
    fs.writeFileSync(temporaryCatalogPath, `${JSON.stringify(gatewayCatalog, null, 2)}\n`, { mode: 0o600 });

    const outputFile = path.join(scratch, `${account.id}.txt`);
    console.log(`→ ${GATEWAY_SLUG} with active account ${account.label}`);
    const result = await runCodexExec({
      accountHome: account.codexHome,
      catalogFile: temporaryCatalogPath,
      outputFile,
    });
    if (result.code !== 0) {
      throw new Error(`Codex exec failed for ${account.label} (code ${result.code}).\n${tail(result.stderr || result.stdout)}`);
    }
    const answer = fs.readFileSync(outputFile, 'utf8').trim();
    if (answer !== SUCCESS) throw new Error(`Unexpected response through ${account.label}: ${JSON.stringify(answer)}`);
    console.log(`✓ Single gateway routed live request through explicitly active account ${account.label}`);
  }
} catch (error) {
  failed = true;
  console.error(`✗ ${error.message}`);
} finally {
  await new Promise(resolve => server.close(() => resolve()));
  if (previousHome === undefined) delete process.env.CODEXROUTER_HOME;
  else process.env.CODEXROUTER_HOME = previousHome;
  fs.rmSync(scratch, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log('✓ E2E passed: one gateway model routed through both accounts after explicit active-account selection.');

function runCodexExec({ accountHome, catalogFile, outputFile }) {
  const args = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '-m', GATEWAY_SLUG,
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
