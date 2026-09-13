// Architecture adapted from miuuyy/codex-chatgpt-web (MIT). See THIRD_PARTY_NOTICES.md.
import { fetchNativeCatalog } from './auth.js';
import { catalogPath } from './paths.js';
import { writeJsonAtomic } from './fs-util.js';
import { saveRegistry } from './store.js';

export const ROUTER_PREFIX = 'codexrouter/';
export const GATEWAY_SLUG = 'codexrouter/gateway';
export const GATEWAY_DISPLAY_NAME = 'CodexRouter';

export function isGatewaySlug(value) {
  return value === GATEWAY_SLUG;
}

export function modelsFromCatalog(catalog) {
  if (Array.isArray(catalog)) return catalog;
  if (catalog && Array.isArray(catalog.models)) return catalog.models;
  throw new Error('Unsupported Codex model catalog shape. Expected an array or { models: [] }.');
}

function cloneCatalogWithModels(template, models) {
  if (Array.isArray(template)) return models;
  return { ...structuredClone(template), models };
}

export function listVisibleNativeModels(catalog) {
  return modelsFromCatalog(catalog).filter(model =>
    model
    && typeof model === 'object'
    && typeof model.slug === 'string'
    && model.slug
    && !model.slug.startsWith(ROUTER_PREFIX)
    && (!model.visibility || model.visibility === 'list')
  );
}

export function chooseNativeModel(catalog, preferredModel = null) {
  const models = listVisibleNativeModels(catalog);
  if (!models.length) return null;
  if (preferredModel && models.some(model => model.slug === preferredModel)) return preferredModel;
  return models.find(model => model.is_default === true)?.slug ?? models[0].slug;
}

export function buildGatewayCatalog(accountCatalogs, activeAccountId) {
  if (!accountCatalogs.length) throw new Error('At least one account catalog is required.');
  const activeEntry = accountCatalogs.find(item => item.account.id === activeAccountId) ?? accountCatalogs[0];
  const nativeModel = chooseNativeModel(activeEntry.catalog, activeEntry.account.preferredModel);
  if (!nativeModel) {
    throw new Error(`The active account “${activeEntry.account.label}” does not expose a list-visible Codex model.`);
  }
  const source = listVisibleNativeModels(activeEntry.catalog).find(model => model.slug === nativeModel);
  const gateway = structuredClone(source);
  gateway.slug = GATEWAY_SLUG;
  gateway.display_name = GATEWAY_DISPLAY_NAME;
  gateway.description = 'Single CodexRouter gateway. Account and native model are managed in the CodexRouter desktop app.';
  gateway.visibility = 'list';
  gateway.supported_in_api = true;
  gateway.is_default = true;
  gateway.upgrade = null;
  delete gateway.availability_nux;
  return cloneCatalogWithModels(activeEntry.catalog, [gateway]);
}

export function syncCatalog(registry) {
  if (!registry.accounts.length) throw new Error('No accounts configured.');

  const accountCatalogs = registry.accounts.map(account => ({
    account,
    catalog: fetchNativeCatalog(account.codexHome),
  }));

  let registryChanged = false;
  for (const { account, catalog } of accountCatalogs) {
    const visible = listVisibleNativeModels(catalog);
    const preferredModel = chooseNativeModel(catalog, account.preferredModel);
    if (account.preferredModel !== preferredModel || account.nativeModelCount !== visible.length) {
      account.preferredModel = preferredModel;
      account.nativeModelCount = visible.length;
      registryChanged = true;
    }
  }
  if (registryChanged) saveRegistry(registry);

  const activeEntry = accountCatalogs.find(item => item.account.id === registry.defaultAccountId) ?? accountCatalogs[0];
  const nativeModel = chooseNativeModel(activeEntry.catalog, activeEntry.account.preferredModel);
  const combined = buildGatewayCatalog(accountCatalogs, activeEntry.account.id);
  writeJsonAtomic(catalogPath(), combined, 0o600);

  return {
    path: catalogPath(),
    combined,
    accountCatalogs,
    activeAccount: activeEntry.account,
    nativeModel,
  };
}
