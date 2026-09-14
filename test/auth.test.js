import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexBinary, extractLoginAuthUrl, reuseMainCodexSession } from '../src/auth.js';

function jwt(payload) {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
}

test('codexBinary honors an explicit executable path', () => {
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = '/custom/path/codex';
  try {
    assert.equal(codexBinary(), '/custom/path/codex');
  } finally {
    if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous;
  }
});

test('reuseMainCodexSession copies an existing official session into an account profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-auth-'));
  const previous = process.env.CODEX_HOME;
  const main = path.join(root, 'main');
  const account = path.join(root, 'account');
  process.env.CODEX_HOME = main;
  fs.mkdirSync(main, { recursive: true });
  fs.writeFileSync(path.join(main, 'auth.json'), JSON.stringify({ tokens: {
    id_token: jwt({}),
    access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    refresh_token: 'refresh-token',
    account_id: 'acct-existing',
  } }));
  try {
    const identity = reuseMainCodexSession(account);
    assert.equal(identity.accountId, 'acct-existing');
    assert.equal(fs.existsSync(path.join(account, 'auth.json')), true);
    assert.equal(fs.statSync(path.join(account, 'auth.json')).mode & 0o777, 0o600);
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
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
