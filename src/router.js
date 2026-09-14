// Architecture adapted from miuuyy/codex-chatgpt-web (MIT). See THIRD_PARTY_NOTICES.md.
import http from 'node:http';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { freshAuth } from './auth.js';
import { GATEWAY_SLUG, isGatewaySlug, parseAccountModelSlug } from './catalog.js';
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
  onRequest = null,
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
      let explicitAccountModel = false;

      if (raw.length && contentType.includes('application/json')) {
        const parsed = JSON.parse(raw.toString('utf8'));
        const qualified = parseAccountModelSlug(parsed?.model);
        explicitAccountModel = Boolean(qualified);
        const requestedModel = parsed?.model;
        gatewayRequest = isGatewaySlug(requestedModel) || Boolean(qualified) || typeof requestedModel === 'string';
        if (gatewayRequest) {
          if (qualified) {
            account = allAccounts().find(candidate => candidate.id === qualified.accountId);
            if (!account) throw httpError(400, `Unknown CodexRouter account model: ${requestedModel}`);
            const usage = await readUsageSafely(usageReader, account);
            if (!usageIsHealthy(usage)) throw cooldownError(account, usage);
            parsed.model = qualified.modelSlug;
          } else {
            account = await selectGatewayAccount(account, usageReader);
            if (!account.preferredModel) throw httpError(503, `The active account “${account.label}” does not have a native Codex model selected. Sync the gateway catalog first.`);
            parsed.model = isGatewaySlug(requestedModel) ? account.preferredModel : requestedModel;
          }
          if (account.preferredEffort) {
            parsed.reasoning = { ...(parsed.reasoning || {}), effort: parsed.reasoning?.effort || account.preferredEffort };
          }
          body = Buffer.from(JSON.stringify(parsed));
        }
      }

      let upstream = await forward({ req, body, account, endpoint, upstreamBase, forceRefresh: false });
      if (upstream.status === 401) {
        await upstream.arrayBuffer();
        upstream = await forward({ req, body, account, endpoint, upstreamBase, forceRefresh: true });
      }
      if (gatewayRequest && upstream.status === 429 && !explicitAccountModel) {
        const fallback = await selectGatewayAccount(account, usageReader, { force: true, exclude: new Set([account.id]) });
        if (fallback && fallback.id !== account.id) {
          if (!fallback.preferredModel) throw httpError(503, `The fallback account “${fallback.label}” does not have a native Codex model selected. Sync the gateway catalog first.`);
          account = fallback;
          body = Buffer.from(JSON.stringify({ ...JSON.parse(body.toString('utf8')), model: account.preferredModel }));
          upstream = await forward({ req, body, account, endpoint, upstreamBase, forceRefresh: false });
        }
      }
      let requestModel = null;
      try { requestModel = JSON.parse(body.toString('utf8')).model ?? null; } catch {}
      await onRequest?.({ account, endpoint, model: requestModel, status: upstream.status, transport: 'http' });
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
  server.on('upgrade', (req, socket, head) => {
    void proxyWebSocket({ req, socket, head, upstreamBase, usageReader, onRequest });
  });
  server.listen(port, host);
  return server;
}

async function proxyWebSocket({ req, socket, head, upstreamBase, usageReader, onRequest }) {
  if (req.url?.split('?')[0] !== '/v1/responses' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
  const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);

  let buffer = head?.length ? Buffer.from(head) : Buffer.alloc(0);
  let routed = false;
  let account = null;
  let endpoint = 'responses';
  const pending = [];
  const close = () => { if (!socket.destroyed) socket.end(); };
  socket.on('error', close);
  socket.on('close', close);

  const routeAndConnect = async payload => {
    const parsed = payload && typeof payload === 'object' ? payload : {};
    const requestedModel = parsed.model;
    const qualified = parseAccountModelSlug(requestedModel);
    account = qualified ? allAccounts().find(candidate => candidate.id === qualified.accountId) : await selectGatewayAccount(defaultAccount(), usageReader);
    if (!account) throw httpError(400, `Unknown CodexRouter account model: ${requestedModel}`);
    if (qualified) {
      const usage = await readUsageSafely(usageReader, account);
      if (!usageIsHealthy(usage)) throw cooldownError(account, usage);
      parsed.model = qualified.modelSlug;
    } else {
      if (!account.preferredModel) throw httpError(503, 'No native Codex model selected. Sync the gateway catalog first.');
      parsed.model = isGatewaySlug(requestedModel) ? account.preferredModel : requestedModel;
    }
    if (account.preferredEffort) parsed.reasoning = { ...(parsed.reasoning || {}), effort: parsed.reasoning?.effort || account.preferredEffort };
    parsed.stream = true;
    const target = new URL(`${upstreamBase.replace(/\/$/, '')}/${endpoint}`);
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value != null && !HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== 'authorization' && name.toLowerCase() !== 'chatgpt-account-id') headers[name] = value;
    }
    const auth = freshAuth(account.codexHome);
    headers.authorization = `Bearer ${auth.accessToken}`;
    if (auth.accountId) headers['chatgpt-account-id'] = auth.accountId;
    headers.host = target.host;
    headers['content-type'] = 'application/json';
    headers.accept = 'text/event-stream';
    const response = await fetch(target, { method: 'POST', headers, body: JSON.stringify(parsed) });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Codex upstream request failed with ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }
    routed = true;
    await onRequest?.({ account, endpoint, model: parsed.model ?? null, status: response.status, transport: 'websocket' });
    if (response.body) {
      for await (const chunk of response.body) {
        if (!socket.destroyed) socket.write(encodeWebSocketFrame(Buffer.from(chunk), 0x1));
      }
    }
    if (!socket.destroyed) {
      const closePayload = Buffer.from([0x03, 0xE8]);
      socket.write(encodeWebSocketFrame(closePayload, 0x8));
      setTimeout(() => { if (!socket.destroyed) socket.end(); }, 500);
    }
  };

  const consume = async chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    const frames = decodeWebSocketFrames(buffer);
    buffer = frames.rest;
    for (const frame of frames.frames) {
      if (frame.opcode === 0x8) { close(); return; }
      if (frame.opcode === 0x9) { socket.write(encodeWebSocketFrame(frame.payload, 0xA)); continue; }
      if (routed) continue;
      pending.push(frame);
      if (frame.opcode === 0x1) {
        try { await routeAndConnect(JSON.parse(frame.payload.toString('utf8'))); }
        catch (error) { socket.write(encodeWebSocketFrame(Buffer.from(JSON.stringify({ error: { message: error.message } })), 0x1)); close(); return; }
      }
    }
  };
  socket.on('data', chunk => void consume(chunk));
  if (buffer.length) void consume(Buffer.alloc(0));
}

function decodeWebSocketFrames(input) {
  const frames = [];
  let offset = 0;
  while (input.length - offset >= 2) {
    const first = input[offset];
    const second = input[offset + 1];
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) { if (input.length - cursor < 2) break; length = input.readUInt16BE(cursor); cursor += 2; }
    else if (length === 127) { if (input.length - cursor < 8) break; const value = input.readBigUInt64BE(cursor); if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebSocket frame is too large.'); length = Number(value); cursor += 8; }
    const masked = (second & 0x80) !== 0;
    if (masked) { if (input.length - cursor < 4) break; cursor += 4; }
    if (input.length - cursor < length) break;
    const payloadStart = cursor;
    const payload = Buffer.from(input.subarray(payloadStart, payloadStart + length));
    if (masked) { const mask = input.subarray(payloadStart - 4, payloadStart); for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4]; }
    frames.push({ opcode: first & 0x0f, payload });
    offset = payloadStart + length;
  }
  return { frames, rest: input.subarray(offset) };
}

function encodeWebSocketFrame(payload, opcode = 0x1, masked = false) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const maskBit = masked ? 0x80 : 0;
  const mask = masked ? crypto.randomBytes(4) : null;
  const header = data.length < 126 ? Buffer.from([0x80 | opcode, maskBit | data.length])
    : data.length <= 0xffff ? Buffer.from([0x80 | opcode, maskBit | 126, (data.length >> 8) & 0xff, data.length & 0xff])
      : Buffer.concat([Buffer.from([0x80 | opcode, maskBit | 127]), (() => { const length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(data.length)); return length; })()]);
  if (!masked) return Buffer.concat([header, data]);
  const encoded = Buffer.from(data);
  for (let index = 0; index < encoded.length; index += 1) encoded[index] ^= mask[index % 4];
  return Buffer.concat([header, mask, encoded]);
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
