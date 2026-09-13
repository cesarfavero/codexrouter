import os from 'node:os';
import path from 'node:path';

export function homeDir() {
  return process.env.CODEXROUTER_HOME
    ? path.resolve(expandHome(process.env.CODEXROUTER_HOME))
    : path.join(os.homedir(), '.codexrouter');
}

export function mainCodexHome() {
  return process.env.CODEX_HOME
    ? path.resolve(expandHome(process.env.CODEX_HOME))
    : path.join(os.homedir(), '.codex');
}

export function registryPath() {
  return path.join(homeDir(), 'accounts.json');
}

export function accountHome(accountId) {
  return path.join(homeDir(), 'accounts', accountId, 'codex-home');
}

export function catalogPath() {
  return path.join(homeDir(), 'model-catalog.json');
}

export function integrationJournalPath() {
  return path.join(homeDir(), 'integration.json');
}

export function mainCodexConfigPath() {
  return path.join(mainCodexHome(), 'config.toml');
}

export function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}
