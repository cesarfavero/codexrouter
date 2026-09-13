import fs from 'node:fs';
import { accountHome, registryPath } from './paths.js';
import { readJson, writeJsonAtomic } from './fs-util.js';

const EMPTY = { version: 1, defaultAccountId: null, accounts: [] };

export function slugifyAccountId(input) {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!slug) throw new Error('Account name must contain at least one letter or number.');
  return slug;
}

export function loadRegistry() {
  const registry = readJson(registryPath(), EMPTY);
  if (registry?.version !== 1 || !Array.isArray(registry.accounts)) {
    throw new Error(`Unsupported or invalid registry: ${registryPath()}`);
  }
  return registry;
}

export function saveRegistry(registry) {
  writeJsonAtomic(registryPath(), registry);
}

export function getAccount(idOrLabel) {
  const registry = loadRegistry();
  const needle = idOrLabel.toLowerCase();
  const account = registry.accounts.find(item =>
    item.id.toLowerCase() === needle || item.label.toLowerCase() === needle
  );
  if (!account) throw new Error(`Unknown account: ${idOrLabel}`);
  return { registry, account };
}

export function registerAccount(label, metadata = {}) {
  const registry = loadRegistry();
  const base = slugifyAccountId(label);
  let id = base;
  let suffix = 2;
  while (registry.accounts.some(account => account.id === id)) id = `${base}-${suffix++}`;
  const account = {
    id,
    label,
    codexHome: accountHome(id),
    email: metadata.email ?? null,
    plan: metadata.plan ?? null,
    createdAt: new Date().toISOString(),
  };
  registry.accounts.push(account);
  if (!registry.defaultAccountId) registry.defaultAccountId = id;
  saveRegistry(registry);
  return account;
}

export function updateAccount(id, patch) {
  const registry = loadRegistry();
  const index = registry.accounts.findIndex(account => account.id === id);
  if (index < 0) throw new Error(`Unknown account: ${id}`);
  registry.accounts[index] = { ...registry.accounts[index], ...patch, id };
  saveRegistry(registry);
  return registry.accounts[index];
}

export function removeAccount(idOrLabel, { removeProfile = false } = {}) {
  const { registry, account } = getAccount(idOrLabel);
  registry.accounts = registry.accounts.filter(item => item.id !== account.id);
  if (registry.defaultAccountId === account.id) {
    registry.defaultAccountId = registry.accounts[0]?.id ?? null;
  }
  saveRegistry(registry);
  if (removeProfile) fs.rmSync(account.codexHome, { recursive: true, force: true });
  return account;
}

export function setDefaultAccount(idOrLabel) {
  const { registry, account } = getAccount(idOrLabel);
  registry.defaultAccountId = account.id;
  saveRegistry(registry);
  return account;
}

export function defaultAccount() {
  const registry = loadRegistry();
  const account = registry.accounts.find(item => item.id === registry.defaultAccountId)
    ?? registry.accounts[0];
  if (!account) throw new Error('No accounts configured. Run: codexrouter account add <name>');
  return account;
}
