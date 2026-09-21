const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, safeStorage } = require('electron');
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
const UPDATE_CHECK_URL = 'https://api.github.com/repos/cesarfavero/codexrouter/releases/latest';
const LOG_PATH = path.join(os.homedir(), '.codexrouter', 'logs', 'router.jsonl');
const JEV_SETTINGS_PATH = path.join(os.homedir(), '.codexrouter', 'jev-settings.json');
const JEV_MODES = new Set(['off', 'observe', 'active']);

let mainWindow = null;
let tray = null;
let routerServer = null;
let routerPort = DEFAULT_PORT;
let isQuitting = false;
let corePromise = null;
let updateTimer = null;
let updateInfo = null;
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
  const apiKey = storedKey || base.apiKey;
  return { ...base, mode, model, minConfidence, apiKey, configured: Boolean(apiKey) };
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
    keySource: stored ? 'secure-storage' : config.configured ? 'environment' : 'none',
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
  };
}

function createDesktopJevAdvisor(jev) {
  return jev.createJevAdvisor({ config: desktopJevConfig(jev) });
}

async function applyJevSettings(raw) {
  const { jev } = await core();
  const current = loadJevSettings();
  const mode = String(raw?.mode || 'off').trim().toLowerCase();
  if (!JEV_MODES.has(mode)) throw new Error('Jev mode must be off, observe, or active.');

  const model = String(raw?.model || 'jev-1.13.0').trim();
  if (!model || model.length > 120 || !/^[A-Za-z0-9._/-]+$/.test(model)) throw new Error('Jev model id is invalid.');

  const minConfidence = Number(raw?.minConfidence);
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) throw new Error('Jev minimum confidence must be between 0 and 1.');

  const next = { ...current, mode, model, minConfidence };
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
  record('info', `Jev semantic routing saved: ${summary.mode} · ${summary.configured ? 'configured' : 'no API key'} · ${summary.model}.`);
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

function recordRouterRequest(event) {
  if (event.usageOnly) {
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
    ? ` · Jev ${jev.mode || 'shadow'}:${jev.status}${jev.routeTier ? ` ${jev.routeTier}→${jev.recommendedModel || 'default'}${jev.appliedModel ? ' applied' : ' shadow'}` : ''}${Number.isFinite(jev.latencyMs) ? ` ${jev.latencyMs}ms` : ''}`
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

async function checkForUpdates() {
  if (!canUseAutoUpdater()) return;
  try { await autoUpdater.checkForUpdates(); } catch (error) { record('warning', `Update check failed: ${error.message}`); }
}

function canUseAutoUpdater() {
  if (autoUpdateCapability != null) return autoUpdateCapability;
  if (!app.isPackaged || process.platform !== 'darwin') {
    autoUpdateCapability = Boolean(app.isPackaged);
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
  const codexProbe = spawnSync(auth.codexBinary(), ['--version'], { encoding: 'utf8', timeout: 5000 });
  return {
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    accounts,
    defaultAccountId: registry.defaultAccountId,
    integration: { installed: installed.installed, port: installed.journal?.port ?? DEFAULT_PORT },
    runtime: { running: Boolean(routerServer?.listening), port: routerPort },
    autostart: getAutostart(app),
    jev: desktopJevSummary(jev),
    codex: {
      available: !codexProbe.error && codexProbe.status === 0,
      version: codexProbe.status === 0 ? String(codexProbe.stdout || codexProbe.stderr || '').trim() : null,
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
  const { router, jev } = await core();
  routerPort = Number(preferredPort || DEFAULT_PORT);
  const jevAdvisor = createDesktopJevAdvisor(jev);
  let server = router.startRouter({
    port: routerPort,
    jevAdvisor,
    onRequest: recordRouterRequest,
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

async function syncCatalogBestEffort() {
  const { store, catalog } = await core();
  const registry = store.loadRegistry();
  if (!registry.accounts.length) return null;
  try {
    const result = catalog.syncCatalog(registry);
    record('info', `Gateway catalog synchronized. Active account: ${result.activeAccount.label}; native model: ${result.nativeModel}.`);
    return result;
  } catch (error) {
    record('warning', `Catalog sync deferred: ${error.message}`);
    return null;
  }
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
  ipcMain.handle('codexrouter:update:download', async () => {
    if (!canUseAutoUpdater()) throw new Error('Automatic updates require a signed macOS build.');
    if (!updateInfo) throw new Error('No update is available.');
    await autoUpdater.downloadUpdate();
    return { ok: true };
  });
  ipcMain.handle('codexrouter:update:install', () => {
    if (!canUseAutoUpdater()) throw new Error('Automatic updates require a signed macOS build.');
    if (!updateInfo) throw new Error('No update is ready.');
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
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
    const { store } = await core();
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
    const { store, catalog } = await core();
    const result = catalog.syncCatalog(store.loadRegistry());
    record('info', `Gateway catalog synchronized. Active account: ${result.activeAccount.label}; native model: ${result.nativeModel}.`);
    sendEvent({ type: 'snapshot-invalidated' });
    return snapshot();
  }));

  ipcMain.handle('codexrouter:integration:install', () => withOperation('Install Codex integration', async () => {
    const { store, catalog, integration } = await core();
    catalog.syncCatalog(store.loadRegistry());
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
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendEvent({ type: 'update-state', state: 'checking' }));
  autoUpdater.on('update-available', info => {
    updateInfo = info;
    sendEvent({ type: 'update-available', version: info.version, url: info.releaseUrl || UPDATE_CHECK_URL });
    record('info', `Update ${info.version} available for ${process.platform}.`);
  });
  autoUpdater.on('update-not-available', () => sendEvent({ type: 'update-state', state: 'up-to-date' }));
  autoUpdater.on('download-progress', progress => sendEvent({ type: 'update-progress', percent: progress.percent, transferred: progress.transferred, total: progress.total }));
  autoUpdater.on('update-downloaded', info => { updateInfo = info; sendEvent({ type: 'update-downloaded', version: info.version }); record('info', `Update ${info.version} downloaded and ready to install.`); });
  autoUpdater.on('error', error => { record('error', `Updater: ${error.message}`); sendEvent({ type: 'update-state', state: 'error', message: error.message }); });
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { isQuitting = true; if (updateTimer) clearInterval(updateTimer); });
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
    updateTimer = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
    await restoreRuntimeIfInstalled();
  }).catch(error => {
    console.error(error);
    app.quit();
  });
}
