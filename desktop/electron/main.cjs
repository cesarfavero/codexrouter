const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { getAutostart, setAutostart } = require('./autostart.cjs');

const DEFAULT_PORT = Number(process.env.CODEXROUTER_PORT || 17842);
const VALID_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
const TRAY_ICON = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAkElEQVR4nO2XSw6AMAhEwXj/K+PKpLF8ay1pZLbWmQcYUYDS34WeQ0REwwGIaoZ68U2wF+RYEa75sQCzwzVfsQOr1M3Fqt56qKIep2UWCX6e9YwyfQQugEj10fv26EABFEABpAOMbsctXsXuZXRXM2MbtmLNvvogAegLSB8BCzC6/SxxvmIHZkNIfun/BaV0XTuOPDLd7faPAAAAAElFTkSuQmCC';
const UPDATE_CHECK_URL = 'https://api.github.com/repos/cesarfavero/codexrouter/releases/latest';

let mainWindow = null;
let tray = null;
let routerServer = null;
let routerPort = DEFAULT_PORT;
let isQuitting = false;
let corePromise = null;
let updateTimer = null;
const logs = [];

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
    ]).then(([store, auth, catalog, integration, router, paths, usage]) => ({
      store, auth, catalog, integration, router, paths, usage,
    }));
  }
  return corePromise;
}

function record(level, message) {
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, level, message, at: new Date().toISOString() };
  logs.push(item);
  if (logs.length > 250) logs.splice(0, logs.length - 250);
  sendEvent({ type: 'log', record: item });
  return item;
}

function sendEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('codexrouter:event', payload);
  }
}

async function checkForUpdates() {
  try {
    const response = await fetch(UPDATE_CHECK_URL, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'CodexRouter' } });
    if (!response.ok) return;
    const release = await response.json();
    const version = String(release.tag_name || '').replace(/^v/, '');
    if (version && isNewerVersion(version, app.getVersion())) sendEvent({ type: 'update-available', version, url: release.html_url });
  } catch {}
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
  const { store, auth, integration, paths, usage, catalog } = await core();
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
    logs: [...logs],
  };
}

async function startRuntime(preferredPort) {
  if (routerServer?.listening) return snapshot();
  const { router } = await core();
  routerPort = Number(preferredPort || DEFAULT_PORT);
  let server = router.startRouter({
    port: routerPort,
    onRequest: event => record('info', `Request via Router → ${event.account.label} · ${event.model || event.endpoint} · ${event.status} (${event.transport}).`),
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
      onRequest: event => record('info', `Request via Router → ${event.account.label} · ${event.model || event.endpoint} · ${event.status} (${event.transport}).`),
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

async function stopRuntime() {
  const server = routerServer;
  if (!server) return snapshot();
  routerServer = null;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  record('info', 'Router stopped.');
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
    await stopRuntime();
    if (integration.integrationStatus().installed) integration.uninstallIntegration();
    record('info', 'Codex integration removed and previous config restored.');
    return snapshot();
  }));

  ipcMain.handle('codexrouter:runtime:start', () => withOperation('Start router', async () => {
    const { integration } = await core();
    const status = integration.integrationStatus();
    return startRuntime(status.journal?.port ?? DEFAULT_PORT);
  }));

  ipcMain.handle('codexrouter:runtime:stop', () => withOperation('Stop router', stopRuntime));

  ipcMain.handle('codexrouter:open-codex', async () => {
    const { auth } = await core();
    const child = spawn(auth.codexBinary(), ['app'], { detached: true, stdio: 'ignore', cwd: process.env.CODEXROUTER_PROJECT_DIR || app.getPath('home'), env: process.env });
    child.unref();
    record('info', 'Requested Codex Desktop launch.');
    return { ok: true };
  });

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
        return startRuntime(integration.integrationStatus().journal?.port ?? DEFAULT_PORT);
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
      const child = spawn(auth.codexBinary(), ['app'], { detached: true, stdio: 'ignore', cwd: process.env.CODEXROUTER_PROJECT_DIR || app.getPath('home'), env: process.env });
      child.unref();
    } catch (error) {
      record('error', `Open Codex: ${error.message}`);
    }
  });
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
