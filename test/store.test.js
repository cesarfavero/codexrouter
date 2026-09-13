import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { slugifyAccountId, registerAccount, loadRegistry, setDefaultAccount } from '../src/store.js';

test('slugify account names', () => {
  assert.equal(slugifyAccountId('César High Square'), 'cesar-high-square');
});

test('registry stores accounts and default', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-test-'));
  const previous = process.env.CODEXROUTER_HOME;
  process.env.CODEXROUTER_HOME = root;
  try {
    const cesar = registerAccount('Cesar');
    const eduardo = registerAccount('Eduardo');
    assert.equal(loadRegistry().defaultAccountId, cesar.id);
    setDefaultAccount(eduardo.id);
    assert.equal(loadRegistry().defaultAccountId, eduardo.id);
  } finally {
    if (previous === undefined) delete process.env.CODEXROUTER_HOME;
    else process.env.CODEXROUTER_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
