import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
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
    assert.equal(seen.headers['chatgpt-account-id'], 'acct-eduardo');
    assert.notEqual(seen.headers.authorization, 'Bearer main-account');
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
