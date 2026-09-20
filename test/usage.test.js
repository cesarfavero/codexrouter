import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAccountUsage, normalizeUsagePayload } from '../src/usage.js';

function jwt(payload) {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
}

test('usage normalization marks exhausted account as cooldown with reset', () => {
  const resetAt = Math.floor(Date.now() / 1000) + 3600;
  const usage = normalizeUsagePayload({
    rate_limit: {
      allowed: false,
      limit_reached: true,
      primary_window: {
        used_percent: 100,
        limit_window_seconds: 18_000,
        reset_after_seconds: 3600,
        reset_at: resetAt,
      },
    },
    rate_limit_reached_type: { type: 'usage_limit_reached' },
  });

  assert.equal(usage.status, 'cooldown');
  assert.equal(usage.allowed, false);
  assert.equal(usage.primary.usedPercent, 100);
  assert.equal(usage.primary.remainingPercent, 0);
  assert.equal(usage.cooldownUntil, resetAt);
  assert.equal(usage.reachedType, 'usage_limit_reached');
});

test('usage normalization exposes available windows and spend control', () => {
  const usage = normalizeUsagePayload({
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: { used_percent: 42, reset_at: 1_800_000_000 },
      secondary_window: { used_percent: 5, reset_at: 1_800_100_000 },
    },
    spend_control: {
      reached: false,
      individual_limit: { used_percent: 32, remaining_percent: 68, reset_at: 1_800_100_000 },
    },
  });

  assert.equal(usage.status, 'available');
  assert.equal(usage.primary.remainingPercent, 58);
  assert.equal(usage.secondary.remainingPercent, 95);
  assert.equal(usage.spendControl.remainingPercent, 68);
  assert.equal(usage.cooldownUntil, null);
});

test('usage normalization does not call a healthy window a cooldown only because allowed is false', () => {
  const usage = normalizeUsagePayload({
    rate_limit: {
      allowed: false,
      limit_reached: false,
      primary_window: { used_percent: 20 },
      secondary_window: { used_percent: 10 },
    },
  });

  assert.equal(usage.status, 'unknown');
  assert.equal(usage.limitReached, false);
  assert.equal(usage.primary.remainingPercent, 80);
});

test('usage cache follows the upstream account identity after a profile is reauthenticated', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-usage-'));
  const accountHome = path.join(root, 'account');
  fs.mkdirSync(accountHome, { recursive: true });
  const account = { id: 'shared-profile', codexHome: accountHome };
  const writeAuth = accountId => fs.writeFileSync(path.join(accountHome, 'auth.json'), JSON.stringify({ tokens: {
    id_token: jwt({}),
    access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    refresh_token: 'refresh-token',
    account_id: accountId,
  } }));
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    const accountId = options.headers['chatgpt-account-id'];
    return new Response(JSON.stringify({ rate_limit: {
      allowed: true,
      primary_window: { used_percent: accountId === 'acct-a' ? 20 : 80 },
      secondary_window: { used_percent: 10 },
    } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    writeAuth('acct-a');
    assert.equal((await getAccountUsage(account, { fetchImpl })).primary.remainingPercent, 80);
    writeAuth('acct-b');
    assert.equal((await getAccountUsage(account, { fetchImpl })).primary.remainingPercent, 20);
    assert.equal(calls, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
