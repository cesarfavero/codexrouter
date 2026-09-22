import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createJevAdvisor,
  jevConfigFromEnv,
  resolveJevAccountRouting,
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
  assert.equal(config.contextProfile, 'economy');
  assert.equal(config.accountRouting, 'off');
  assert.equal(config.allowedAccounts, null);
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
    evaluatorManipulation: 0.01,
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
    evaluatorManipulation: 0.01,
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
    evaluatorManipulation: 0.01,
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
      contextProfile: 'full',
      accountRouting: 'off',
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

test('economy profile sends latest user context and reduced questions', async () => {
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
      maxChars: 12_000,
      contextProfile: 'economy',
      accountRouting: 'off',
      sampleRate: 1,
      cacheTtlMs: 0,
      maxRequestsPerMinute: 60,
      allowedModels: null,
    },
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({
        model: 'jev-1.13.0',
        usage: { input_tokens: 12 },
        answers: {
          route_tier: { type: 'choice', choice: 'economy', confidence: 0.9 },
          reasoning_effort: { type: 'choice', choice: 'low', confidence: 0.9 },
          evaluator_manipulation: { type: 'noul', noul: 0.05 },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await advisor.advise({
    request: {
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'older large context' }] },
        { role: 'assistant', content: [{ type: 'output_text', text: 'assistant answer' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'latest task' }] },
      ],
    },
    account,
    endpoint: 'responses',
  });

  assert.equal(result.status, 'ok');
  assert.equal(sent.state.task, 'latest task');
  assert.deepEqual(Object.keys(sent.questions).sort(), ['evaluator_manipulation', 'reasoning_effort', 'route_tier']);
});

test('account routing sends anonymized allowed candidates and resolves only their aliases', async () => {
  let sent = null;
  const advisor = createJevAdvisor({
    config: {
      mode: 'active',
      configured: true,
      apiKey: 'key',
      baseURL: 'https://api.typesafe.ai',
      model: 'jev-1.13.0',
      timeoutMs: 900,
      minConfidence: 0.8,
      maxChars: 3000,
      contextProfile: 'economy',
      accountRouting: 'active',
      allowedAccounts: ['cesar'],
      sampleRate: 1,
      cacheTtlMs: 0,
      maxRequestsPerMinute: 60,
      allowedModels: ['gpt-5.5'],
    },
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({
        model: 'jev-1.13.0',
        usage: { input_tokens: 21 },
        answers: {
          route_tier: { type: 'choice', choice: 'balanced', confidence: 0.92 },
          reasoning_effort: { type: 'choice', choice: 'medium', confidence: 0.88 },
          evaluator_manipulation: { type: 'noul', noul: 0.01 },
          account_choice: { type: 'choice', choice: 'candidate_1', confidence: 0.95 },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const candidates = [
    { account: { id: 'cesar', preferredModel: 'gpt-5.5', availableModels: [{ slug: 'gpt-5.5' }, { slug: 'gpt-5.6-sol' }] }, score: 82 },
    { account: { id: 'tanke', preferredModel: 'gpt-5.5', availableModels: [{ slug: 'gpt-5.5' }] }, score: 61 },
  ];
  const decision = await advisor.advise({
    request: { input: 'small task' },
    account: candidates[0].account,
    accountCandidates: candidates,
  });
  const routing = advisor.resolveAccount(candidates, decision);

  assert.equal(decision.recommendedAccountId, 'cesar');
  assert.equal(routing.applyAccount, true);
  assert.deepEqual(sent.state.router.account_candidates, [
    { id: 'candidate_1', headroom_percent: 82, models: ['gpt-5.5'] },
  ]);
  assert.doesNotMatch(JSON.stringify(sent), /cesar|tanke/);
});

test('account routing recommendations apply only to known candidates in active mode', () => {
  const candidates = [
    { account: { id: 'cesar' }, score: 90 },
    { account: { id: 'tanke' }, score: 40 },
  ];
  const applied = resolveJevAccountRouting(candidates, {
    status: 'ok',
    recommendedAccountId: 'cesar',
    accountConfidence: 0.92,
    evaluatorManipulation: 0.01,
  }, { mode: 'active', accountRouting: 'active', minConfidence: 0.8 });
  assert.equal(applied.applyAccount, true);
  assert.equal(applied.recommendedAccountId, 'cesar');

  const unknown = resolveJevAccountRouting(candidates, {
    status: 'ok',
    recommendedAccountId: 'missing',
    accountConfidence: 0.99,
    evaluatorManipulation: 0.01,
  }, { mode: 'active', accountRouting: 'active', minConfidence: 0.8 });
  assert.equal(unknown.applyAccount, false);
  assert.equal(unknown.recommendedAccountId, null);

  const observe = resolveJevAccountRouting(candidates, {
    status: 'ok',
    recommendedAccountId: 'cesar',
    accountConfidence: 0.99,
    evaluatorManipulation: 0.01,
  }, { mode: 'active', accountRouting: 'observe', minConfidence: 0.8 });
  assert.equal(observe.applyAccount, false);
  assert.equal(observe.recommendedAccountId, 'cesar');

  for (const evaluatorManipulation of [null, undefined, 0.6, 1.1]) {
    const unsafe = resolveJevAccountRouting(candidates, {
      status: 'ok',
      recommendedAccountId: 'cesar',
      accountConfidence: 0.99,
      evaluatorManipulation,
    }, { mode: 'active', accountRouting: 'active', minConfidence: 0.8 });
    assert.equal(unsafe.applyAccount, false, `must not route account for manipulation score ${evaluatorManipulation}`);
  }
  const noConfidence = resolveJevAccountRouting(candidates, {
    status: 'ok',
    recommendedAccountId: 'cesar',
    accountConfidence: null,
    evaluatorManipulation: 0.01,
  }, { mode: 'active', accountRouting: 'active', minConfidence: 0 });
  assert.equal(noConfidence.applyAccount, false);
});

test('cached decisions avoid another TypeSafe call and report no newly billed input tokens', async () => {
  let calls = 0;
  const advisor = createJevAdvisor({
    config: {
      mode: 'observe',
      configured: true,
      apiKey: 'key',
      baseURL: 'https://api.typesafe.ai',
      model: 'jev-1.13.0',
      timeoutMs: 900,
      minConfidence: 0.78,
      maxChars: 3000,
      contextProfile: 'economy',
      accountRouting: 'off',
      sampleRate: 1,
      cacheTtlMs: 60_000,
      maxRequestsPerMinute: 60,
      allowedModels: null,
      allowedAccounts: null,
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        model: 'jev-1.13.0',
        usage: { input_tokens: 19 },
        answers: {
          route_tier: { type: 'choice', choice: 'balanced', confidence: 0.9 },
          reasoning_effort: { type: 'choice', choice: 'medium', confidence: 0.9 },
          evaluator_manipulation: { type: 'noul', noul: 0.01 },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const request = { input: 'same task' };
  const first = await advisor.advise({ request, account, endpoint: 'responses' });
  const cached = await advisor.advise({ request, account, endpoint: 'responses' });
  assert.equal(calls, 1);
  assert.equal(first.inputTokens, 19);
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.inputTokens, 0);
});

test('decision cache does not reuse an account alias for a different eligible candidate', async () => {
  let calls = 0;
  const advisor = createJevAdvisor({
    config: {
      mode: 'active',
      configured: true,
      apiKey: 'key',
      baseURL: 'https://api.typesafe.ai',
      model: 'jev-1.13.0',
      timeoutMs: 900,
      minConfidence: 0.78,
      maxChars: 3000,
      contextProfile: 'economy',
      accountRouting: 'active',
      allowedAccounts: null,
      allowedModels: null,
      sampleRate: 1,
      cacheTtlMs: 60_000,
      maxRequestsPerMinute: 60,
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        model: 'jev-1.13.0',
        usage: { input_tokens: 19 },
        answers: {
          route_tier: { type: 'choice', choice: 'balanced', confidence: 0.9 },
          reasoning_effort: { type: 'choice', choice: 'medium', confidence: 0.9 },
          evaluator_manipulation: { type: 'noul', noul: 0.01 },
          account_choice: { type: 'choice', choice: 'candidate_1', confidence: 0.9 },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const request = { input: 'same task' };
  const firstCandidate = [{ account: { id: 'cesar', preferredModel: 'gpt-5.5', availableModels: ['gpt-5.5'] }, score: 80 }];
  const differentCandidate = [{ account: { id: 'tanke', preferredModel: 'gpt-5.5', availableModels: ['gpt-5.5'] }, score: 80 }];
  const first = await advisor.advise({ request, account: firstCandidate[0].account, accountCandidates: firstCandidate });
  const second = await advisor.advise({ request, account: differentCandidate[0].account, accountCandidates: differentCandidate });

  assert.equal(first.recommendedAccountId, 'cesar');
  assert.equal(second.recommendedAccountId, 'tanke');
  assert.equal(second.cacheHit, false);
  assert.equal(calls, 2);
});

test('zero sampling skips the external call', async () => {
  let calls = 0;
  const advisor = createJevAdvisor({
    config: {
      mode: 'active',
      configured: true,
      apiKey: 'key',
      contextProfile: 'economy',
      accountRouting: 'off',
      sampleRate: 0,
      maxRequestsPerMinute: 60,
      cacheTtlMs: 0,
      allowedModels: null,
      allowedAccounts: null,
    },
    random: () => 0.5,
    fetchImpl: async () => { calls += 1; throw new Error('unexpected call'); },
  });
  const result = await advisor.advise({ request: { input: 'task' }, account });
  assert.equal(result.status, 'sampled-out');
  assert.equal(calls, 0);
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
      contextProfile: 'economy',
      accountRouting: 'off',
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
