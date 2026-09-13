import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLoginAuthUrl } from '../src/auth.js';

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
