// IPC channel names shared by the main process and the preload.
export const CHANNELS = Object.freeze({
  // Synchronous, so the first render already knows where the server is.
  getLocalEnvironment: 'ordem:get-local-environment',
  getPlatform: 'ordem:get-platform',
  // Pushed when the server moved to another port after a restart.
  localEnvironmentChanged: 'ordem:local-environment-changed',
  pickFolder: 'ordem:pick-folder',
  openExternal: 'ordem:open-external',
  getUpdateState: 'ordem:get-update-state',
  updateState: 'ordem:update-state',
  checkForUpdates: 'ordem:check-for-updates',
  installUpdate: 'ordem:install-update',
})
