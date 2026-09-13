// Architecture adapted from miuuyy/codex-chatgpt-web (MIT). See THIRD_PARTY_NOTICES.md.
import http from 'node:http';
import { Readable } from 'node:stream';
import { freshAuth } from './auth.js';
import { GATEWAY_SLUG, isGatewaySlug } from './catalog.js';
import { allAccounts, defaultAccount, setDefaultAccount } from './store.js';
import { catalogPath } from './paths.js';
import { readJson } from './fs-util.js';
import { getAccountUsage } from './usage.js';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te',
  'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);
const LOW_USAGE_REMAINING_PERCENT = Number(process.env.CODEXROUTER_LOW_USAGE_REMAINING_PERCENT || 10);

export function startRouter({
  port = 17842,
  host = '127.0.0.1',
  upstreamBase = process.env.CODEXROUTER_UPSTREAM_BASE || 'https://chatgpt.com/backend-api/codex',
  usageReader = getAccountUsage,
} = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'codexrouter', model: GATEWAY_SLUG }));
        return;
      }
      if (req.method === 'GET' && (req.url === '/v1/models' || req.url?.startsWith('/v1/models?'))) {
        const catalog = readJson(catalogPath());
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(catalog));
        return;
      }

      const endpoint = routeEndpoint(req.method, req.url);
      if (!endpoint) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'CodexRouter endpoint not found.' } }));
        return;
      }

      const raw = await readBody(req);
      let body = raw;
      let account = defaultAccount();
      const contentType = String(req.headers['content-type'] || '');
      let gatewayRequest = false;

      if (raw.length && contentType.includes('application/json')) {
        const parsed = JSON.parse(raw.toString('utf8'));
        gatewayRequest = isGatewaySlug(parsed?.model);
        if (gatewayRequest) {
          account = await selectGatewayAccount(account, usageReader);
          if (!account.preferredModel) throw httpError(503, `The active account “${account.label}” does not have a native Codex model selected. Sync the gateway catalog first.`);
          if (account.preferredEffort) {
            parsed.reasoning = { ...(parsed.reasoning || {}), effort: parsed.reasoning?.effort || account.preferredEffort };
          }
          parsed.model = account.preferredModel;
          body = Buffer.from(JSON.stringify(parsed));
        }
      }

      let upstream = await forward({ req, body, account, endpoint, upstreamBase, forceRefresh: false });
      if (upstream.status === 401) {
        await upstream.arrayBuffer();
        upstream = await forward({ req, body, account, endpoint, upstreamBase, forceRefresh: true });
      }
      if (gatewayRequest && upstream.status === 429) {
        const fallback = await selectGatewayAccount(account, usageReader, { force: true, exclude: new Set([account.id]) });
        if (fallback && fallback.id !== account.id) {
          if (!fallback.preferredModel) throw httpError(503, `The fallback account “${fallback.label}” does not have a native Codex model selected. Sync the gateway catalog first.`);
          account = fallback;
          body = Buffer.from(JSON.stringify({ ...JSON.parse(body.toString('utf8')), model: account.preferredModel }));
          upstream = await forward({ req, body, account, endpoint, upstreamBase, forceRefresh: false });
        }
      }
      await writeResponse(res, upstream);
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          message: error?.message || String(error),
          type: error?.type || (status === 429 ? 'usage_limit_reached' : 'codexrouter_error'),
          cooldown_until: error?.cooldownUntil ?? null,
        },
      }));
    }
  });
  server.listen(port, host);
  return server;
}

function routeEndpoint(method, url = '') {
  if (method !== 'POST') return null;
  const path = url.split('?')[0];
  const map = {
    '/v1/responses': 'responses',
    '/v1/responses/compact': 'responses/compact',
    '/v1/alpha/search': 'alpha/search',
    '/v1/images/generations': 'images/generations',
    '/v1/images/edits': 'images/edits',
  };
  return map[path] || null;
}

async function readUsageSafely(usageReader, account, options = {}) {
  try {
    return await usageReader(account, options);
  } catch {
    return null;
  }
}

async function selectGatewayAccount(active, usageReader, { force = false, exclude = new Set() } = {}) {
  const accounts = allAccounts();
  const candidates = [active, ...accounts.filter(account => account.id !== active.id)]
    .filter((account, index, list) => !exclude.has(account.id) && list.findIndex(item => item.id === account.id) === index);
  for (const account of candidates) {
    const usage = await readUsageSafely(usageReader, account, { force });
    if (usageIsHealthy(usage)) {
      if (account.id !== active.id) setDefaultAccount(account.id);
      return account;
    }
  }
  throw cooldownError(active, await readUsageSafely(usageReader, active, { force }));
}

function usageIsHealthy(usage) {
  if (!usage || usage.status === 'cooldown' || usage.allowed === false) return false;
  const remaining = [usage.primary?.remainingPercent, usage.secondary?.remainingPercent, usage.spendControl?.remainingPercent]
    .filter(value => Number.isFinite(value));
  return !remaining.some(value => value <= LOW_USAGE_REMAINING_PERCENT);
}

function cooldownError(account, usage) {
  const reset = usage.cooldownUntil
    ? new Date(usage.cooldownUntil * 1000).toISOString()
    : null;
  const suffix = reset ? ` until ${reset}` : '';
  const error = httpError(429, `The active account “${account.label}” is in cooldown${suffix}. Select another account explicitly in CodexRouter or wait for this account to reset.`);
  error.type = 'usage_limit_reached';
  error.cooldownUntil = usage.cooldownUntil ?? null;
  return error;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function forward({ req, body, account, endpoint, upstreamBase, forceRefresh }) {
  const auth = freshAuth(account.codexHome, { force: forceRefresh });
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value == null || HOP_BY_HOP.has(name.toLowerCase())) continue;
    if (name.toLowerCase() === 'authorization' || name.toLowerCase() === 'chatgpt-account-id') continue;
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else headers.set(name, String(value));
  }
  headers.set('authorization', `Bearer ${auth.accessToken}`);
  if (auth.accountId) headers.set('chatgpt-account-id', auth.accountId);
  const upstream = `${upstreamBase.replace(/\/$/, '')}/${endpoint}`;
  return fetch(upstream, { method: 'POST', headers, body });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function writeResponse(res, upstream) {
  const headers = {};
  for (const [name, value] of upstream.headers) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
  }
  res.writeHead(upstream.status, headers);
  if (!upstream.body) return res.end();
  await new Promise((resolve, reject) => {
    Readable.fromWeb(upstream.body).on('error', reject).pipe(res).on('finish', resolve).on('error', reject);
  });
}
