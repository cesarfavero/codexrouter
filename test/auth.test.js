import test from 'node:test';
import assert from 'node:assert/strict';
import { codexBinary, extractLoginAuthUrl } from '../src/auth.js';

test('codexBinary honors an explicit executable path', () => {
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = '/custom/path/codex';
  try {
    assert.equal(codexBinary(), '/custom/path/codex');
  } finally {
    if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous;
  }
});

test('extractLoginAuthUrl reads the official Codex browser login message', () => {
  const output = [
    'Starting local login server on http://localhost:1455.',
    'If your browser did not open, navigate to this URL to authenticate:',
    '',
    'https://auth.openai.com/oauth/authorize?client_id=test&state=abc',
    '',
  ].join('\n');
  assert.equal(
    extractLoginAuthUrl(output),
    'https://auth.openai.com/oauth/authorize?client_id=test&state=abc',
  );
});

test('extractLoginAuthUrl does not accept unrelated output', () => {
  assert.equal(extractLoginAuthUrl('Successfully logged in'), null);
});
