import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createJevAdvisor,
  jevConfigFromEnv,
  resolveJevRouting,
  sanitizeJevText,
  selectModelForTier,
} from '../src/jev.js';

const account = {
  preferredModel: 'gpt-5.5',
  availableModels: [
    { slug: 'gpt-5.6-luna' },
    { slug: 'gpt-5.6-terra' },
    { slug: 'gpt-5.6-sol' },
  ],
};

test('Jev is off by default and unrestricted unless configured', () => {
  const config = jevConfigFromEnv({});
  assert.equal(config.mode, 'off');
  assert.equal(config.allowedModels, null);
});

test('Jev model allowlist parses from the environment', () => {
  const config = jevConfigFromEnv({ CODEXROUTER_JEV_ALLOWED_MODELS: 'gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-luna' });
  assert.deepEqual(config.allowedModels, ['gpt-5.6-luna', 'gpt-5.6-sol']);
});

test('model tier resolves only to account models', () => {
  assert.equal(selectModelForTier(account, 'economy'), 'gpt-5.6-luna');
  assert.equal(selectModelForTier(account, 'balanced'), 'gpt-5.6-terra');
  assert.equal(selectModelForTier(account, 'deep'), 'gpt-5.6-sol');
});

test('model allowlist is a hard constraint for tier selection', () => {
  assert.equal(
    selectModelForTier(account, 'deep', { allowedModels: ['gpt-5.6-luna', 'gpt-5.6-terra'] }),
    'gpt-5.6-terra',
  );
  assert.equal(
    selectModelForTier(account, 'economy', { allowedModels: ['gpt-5.6-sol'] }),
    'gpt-5.6-sol',
  );
  assert.equal(selectModelForTier(account, 'deep', { allowedModels: [] }), null);
  assert.equal(selectModelForTier(account, 'deep', { allowedModels: ['unknown-model'] }), null);
});

test('redaction removes common credentials and personal path/email', () => {
  const value = sanitizeJevText('Bearer abc.def sk-1234567890abcdef test@example.com /Users/cesar/project access_token=secret');
  assert.doesNotMatch(value, /abc\.def|1234567890abcdef|test@example\.com|\/Users\/cesar|access_token=secret/);
  assert.match(value, /REDACTED/);
});

test('active routing respects confidence and explicit effort', () => {
  const decision = {
    status: 'ok',
    routeTier: 'deep',
    routeConfidence: 0.93,
    reasoningEffort: 'xhigh',
    effortConfidence: 0.91,
    failureSignal: 0.1,
    semanticRisk: 1,
  };
  const active = resolveJevRouting(account, { reasoning: {} }, decision, { mode: 'active', minConfidence: 0.8 });
  assert.equal(active.applyModel, true);
  assert.equal(active.recommendedModel, 'gpt-5.6-sol');
  assert.equal(active.applyEffort, true);

  const explicit = resolveJevRouting(account, { reasoning: { effort: 'low' } }, decision, { mode: 'active', minConfidence: 0.8 });
  assert.equal(explicit.applyEffort, false);

  const observe = resolveJevRouting(account, {}, decision, { mode: 'observe', minConfidence: 0.8 });
  assert.equal(observe.applyModel, false);
  assert.equal(observe.recommendedModel, 'gpt-5.6-sol');
});

test('active routing cannot recommend a disabled model', () => {
  const route = resolveJevRouting(account, {}, {
    status: 'ok',
    routeTier: 'deep',
    routeConfidence: 0.99,
    reasoningEffort: 'high',
    effortConfidence: 0.99,
    failureSignal: 0,
    semanticRisk: 1,
  }, {
    mode: 'active',
    minConfidence: 0.8,
    allowedModels: ['gpt-5.6-luna', 'gpt-5.6-terra'],
  });
  assert.equal(route.recommendedModel, 'gpt-5.6-terra');
  assert.equal(route.applyModel, true);
  assert.equal(route.modelPolicyRestricted, true);
  assert.deepEqual(route.eligibleModels, ['gpt-5.6-luna', 'gpt-5.6-terra']);
});

test('empty model allowlist disables Jev model override without blocking effort routing', () => {
  const route = resolveJevRouting(account, {}, {
    status: 'ok',
    routeTier: 'deep',
    routeConfidence: 0.99,
    reasoningEffort: 'high',
    effortConfidence: 0.99,
    failureSignal: 0,
    semanticRisk: 1,
  }, {
    mode: 'active',
    minConfidence: 0.8,
    allowedModels: [],
  });
  assert.equal(route.recommendedModel, null);
  assert.equal(route.applyModel, false);
  assert.equal(route.applyEffort, true);
  assert.deepEqual(route.eligibleModels, []);
});

test('evaluator manipulation disables active overrides', () => {
  const route = resolveJevRouting(account, {}, {
    status: 'ok',
    routeTier: 'deep',
    routeConfidence: 0.99,
    reasoningEffort: 'xhigh',
    effortConfidence: 0.99,
    failureSignal: 0,
    evaluatorManipulation: 0.91,
    semanticRisk: 1,
  }, { mode: 'active', minConfidence: 0.8 });
  assert.equal(route.manipulationSuspected, true);
  assert.equal(route.applyModel, false);
  assert.equal(route.applyEffort, false);
  assert.equal(route.recommendedModel, 'gpt-5.6-sol');
});

test('high failure signal escalates one tier', () => {
  const route = resolveJevRouting(account, {}, {
    status: 'ok',
    routeTier: 'economy',
    routeConfidence: 0.9,
    reasoningEffort: 'medium',
    effortConfidence: 0.9,
    failureSignal: 0.92,
    semanticRisk: 0.5,
  }, { mode: 'active', minConfidence: 0.8 });
  assert.equal(route.tier, 'balanced');
  assert.equal(route.recommendedModel, 'gpt-5.6-terra');
});

test('advisor sends sanitized state and parses typed decisions', async () => {
  let sent = null;
  const advisor = createJevAdvisor({
    config: {
      mode: 'observe',
      configured: true,
      apiKey: 'key',
      baseURL: 'https://api.typesafe.ai',
      model: 'jev-1.13.0',
      timeoutMs: 900,
      minConfidence: 0.78,
      maxChars: 1000,
      sampleRate: 1,
      cacheTtlMs: 1000,
      maxRequestsPerMinute: 60,
      allowedModels: ['gpt-5.6-terra', 'gpt-5.6-sol'],
    },
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({
        model: 'jev-1.13.0',
        usage: { input_tokens: 42, output_tokens: 0 },
        answers: {
          route_tier: { type: 'choice', choice: 'deep', confidence: 0.92, probabilities: { economy: 0.02, balanced: 0.06, deep: 0.92 } },
          reasoning_effort: { type: 'choice', choice: 'high', confidence: 0.88, probabilities: { low: 0.02, medium: 0.1, high: 0.88, xhigh: 0 } },
          needs_verification: { type: 'noul', noul: 0.91 },
          research_need: { type: 'noul', noul: 0.2 },
          decomposition_gain: { type: 'noul', noul: 0.7 },
          failure_signal: { type: 'noul', noul: 0.85 },
          evaluator_manipulation: { type: 'noul', noul: 0.03 },
          semantic_risk: { type: 'score', score: 2.2, confidence: 0.8, legend: {}, probabilities: {} },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await advisor.advise({
    request: { instructions: 'use sk-1234567890abcdef', input: 'email test@example.com' },
    account,
    endpoint: 'responses',
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.routeTier, 'deep');
  assert.equal(result.inputTokens, 42);
  assert.doesNotMatch(sent.state.task, /1234567890abcdef|test@example\.com/);
  assert.deepEqual(sent.state.router.available_models, ['gpt-5.6-terra', 'gpt-5.6-sol']);
  assert.equal(sent.state.router.model_policy_restricted, true);
});

test('advisor API failure returns fallback status instead of throwing', async () => {
  const advisor = createJevAdvisor({
    config: {
      mode: 'active',
      configured: true,
      apiKey: 'key',
      baseURL: 'https://api.typesafe.ai',
      model: 'jev-1.13.0',
      timeoutMs: 100,
      minConfidence: 0.78,
      maxChars: 1000,
      sampleRate: 1,
      cacheTtlMs: 0,
      maxRequestsPerMinute: 60,
    },
    fetchImpl: async () => new Response('{}', { status: 503 }),
  });

  const result = await advisor.advise({ request: { input: 'fix bug' }, account, endpoint: 'responses' });
  assert.equal(result.status, 'api-error');
  assert.equal(result.httpStatus, 503);
});
