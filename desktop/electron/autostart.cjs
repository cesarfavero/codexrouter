const HIDDEN_ARG = '--hidden';

function supportedOnThisHost(app) {
  return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
}

function getAutostart(app) {
  if (!app.isPackaged) return { supported: false, enabled: false, development: true };
  if (!supportedOnThisHost(app)) return { supported: false, enabled: false };
  const settings = app.getLoginItemSettings({ args: [HIDDEN_ARG] });
  return { supported: true, enabled: settings.openAtLogin === true };
}

function setAutostart(app, enabled) {
  if (!app.isPackaged) return { supported: false, enabled: Boolean(enabled), development: true };
  if (!supportedOnThisHost(app)) return { supported: false, enabled: false };

  const desired = Boolean(enabled);
  app.setLoginItemSettings({
    openAtLogin: desired,
    openAsHidden: desired,
    args: [HIDDEN_ARG],
  });
  const current = getAutostart(app);
  if (current.enabled !== desired) {
    throw new Error(`CodexRouter autostart could not be ${desired ? 'enabled' : 'disabled'} by the operating system.`);
  }
  return current;
}

module.exports = { getAutostart, setAutostart };
