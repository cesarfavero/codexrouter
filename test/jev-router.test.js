import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { startRouter } from '../src/router.js';
import { resolveJevRouting } from '../src/jev.js';
import { writeJsonAtomic } from '../src/fs-util.js';

function jwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`;
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-jev-router-'));
  const previous = process.env.CODEXROUTER_HOME;
  process.env.CODEXROUTER_HOME = root;
  const codexHome = path.join(root, 'accounts', 'cesar', 'codex-home');
  fs.mkdirSync(codexHome, { recursive: true });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  writeJsonAtomic(path.join(codexHome, 'auth.json'), {
    tokens: {
      id_token: jwt({}),
      access_token: jwt({ exp }),
      refresh_token: 'refresh-test',
      account_id: 'acct-cesar',
    },
  });
  writeJsonAtomic(path.join(root, 'accounts.json'), {
    version: 1,
    defaultAccountId: 'cesar',
    accounts: [{
      id: 'cesar',
      label: 'Cesar',
      codexHome,
      preferredModel: 'gpt-5.5',
      preferredEffort: null,
      enabled: true,
      availableModels: [
        { slug: 'gpt-5.6-luna', name: 'Luna' },
        { slug: 'gpt-5.6-terra', name: 'Terra' },
        { slug: 'gpt-5.6-sol', name: 'Sol' },
      ],
    }],
  });
  return {
    restore() {
      if (previous === undefined) delete process.env.CODEXROUTER_HOME;
      else process.env.CODEXROUTER_HOME = previous;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function advisor(mode) {
  const decision = {
    status: 'ok',
    model: 'jev-1.13.0',
    inputTokens: 31,
    latencyMs: 12,
    routeTier: 'deep',
    routeConfidence: 0.96,
    reasoningEffort: 'high',
    effortConfidence: 0.94,
    needsVerification: 0.9,
    researchNeed: 0.2,
    decompositionGain: 0.7,
    failureSignal: 0.1,
    semanticRisk: 1.4,
  };
  return {
    mode,
    status: () => ({ mode, configured: true, model: 'jev-1.13.0' }),
    advise: async () => decision,
    resolve: (account, request, value) => resolveJevRouting(account, request, value, {
      mode,
      minConfidence: 0.8,
    }),
  };
}

async function upstreamCapture() {
  let seen = null;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, get seen() { return seen; } };
}

test('Jev observe mode records recommendation without changing gateway model or effort', async () => {
  const state = await fixture();
  const upstream = await upstreamCapture();
  const events = [];
  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.server.address().port}`,
    usageReader: async () => ({ status: 'available' }),
    jevAdvisor: advisor('observe'),
    onRequest: event => events.push(event),
  });
  await once(router, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: 'fix the bug' }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(upstream.seen.model, 'gpt-5.5');
    assert.equal(upstream.seen.reasoning, undefined);
    assert.equal(events[0].jev.recommendedModel, 'gpt-5.6-sol');
    assert.equal(events[0].jev.appliedModel, false);
    assert.equal(events[0].jev.appliedEffort, false);
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.server.close(resolve));
    state.restore();
  }
});

test('Jev active mode applies a high-confidence gateway tier and effort', async () => {
  const state = await fixture();
  const upstream = await upstreamCapture();
  const events = [];
  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.server.address().port}`,
    usageReader: async () => ({ status: 'available' }),
    jevAdvisor: advisor('active'),
    onRequest: event => events.push(event),
  });
  await once(router, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codexrouter/gateway', input: 'architect a complex fix' }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(upstream.seen.model, 'gpt-5.6-sol');
    assert.equal(upstream.seen.reasoning.effort, 'high');
    assert.equal(events[0].jev.appliedModel, true);
    assert.equal(events[0].jev.appliedEffort, true);
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.server.close(resolve));
    state.restore();
  }
});

test('explicit native model bypasses Jev semantic routing', async () => {
  const state = await fixture();
  const upstream = await upstreamCapture();
  let calls = 0;
  const semantic = advisor('active');
  semantic.advise = async () => {
    calls += 1;
    return { status: 'ok' };
  };
  const router = startRouter({
    port: 0,
    upstreamBase: `http://127.0.0.1:${upstream.server.address().port}`,
    usageReader: async () => ({ status: 'available' }),
    jevAdvisor: semantic,
  });
  await once(router, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${router.address().port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', input: 'do exactly this' }),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(calls, 0);
    assert.equal(upstream.seen.model, 'gpt-5.6-luna');
  } finally {
    await new Promise(resolve => router.close(resolve));
    await new Promise(resolve => upstream.server.close(resolve));
    state.restore();
  }
});
