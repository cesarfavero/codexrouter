import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ensureDir, readJson, writeTextAtomic } from './fs-util.js';

export function codexBinary() {
  return process.env.CODEX_BIN || 'codex';
}

export function prepareAccountCodexHome(codexHome) {
  ensureDir(codexHome);
  const configPath = path.join(codexHome, 'config.toml');
  if (!fs.existsSync(configPath)) {
    writeTextAtomic(configPath, 'cli_auth_credentials_store = "file"\n');
  } else {
    const text = fs.readFileSync(configPath, 'utf8');
    if (!/^\s*cli_auth_credentials_store\s*=/m.test(text)) {
      writeTextAtomic(configPath, `cli_auth_credentials_store = "file"\n${text}`);
    }
  }
}

function runCodex(codexHome, args, options = {}) {
  prepareAccountCodexHome(codexHome);
  const result = spawnSync(codexBinary(), args, {
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
    timeout: options.timeout ?? undefined,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? (result.stderr || result.stdout || '').trim() : '';
    throw new Error(`codex ${args.join(' ')} exited with code ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

export function extractLoginAuthUrl(output) {
  if (typeof output !== 'string') return null;
  const explicit = /navigate to this URL to authenticate:\s*(https:\/\/[^\s]+)/i.exec(output)?.[1];
  if (explicit) return explicit.replace(/[),.;]+$/, '');
  const authOpenAi = /(https:\/\/auth\.openai\.com\/[^\s]+)/i.exec(output)?.[1];
  return authOpenAi ? authOpenAi.replace(/[),.;]+$/, '') : null;
}

/**
 * Starts the official `codex login` browser OAuth flow for one isolated CODEX_HOME.
 * Codex owns the local callback server, token exchange, persistence and refresh semantics.
 * CodexRouter only observes the public auth URL so a desktop launcher can surface it.
 */
export function loginInteractive(codexHome, {
  onAuthUrl,
  onState,
  timeout = 10 * 60 * 1000,
} = {}) {
  prepareAccountCodexHome(codexHome);

  return new Promise((resolve, reject) => {
    const child = spawn(codexBinary(), ['login'], {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let combined = '';
    let reportedUrl = null;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const consume = chunk => {
      const text = String(chunk ?? '');
      combined = `${combined}${text}`.slice(-16_384);
      if (!reportedUrl) {
        const url = extractLoginAuthUrl(combined);
        if (url) {
          reportedUrl = url;
          onAuthUrl?.(url);
          onState?.('waiting-for-browser');
        }
      }
    };

    child.stdout?.on('data', consume);
    child.stderr?.on('data', consume);
    child.once('error', error => finish(() => reject(error)));
    child.once('exit', (code, signal) => {
      if (code === 0) {
        finish(() => {
          try {
            onState?.('authenticated');
            resolve(inspectAuth(codexHome));
          } catch (error) {
            reject(error);
          }
        });
        return;
      }
      const suffix = signal ? ` (signal ${signal})` : '';
      finish(() => reject(new Error(`codex login exited with code ${code ?? 'unknown'}${suffix}.`)));
    });

    onState?.('starting');
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => reject(new Error('Codex login timed out before authentication completed.')));
    }, timeout);
  });
}

export function login(codexHome) {
  runCodex(codexHome, ['login']);
  return inspectAuth(codexHome);
}

export function logout(codexHome) {
  runCodex(codexHome, ['logout']);
}

export function loginStatus(codexHome) {
  return runCodex(codexHome, ['login', 'status'], { capture: true }).stdout.trim();
}

export function refreshViaCodex(codexHome) {
  runCodex(codexHome, ['debug', 'models'], { capture: true, timeout: 120_000 });
  return inspectAuth(codexHome);
}

export function fetchNativeCatalog(codexHome) {
  const output = runCodex(codexHome, ['debug', 'models'], { capture: true, timeout: 120_000 }).stdout;
  const firstBrace = output.indexOf('{');
  const firstBracket = output.indexOf('[');
  const startCandidates = [firstBrace, firstBracket].filter(index => index >= 0);
  if (!startCandidates.length) throw new Error('codex debug models did not return JSON.');
  const start = Math.min(...startCandidates);
  return JSON.parse(output.slice(start));
}

export function inspectAuth(codexHome) {
  const authPath = path.join(codexHome, 'auth.json');
  const auth = readJson(authPath);
  const tokens = auth?.tokens;
  if (!tokens?.access_token) {
    throw new Error(`ChatGPT credentials were not found in ${authPath}.`);
  }
  const idInfo = decodeJwtPayload(rawIdToken(tokens.id_token));
  const accessInfo = decodeJwtPayload(tokens.access_token);
  const authClaims = idInfo?.['https://api.openai.com/auth'] ?? {};
  const profileClaims = idInfo?.['https://api.openai.com/profile'] ?? {};
  return {
    authPath,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accountId: tokens.account_id ?? authClaims.chatgpt_account_id ?? null,
    email: idInfo?.email ?? profileClaims.email ?? null,
    plan: authClaims.chatgpt_plan_type ?? null,
    expiresAt: typeof accessInfo?.exp === 'number' ? accessInfo.exp * 1000 : null,
  };
}

export function freshAuth(codexHome, { force = false } = {}) {
  let auth = inspectAuth(codexHome);
  const refreshWindow = 5 * 60 * 1000;
  if (force || !auth.expiresAt || auth.expiresAt <= Date.now() + refreshWindow) {
    auth = refreshViaCodex(codexHome);
  }
  return auth;
}

function rawIdToken(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value.raw_jwt || value.rawJwt || null;
  return null;
}

function decodeJwtPayload(jwt) {
  if (!jwt || typeof jwt !== 'string') return {};
  const parts = jwt.split('.');
  if (parts.length < 2) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}
