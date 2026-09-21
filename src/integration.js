// Architecture adapted from miuuyy/codex-chatgpt-web (MIT). See THIRD_PARTY_NOTICES.md.
import fs from 'node:fs';
import path from 'node:path';
import { catalogPath, integrationJournalPath, mainCodexConfigPath } from './paths.js';
import { ensureDir, readJson, writeJsonAtomic, writeTextAtomic } from './fs-util.js';

const MANAGED_KEYS = ['openai_base_url', 'model_catalog_json', 'model'];
const ROUTER_MODEL_PREFIX = 'codexrouter/';
const GATEWAY_MODEL = 'codexrouter/gateway';
const LEGACY_ROUTER_HOME_MARKERS = ['/.codexrouter/', '/.codex-chatgpt-web/'];

function quoteToml(value) {
  return JSON.stringify(value);
}

function assignmentRegex(key) {
  return new RegExp(`^\\s*${key}\\s*=\\s*.+$`);
}

function parseTomlStringAssignment(line, key) {
  if (!line) return null;
  const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")\\s*(?:#.*)?$`));
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function normalizePathLike(value) {
  return value.replaceAll('\\', '/');
}

function isRouterCatalogAssignment(line) {
  const value = parseTomlStringAssignment(line, 'model_catalog_json');
  if (!value) return false;
  const normalized = normalizePathLike(value);
  if (normalized === normalizePathLike(catalogPath())) return true;
  return LEGACY_ROUTER_HOME_MARKERS.some(marker => normalized.includes(marker));
}

function firstTableIndex(lines) {
  const index = lines.findIndex(line => /^\s*\[/.test(line));
  return index < 0 ? lines.length : index;
}

function findTopLevelEntries(lines, key) {
  const regex = assignmentRegex(key);
  const matches = [];
  for (let i = 0; i < firstTableIndex(lines); i++) {
    if (/^\s*#/.test(lines[i])) continue;
    if (regex.test(lines[i])) matches.push({ index: i, line: lines[i] });
  }
  return matches;
}

function findTopLevel(lines, key) {
  const matches = findTopLevelEntries(lines, key);
  if (matches.length > 1 && new Set(matches.map(match => match.line)).size > 1) {
    throw new Error(`Conflicting duplicate top-level ${key} assignments in Codex config.`);
  }
  return matches[0] ?? null;
}

function setTopLevel(lines, key, line) {
  const matches = findTopLevelEntries(lines, key);
  if (matches.length) {
    findTopLevel(lines, key);
    lines[matches[0].index] = line;
    for (const duplicate of matches.slice(1).reverse()) lines.splice(duplicate.index, 1);
    return;
  }
  lines.splice(firstTableIndex(lines), 0, line);
}

function removeManagedLine(lines, key, expected) {
  const matches = findTopLevelEntries(lines, key);
  if (!matches.length) return;
  if (matches.some(match => match.line !== expected)) {
    throw new Error(`Codex ${key} changed after CodexRouter install; refusing to overwrite it.`);
  }
  for (const match of matches.reverse()) lines.splice(match.index, 1);
}

function removeRouterModelSelection(lines) {
  const current = findTopLevel(lines, 'model');
  if (!current) return;
  const model = parseTomlStringAssignment(current.line, 'model');
  if (model?.startsWith(ROUTER_MODEL_PREFIX)) lines.splice(current.index, 1);
}

function journalManagedKeys(journal) {
  return MANAGED_KEYS.filter(key => typeof journal?.installed?.[key] === 'string');
}

function shouldRestorePrevious(key, previous, previousWasRouterIntegration) {
  if (!previous?.line) return false;
  if (key === 'model') {
    const model = parseTomlStringAssignment(previous.line, 'model');
    return Boolean(model && !model.startsWith(ROUTER_MODEL_PREFIX));
  }
  return !previousWasRouterIntegration;
}

function assertInstalledValuesUnchanged(lines, journal) {
  for (const key of journalManagedKeys(journal)) {
    const current = findTopLevel(lines, key);
    if (!current || current.line !== journal.installed[key]) {
      throw new Error(`Codex ${key} changed after CodexRouter install; refusing to overwrite it.`);
    }
  }
}

export function installIntegration({ port = 17842 } = {}) {
  const configPath = mainCodexConfigPath();
  ensureDir(path.dirname(configPath));
  let text = '';
  try { text = fs.readFileSync(configPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const hadTrailingNewline = text.endsWith('\n');
  const lines = text ? text.replace(/\n$/, '').split(/\r?\n/) : [];
  const previous = Object.fromEntries(MANAGED_KEYS.map(key => [key, findTopLevel(lines, key)]));
  const installed = {
    openai_base_url: `openai_base_url = ${quoteToml(`http://127.0.0.1:${port}/v1`)}`,
    model_catalog_json: `model_catalog_json = ${quoteToml(catalogPath())}`,
    model: `model = ${quoteToml(GATEWAY_MODEL)}`,
  };
  setTopLevel(lines, 'openai_base_url', installed.openai_base_url);
  setTopLevel(lines, 'model_catalog_json', installed.model_catalog_json);
  setTopLevel(lines, 'model', installed.model);
  const rendered = `${lines.join('\n')}${hadTrailingNewline || lines.length ? '\n' : ''}`;
  writeTextAtomic(configPath, rendered, 0o600);
  const journal = { version: 2, configPath, port, previous, installed, installedAt: new Date().toISOString() };
  writeJsonAtomic(integrationJournalPath(), journal);
  return journal;
}

export function uninstallIntegration() {
  const journal = readJson(integrationJournalPath());
  if (!journal) throw new Error('CodexRouter integration is not installed.');
  const text = fs.readFileSync(journal.configPath, 'utf8');
  const lines = text.replace(/\n$/, '').split(/\r?\n/);
  const previousWasRouterIntegration = isRouterCatalogAssignment(journal.previous?.model_catalog_json?.line);

  for (const key of journalManagedKeys(journal)) {
    const previous = journal.previous?.[key];
    if (shouldRestorePrevious(key, previous, previousWasRouterIntegration)) {
      const current = findTopLevel(lines, key);
      if (!current || current.line !== journal.installed[key]) {
        throw new Error(`Codex ${key} changed after install; refusing automatic restore.`);
      }
      lines[current.index] = previous.line;
    } else {
      removeManagedLine(lines, key, journal.installed[key]);
    }
  }

  // Legacy journals did not manage the model key. Remove stale Router-only
  // selections left by older integrations, but never remove a native model.
  removeRouterModelSelection(lines);
  while (lines.length && lines[0] === '' && lines[1] === '') lines.shift();
  writeTextAtomic(journal.configPath, `${lines.join('\n')}\n`, 0o600);
  fs.rmSync(integrationJournalPath(), { force: true });
  return journal;
}

export function ensureGatewayDefaultModel() {
  const journal = readJson(integrationJournalPath());
  if (!journal) throw new Error('CodexRouter integration is not installed.');
  const text = fs.readFileSync(journal.configPath, 'utf8');
  const hadTrailingNewline = text.endsWith('\n');
  const lines = text ? text.replace(/\n$/, '').split(/\r?\n/) : [];
  const trackedWithoutModel = journalManagedKeys(journal).filter(key => key !== 'model');
  for (const key of trackedWithoutModel) {
    const current = findTopLevel(lines, key);
    if (!current || current.line !== journal.installed[key]) {
      throw new Error(`Codex ${key} changed after CodexRouter install; refusing to repair the gateway model.`);
    }
  }

  const target = `model = ${quoteToml(GATEWAY_MODEL)}`;
  const current = findTopLevel(lines, 'model');
  if (current?.line === target && journal.installed?.model === target) {
    return { changed: false, model: GATEWAY_MODEL };
  }

  const currentModel = parseTomlStringAssignment(current?.line, 'model');
  const previousModel = currentModel && !currentModel.startsWith(ROUTER_MODEL_PREFIX)
    ? current
    : journal.previous?.model ?? null;

  setTopLevel(lines, 'model', target);
  const rendered = `${lines.join('\n')}${hadTrailingNewline || lines.length ? '\n' : ''}`;
  writeTextAtomic(journal.configPath, rendered, 0o600);
  const nextJournal = {
    ...journal,
    version: 2,
    previous: { ...(journal.previous || {}), model: previousModel },
    installed: { ...(journal.installed || {}), model: target },
  };
  writeJsonAtomic(integrationJournalPath(), nextJournal);
  return { changed: true, model: GATEWAY_MODEL, previousModel: currentModel ?? null };
}

export function integrationStatus() {
  try {
    const journal = readJson(integrationJournalPath());
    const text = fs.readFileSync(journal.configPath, 'utf8');
    const lines = text.replace(/\n$/, '').split(/\r?\n/);
    const keys = journalManagedKeys(journal);
    const matches = keys.length > 0 && keys.every(key => findTopLevel(lines, key)?.line === journal.installed[key]);
    const activeModel = parseTomlStringAssignment(findTopLevel(lines, 'model')?.line, 'model');
    return {
      installed: matches,
      journal,
      activeModel,
      gatewayDefault: activeModel === GATEWAY_MODEL,
    };
  } catch {
    return { installed: false, journal: null, activeModel: null, gatewayDefault: false };
  }
}
