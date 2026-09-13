// Architecture adapted from miuuyy/codex-chatgpt-web (MIT). See THIRD_PARTY_NOTICES.md.
import { fetchNativeCatalog } from './auth.js';
import { catalogPath } from './paths.js';
import { writeJsonAtomic } from './fs-util.js';

export const ROUTER_PREFIX = 'codexrouter/';

export function aliasSlug(accountId, nativeSlug) {
  return `${ROUTER_PREFIX}${accountId}/${nativeSlug}`;
}

export function parseAliasSlug(value) {
  if (typeof value !== 'string' || !value.startsWith(ROUTER_PREFIX)) return null;
  const rest = value.slice(ROUTER_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { accountId: rest.slice(0, slash), nativeModel: rest.slice(slash + 1) };
}

function modelsFromCatalog(catalog) {
  if (Array.isArray(catalog)) return catalog;
  if (catalog && Array.isArray(catalog.models)) return catalog.models;
  throw new Error('Unsupported Codex model catalog shape. Expected an array or { models: [] }.');
}

function cloneCatalogWithModels(template, models) {
  if (Array.isArray(template)) return models;
  return { ...structuredClone(template), models };
}

export function buildCombinedCatalog(accountCatalogs, defaultAccountId) {
  if (!accountCatalogs.length) throw new Error('At least one account catalog is required.');
  const baselineEntry = accountCatalogs.find(item => item.account.id === defaultAccountId) ?? accountCatalogs[0];
  const baseline = structuredClone(baselineEntry.catalog);
  const nativeModels = modelsFromCatalog(baseline)
    .filter(model => model && typeof model === 'object' && !String(model.slug ?? '').startsWith(ROUTER_PREFIX));

  const aliases = [];
  for (const { account, catalog } of accountCatalogs) {
    for (const source of modelsFromCatalog(catalog)) {
      if (!source || typeof source !== 'object') continue;
      const nativeSlug = source.slug;
      if (typeof nativeSlug !== 'string' || !nativeSlug || nativeSlug.startsWith(ROUTER_PREFIX)) continue;
      if (source.visibility && source.visibility !== 'list') continue;
      const display = source.display_name || source.displayName || nativeSlug;
      const alias = structuredClone(source);
      alias.slug = aliasSlug(account.id, nativeSlug);
      alias.display_name = `${display} · ${account.label}`;
      alias.description = `CodexRouter alias for ${display} using the ChatGPT account “${account.label}”.`;
      alias.visibility = 'list';
      alias.supported_in_api = true;
      alias.upgrade = null;
      delete alias.availability_nux;
      aliases.push(alias);
    }
  }
  return cloneCatalogWithModels(baseline, [...nativeModels, ...aliases]);
}

export function syncCatalog(registry) {
  if (!registry.accounts.length) throw new Error('No accounts configured.');
  const accountCatalogs = registry.accounts.map(account => ({
    account,
    catalog: fetchNativeCatalog(account.codexHome),
  }));
  const combined = buildCombinedCatalog(accountCatalogs, registry.defaultAccountId);
  writeJsonAtomic(catalogPath(), combined, 0o600);
  return { path: catalogPath(), combined, accountCatalogs };
}
