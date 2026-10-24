import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexBinary, extractLoginAuthUrl, fetchNativeCatalog, fetchNativeCatalogAsync, prepareAccountCodexHome, probeCodexCli, reuseMainCodexSession } from '../src/auth.js';

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

test('isolated account login stores credentials in the file required by the Router', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-auth-store-'));
  try {
    const configPath = path.join(root, 'config.toml');
    fs.writeFileSync(configPath, 'cli_auth_credentials_store = "keyring"\nmodel = "gpt-6-luna"\n');
    prepareAccountCodexHome(root);
    assert.equal(fs.readFileSync(configPath, 'utf8'), 'cli_auth_credentials_store = "file"\nmodel = "gpt-6-luna"\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Windows Codex .cmd shim runs from a path with spaces for sync and async catalog refresh', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexrouter-cmd-'));
  const previous = process.env.CODEX_BIN;
  try {
    const directory = path.join(root, 'codex shim test');
    fs.mkdirSync(directory);
    const binary = path.join(directory, 'codex.cmd');
    fs.writeFileSync(binary, [
      '@echo off',
      'if "%~1"=="--version" (echo codex-cli 0.163.0 & exit /b 0)',
      'if not "%~1"=="debug" exit /b 2',
      'if not "%~2"=="models" exit /b 3',
      'echo {"models":[{"slug":"gpt-6.1-sol","visibility":"list"}]}',
      '',
    ].join('\r\n'));
    process.env.CODEX_BIN = binary;
    const home = path.join(root, 'account home');

    const sync = fetchNativeCatalog(home);
    const asyncCatalog = await fetchNativeCatalogAsync(home);
    assert.deepEqual(sync, asyncCatalog);
    assert.equal(sync.models[0].slug, 'gpt-6.1-sol');
    assert.deepEqual(await probeCodexCli(), { available: true, version: '0.163.0' });
  } finally {
    if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous;
    fs.rmSync(root, { recursive: true, force: true });
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
