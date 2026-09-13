import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsagePayload } from '../src/usage.js';

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
