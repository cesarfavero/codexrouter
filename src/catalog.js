// Architecture adapted from miuuyy/codex-chatgpt-web (MIT). See THIRD_PARTY_NOTICES.md.
import { fetchNativeCatalog } from './auth.js';
import { catalogPath } from './paths.js';
import { writeJsonAtomic } from './fs-util.js';
import { saveRegistry } from './store.js';

export const ROUTER_PREFIX = 'codexrouter/';
export const GATEWAY_SLUG = 'codexrouter/gateway';
export const GATEWAY_DISPLAY_NAME = 'CodexRouter';
const DEFAULT_MODEL_ORDER = ['gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'];

export function isGatewaySlug(value) {
  return value === GATEWAY_SLUG;
}

export function accountModelSlug(accountId, modelSlug) {
  return `${ROUTER_PREFIX}${accountId}/${modelSlug}`;
}

export function parseAccountModelSlug(value) {
  if (typeof value !== 'string' || !value.startsWith(ROUTER_PREFIX) || isGatewaySlug(value)) return null;
  const [, accountId, ...modelParts] = value.split('/');
  return accountId && modelParts.length ? { accountId, modelSlug: modelParts.join('/') } : null;
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

export function summarizeNativeModels(catalog) {
  return listVisibleNativeModels(catalog).map(model => ({
    slug: model.slug,
    name: model.display_name ?? model.name ?? model.slug,
  }));
}

export function chooseNativeModel(catalog, preferredModel = null) {
  const models = listVisibleNativeModels(catalog);
  if (!models.length) return null;
  if (preferredModel && models.some(model => model.slug === preferredModel)) return preferredModel;
  return DEFAULT_MODEL_ORDER.find(slug => models.some(model => model.slug === slug))
    ?? models.find(model => model.is_default !== true)?.slug
    ?? models[0].slug;
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
  gateway.description = 'CodexRouter managed gateway. Native Codex models and account-specific models are available in the Codex picker.';
  gateway.visibility = 'list';
  gateway.supported_in_api = true;
  gateway.is_default = true;
  gateway.upgrade = null;
  delete gateway.availability_nux;
  const models = [gateway];
  for (const { account, catalog } of accountCatalogs) {
    for (const sourceModel of listVisibleNativeModels(catalog)) {
      const model = structuredClone(sourceModel);
      if (account.id !== activeEntry.account.id) {
        model.slug = accountModelSlug(account.id, sourceModel.slug);
        model.display_name = `${sourceModel.display_name ?? sourceModel.name ?? sourceModel.slug} · ${account.label}`;
      }
      model.visibility = 'list';
      model.supported_in_api = true;
      models.push(model);
    }
  }
  return cloneCatalogWithModels(activeEntry.catalog, models.filter((model, index, list) => list.findIndex(item => item.slug === model.slug) === index));
}

export function syncCatalog(registry) {
  if (!registry.accounts.length) throw new Error('No accounts configured.');

  const accountCatalogs = registry.accounts.flatMap(account => {
    try {
      return [{ account, catalog: fetchNativeCatalog(account.codexHome) }];
    } catch {
      return [];
    }
  });
  if (!accountCatalogs.length) throw new Error('No connected account returned a usable Codex model catalog.');

  let registryChanged = false;
  for (const { account, catalog } of accountCatalogs) {
    const visible = listVisibleNativeModels(catalog);
    const preferredModel = account.modelSelectionSource === 'user'
      ? chooseNativeModel(catalog, account.preferredModel)
      : chooseNativeModel(catalog);
    if (account.preferredModel !== preferredModel || account.nativeModelCount !== visible.length) {
      account.preferredModel = preferredModel;
      account.modelSelectionSource = account.modelSelectionSource === 'user' ? 'user' : 'automatic';
      account.nativeModelCount = visible.length;
      registryChanged = true;
    }
    const availableModels = summarizeNativeModels(catalog);
    if (JSON.stringify(account.availableModels ?? []) !== JSON.stringify(availableModels)) {
      account.availableModels = availableModels;
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
