import test from 'node:test';
import assert from 'node:assert/strict';
import { aliasSlug, parseAliasSlug, buildCombinedCatalog } from '../src/catalog.js';

test('alias slug encodes account and native model', () => {
  const slug = aliasSlug('cesar', 'gpt-5.6-sol');
  assert.equal(slug, 'codexrouter/cesar/gpt-5.6-sol');
  assert.deepEqual(parseAliasSlug(slug), { accountId: 'cesar', nativeModel: 'gpt-5.6-sol' });
});

test('combined catalog appends account-specific model aliases', () => {
  const source = { models: [{ slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', visibility: 'list', context_window: 100 }] };
  const result = buildCombinedCatalog([
    { account: { id: 'cesar', label: 'Cesar' }, catalog: source },
    { account: { id: 'eduardo', label: 'Eduardo' }, catalog: source },
  ], 'cesar');
  assert.equal(result.models.length, 3);
  assert.equal(result.models[1].display_name, 'GPT-5.6 Sol · Cesar');
  assert.equal(result.models[2].display_name, 'GPT-5.6 Sol · Eduardo');
  assert.equal(result.models[2].slug, 'codexrouter/eduardo/gpt-5.6-sol');
});
