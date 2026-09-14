const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

function onEvent(callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on('codexrouter:event', listener);
  return () => ipcRenderer.removeListener('codexrouter:event', listener);
}

contextBridge.exposeInMainWorld('codexRouter', {
  snapshot: () => invoke('codexrouter:snapshot'),
  addAccount: (label, authMode) => invoke('codexrouter:account:add', label, authMode),
  reauthenticateAccount: accountId => invoke('codexrouter:account:reauth', accountId),
  removeAccount: accountId => invoke('codexrouter:account:remove', accountId),
  setDefaultAccount: accountId => invoke('codexrouter:account:default', accountId),
  setAccountPreferences: (accountId, preferences) => invoke('codexrouter:account:preferences', accountId, preferences),
  syncCatalog: () => invoke('codexrouter:catalog:sync'),
  install: () => invoke('codexrouter:integration:install'),
  uninstall: () => invoke('codexrouter:integration:uninstall'),
  startRouter: () => invoke('codexrouter:runtime:start'),
  stopRouter: () => invoke('codexrouter:runtime:stop'),
  openCodex: () => invoke('codexrouter:open-codex'),
  setAutostart: enabled => invoke('codexrouter:autostart:set', enabled),
  openExternal: url => invoke('codexrouter:open-external', url),
  revealData: () => invoke('codexrouter:reveal-data'),
  onEvent,
});
