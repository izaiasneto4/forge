import { app, Menu, type MenuItemConstructorOptions } from 'electron'

// macOS needs an app menu for Quit, copy and paste to work at all. Elsewhere
// the same menu hides behind Alt.
export function installMenu(options: { development: boolean }) {
  const isMac = process.platform === 'darwin'
  const view: MenuItemConstructorOptions[] = [
    { role: 'reload' },
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ]
  if (options.development) view.push({ type: 'separator' }, { role: 'forceReload' }, { role: 'toggleDevTools' })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } satisfies MenuItemConstructorOptions] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: view },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
