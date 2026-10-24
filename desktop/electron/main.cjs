const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, safeStorage, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { getAutostart, setAutostart } = require('./autostart.cjs');

const DEFAULT_PORT = Number(process.env.CODEXROUTER_PORT || 17842);
const VALID_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
const TRAY_ICON = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAkElEQVR4nO2XSw6AMAhEwXj/K+PKpLF8ay1pZLbWmQcYUYDS34WeQ0REwwGIaoZ68U2wF+RYEa75sQCzwzVfsQOr1M3Fqt56qKIep2UWCX6e9YwyfQQugEj10fv26EABFEABpAOMbsctXsXuZXRXM2MbtmLNvvogAegLSB8BCzC6/SxxvmIHZkNIfun/BaV0XTuOPDLd7faPAAAAAElFTkSuQmCC';
const UPDATE_RELEASE_URL = 'https://github.com/cesarfavero/codexrouter/releases/latest';
const LOG_PATH = path.join(os.homedir(), '.codexrouter', 'logs', 'router.jsonl');
const JEV_SETTINGS_PATH = path.join(os.homedir(), '.codexrouter', 'jev-settings.json');
const JEV_MODES = new Set(['off', 'observe', 'active']);
const JEV_CONTEXT_PROFILES = new Set(['economy', 'balanced', 'full']);
const JEV_ACCOUNT_ROUTING_MODES = new Set(['off', 'observe', 'active']);

let mainWindow = null;
let tray = null;
let routerServer = null;
let routerPort = DEFAULT_PORT;
let isQuitting = false;
let corePromise = null;
let updateTimer = null;
let catalogRefreshTimer = null;
let backgroundCatalogRefresh = null;
let catalogSyncQueue = Promise.resolve();
let catalogRefreshState = { status: 'idle', lastSuccessAt: null, error: null };
let updateInfo = null;
let updateStatus = null;
let updateProgress = 0;
let updateApplyPromise = null;
let updateCheckPromise = null;
let updateCheck = { state: 'idle', checkedAt: null, error: null };
let autoUpdateCapability = null;
const logs = loadLogs();

function loadLogs() {
  try {
    return fs.readFileSync(LOG_PATH, 'utf8').trim().split(/\r?\n/).slice(-250).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function moduleUrl(relative) {
  return pathToFileURL(path.join(__dirname, '..', '..', relative)).href;
}

async function core() {
  if (!corePromise) {
    corePromise = Promise.all([
      import(moduleUrl('src/store.js')),
      import(moduleUrl('src/auth.js')),
      import(moduleUrl('src/catalog.js')),
      import(moduleUrl('src/integration.js')),
      import(moduleUrl('src/router.js')),
      import(moduleUrl('src/paths.js')),
      import(moduleUrl('src/usage.js')),
      import(moduleUrl('src/jev.js')),
    ]).then(([store, auth, catalog, integration, router, paths, usage, jev]) => ({
      store, auth, catalog, integration, router, paths, usage, jev,
    }));
  }
  return corePromise;
}

function loadJevSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(JEV_SETTINGS_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function saveJevSettings(settings) {
  fs.mkdirSync(path.dirname(JEV_SETTINGS_PATH), { recursive: true, mode: 0o700 });
  const temporary = `${JEV_SETTINGS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, JEV_SETTINGS_PATH);
  try { fs.chmodSync(JEV_SETTINGS_PATH, 0o600); } catch {}
}

function decryptStoredJevKey(settings) {
  const encoded = typeof settings.apiKeyCiphertext === 'string' ? settings.apiKeyCiphertext : '';
  if (!encoded) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try { return safeStorage.decryptString(Buffer.from(encoded, 'base64')); } catch { return null; }
}

function desktopJevConfig(jev) {
  const base = jev.jevConfigFromEnv(process.env);
  const settings = loadJevSettings();
  const storedKey = decryptStoredJevKey(settings);
  const mode = JEV_MODES.has(settings.mode) ? settings.mode : base.mode;
  const minConfidence = Number.isFinite(Number(settings.minConfidence))
    ? Math.max(0, Math.min(1, Number(settings.minConfidence)))
    : base.minConfidence;
  const model = typeof settings.model === 'string' && settings.model.trim() ? settings.model.trim() : base.model;
  const contextProfile = JEV_CONTEXT_PROFILES.has(settings.contextProfile) ? settings.contextProfile : base.contextProfile;
  const accountRouting = JEV_ACCOUNT_ROUTING_MODES.has(settings.accountRouting) ? settings.accountRouting : base.accountRouting;
  const maxChars = boundedNumber(settings.maxChars, base.maxChars, 1_000, 100_000);
  const sampleRate = boundedNumber(settings.sampleRate, base.sampleRate, 0, 1);
  const cacheTtlMs = boundedNumber(settings.cacheTtlMs, base.cacheTtlMs, 0, 3_600_000);
  const hasStoredAccountPolicy = Object.prototype.hasOwnProperty.call(settings, 'allowedAccounts');
  const allowedAccounts = hasStoredAccountPolicy
    ? settings.allowedAccounts === null
      ? null
      : Array.isArray(settings.allowedAccounts)
        ? [...new Set(settings.allowedAccounts.map(value => String(value || '').trim()).filter(Boolean))]
        : base.allowedAccounts
    : base.allowedAccounts;
  const hasStoredModelPolicy = Object.prototype.hasOwnProperty.call(settings, 'allowedModels');
  const allowedModels = hasStoredModelPolicy
    ? settings.allowedModels === null
      ? null
      : Array.isArray(settings.allowedModels)
        ? [...new Set(settings.allowedModels.map(value => String(value || '').trim()).filter(Boolean))]
        : base.allowedModels
    : base.allowedModels;
  const apiKey = storedKey || base.apiKey;
  return { ...base, mode, model, minConfidence, contextProfile, accountRouting, maxChars, sampleRate, cacheTtlMs, allowedAccounts, allowedModels, apiKey, configured: Boolean(apiKey) };
}

function desktopJevSummary(jev) {
  const settings = loadJevSettings();
  const config = desktopJevConfig(jev);
  const stored = Boolean(settings.apiKeyCiphertext && decryptStoredJevKey(settings));
  return {
    mode: config.mode,
    configured: config.configured,
    model: config.model,
    minConfidence: config.minConfidence,
    contextProfile: config.contextProfile,
    accountRouting: config.accountRouting,
    maxChars: config.maxChars,
    sampleRate: config.sampleRate,
    cacheTtlMs: config.cacheTtlMs,
    allowedAccounts: config.allowedAccounts === null ? null : [...config.allowedAccounts],
    allowedModels: config.allowedModels === null ? null : [...config.allowedModels],
    keySource: stored ? 'secure-storage' : config.configured ? 'environment' : 'none',
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
  };
}

function createDesktopJevAdvisor(jev) {
  return jev.createJevAdvisor({ config: desktopJevConfig(jev) });
}

async function applyJevSettings(raw) {
  const { jev, integration } = await core();
  const current = loadJevSettings();
  const baseConfig = jev.jevConfigFromEnv(process.env);
  const mode = String(raw?.mode || 'off').trim().toLowerCase();
  if (!JEV_MODES.has(mode)) throw new Error('Jev mode must be off, observe, or active.');

  const model = typeof raw?.model === 'string' && raw.model.trim()
    ? raw.model.trim()
    : typeof current.model === 'string' && current.model.trim()
      ? current.model.trim()
      : 'jev-1.13.0';
  if (!model || model.length > 120 || !/^[A-Za-z0-9._/-]+$/.test(model)) throw new Error('Jev model id is invalid.');

  const minConfidence = Number(raw?.minConfidence);
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) throw new Error('Jev minimum confidence must be between 0 and 1.');
  const contextProfile = String(raw?.contextProfile || current.contextProfile || 'economy').trim().toLowerCase();
  if (!JEV_CONTEXT_PROFILES.has(contextProfile)) throw new Error('Jev context profile must be economy, balanced, or full.');
  const accountRouting = String(raw?.accountRouting || current.accountRouting || 'off').trim().toLowerCase();
  if (!JEV_ACCOUNT_ROUTING_MODES.has(accountRouting)) throw new Error('Jev account routing must be off, observe, or active.');
  const maxChars = Number(raw?.maxChars ?? current.maxChars ?? 12_000);
  if (!Number.isInteger(maxChars) || maxChars < 1_000 || maxChars > 100_000) throw new Error('Jev maximum context must be between 1,000 and 100,000 characters.');
  const sampleRate = Number(raw?.sampleRate ?? current.sampleRate ?? 1);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) throw new Error('Jev sample rate must be between 0 and 1.');
  const cacheTtlMs = Number(raw?.cacheTtlMs ?? current.cacheTtlMs ?? 300_000);
  if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 3_600_000) throw new Error('Jev cache duration must be between 0 and 3,600,000 milliseconds.');
  let allowedAccounts = Object.prototype.hasOwnProperty.call(current, 'allowedAccounts')
    ? current.allowedAccounts
    : baseConfig.allowedAccounts;
  if (Object.prototype.hasOwnProperty.call(raw || {}, 'allowedAccounts')) {
    if (raw.allowedAccounts === null) {
      allowedAccounts = null;
    } else {
      if (!Array.isArray(raw.allowedAccounts)) throw new Error('Jev allowed accounts must be an array or null.');
      if (raw.allowedAccounts.length > 128) throw new Error('Jev allowed account list is too large.');
      allowedAccounts = [...new Set(raw.allowedAccounts.map(value => String(value || '').trim()).filter(Boolean))];
      if (allowedAccounts.some(value => value.length > 180 || !/^[A-Za-z0-9._-]+$/.test(value))) {
        throw new Error('Jev allowed account list contains an invalid account id.');
      }
    }
  }

  const next = { ...current, mode, model, minConfidence, contextProfile, accountRouting, maxChars, sampleRate, cacheTtlMs, allowedAccounts };
  if (Object.prototype.hasOwnProperty.call(raw || {}, 'allowedModels')) {
    if (raw.allowedModels === null) {
      next.allowedModels = null;
    } else {
      if (!Array.isArray(raw.allowedModels)) throw new Error('Jev allowed models must be an array or null.');
      if (raw.allowedModels.length > 128) throw new Error('Jev allowed model list is too large.');
      const allowedModels = [...new Set(raw.allowedModels.map(value => String(value || '').trim()).filter(Boolean))];
      if (allowedModels.some(value => value.length > 180 || !/^[A-Za-z0-9._/-]+$/.test(value))) {
        throw new Error('Jev allowed model list contains an invalid model id.');
      }
      next.allowedModels = allowedModels;
    }
  }
  if (raw?.clearApiKey === true) delete next.apiKeyCiphertext;

  const apiKey = typeof raw?.apiKey === 'string' ? raw.apiKey.trim() : '';
  if (apiKey) {
    if (apiKey.length > 4096) throw new Error('TypeSafe API key is too long.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure OS encryption is unavailable. Use TYPESAFE_API_KEY instead of storing the key in CodexRouter.');
    next.apiKeyCiphertext = safeStorage.encryptString(apiKey).toString('base64');
  }

  saveJevSettings(next);
  const wasRunning = Boolean(routerServer?.listening);
  const restartPort = routerPort;
  if (wasRunning) {
    await stopRuntime({ restoreIntegration: false });
    await startRuntime(restartPort);
  }
  const summary = desktopJevSummary(jev);
  const modelPolicy = summary.allowedModels === null ? 'all models eligible' : `${summary.allowedModels.length} model(s) eligible`;
  const gatewayNote = mode === 'off' ? '' : ' · select Router in Codex to route requests through Jev';
  record('info', `Jev semantic routing saved: ${summary.mode} · ${summary.contextProfile} context · sample ${Math.round(summary.sampleRate * 100)}% · account routing ${summary.accountRouting} · ${summary.allowedAccounts === null ? 'all accounts eligible' : `${summary.allowedAccounts.length} account(s) eligible`} · ${summary.configured ? 'configured' : 'no API key'} · ${summary.model} · ${modelPolicy}${gatewayNote}.`);
  sendEvent({ type: 'snapshot-invalidated' });
  return snapshot();
}

function record(level, message, details = null) {
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, level, message, at: new Date().toISOString(), ...(details ? { details } : {}) };
  logs.push(item);
  if (logs.length > 250) logs.splice(0, logs.length - 250);
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true, mode: 0o700 });
    fs.appendFileSync(LOG_PATH, `${JSON.stringify(item)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {}
  sendEvent({ type: 'log', record: item });
  return item;
}

async function recordRouterRequest(event) {
  if (event.transport === 'websocket-negotiation' && event.status === 426) {
    record('info', 'Codex WebSocket is unavailable here; waiting to see whether Codex retries the model request over HTTP.', event);
    return;
  }
  if (event.usageOnly) {
    if (event.account?.id) {
      const { usage } = await core();
      usage.invalidateAccountUsage(event.account.id);
      sendEvent({ type: 'snapshot-invalidated' });
    }
    const usage = event.usage || {};
    record('info', `Usage ${event.requestId || 'unknown'} → ${event.account?.label || 'no account'} · ${event.model || event.endpoint} · ${usage.totalTokens ?? '—'} tokens (${usage.inputTokens ?? '—'} in / ${usage.outputTokens ?? '—'} out).`, { ...event, account: event.account ? { id: event.account.id, label: event.account.label } : null });
    return;
  }
  const account = event.account?.label || 'no account';
  const target = event.model || event.endpoint || 'unknown';
  const attempts = Array.isArray(event.attempts) ? event.attempts : [];
  const failures = attempts.filter(attempt => attempt.error).map(attempt => `${attempt.reason}:${attempt.status} ${attempt.error}`).join(' | ');
  const suffix = event.error || failures;
  const jev = event.jev;
  const jevSuffix = jev
    ? ` · Jev ${jev.mode || 'shadow'}:${jev.status}${jev.routeTier ? ` ${jev.routeTier}→${jev.recommendedModel || 'default'}${jev.appliedModel ? ' applied' : ' shadow'}` : ''}${jev.recommendedAccountId ? ` · account ${jev.appliedAccount ? 'applied' : 'shadow'}` : ''}${Number.isFinite(jev.latencyMs) ? ` ${jev.latencyMs}ms` : ''}`
    : '';
  const message = `Request ${event.requestId || 'unknown'} via Router → ${account} · ${target} · ${event.status} · ${event.durationMs ?? 0}ms${jevSuffix}${suffix ? ` · ${suffix}` : ''}`;
  const details = { ...event, account: event.account ? { id: event.account.id, label: event.account.label } : null };
  record(event.status >= 500 || event.error ? 'error' : event.status >= 400 ? 'warning' : 'info', message, details);
}

function sendEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('codexrouter:event', payload);
  }
}

async function checkForUpdates({ manual = false } = {}) {
  if (!canUseAutoUpdater()) {
    if (manual) throw new Error(updateUnavailableMessage());
    return;
  }
  if (!updateCheckPromise) {
    updateCheck = { ...updateCheck, state: 'checking', error: null };
    sendEvent({ type: 'snapshot-invalidated' });
    updateCheckPromise = (async () => {
      try {
        await autoUpdater.checkForUpdates();
        updateCheck = { state: updateInfo ? 'available' : 'up-to-date', checkedAt: new Date().toISOString(), error: null };
      } catch (error) {
        updateCheck = { state: 'error', checkedAt: new Date().toISOString(), error: error.message };
        record('warning', `Update check failed: ${error.message}`);
        throw error;
      } finally {
        sendEvent({ type: 'snapshot-invalidated' });
      }
    })().finally(() => { updateCheckPromise = null; });
  }
  return manual ? updateCheckPromise : updateCheckPromise.catch(() => {});
}

function canUseAutoUpdater() {
  if (autoUpdateCapability != null) return autoUpdateCapability;
  if (!app.isPackaged || process.platform !== 'darwin') {
    autoUpdateCapability = app.isPackaged;
    return autoUpdateCapability;
  }
  const appBundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  const verification = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appBundle], { encoding: 'utf8' });
  autoUpdateCapability = verification.status === 0;
  if (!autoUpdateCapability) {
    record('warning', 'Automatic updates disabled because this macOS build is not signed with a valid Developer ID certificate.');
  }
  return autoUpdateCapability;
}

function updateUnavailableMessage() {
  return process.platform === 'darwin'
    ? 'Automatic updates require a signed macOS build.'
    : 'Automatic updates require an installed CodexRouter app.';
}

function isNewerVersion(candidate, current) {
  const parse = value => String(value).split('.').map(part => Number.parseInt(part, 10) || 0);
  const next = parse(candidate);
  const installed = parse(current);
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

async function withOperation(name, work) {
  sendEvent({ type: 'operation', operation: { name, status: 'running', startedAt: new Date().toISOString() } });
  try {
    const result = await work();
    sendEvent({ type: 'operation', operation: { name, status: 'complete', completedAt: new Date().toISOString() } });
    return result;
  } catch (error) {
    const message = error?.message || String(error);
    record('error', `${name}: ${message}`);
    sendEvent({ type: 'operation', operation: { name, status: 'failed', message, completedAt: new Date().toISOString() } });
    throw error;
  } finally {
    refreshTray();
  }
}

async function snapshot() {
  const { store, auth, integration, paths, usage, catalog, jev } = await core();
  const registry = store.loadRegistry();

  const accounts = await Promise.all(registry.accounts.map(async account => {
    let identity = null;
    let usageSnapshot = null;
    let usageError = null;
    try { identity = auth.inspectAuth(account.codexHome); } catch {}
    if (identity?.accessToken) {
      try {
        usageSnapshot = await usage.getAccountUsage(account);
      } catch (error) {
        usageError = error?.message || String(error);
      }
    }
    return {
      id: account.id,
      label: account.label,
      email: identity?.email ?? account.email ?? null,
      plan: identity?.plan ?? account.plan ?? null,
      connected: Boolean(identity?.accessToken),
      expiresAt: identity?.expiresAt ?? null,
      isDefault: registry.defaultAccountId === account.id,
      isActive: registry.defaultAccountId === account.id,
      enabled: account.enabled !== false,
      preferredModel: account.preferredModel ?? null,
      preferredEffort: account.preferredEffort ?? null,
      availableModels: account.availableModels?.length
        ? account.availableModels
        : (catalog.summarizeNativeModels(auth.readCachedNativeCatalog(account.codexHome) ?? [])
          .concat(account.preferredModel ? [{ slug: account.preferredModel, name: account.preferredModel }] : [])
          .filter((item, index, list) => list.findIndex(candidate => candidate.slug === item.slug) === index)),
      modelCount: account.nativeModelCount ?? 0,
      usage: usageSnapshot,
      usageError,
      createdAt: account.createdAt,
    };
  }));

  const installed = integration.integrationStatus();
  const codexProbe = await auth.probeCodexCli();
  return {
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    update: updateInfo ? {
      version: updateInfo.version,
      url: updateInfo.releaseUrl || UPDATE_RELEASE_URL,
      state: updateStatus,
      progress: updateProgress,
    } : null,
    updateCheck: { ...updateCheck, supported: canUseAutoUpdater() },
    accounts,
    catalogRefresh: catalogRefreshState,
    defaultAccountId: registry.defaultAccountId,
    integration: {
      installed: installed.installed,
      port: installed.journal?.port ?? DEFAULT_PORT,
      activeModel: installed.activeModel ?? null,
      gatewayDefault: installed.gatewayDefault === true,
    },
    runtime: { running: Boolean(routerServer?.listening), port: routerPort },
    autostart: getAutostart(app),
    jev: desktopJevSummary(jev),
    codex: {
      available: codexProbe.available,
      version: codexProbe.version,
    },
    gateway: {
      slug: catalog.GATEWAY_SLUG,
      displayName: catalog.GATEWAY_DISPLAY_NAME,
      activeAccountId: registry.defaultAccountId,
    },
    dataPath: paths.homeDir(),
    catalogPath: paths.catalogPath(),
    logPath: LOG_PATH,
    logs: [...logs],
  };
}

async function startRuntime(preferredPort) {
  if (routerServer?.listening) return snapshot();
  const { router, jev, integration } = await core();
  routerPort = Number(preferredPort || DEFAULT_PORT);
  const integrationState = integration.integrationStatus();
  if (integrationState.journal?.installed?.model) {
    const migration = integration.migrateGatewayDefaultModel();
    if (migration.changed) {
      record('info', `Migrated Router from the global Codex default; restored native model ${migration.model || '(Codex default)'}.`);
    }
  }
  const jevConfig = desktopJevConfig(jev);
  const jevAdvisor = jev.createJevAdvisor({ config: jevConfig });
  let server = router.startRouter({
    port: routerPort,
    jevAdvisor,
    onRequest: recordRouterRequest,
    fetchImpl: process.platform === 'win32' ? desktopUpstreamFetch : fetch,
  });
  try {
    await waitForServer(server);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error;
    server.close();
    const stopped = stopCodexRouterPortOwner(routerPort);
    if (!stopped) throw new Error(`Port ${routerPort} is already in use by another process. Stop it manually before starting CodexRouter.`);
    record('warning', `Restarting the previous Router process on port ${routerPort}.`);
    await new Promise(resolve => setTimeout(resolve, 150));
    server = router.startRouter({
      port: routerPort,
      jevAdvisor,
      onRequest: recordRouterRequest,
      fetchImpl: process.platform === 'win32' ? desktopUpstreamFetch : fetch,
    });
    await waitForServer(server);
  }
  routerServer = server;
  server.once('close', () => {
    if (routerServer === server) routerServer = null;
    sendEvent({ type: 'snapshot-invalidated' });
    refreshTray();
  });
  server.on('error', error => record('error', `Router runtime: ${error.message}`));
  record('info', `Router listening on 127.0.0.1:${routerPort}.`);
  sendEvent({ type: 'snapshot-invalidated' });
  return snapshot();
}

function desktopUpstreamFetch(input, init) {
  // An isolated in-memory Chromium session honors the Windows system proxy
  // without sharing browser cookies with authenticated account requests.
  const upstreamSession = session.fromPartition('codexrouter-upstream', { cache: false });
  return upstreamSession.fetch(input, {
    ...init,
    credentials: 'omit',
    bypassCustomProtocolHandlers: true,
  });
}

function waitForServer(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onListening = () => { cleanup(); resolve(); };
    const onError = error => { cleanup(); reject(error); };
    const cleanup = () => { server.off('listening', onListening); server.off('error', onError); };
    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function stopCodexRouterPortOwner(port) {
  const result = spawnSync('/usr/sbin/lsof', ['-tiTCP:' + port, '-sTCP:LISTEN', '-n', '-P'], { encoding: 'utf8' });
  const pids = String(result.stdout || '').split(/\s+/).filter(Boolean).map(value => Number(value)).filter(Number.isInteger);
  let stopped = false;
  for (const pid of pids) {
    if (pid === process.pid) continue;
    const command = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout || '';
    if (!/codexrouter|codex-router|src\/cli\.js start/i.test(command)) continue;
    try { process.kill(pid, 'SIGTERM'); stopped = true; } catch {}
  }
  return stopped;
}

async function stopRuntime({ restoreIntegration = true } = {}) {
  const server = routerServer;
  if (server) {
    routerServer = null;
    // Codex can keep a negotiated WebSocket open indefinitely. Destroy the
    // router-owned connections before waiting for Node's close callback so a
    // settings restart cannot leave the renderer waiting forever.
    server.closeRouterConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    record('info', 'Router stopped.');
  }
  if (restoreIntegration) {
    const { integration } = await core();
    if (integration.integrationStatus().installed) {
      integration.uninstallIntegration();
      record('info', 'Codex integration restored to the official endpoint.');
    }
  }
  sendEvent({ type: 'snapshot-invalidated' });
  return snapshot();
}

function synchronizeCatalog() {
  const pending = catalogSyncQueue.then(async () => {
    const { store, catalog } = await core();
    catalogRefreshState = { ...catalogRefreshState, status: 'refreshing', error: null };
    sendEvent({ type: 'snapshot-invalidated' });
    try {
      const result = await catalog.syncCatalogAsync(store.loadRegistry());
      catalogRefreshState = { status: 'ready', lastSuccessAt: new Date().toISOString(), error: null };
      return result;
    } catch (error) {
      catalogRefreshState = { ...catalogRefreshState, status: 'error', error: error?.message || String(error) };
      throw error;
    } finally {
      sendEvent({ type: 'snapshot-invalidated' });
    }
  });
  catalogSyncQueue = pending.catch(() => {});
  return pending;
}

async function syncCatalogBestEffort() {
  try {
    const { store } = await core();
    if (!store.loadRegistry().accounts.length) return null;
    const result = await synchronizeCatalog();
    record('info', `Gateway catalog synchronized. Active account: ${result.activeAccount.label}; native model: ${result.nativeModel}.`);
    return result;
  } catch (error) {
    record('warning', `Catalog sync deferred: ${error.message}`);
    return null;
  }
}

function refreshCatalogInBackground() {
  if (backgroundCatalogRefresh) return backgroundCatalogRefresh;
  backgroundCatalogRefresh = syncCatalogBestEffort()
    .finally(() => { backgroundCatalogRefresh = null; });
  return backgroundCatalogRefresh;
}

function validateLabel(value) {
  const label = String(value || '').trim();
  if (label.length < 1 || label.length > 80) throw new Error('Account name must be between 1 and 80 characters.');
  return label;
}

function launchCodex(auth) {
  const configuredProject = String(process.env.CODEXROUTER_PROJECT_DIR || '').trim();
  if (process.platform === 'darwin' && !configuredProject) {
    const child = spawn('/usr/bin/open', ['-a', 'Codex'], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  const options = { detached: true, stdio: 'ignore', env: process.env };
  if (configuredProject) options.cwd = configuredProject;
  const child = spawn(auth.codexBinary(), ['app', ...(configuredProject ? [configuredProject] : [])], options);
  child.unref();
}

async function authenticateAccount(account, operationName, { reuseMainSession = false } = {}) {
  const { auth, store, usage } = await core();
  let identity = null;
  if (reuseMainSession) {
    sendEvent({ type: 'login-state', accountId: account.id, state: 'reusing-session' });
    identity = auth.reuseMainCodexSession(account.codexHome);
    if (!identity) throw new Error('No valid local Codex session was found in ~/.codex. Choose browser sign-in or log in to Codex first.');
  }
  if (!identity) {
    sendEvent({ type: 'login-state', accountId: account.id, state: 'starting' });
    identity = await auth.loginInteractive(account.codexHome, {
      onAuthUrl: url => sendEvent({ type: 'login-url', accountId: account.id, url }),
      onState: state => sendEvent({ type: 'login-state', accountId: account.id, state }),
    });
  } else {
    sendEvent({ type: 'login-state', accountId: account.id, state: 'authenticated' });
  }
  store.updateAccount(account.id, { email: identity.email, plan: identity.plan });
  usage.invalidateAccountUsage(account.id);
  record('info', `${operationName} completed for ${account.label}.`);
  await syncCatalogBestEffort();
  sendEvent({ type: 'snapshot-invalidated' });
  return snapshot();
}

function registerIpc() {
  ipcMain.handle('codexrouter:snapshot', () => snapshot());
  ipcMain.handle('codexrouter:update:check', async () => {
    await checkForUpdates({ manual: true });
    return snapshot();
  });
  ipcMain.handle('codexrouter:update:download', async () => {
    if (!canUseAutoUpdater()) throw new Error(updateUnavailableMessage());
    if (!updateInfo) throw new Error('No update is available.');
    await autoUpdater.downloadUpdate();
    return { ok: true };
  });
  ipcMain.handle('codexrouter:update:install', () => {
    if (!canUseAutoUpdater()) throw new Error(updateUnavailableMessage());
    if (!updateInfo || updateStatus !== 'ready') throw new Error('No update is ready.');
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });
  ipcMain.handle('codexrouter:update:apply', () => {
    if (updateApplyPromise) return updateApplyPromise;
    updateApplyPromise = (async () => {
      if (!canUseAutoUpdater()) throw new Error(updateUnavailableMessage());
      if (!updateInfo) throw new Error('No update is available.');
      if (updateStatus !== 'ready') {
        updateStatus = 'downloading';
        updateProgress = 0;
        await autoUpdater.downloadUpdate();
      }
      if (updateStatus !== 'ready') throw new Error('The update download did not complete.');
      updateStatus = 'installing';
      sendEvent({ type: 'update-state', state: 'installing' });
      isQuitting = true;
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    })().catch(error => {
      if (updateInfo) {
        updateStatus = 'error';
        sendEvent({ type: 'update-state', state: 'error', message: error.message });
      }
      throw error;
    }).finally(() => { updateApplyPromise = null; });
    return updateApplyPromise;
  });

  ipcMain.handle('codexrouter:account:add', (_event, rawLabel, rawAuthMode) => withOperation('Add account', async () => {
    const { store } = await core();
    const authMode = rawAuthMode === 'local' || rawAuthMode === 'login' ? rawAuthMode : 'login';
    const account = store.registerAccount(validateLabel(rawLabel));
    record('info', `Created isolated Codex profile for ${account.label}.`);
    return authenticateAccount(account, 'Authentication', { reuseMainSession: authMode === 'local' });
  }));

  ipcMain.handle('codexrouter:account:reauth', (_event, accountId) => withOperation('Re-authenticate account', async () => {
    const { store } = await core();
    const { account } = store.getAccount(String(accountId));
    return authenticateAccount(account, 'Re-authentication');
  }));

  ipcMain.handle('codexrouter:account:remove', (_event, accountId) => withOperation('Remove account', async () => {
    const { store, auth, integration, paths, usage } = await core();
    const { account } = store.getAccount(String(accountId));
    auth.logout(account.codexHome);
    usage.invalidateAccountUsage(account.id);
    store.removeAccount(account.id, { removeProfile: true });
    record('info', `Removed ${account.label} and its isolated local Codex profile.`);
    const registry = store.loadRegistry();
    if (registry.accounts.length) {
      await syncCatalogBestEffort();
    } else {
      fs.rmSync(paths.catalogPath(), { force: true });
      await stopRuntime();
      if (integration.integrationStatus().installed) integration.uninstallIntegration();
    }
    sendEvent({ type: 'snapshot-invalidated' });
    return snapshot();
  }));

  ipcMain.handle('codexrouter:account:default', (_event, accountId) => withOperation('Set active account', async () => {
    const { store } = await core();
    const account = store.setDefaultAccount(String(accountId));
    const result = await syncCatalogBestEffort();
    record('info', `Gateway active account set to ${account.label}${result?.nativeModel ? ` using ${result.nativeModel}` : ''}.`);
    sendEvent({ type: 'snapshot-invalidated' });
    return snapshot();
  }));

  ipcMain.handle('codexrouter:account:enabled', (_event, accountId, enabled) => withOperation(enabled ? 'Enable account' : 'Disable account', async () => {
    const { store } = await core();
    const account = store.setAccountEnabled(String(accountId), Boolean(enabled));
    const result = await syncCatalogBestEffort();
    record('info', `${enabled ? 'Enabled' : 'Disabled'} ${account.label} for gateway routing${result?.nativeModel ? ` using ${result.nativeModel}` : ''}.`);
    sendEvent({ type: 'snapshot-invalidated' });
    return snapshot();
  }));

  ipcMain.handle('codexrouter:account:preferences', (_event, accountId, preferences) => withOperation('Save model preferences', async () => {
    const { store, auth, catalog } = await core();
    const { account } = store.getAccount(String(accountId));
    const model = preferences?.preferredModel == null ? account.preferredModel : String(preferences.preferredModel);
    const effort = preferences?.preferredEffort == null ? null : String(preferences.preferredEffort);
    if (effort && !VALID_EFFORTS.has(effort)) throw new Error(`Unsupported reasoning effort: ${effort}`);
    const cachedModels = catalog.summarizeNativeModels(auth.readCachedNativeCatalog(account.codexHome) ?? []);
    const availableModels = account.availableModels?.length ? account.availableModels : cachedModels;
    if (model && availableModels.length && !availableModels.some(item => item.slug === model)) {
      throw new Error(`Model “${model}” is not available for ${account.label}. Refresh the gateway catalog first.`);
    }
    store.updateAccount(account.id, { preferredModel: model || null, preferredEffort: effort || null, modelSelectionSource: 'user' });
    await syncCatalogBestEffort();
    sendEvent({ type: 'snapshot-invalidated' });
    return snapshot();
  }));

  ipcMain.handle('codexrouter:catalog:sync', () => withOperation('Sync gateway catalog', async () => {
    const result = await synchronizeCatalog();
    record('info', `Gateway catalog synchronized. Active account: ${result.activeAccount.label}; native model: ${result.nativeModel}.`);
    sendEvent({ type: 'snapshot-invalidated' });
    return snapshot();
  }));

  ipcMain.handle('codexrouter:integration:install', () => withOperation('Install Codex integration', async () => {
    const { integration } = await core();
    await synchronizeCatalog();
    const journal = integration.installIntegration({ port: DEFAULT_PORT });
    record('info', 'Codex integration installed. Restart Codex to refresh the single gateway model.');
    await startRuntime(journal.port);
    return snapshot();
  }));

  ipcMain.handle('codexrouter:integration:uninstall', () => withOperation('Uninstall Codex integration', async () => {
    const { integration } = await core();
    await stopRuntime({ restoreIntegration: false });
    if (integration.integrationStatus().installed) integration.uninstallIntegration();
    record('info', 'Codex integration removed and previous config restored.');
    return snapshot();
  }));

  ipcMain.handle('codexrouter:runtime:start', () => withOperation('Start router', async () => {
    const { integration } = await core();
    const status = integration.integrationStatus();
    const port = status.journal?.port ?? DEFAULT_PORT;
    if (!status.installed) {
      integration.installIntegration({ port });
      record('info', 'Codex integration installed for the Router.');
    }
    return startRuntime(port);
  }));

  ipcMain.handle('codexrouter:runtime:stop', () => withOperation('Stop router', stopRuntime));

  ipcMain.handle('codexrouter:open-codex', async () => {
    const { auth } = await core();
    launchCodex(auth);
    record('info', 'Requested Codex Desktop launch.');
    return { ok: true };
  });

  ipcMain.handle('codexrouter:jev:settings', (_event, settings) => withOperation('Save Jev settings', () => applyJevSettings(settings)));

  ipcMain.handle('codexrouter:autostart:set', (_event, enabled) => {
    const result = setAutostart(app, Boolean(enabled));
    record('info', `Launch at login ${result.enabled ? 'enabled' : 'disabled'}.`);
    refreshTray();
    sendEvent({ type: 'snapshot-invalidated' });
    return result;
  });

  ipcMain.handle('codexrouter:open-external', (_event, rawUrl) => {
    const url = new URL(String(rawUrl));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only HTTP(S) links are allowed.');
    return shell.openExternal(url.href);
  });

  ipcMain.handle('codexrouter:reveal-data', async () => {
    const { paths } = await core();
    fs.mkdirSync(paths.homeDir(), { recursive: true });
    shell.showItemInFolder(paths.homeDir());
    return { ok: true };
  });
}

function createWindow({ hidden = false } = {}) {
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 820,
    minHeight: 580,
    show: false,
    backgroundColor: '#181818',
    title: 'CodexRouter',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL();
    if (url !== current) event.preventDefault();
  });
  window.on('close', event => {
    if (!isQuitting && tray) {
      event.preventDefault();
      window.hide();
    }
  });

  const devUrl = process.env.CODEXROUTER_RENDERER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  window.once('ready-to-show', () => {
    if (!hidden) window.show();
  });
  mainWindow = window;
  return window;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function trayImage() {
  const brandedIcon = path.join(__dirname, '..', '..', 'assets', 'codexrouter-icon.png');
  const image = fs.existsSync(brandedIcon)
    ? nativeImage.createFromPath(brandedIcon)
    : nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON}`);
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image.resize({ width: 16, height: 16 });
}

function refreshTray() {
  if (!tray) return;
  const autostart = getAutostart(app);
  const running = Boolean(routerServer?.listening);
  tray.setToolTip(`CodexRouter · ${running ? 'Running' : 'Stopped'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open CodexRouter', click: showWindow },
    { label: 'Open Codex', click: () => void ipcMain.emit('codexrouter:tray-open-codex') },
    { type: 'separator' },
    { label: running ? `Router running · :${routerPort}` : 'Router stopped', enabled: false },
    {
      label: running ? 'Stop Router' : 'Start Router',
      click: () => void withOperation(running ? 'Stop router' : 'Start router', async () => {
        if (running) return stopRuntime();
        const { integration } = await core();
        const status = integration.integrationStatus();
        const port = status.journal?.port ?? DEFAULT_PORT;
        if (!status.installed) {
          integration.installIntegration({ port });
          record('info', 'Codex integration installed for the Router.');
        }
        return startRuntime(port);
      }),
    },
    {
      label: 'Add Account…',
      click: () => {
        showWindow();
        sendEvent({ type: 'open-add-account' });
      },
    },
    { type: 'separator' },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: autostart.enabled,
      enabled: autostart.supported,
      click: item => {
        try { setAutostart(app, item.checked); } catch (error) { record('error', error.message); }
        refreshTray();
        sendEvent({ type: 'snapshot-invalidated' });
      },
    },
    { type: 'separator' },
    { label: 'Quit CodexRouter', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(trayImage());
  tray.on('click', showWindow);
  refreshTray();
}

async function restoreRuntimeIfInstalled() {
  const { integration } = await core();
  const status = integration.integrationStatus();
  if (!status.installed) return;
  try { await startRuntime(status.journal?.port ?? DEFAULT_PORT); }
  catch (error) { record('error', `Could not restore router runtime: ${error.message}`); }
}

function wireInternalEvents() {
  ipcMain.on('codexrouter:tray-open-codex', async () => {
    try {
      const { auth } = await core();
      launchCodex(auth);
    } catch (error) {
      record('error', `Open Codex: ${error.message}`);
    }
  });
}

function wireAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => sendEvent({ type: 'update-state', state: 'checking' }));
  autoUpdater.on('update-available', info => {
    updateInfo = info;
    updateStatus = 'available';
    updateProgress = 0;
    sendEvent({ type: 'update-available', version: info.version, url: info.releaseUrl || UPDATE_RELEASE_URL });
    record('info', `Update ${info.version} available for ${process.platform}.`);
  });
  autoUpdater.on('update-not-available', () => {
    updateInfo = null;
    updateStatus = null;
    updateProgress = 0;
    sendEvent({ type: 'update-state', state: 'up-to-date' });
  });
  autoUpdater.on('download-progress', progress => {
    updateStatus = 'downloading';
    updateProgress = progress.percent;
    sendEvent({ type: 'update-progress', percent: progress.percent, transferred: progress.transferred, total: progress.total });
  });
  autoUpdater.on('update-downloaded', info => {
    updateInfo = info;
    updateStatus = 'ready';
    updateProgress = 100;
    sendEvent({ type: 'update-downloaded', version: info.version });
    record('info', `Update ${info.version} downloaded and ready to install.`);
  });
  autoUpdater.on('error', error => {
    if (updateInfo) updateStatus = 'error';
    record('error', `Updater: ${error.message}`);
    sendEvent({ type: 'update-state', state: 'error', message: error.message });
  });
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { isQuitting = true; if (updateTimer) clearInterval(updateTimer); if (catalogRefreshTimer) clearInterval(catalogRefreshTimer); });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !tray) app.quit();
  });
  app.on('activate', showWindow);

  app.whenReady().then(async () => {
    registerIpc();
    wireInternalEvents();
    wireAutoUpdater();
    createTray();
    const hidden = process.argv.includes('--hidden');
    createWindow({ hidden });
    void checkForUpdates();
    updateTimer = setInterval(() => void checkForUpdates(), 30 * 60 * 1000);
    await restoreRuntimeIfInstalled();
    void refreshCatalogInBackground();
    catalogRefreshTimer = setInterval(() => void refreshCatalogInBackground(), 60 * 60 * 1000);
  }).catch(error => {
    console.error(error);
    app.quit();
  });
}
