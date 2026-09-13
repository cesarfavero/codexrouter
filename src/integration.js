// Architecture adapted from miuuyy/codex-chatgpt-web (MIT). See THIRD_PARTY_NOTICES.md.
import fs from 'node:fs';
import path from 'node:path';
import { catalogPath, integrationJournalPath, mainCodexConfigPath } from './paths.js';
import { ensureDir, readJson, writeJsonAtomic, writeTextAtomic } from './fs-util.js';

const MANAGED_KEYS = ['openai_base_url', 'model_catalog_json'];

function quoteToml(value) {
  return JSON.stringify(value);
}

function assignmentRegex(key) {
  return new RegExp(`^\\s*${key}\\s*=\\s*.+$`);
}

function firstTableIndex(lines) {
  const index = lines.findIndex(line => /^\s*\[/.test(line));
  return index < 0 ? lines.length : index;
}

function findTopLevel(lines, key) {
  const regex = assignmentRegex(key);
  const matches = [];
  for (let i = 0; i < firstTableIndex(lines); i++) {
    if (/^\s*#/.test(lines[i])) continue;
    if (regex.test(lines[i])) matches.push({ index: i, line: lines[i] });
  }
  if (matches.length > 1) throw new Error(`Duplicate top-level ${key} assignments in Codex config.`);
  return matches[0] ?? null;
}

function setTopLevel(lines, key, line) {
  const current = findTopLevel(lines, key);
  if (current) {
    lines[current.index] = line;
    return;
  }
  lines.splice(firstTableIndex(lines), 0, line);
}

function removeManagedLine(lines, key, expected) {
  const current = findTopLevel(lines, key);
  if (!current) return;
  if (current.line !== expected) {
    throw new Error(`Codex ${key} changed after CodexRouter install; refusing to overwrite it.`);
  }
  lines.splice(current.index, 1);
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
  };
  setTopLevel(lines, 'openai_base_url', installed.openai_base_url);
  setTopLevel(lines, 'model_catalog_json', installed.model_catalog_json);
  const rendered = `${lines.join('\n')}${hadTrailingNewline || lines.length ? '\n' : ''}`;
  writeTextAtomic(configPath, rendered, 0o600);
  const journal = { version: 1, configPath, port, previous, installed, installedAt: new Date().toISOString() };
  writeJsonAtomic(integrationJournalPath(), journal);
  return journal;
}

export function uninstallIntegration() {
  const journal = readJson(integrationJournalPath());
  if (!journal) throw new Error('CodexRouter integration is not installed.');
  let text = fs.readFileSync(journal.configPath, 'utf8');
  const lines = text.replace(/\n$/, '').split(/\r?\n/);
  for (const key of MANAGED_KEYS) {
    const previous = journal.previous[key];
    if (previous?.line) {
      const current = findTopLevel(lines, key);
      if (!current || current.line !== journal.installed[key]) {
        throw new Error(`Codex ${key} changed after install; refusing automatic restore.`);
      }
      lines[current.index] = previous.line;
    } else {
      removeManagedLine(lines, key, journal.installed[key]);
    }
  }
  while (lines.length && lines[0] === '' && lines[1] === '') lines.shift();
  writeTextAtomic(journal.configPath, `${lines.join('\n')}\n`, 0o600);
  fs.rmSync(integrationJournalPath(), { force: true });
  return journal;
}

export function integrationStatus() {
  try {
    const journal = readJson(integrationJournalPath());
    const text = fs.readFileSync(journal.configPath, 'utf8');
    const lines = text.replace(/\n$/, '').split(/\r?\n/);
    const matches = MANAGED_KEYS.every(key => findTopLevel(lines, key)?.line === journal.installed[key]);
    return { installed: matches, journal };
  } catch {
    return { installed: false, journal: null };
  }
}
