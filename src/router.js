// Architecture adapted from miuuyy/codex-chatgpt-web (MIT). See THIRD_PARTY_NOTICES.md.
import http from 'node:http';
import { Readable } from 'node:stream';
import { freshAuth } from './auth.js';
import { parseAliasSlug } from './catalog.js';
import { defaultAccount, loadRegistry } from './store.js';
import { catalogPath } from './paths.js';
import { readJson } from './fs-util.js';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te',
  'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

export function startRouter({ port = 17842, host = '127.0.0.1', upstreamBase = process.env.CODEXROUTER_UPSTREAM_BASE || 'https://chatgpt.com/backend-api/codex' } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'codexrouter' }));
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
      if (raw.length && contentType.includes('application/json')) {
        const parsed = JSON.parse(raw.toString('utf8'));
        const route = parseAliasSlug(parsed?.model);
        if (route) {
          const registry = loadRegistry();
          const selected = registry.accounts.find(item => item.id === route.accountId);
          if (!selected) throw new Error(`Model alias references missing account: ${route.accountId}`);
          account = selected;
          parsed.model = route.nativeModel;
          body = Buffer.from(JSON.stringify(parsed));
        }
      }

      let upstream = await forward({ req, body, account, endpoint, upstreamBase, forceRefresh: false });
      if (upstream.status === 401) {
        await upstream.arrayBuffer();
        upstream = await forward({ req, body, account, endpoint, upstreamBase, forceRefresh: true });
      }
      await writeResponse(res, upstream);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error?.message || String(error) } }));
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
