import { freshAuth } from './auth.js';

const DEFAULT_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CACHE_TTL_MS = Number(process.env.CODEXROUTER_USAGE_CACHE_MS || 15_000);
const cache = new Map();

export async function getAccountUsage(account, { force = false, fetchImpl = fetch } = {}) {
  let auth = freshAuth(account.codexHome);
  // The local registry id identifies a profile, not the ChatGPT subscription
  // currently logged into that profile. Include the upstream account identity
  // in the cache key so logout/login outside CodexRouter cannot reuse another
  // subscription's quota snapshot.
  const cacheKey = `${account.id}:${auth.accountId || 'unknown'}:${auth.expiresAt || 'unknown'}`;
  const cached = cache.get(cacheKey);
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  let response = await requestUsage(auth, fetchImpl);
  if (response.status === 401) {
    auth = freshAuth(account.codexHome, { force: true });
    response = await requestUsage(auth, fetchImpl);
    cache.delete(cacheKey);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Codex usage request failed with ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }

  const value = normalizeUsagePayload(await response.json());
  const finalCacheKey = `${account.id}:${auth.accountId || 'unknown'}:${auth.expiresAt || 'unknown'}`;
  cache.set(finalCacheKey, { cachedAt: Date.now(), value });
  return value;
}

export function invalidateAccountUsage(accountId) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${accountId}:`)) cache.delete(key);
  }
}

async function requestUsage(auth, fetchImpl) {
  const url = process.env.CODEXROUTER_USAGE_URL || DEFAULT_USAGE_URL;
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${auth.accessToken}`,
  };
  if (auth.accountId) headers['chatgpt-account-id'] = auth.accountId;
  return fetchImpl(url, { method: 'GET', headers });
}

export function normalizeUsagePayload(payload) {
  const rateLimit = objectOrNull(payload?.rate_limit)
    ?? objectOrNull(payload?.rate_limits?.rate_limit)
    ?? null;
  const spendControl = objectOrNull(payload?.spend_control);
  const primary = normalizeWindow(rateLimit?.primary_window);
  const secondary = normalizeWindow(rateLimit?.secondary_window);
  const additional = Array.isArray(payload?.additional_rate_limits)
    ? payload.additional_rate_limits.map(item => ({
        id: stringOrNull(item?.limit_name) ?? stringOrNull(item?.metered_feature),
        model: stringOrNull(item?.normal_model_slug),
        primary: normalizeWindow(item?.rate_limit?.primary_window),
        secondary: normalizeWindow(item?.rate_limit?.secondary_window),
        allowed: booleanOrNull(item?.rate_limit?.allowed),
        limitReached: item?.rate_limit?.limit_reached === true,
      }))
    : [];

  const explicitLimitReached = rateLimit?.limit_reached === true
    || spendControl?.reached === true;
  const allowed = booleanOrNull(rateLimit?.allowed);
  const status = explicitLimitReached ? 'cooldown' : allowed === true ? 'available' : 'unknown';
  const reachedType = normalizeReachedType(payload?.rate_limit_reached_type);

  const reachedWindows = [primary, secondary, ...additional.flatMap(item => [item.primary, item.secondary])]
    .filter(window => window && window.usedPercent != null && window.usedPercent >= 100 && window.resetsAt != null);
  const allFutureResets = [primary, secondary, ...additional.flatMap(item => [item.primary, item.secondary])]
    .filter(window => window?.resetsAt != null && window.resetsAt * 1000 > Date.now());
  const resetPool = reachedWindows.length ? reachedWindows : explicitLimitReached ? allFutureResets : [];
  const cooldownUntil = resetPool.length
    ? Math.max(...resetPool.map(window => window.resetsAt))
    : null;

  const individual = objectOrNull(spendControl?.individual_limit);
  return {
    status,
    allowed,
    limitReached: explicitLimitReached,
    cooldownUntil,
    reachedType,
    primary,
    secondary,
    additional,
    spendControl: spendControl ? {
      reached: spendControl.reached === true,
      usedPercent: numberOrNull(individual?.used_percent),
      remainingPercent: numberOrNull(individual?.remaining_percent),
      resetsAt: timestampOrNull(individual?.reset_at),
    } : null,
    checkedAt: new Date().toISOString(),
  };
}

function normalizeWindow(window) {
  if (!window || typeof window !== 'object') return null;
  const usedPercent = numberOrNull(window.used_percent);
  return {
    usedPercent,
    remainingPercent: usedPercent == null ? null : Math.max(0, Math.min(100, 100 - usedPercent)),
    windowSeconds: numberOrNull(window.limit_window_seconds),
    resetAfterSeconds: numberOrNull(window.reset_after_seconds),
    resetsAt: timestampOrNull(window.reset_at),
  };
}

function normalizeReachedType(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  return stringOrNull(value.type) ?? stringOrNull(value.kind) ?? null;
}

function timestampOrNull(value) {
  const number = numberOrNull(value);
  return number == null || number <= 0 ? null : Math.floor(number);
}

function numberOrNull(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
