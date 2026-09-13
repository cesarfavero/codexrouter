import test from 'node:test';
import assert from 'node:assert/strict';
import { GATEWAY_SLUG, buildGatewayCatalog, chooseNativeModel, summarizeNativeModels } from '../src/catalog.js';

test('gateway catalog exposes gateway and account models', () => {
  const cesar = {
    models: [
      { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', visibility: 'list', context_window: 100, is_default: true },
      { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', context_window: 80 },
    ],
  };
  const eduardo = {
    models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', context_window: 80 }],
  };

  const result = buildGatewayCatalog([
    { account: { id: 'cesar', label: 'Cesar', preferredModel: 'gpt-5.6-sol' }, catalog: cesar },
    { account: { id: 'eduardo', label: 'Eduardo', preferredModel: 'gpt-5.5' }, catalog: eduardo },
  ], 'cesar');

  assert.equal(result.models.length, 4);
  assert.equal(result.models[0].slug, GATEWAY_SLUG);
  assert.equal(result.models[0].display_name, 'CodexRouter');
  assert.equal(result.models[0].context_window, 100);
  assert.equal(result.models[1].slug, 'gpt-5.6-sol');
  assert.equal(result.models[2].slug, 'gpt-5.5');
  assert.equal(result.models[3].slug, 'codexrouter/eduardo/gpt-5.5');
});

test('native model selection respects preference then catalog default', () => {
  const source = {
    models: [
      { slug: 'gpt-default', visibility: 'list', is_default: true },
      { slug: 'gpt-preferred', visibility: 'list' },
    ],
  };
  assert.equal(chooseNativeModel(source, 'gpt-preferred'), 'gpt-preferred');
  assert.equal(chooseNativeModel(source, 'missing'), 'gpt-preferred');
});

test('summarizes only selectable native models', () => {
  const result = summarizeNativeModels({ models: [
    { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', visibility: 'list' },
    { slug: 'hidden', visibility: 'hide' },
    { slug: 'codexrouter/gateway', visibility: 'list' },
  ] });
  assert.deepEqual(result, [{ slug: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]);
});
