// Architecture adapted from miuuyy/codex-chatgpt-web (MIT). See THIRD_PARTY_NOTICES.md.
import http from 'node:http';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { brotliDecompressSync, gunzipSync, inflateSync, zstdDecompressSync } from 'node:zlib';
import { freshAuth } from './auth.js';
import { GATEWAY_SLUG, isGatewaySlug, parseAccountModelSlug } from './catalog.js';
import { allAccounts, defaultAccount, setDefaultAccount } from './store.js';
import { catalogPath, mainCodexHome } from './paths.js';
import { readJson } from './fs-util.js';
import { getAccountUsage } from './usage.js';
import { createJevAdvisor, summarizeJevDecision } from './jev.js';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te',
  'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);
const MAX_DECODED_REQUEST_BYTES = 128 * 1024 * 1024;
const HEADROOM_TIE_MARGIN = 5;
const FRESH_USAGE_THRESHOLD_PERCENT = 10;

export function startRouter({
  port = 17842,
  host = '127.0.0.1',
  upstreamBase = process.env.CODEXROUTER_UPSTREAM_BASE || 'https://chatgpt.com/backend-api/codex',
  officialUpstreamBase = process.env.CODEXROUTER_OFFICIAL_UPSTREAM_BASE || upstreamBase,
  usageReader = getAccountUsage,
  jevAdvisor = createJevAdvisor(),
  onRequest = null,
} = {}) {
  const upgradedSockets = new Set();
  const server = http.createServer(async (req, res) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let routedAccount = null;
    let routedModel = null;
    let jevDecision = null;
    let jevRouting = null;
    let jevAccountRouting = null;
    const attempts = [];
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          service: 'codexrouter',
          model: GATEWAY_SLUG,
          jev: {
            ...(jevAdvisor?.status?.() ?? { mode: 'off', configured: false }),
            requiresModel: GATEWAY_SLUG,
          },
        }));
        return;
      }
      if (req.method === 'GET' && (req.url === '/v1/models' || req.url?.startsWith('/v1/models?'))) {
        const catalog = readJson(catalogPath());
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(catalog));
        return;
      }
      if (req.method === 'GET' && req.url?.split('?')[0] === '/v1/responses') {
        res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Responses WebSocket transport is not enabled on this local route');
        await emitRequest(onRequest, { requestId, account: null, endpoint: 'responses', model: null, status: 426, transport: 'websocket-negotiation', method: 'GET', durationMs: Date.now() - startedAt, attempts: [] });
        return;
      }

      const endpoint = routeEndpoint(req.method, req.url);
      if (!endpoint) {
        const upstream = await forwardOfficial({ req, body: await readBody(req), officialBase: officialUpstreamBase, forceRefresh: false });
        await writeResponse(res, upstream);
        await emitRequest(onRequest, { requestId, account: null, endpoint: req.url?.split('?')[0] || null, model: null, status: upstream.status, transport: 'official-http', method: req.method || null, durationMs: Date.now() - startedAt, attempts: [] });
        return;
      }

      const raw = await readBody(req);
      let body = raw;
      let decodedRequestBody = false;
      let account = defaultAccount();
      routedAccount = account;
      const contentType = String(req.headers['content-type'] || '');
      let gatewayRequest = false;
      let explicitAccountModel = false;

      if (raw.length && contentType.includes('application/json')) {
        body = decodeRequestBody(raw, req.headers['content-encoding']);
        decodedRequestBody = body !== raw;
        const parsed = JSON.parse(body.toString('utf8'));
        const qualified = parseAccountModelSlug(parsed?.model);
        explicitAccountModel = Boolean(qualified);
        const requestedModel = parsed?.model;
        gatewayRequest = isGatewaySlug(requestedModel) || Boolean(qualified) || typeof requestedModel === 'string';
        if (jevAdvisor?.mode !== 'off' && gatewayRequest && !isGatewaySlug(requestedModel)) {
          jevDecision = {
            status: qualified ? 'bypassed-account-model' : 'bypassed-explicit-model',
          };
          jevRouting = {
            mode: jevAdvisor.mode,
            applicable: false,
            applyModel: false,
            applyEffort: false,
          };
        }
        if (gatewayRequest) {
          if (qualified) {
            account = allAccounts().find(candidate => candidate.id === qualified.accountId);
            if (!account || account.enabled === false) throw httpError(400, `CodexRouter account is disabled: ${requestedModel}`);
            let usage = await readUsageSafely(usageReader, account);
            if (usageNeedsFreshRead(usage)) usage = await readUsageSafely(usageReader, account, { force: true });
            if (!usageIsHealthy(usage)) throw cooldownError(account, usage);
            parsed.model = qualified.modelSlug;
          } else {
            const candidates = await listHealthyGatewayAccounts(account, usageReader);
            account = chooseGatewayAccount(candidates, account);
            if (account.id !== defaultAccount().id) setDefaultAccount(account.id);
            if (!account.preferredModel) throw httpError(503, `The active account “${account.label}” does not have a native Codex model selected. Sync the gateway catalog first.`);
            if (isGatewaySlug(requestedModel) && jevAdvisor?.mode !== 'off') {
              jevDecision = await adviseJevSafely(jevAdvisor, { request: parsed, account, endpoint, accountCandidates: candidates });
              jevAccountRouting = jevAdvisor?.resolveAccount?.(candidates, jevDecision) ?? null;
              if (jevAccountRouting?.applyAccount) {
                const recommended = candidates.find(candidate => candidate.account.id === jevAccountRouting.recommendedAccountId);
                if (recommended?.account?.preferredModel) account = recommended.account;
              }
              if (account.id !== defaultAccount().id) setDefaultAccount(account.id);
            }
            let selectedModel = isGatewaySlug(requestedModel) ? account.preferredModel : requestedModel;
            if (isGatewaySlug(requestedModel) && jevAdvisor?.mode !== 'off') {
              jevRouting = jevAdvisor?.resolve?.(account, parsed, jevDecision) ?? null;
              if (jevRouting?.applyModel && jevRouting.recommendedModel) selectedModel = jevRouting.recommendedModel;
              if (jevRouting?.applyEffort && jevRouting.recommendedEffort) {
                parsed.reasoning = { ...(parsed.reasoning || {}), effort: jevRouting.recommendedEffort };
              }
            }
            parsed.model = selectedModel;
          }
          if (account.preferredEffort) {
            parsed.reasoning = { ...(parsed.reasoning || {}), effort: parsed.reasoning?.effort || account.preferredEffort };
          }
          body = Buffer.from(JSON.stringify(parsed));
          routedAccount = account;
          routedModel = parsed.model ?? null;
        }
      }

      let upstream = await forward({ req, body, account, endpoint, upstreamBase, forceRefresh: false, decodedRequestBody });
      attempts.push(await describeAttempt(upstream, account, 'initial'));
      if (upstream.status === 401) {
        await upstream.arrayBuffer();
        upstream = await forward({ req, body, account, endpoint, upstreamBase, forceRefresh: true, decodedRequestBody });
        attempts.push(await describeAttempt(upstream, account, 'auth-refresh'));
      }
      if (gatewayRequest && upstream.status === 429 && !explicitAccountModel) {
        const fallback = await selectGatewayAccount(account, usageReader, { force: true, exclude: new Set([account.id]) });
        if (fallback && fallback.id !== account.id) {
          if (!fallback.preferredModel) throw httpError(503, `The fallback account “${fallback.label}” does not have a native Codex model selected. Sync the gateway catalog first.`);
          account = fallback;
          const fallbackRequest = JSON.parse(body.toString('utf8'));
          const fallbackRouting = jevAdvisor?.mode === 'active' && jevDecision?.status === 'ok'
            ? jevAdvisor.resolve?.(account, fallbackRequest, jevDecision)
            : null;
          const fallbackModel = fallbackRouting?.applyModel && fallbackRouting.recommendedModel
            ? fallbackRouting.recommendedModel
            : account.preferredModel;
          body = Buffer.from(JSON.stringify({ ...fallbackRequest, model: fallbackModel || account.preferredModel }));
          upstream = await forward({ req, body, account, endpoint, upstreamBase, forceRefresh: false, decodedRequestBody });
          attempts.push(await describeAttempt(upstream, account, 'account-failover'));
        }
      }
      let requestModel = null;
      try { requestModel = JSON.parse(body.toString('utf8')).model ?? null; } catch {}
      routedAccount = account;
      routedModel = requestModel;
      const usage = await writeResponse(res, upstream);
      const jev = summarizeJevDecision(jevDecision, jevRouting, jevAccountRouting);
      await emitRequest(onRequest, { requestId, account, endpoint, model: requestModel, status: upstream.status, transport: 'http', durationMs: Date.now() - startedAt, attempts, usage: null, jev });
      if (usage) void emitRequest(onRequest, { requestId, account, endpoint, model: requestModel, status: upstream.status, transport: 'http-usage', durationMs: Date.now() - startedAt, attempts, usage, usageOnly: true, jev });
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      await emitRequest(onRequest, { requestId, account: routedAccount, endpoint: req.url?.split('?')[0] || null, model: routedModel, status, transport: 'http', durationMs: Date.now() - startedAt, attempts, error: sanitizeLogText(error?.message || String(error)), jev: summarizeJevDecision(jevDecision, jevRouting, jevAccountRouting) });
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
  server.on('upgrade', (req, socket, head) => {
    upgradedSockets.add(socket);
    const forgetSocket = () => upgradedSockets.delete(socket);
    socket.once('close', forgetSocket);
    socket.once('error', forgetSocket);
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    if (req.url?.split('?')[0] !== '/v1/responses') {
      void emitRequest(onRequest, { requestId, account: null, endpoint: req.url?.split('?')[0] || null, model: null, status: 404, transport: 'websocket-negotiation', method: 'GET', durationMs: 0, attempts: [] });
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      void emitRequest(onRequest, { requestId, account: null, endpoint: 'responses', model: null, status: 426, transport: 'websocket-negotiation', method: 'GET', durationMs: Date.now() - startedAt, attempts: [] });
      socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    void emitRequest(onRequest, { requestId, account: null, endpoint: 'responses', model: null, status: 426, transport: 'websocket-negotiation', method: 'GET', durationMs: Date.now() - startedAt, attempts: [] });
    socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 0\r\n\r\n');
  });
  server.closeRouterConnections = () => {
    for (const socket of upgradedSockets) socket.destroy();
    upgradedSockets.clear();
  };
  server.listen(port, host);
  return server;
}

async function emitRequest(onRequest, event) {
  if (!onRequest) return;
  try { await onRequest(event); } catch {}
}

async function adviseJevSafely(jevAdvisor, context) {
  try {
    return await jevAdvisor.advise(context);
  } catch {
    return { status: 'advisor-error' };
  }
}

function decodeRequestBody(raw, contentEncoding) {
  const encoding = String(contentEncoding || 'identity').trim().toLowerCase();
  let decoded;
  if (!encoding || encoding === 'identity') return raw;
  if (encoding === 'zstd') decoded = zstdDecompressSync(raw);
  else if (encoding === 'gzip') decoded = gunzipSync(raw);
  else if (encoding === 'deflate') decoded = inflateSync(raw);
  else if (encoding === 'br') decoded = brotliDecompressSync(raw);
  else throw httpError(415, `Unsupported Content-Encoding: ${encoding}`);
  if (decoded.length > MAX_DECODED_REQUEST_BYTES) throw httpError(413, 'Decoded request body is too large.');
  return decoded;
}

async function describeAttempt(response, account, reason) {
  const headers = {};
  for (const name of ['content-type', 'retry-after', 'x-oai-request-id', 'cf-ray', 'x-codex-active-limit', 'x-codex-plan-type']) {
    const value = response.headers.get(name);
    if (value) headers[name] = sanitizeLogText(value);
  }
  let error = null;
  if (!response.ok) {
    try { error = sanitizeLogText((await response.clone().text()).slice(0, 2000)); } catch {}
  }
  return { reason, accountId: account?.id ?? null, accountLabel: account?.label ?? null, status: response.status, headers, error };
}

function sanitizeLogText(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/[\r\n]+/g, ' ')
    .trim();
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
  const healthy = await listHealthyGatewayAccounts(active, usageReader, { force, exclude });
  const selected = chooseGatewayAccount(healthy, active);
  if (selected.id !== active.id) setDefaultAccount(selected.id);
  return selected;
}

async function listHealthyGatewayAccounts(active, usageReader, { force = false, exclude = new Set() } = {}) {
  const accounts = allAccounts();
  const candidates = [active, ...accounts.filter(account => account.id !== active.id)]
    .filter(account => account?.enabled !== false)
    .filter(account => typeof account?.preferredModel === 'string' && account.preferredModel.length > 0)
    .filter((account, index, list) => !exclude.has(account.id) && list.findIndex(item => item.id === account.id) === index);
  const healthy = [];
  let refreshAll = force;
  for (const account of candidates) {
    let usage = await readUsageSafely(usageReader, account, { force: refreshAll });
    // Usage is advisory telemetry and can briefly lag behind the real
    // allowance. Never turn one cached snapshot into a hard 429 without a
    // fresh read first.
    if (usageNeedsFreshRead(usage)) {
      refreshAll = true;
      usage = await readUsageSafely(usageReader, account, { force: true });
    }
    if (usageIsHealthy(usage)) {
      healthy.push({
        account,
        usage,
        score: accountHeadroomScore(usage),
        hasHeadroom: [usage.primary?.remainingPercent, usage.secondary?.remainingPercent, usage.spendControl?.remainingPercent]
          .some(value => Number.isFinite(value)),
      });
    }
  }
  if (healthy.length) {
    return healthy;
  }
  throw cooldownError(active, await readUsageSafely(usageReader, active, { force }));
}

function chooseGatewayAccount(healthy, active) {
  return [...healthy].sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (Math.abs(scoreDelta) > HEADROOM_TIE_MARGIN) return scoreDelta;
    if (!left.hasHeadroom && !right.hasHeadroom) {
      return left.account.id === active.id ? -1 : right.account.id === active.id ? 1 : 0;
    }
    // When accounts have comparable headroom, rotate away from the current
    // default so equal-capacity subscriptions share the workload.
    if (left.account.id === active.id) return 1;
    if (right.account.id === active.id) return -1;
    return left.account.id.localeCompare(right.account.id);
  })[0].account;
}

function accountHeadroomScore(usage) {
  const weighted = [
    [usage.primary?.remainingPercent, 0.7], // 5-hour capacity is the main task constraint.
    [usage.secondary?.remainingPercent, 0.2],
    [usage.spendControl?.remainingPercent, 0.1],
  ].filter(([value]) => Number.isFinite(value));
  if (!weighted.length) return 50;
  const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  return weighted.reduce((sum, [value, weight]) => sum + (value * weight), 0) / totalWeight;
}

function usageIsHealthy(usage) {
  // The upstream `allowed`/`limit_reached` decision is authoritative. A
  // secondary window may legitimately be at 0 while the account remains
  // allowed for the current model; do not discard that account before the
  // five-hour headroom ranking can compare it with the others.
  return Boolean(usage)
    && usage.status === 'available'
    && usage.limitReached !== true;
}

function usageNeedsFreshRead(usage) {
  if (!usageIsHealthy(usage)) return true;
  const primaryRemaining = usage.primary?.remainingPercent;
  return Number.isFinite(primaryRemaining) && primaryRemaining <= FRESH_USAGE_THRESHOLD_PERCENT;
}

function cooldownError(account, usage) {
  const reset = usage.cooldownUntil
    ? new Date(usage.cooldownUntil * 1000).toISOString()
    : null;
  const suffix = reset ? ` until ${reset}` : '';
  const isCooldown = usage?.status === 'cooldown' || usage?.limitReached === true;
  const message = isCooldown
    ? `The active account “${account.label}” is in cooldown${suffix}. Select another account explicitly in CodexRouter or wait for this account to reset.`
    : `No configured account currently has a confirmed available quota. The latest usage telemetry for “${account.label}” was inconclusive; retry the request or refresh the account session.`;
  const error = httpError(429, message);
  error.type = 'usage_limit_reached';
  error.cooldownUntil = usage.cooldownUntil ?? null;
  return error;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function forward({ req, body, account, endpoint, upstreamBase, forceRefresh, decodedRequestBody = false }) {
  const auth = freshAuth(account.codexHome, { force: forceRefresh });
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value == null || HOP_BY_HOP.has(name.toLowerCase())) continue;
    if (decodedRequestBody && name.toLowerCase() === 'content-encoding') continue;
    if (name.toLowerCase() === 'authorization' || name.toLowerCase() === 'chatgpt-account-id') continue;
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else headers.set(name, String(value));
  }
  headers.set('authorization', `Bearer ${auth.accessToken}`);
  if (auth.accountId) headers.set('chatgpt-account-id', auth.accountId);
  const upstream = `${upstreamBase.replace(/\/$/, '')}/${endpoint}`;
  return fetch(upstream, { method: 'POST', headers, body });
}

async function forwardOfficial({ req, body, officialBase, forceRefresh }) {
  const auth = await officialAuth({ force: forceRefresh, incomingAuthorization: req.headers.authorization });
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value == null || HOP_BY_HOP.has(name.toLowerCase())) continue;
    if (name.toLowerCase() === 'authorization' || name.toLowerCase() === 'chatgpt-account-id') continue;
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else headers.set(name, String(value));
  }
  if (auth?.accessToken) headers.set('authorization', `Bearer ${auth.accessToken}`);
  if (auth?.accountId) headers.set('chatgpt-account-id', auth.accountId);
  const target = officialTarget(officialBase, req.url || '/');
  return fetch(target, { method: req.method, headers, body: body?.length ? body : undefined });
}

async function officialAuth({ force = false, incomingAuthorization }) {
  try { return freshAuth(mainCodexHome(), { force }); }
  catch { return incomingAuthorization ? { accessToken: incomingAuthorization.replace(/^Bearer\s+/i, '') } : null; }
}

function stripVersionPrefix(url) {
  return String(url).replace(/^\/v1(?=\/|\?|$)/, '') || '/';
}

function officialTarget(officialBase, requestUrl) {
  const base = new URL(officialBase);
  const request = new URL(String(requestUrl), 'http://codexrouter.invalid');
  const suffix = stripVersionPrefix(request.pathname);
  base.pathname = `${base.pathname.replace(/\/$/, '')}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
  base.search = request.search;
  return base;
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
  if (!upstream.body) { res.end(); return null; }
  let clientBody = upstream.body;
  let inspectionBody = null;
  if (typeof upstream.body.tee === 'function') [clientBody, inspectionBody] = upstream.body.tee();
  const usagePromise = inspectionBody ? inspectUsage(inspectionBody) : Promise.resolve(null);
  await new Promise((resolve, reject) => {
    Readable.fromWeb(clientBody).on('error', reject).pipe(res).on('finish', resolve).on('error', reject);
  });
  return usagePromise;
}

async function inspectUsage(stream) {
  try {
    const decoder = new TextDecoder();
    let pending = '';
    let usage = null;
    for await (const chunk of stream) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        usage = parseUsageLine(line) || usage;
      }
    }
    pending += decoder.decode();
    usage = parseUsageLine(pending) || usage;
    return usage;
  } catch {
    return null;
  }
}

function parseUsageLine(line) {
  const text = String(line || '').trim();
  if (!text || text === '[DONE]' || text.startsWith('event:')) return null;
  const payload = text.startsWith('data:') ? text.slice(5).trim() : text;
  try { return findUsage(JSON.parse(payload)); } catch { return null; }
}

function findUsage(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return null;
  if (value.usage && typeof value.usage === 'object') return normalizeUsage(value.usage);
  for (const child of Object.values(value)) {
    const found = findUsage(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeUsage(usage) {
  const input = numberOrNull(usage.input_tokens);
  const output = numberOrNull(usage.output_tokens);
  const total = numberOrNull(usage.total_tokens);
  return { inputTokens: input, outputTokens: output, totalTokens: total ?? ((input ?? 0) + (output ?? 0)) };
}

function numberOrNull(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}
