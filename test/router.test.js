import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { zstdCompressSync } from 'node:zlib';
import { startRouter } from '../src/router.js';
import { writeJsonAtomic } from '../src/fs-util.js';

function jwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`;
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-router-'));
  const previous = process.env.CODEXROUTER_HOME;
  process.env.CODEXROUTER_HOME = root;
  const cesarHome = path.join(root, 'accounts', 'cesar', 'codex-home');
  const eduardoHome = path.join(root, 'accounts', 'eduardo', 'codex-home');
  fs.mkdirSync(cesarHome, { recursive: true });
  fs.mkdirSync(eduardoHome, { recursive: true });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  writeJsonAtomic(path.join(cesarHome, 'auth.json'), { tokens: { id_token: jwt({}), access_token: jwt({ exp }), refresh_token: 'r1', account_id: 'acct-cesar' } });
  writeJsonAtomic(path.join(eduardoHome, 'auth.json'), { tokens: { id_token: jwt({}), access_token: jwt({ exp, who: 'eduardo' }), refresh_token: 'r2', account_id: 'acct-eduardo' } });
  writeJsonAtomic(path.join(root, 'accounts.json'), {
    version: 1,
    defaultAccountId: 'eduardo',
    accounts: [
      { id: 'cesar', label: 'Cesar', codexHome: cesarHome, preferredModel: 'gpt-5.6-sol' },
      { id: 'eduardo', label: 'Eduardo', codexHome: eduardoHome, preferredModel: 'gpt-5.5' },
    ],
  });
  return {
    root,
    previous,
    restore() {
      if (previous === undefined) delete process.env.CODEXROUTER_HOME; else process.env.CODEXROUTER_HOME = previous;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('responses capability negotiation falls back from WebSocket to HTTP/SSE', async () => {
  const state = await fixture();
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ websocket: true }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({ port: 0, officialUpstreamBase: `http://127.0.0.1:${upstream.address().port}/backend-api/codex` });
  await once(router, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { websocket: true });
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('responses WebSocket upgrade is proxied to the official upstream with main Codex auth', async () => {
  const state = await fixture();
  const previousCodexHome = process.env.CODEX_HOME;
  const mainHome = path.join(state.root, 'main-codex-home');
  const accessToken = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  fs.mkdirSync(mainHome, { recursive: true });
  writeJsonAtomic(path.join(mainHome, 'auth.json'), {
    tokens: { id_token: jwt({}), access_token: accessToken, refresh_token: 'main-refresh', account_id: 'main-account' },
  });
  process.env.CODEX_HOME = mainHome;
  let seen = null;
  const events = [];
  let upstreamSocket = null;
  const upstream = http.createServer();
  upstream.on('upgrade', (req, socket) => {
    seen = {
      url: req.url,
      authorization: req.headers.authorization,
      accountId: req.headers['chatgpt-account-id'],
      upgrade: req.headers.upgrade,
    };
    upstreamSocket = socket;
    const accept = crypto.createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', chunk => socket.write(chunk));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({
    port: 0,
    officialUpstreamBase: `http://127.0.0.1:${upstream.address().port}/backend-api/codex`,
    onRequest: event => events.push(event),
  });
  await once(router, 'listening');
  try {
    const { response, socket } = await new Promise((resolve, reject) => {
      const request = http.request({
        port: router.address().port,
        path: '/v1/responses?transport=websocket',
        headers: {
          authorization: 'Bearer incoming-codex-token',
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
          'sec-websocket-version': '13',
        },
      });
      request.once('upgrade', (upstreamResponse, clientSocket) => resolve({ response: upstreamResponse, socket: clientSocket }));
      request.once('response', incoming => reject(new Error(`unexpected HTTP response: ${incoming.statusCode}`)));
      request.once('error', reject);
      request.end();
    });
    assert.equal(response.statusCode, 101);
    assert.deepEqual(seen, {
      url: '/backend-api/codex/responses?transport=websocket',
      authorization: `Bearer ${accessToken}`,
      accountId: 'main-account',
      upgrade: 'websocket',
    });
    assert.deepEqual(events.map(event => [event.transport, event.status]), [['official-websocket', 101]]);
    const echo = new Promise(resolve => socket.once('data', resolve));
    socket.write('websocket-data');
    assert.equal((await echo).toString(), 'websocket-data');
    socket.destroy();
  } finally {
    router.closeRouterConnections();
    await new Promise(resolve => router.close(resolve));
    upstreamSocket?.destroy();
    await new Promise(resolve => upstream.close(resolve));
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    state.restore();
  }
});

test('responses WebSocket upstream rejection is forwarded to the Codex client', async () => {
  const state = await fixture();
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(state.root, 'empty-main-codex-home');
  let upstreamSocket = null;
  const upstream = http.createServer();
  upstream.on('upgrade', (_req, socket) => {
    upstreamSocket = socket;
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: 7\r\n\r\nblocked');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({
    port: 0,
    officialUpstreamBase: `http://127.0.0.1:${upstream.address().port}/backend-api/codex`,
  });
  await once(router, 'listening');
  try {
    const response = await new Promise((resolve, reject) => {
      const request = http.request({
        port: router.address().port,
        path: '/v1/responses',
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
          'sec-websocket-version': '13',
        },
      });
      request.once('response', resolve);
      request.once('upgrade', (_incoming, socket) => { socket.destroy(); reject(new Error('unexpected successful upgrade')); });
      request.once('error', reject);
      request.end();
    });
    assert.equal(response.statusCode, 403);
    let body = '';
    for await (const chunk of response) body += chunk.toString();
    assert.equal(body, 'blocked');
  } finally {
    router.closeRouterConnections();
    await new Promise(resolve => router.close(resolve));
    upstreamSocket?.destroy();
    await new Promise(resolve => upstream.close(resolve));
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    state.restore();
  }
});

test('router passes unknown Codex routes through to the official upstream', async () => {
  const state = await fixture();
  let seen = null;
  const upstream = http.createServer((req, res) => {
    seen = { url: req.url, method: req.method };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({
    port: 0,
    officialUpstreamBase: `http://127.0.0.1:${upstream.address().port}/backend-api/codex`,
  });
  await once(router, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/remote/status?check=1`, { headers: { authorization: 'Bearer test' } });
    assert.equal(response.status, 200);
    assert.deepEqual(seen, { url: '/backend-api/codex/remote/status?check=1', method: 'GET' });
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('router reports sanitized upstream failure details without consuming the client response', async () => {
  const state = await fixture();
  const events = [];
  const upstream = http.createServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json', 'x-oai-request-id': 'req-test' });
    res.end(JSON.stringify({ error: { message: 'upstream failed with Bearer secret-token' } }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    usageReader: async () => ({ status: 'available' }),
    onRequest: event => events.push(event),
  });
  await once(router, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: [] }),
    });
    assert.equal(response.status, 503);
    assert.match(await response.text(), /secret-token/);
    assert.equal(events.length, 1);
    assert.equal(events[0].status, 503);
    assert.equal(events[0].attempts[0].headers['x-oai-request-id'], 'req-test');
    assert.match(events[0].attempts[0].error, /Bearer \[REDACTED\]/);
    assert.doesNotMatch(events[0].attempts[0].error, /secret-token/);
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('router emits usage telemetry without creating a false 500 after a successful response', async () => {
  const state = await fixture();
  const events = [];
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"usage":{"input_tokens":4,"output_tokens":6}}\n\ndata: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    usageReader: async () => ({ status: 'available' }),
    onRequest: event => events.push(event),
  });
  await once(router, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: [] }),
    });
    assert.equal(response.status, 200);
    await response.text();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(events.map(event => event.status), [200, 200]);
    assert.equal(events[0].usage, null);
    assert.equal(events[1].usage.totalTokens, 10);
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('gateway decodes Codex zstd requests and forwards rewritten JSON without content-encoding', async () => {
  const state = await fixture();
  let seen = null;
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen = { headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('event: response.completed\ndata: {"type":"response.completed"}\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({ port: 0, upstreamBase: `http://127.0.0.1:${upstream.address().port}`, usageReader: async () => ({ status: 'available' }) });
  await once(router, 'listening');
  try {
    const encoded = zstdCompressSync(Buffer.from(JSON.stringify({ model: 'codexrouter/gateway', input: [] })));
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'zstd' },
      body: encoded,
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(seen.body.model, 'gpt-5.5');
    assert.equal(seen.headers['content-encoding'], undefined);
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('gateway routes through the explicitly active account and its preferred native model', async () => {
  const state = await fixture();
  let seen = null;
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen = { headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')), url: req.url };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');

  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    usageReader: async () => ({ status: 'available' }),
  });
  await once(router, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer main-account' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: [] }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(seen.url, '/responses');
    assert.equal(seen.body.model, 'gpt-5.5');
    assert.equal(seen.body.reasoning, undefined);
    assert.equal(seen.headers['chatgpt-account-id'], 'acct-eduardo');
    assert.notEqual(seen.headers.authorization, 'Bearer main-account');
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('account-qualified native model stays pinned to its account', async () => {
  const state = await fixture();
  let seen = null;
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen = { headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({ port: 0, upstreamBase: `http://127.0.0.1:${upstream.address().port}`, usageReader: async () => ({ status: 'available' }) });
  await once(router, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/cesar/gpt-5.5', input: [] }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(seen.body.model, 'gpt-5.5');
    assert.equal(seen.headers['chatgpt-account-id'], 'acct-cesar');
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('gateway applies the account effort without overriding request effort', async () => {
  const state = await fixture();
  let bodies = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const { readJson } = await import('../src/fs-util.js');
  const { registryPath } = await import('../src/paths.js');
  const registry = readJson(registryPath());
  registry.accounts.find(account => account.id === 'eduardo').preferredEffort = 'high';
  writeJsonAtomic(registryPath(), registry);
  const router = startRouter({ port: 0, upstreamBase: `http://127.0.0.1:${upstream.address().port}`, usageReader: async () => ({ status: 'available' }) });
  await once(router, 'listening');
  try {
    for (const input of [{ model: 'codexrouter/gateway', input: [] }, { model: 'codexrouter/gateway', input: [], reasoning: { effort: 'low' } }]) {
      const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      assert.equal(response.status, 200);
      await response.text();
    }
    assert.equal(bodies[0].reasoning.effort, 'high');
    assert.equal(bodies[1].reasoning.effort, 'low');
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('gateway automatically rolls over from a cooldown account', async () => {
  const state = await fixture();
  let upstreamCalls = 0;
  let seenAccount = null;
  const upstream = http.createServer((_req, res) => {
    upstreamCalls += 1;
    seenAccount = _req.headers['chatgpt-account-id'];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const resetAt = Math.floor(Date.now() / 1000) + 900;

  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    usageReader: async account => account.id === 'eduardo'
      ? { status: 'cooldown', cooldownUntil: resetAt }
      : { status: 'available' },
  });
  await once(router, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: [] }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(seenAccount, 'acct-cesar');
    assert.equal(upstreamCalls, 1);
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('gateway re-resolves Jev model policy for a fallback account after 429', async () => {
  const state = await fixture();
  const seen = [];
  const resolvedAccounts = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({
      account: req.headers['chatgpt-account-id'],
      model: JSON.parse(Buffer.concat(chunks).toString('utf8')).model,
    });
    if (seen.length === 1) {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'quota' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');

  const jevDecision = {
    status: 'ok',
    routeTier: 'deep',
    routeConfidence: 0.99,
    reasoningEffort: 'high',
    effortConfidence: 0.99,
  };
  const jevAdvisor = {
    mode: 'active',
    status: () => ({ mode: 'active', configured: true }),
    advise: async () => jevDecision,
    resolve: account => {
      resolvedAccounts.push(account.id);
      return {
        mode: 'active',
        tier: 'deep',
        applyModel: true,
        applyEffort: false,
        recommendedModel: account.id === 'eduardo' ? 'gpt-5.6-sol' : 'gpt-5.6-luna',
      };
    },
  };

  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    usageReader: async () => ({ status: 'available' }),
    jevAdvisor,
  });
  await once(router, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: 'hard task' }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.deepEqual(resolvedAccounts, ['eduardo', 'cesar']);
    assert.deepEqual(seen, [
      { account: 'acct-eduardo', model: 'gpt-5.6-sol' },
      { account: 'acct-cesar', model: 'gpt-5.6-luna' },
    ]);
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('gateway refreshes stale cooldown telemetry before rejecting a usable account', async () => {
  const state = await fixture();
  let upstreamCalls = 0;
  const upstream = http.createServer((_req, res) => {
    upstreamCalls += 1;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    usageReader: async (_account, options = {}) => options.force
      ? { status: 'available', primary: { remainingPercent: 100 }, secondary: { remainingPercent: 100 } }
      : { status: 'cooldown', cooldownUntil: Math.floor(Date.now() / 1000) + 900 },
  });
  await once(router, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: [] }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(upstreamCalls, 1);
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('gateway prioritizes five-hour quota when ranking healthy accounts', async () => {
  const state = await fixture();
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    usageReader: async account => account.id === 'eduardo'
      ? { status: 'available', primary: { remainingPercent: 90 }, secondary: { remainingPercent: 83 } }
      : { status: 'available', primary: { remainingPercent: 100 }, secondary: { remainingPercent: 69 } },
  });
  await once(router, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: [] }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal((await import('../src/store.js')).defaultAccount().id, 'cesar');
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('active Jev account routing selects only from healthy configured candidates', async () => {
  const state = await fixture();
  let seen = null;
  let candidateIds = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen = { account: req.headers['chatgpt-account-id'], body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const jevAdvisor = {
    mode: 'active',
    status: () => ({ mode: 'active', configured: true }),
    advise: async ({ accountCandidates }) => {
      candidateIds = accountCandidates.map(candidate => candidate.account.id);
      return { status: 'ok', recommendedAccountId: 'cesar', accountConfidence: 0.99 };
    },
    resolveAccount: (_candidates, decision) => ({
      mode: 'active',
      accountRouting: 'active',
      recommendedAccountId: decision.recommendedAccountId,
      accountConfidence: decision.accountConfidence,
      applyAccount: candidateIds.includes(decision.recommendedAccountId),
    }),
    resolve: () => ({ mode: 'active', applyModel: false, applyEffort: false }),
  };
  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    usageReader: async account => account.id === 'eduardo'
      ? { status: 'available', primary: { remainingPercent: 80 }, secondary: { remainingPercent: 70 } }
      : { status: 'available', primary: { remainingPercent: 70 }, secondary: { remainingPercent: 60 } },
    jevAdvisor,
  });
  await once(router, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: [] }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.deepEqual(candidateIds.sort(), ['cesar', 'eduardo']);
    assert.equal(seen.account, 'acct-cesar');
    assert.equal(seen.body.model, 'gpt-5.6-sol');
    assert.equal((await import('../src/store.js')).defaultAccount().id, 'cesar');
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('gateway keeps an allowed account with an exhausted secondary window in the ranking', async () => {
  const state = await fixture();
  let seenAccount = null;
  const upstream = http.createServer((req, res) => {
    seenAccount = req.headers['chatgpt-account-id'];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    usageReader: async account => account.id === 'eduardo'
      ? { status: 'available', limitReached: false, primary: { remainingPercent: 40 }, secondary: { remainingPercent: 87 } }
      : { status: 'available', limitReached: false, primary: { remainingPercent: 88 }, secondary: { remainingPercent: 0 } },
  });
  await once(router, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: [] }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(seenAccount, 'acct-cesar');
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('gateway rolls over when the active account is nearly exhausted', async () => {
  const state = await fixture();
  let seenAccount = null;
  const upstream = http.createServer((req, res) => {
    seenAccount = req.headers['chatgpt-account-id'];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');

  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    usageReader: async account => account.id === 'eduardo'
      ? { status: 'available', primary: { remainingPercent: 5 } }
      : { status: 'available', primary: { remainingPercent: 80 } },
  });
  await once(router, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: [] }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(seenAccount, 'acct-cesar');
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});

test('gateway still routes an account with a low but non-zero weekly window', async () => {
  const state = await fixture();
  let upstreamCalls = 0;
  const upstream = http.createServer((_req, res) => {
    upstreamCalls += 1;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    usageReader: async () => ({
      status: 'available',
      primary: { remainingPercent: 85 },
      secondary: { remainingPercent: 8 },
    }),
  });
  await once(router, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: [] }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(upstreamCalls, 1);
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    state.restore();
  }
});
