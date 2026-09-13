#!/usr/bin/env node
import { login, loginStatus, logout, inspectAuth, prepareAccountCodexHome } from './auth.js';
import { syncCatalog } from './catalog.js';
import { installIntegration, uninstallIntegration, integrationStatus } from './integration.js';
import { startRouter } from './router.js';
import { loadRegistry, registerAccount, removeAccount, setDefaultAccount, updateAccount, getAccount } from './store.js';
import { runDoctor } from './doctor.js';

const VERSION = '0.3.0';
const [command, subcommand, ...args] = process.argv.slice(2);

main().catch(error => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') return help();
  if (command === '--version' || command === 'version') return console.log(`codexrouter ${VERSION}`);

  if (command === 'account') return accountCommand(subcommand, args);
  if (command === 'catalog') return catalogCommand(subcommand);
  if (command === 'install') return installCommand(args);
  if (command === 'uninstall') return uninstallCommand();
  if (command === 'start') return startCommand(args);
  if (command === 'status') return statusCommand();
  if (command === 'doctor') return doctorCommand();
  throw new Error(`Unknown command: ${command}`);
}

function accountCommand(action, args) {
  if (action === 'add') {
    const label = args.join(' ').trim();
    if (!label) throw new Error('Usage: codexrouter account add <name>');
    const account = registerAccount(label);
    try {
      prepareAccountCodexHome(account.codexHome);
      console.log(`Opening the official Codex login flow for “${account.label}”…`);
      const auth = login(account.codexHome);
      updateAccount(account.id, { email: auth.email, plan: auth.plan });
      syncCatalog(loadRegistry());
      console.log(`Added ${account.label}${auth.email ? ` <${auth.email}>` : ''}${auth.plan ? ` · ${auth.plan}` : ''}`);
    } catch (error) {
      removeAccount(account.id, { removeProfile: false });
      throw error;
    }
    return;
  }
  if (action === 'list' || !action) {
    const registry = loadRegistry();
    if (!registry.accounts.length) return console.log('No accounts configured.');
    for (const account of registry.accounts) {
      const marker = account.id === registry.defaultAccountId ? '*' : ' ';
      console.log(`${marker} ${account.label} [${account.id}]${account.email ? ` · ${account.email}` : ''}${account.plan ? ` · ${account.plan}` : ''}${account.preferredModel ? ` · ${account.preferredModel}` : ''}`);
    }
    console.log('* active gateway account');
    return;
  }
  if (action === 'status') {
    const name = args.join(' ').trim();
    if (!name) throw new Error('Usage: codexrouter account status <name>');
    const { account } = getAccount(name);
    console.log(loginStatus(account.codexHome));
    const auth = inspectAuth(account.codexHome);
    console.log(`${account.label}${auth.email ? ` · ${auth.email}` : ''}${auth.plan ? ` · ${auth.plan}` : ''}`);
    return;
  }
  if (action === 'logout') {
    const name = args.join(' ').trim();
    if (!name) throw new Error('Usage: codexrouter account logout <name>');
    const { account } = getAccount(name);
    logout(account.codexHome);
    console.log(`Logged out: ${account.label}`);
    return;
  }
  if (action === 'remove') {
    const name = args.filter(arg => arg !== '--delete-profile').join(' ').trim();
    if (!name) throw new Error('Usage: codexrouter account remove <name> [--delete-profile]');
    const removed = removeAccount(name, { removeProfile: args.includes('--delete-profile') });
    console.log(`Removed: ${removed.label}`);
    return;
  }
  if (action === 'active' || action === 'default') {
    const name = args.join(' ').trim();
    if (!name) throw new Error('Usage: codexrouter account active <name>');
    const account = setDefaultAccount(name);
    const result = syncCatalog(loadRegistry());
    console.log(`Active gateway account: ${account.label} · ${result.nativeModel}`);
    return;
  }
  throw new Error(`Unknown account command: ${action}`);
}

function catalogCommand(action) {
  if (action !== 'sync') throw new Error('Usage: codexrouter catalog sync');
  const result = syncCatalog(loadRegistry());
  console.log(`Gateway catalog written: ${result.path}`);
  console.log(`CodexRouter → ${result.activeAccount.label} → ${result.nativeModel}`);
}

function installCommand(args) {
  const portIndex = args.indexOf('--port');
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 17842;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid --port.');
  const result = syncCatalog(loadRegistry());
  const journal = installIntegration({ port });
  console.log(`Catalog: ${result.path}`);
  console.log(`Codex config updated: ${journal.configPath}`);
  console.log(`Start the router with: codexrouter start --port ${port}`);
  console.log('Restart Codex and select CodexRouter.');
}

function uninstallCommand() {
  const journal = uninstallIntegration();
  console.log(`Restored Codex config: ${journal.configPath}`);
}

function startCommand(args) {
  const portIndex = args.indexOf('--port');
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : (integrationStatus().journal?.port ?? 17842);
  const server = startRouter({ port });
  console.log(`CodexRouter listening on http://127.0.0.1:${port}`);
  console.log('Press Ctrl+C to stop.');
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function statusCommand() {
  const registry = loadRegistry();
  const integration = integrationStatus();
  const active = registry.accounts.find(account => account.id === registry.defaultAccountId);
  console.log(`Accounts: ${registry.accounts.length}`);
  console.log(`Active: ${active?.label || 'none'}${active?.preferredModel ? ` · ${active.preferredModel}` : ''}`);
  console.log(`Integration: ${integration.installed ? 'installed' : 'not installed'}`);
  if (integration.journal?.port) console.log(`Port: ${integration.journal.port}`);
}

function doctorCommand() {
  const checks = runDoctor();
  for (const check of checks) console.log(`${check.ok ? 'OK ' : 'ERR'} ${check.name}: ${check.detail}`);
  if (checks.some(check => !check.ok)) process.exitCode = 1;
}

function help() {
  console.log(`CodexRouter ${VERSION}\n\nUsage:\n  codexrouter account add <name>\n  codexrouter account list\n  codexrouter account status <name>\n  codexrouter account active <name>\n  codexrouter account logout <name>\n  codexrouter account remove <name> [--delete-profile]\n  codexrouter catalog sync\n  codexrouter install [--port 17842]\n  codexrouter start [--port 17842]\n  codexrouter status\n  codexrouter doctor\n  codexrouter uninstall\n\nCompatibility:\n  account default <name> is an alias for account active <name>.\n\nAliases:\n  cxr ...\n`);
}
