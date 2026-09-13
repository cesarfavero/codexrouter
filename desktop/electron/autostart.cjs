// Adapted from miuuyy/codex-chatgpt-web launcher/electron/autostart.cjs (MIT).
// See THIRD_PARTY_NOTICES.md and LICENSES/codex-chatgpt-web-MIT.txt.

function requireAutostartState(result, desired) {
  if (result.supported && result.enabled !== Boolean(desired)) {
    throw new Error(`The operating system did not ${desired ? 'enable' : 'disable'} CodexRouter autostart.`);
  }
  return result;
}

function setAutostart(app, enabled) {
  if (!app.isPackaged) return { supported: false, enabled: Boolean(enabled), development: true };
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: Boolean(enabled),
      args: ['--hidden'],
    });
    return requireAutostartState({
      supported: true,
      enabled: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin === true,
    }, enabled);
  }
  return { supported: false, enabled: false };
}

function getAutostart(app) {
  if (!app.isPackaged) return { supported: false, enabled: false, development: true };
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return {
      supported: true,
      enabled: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin === true,
    };
  }
  return { supported: false, enabled: false };
}

module.exports = { getAutostart, requireAutostartState, setAutostart };
