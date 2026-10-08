import { app, Menu, type MenuItemConstructorOptions } from 'electron'

// macOS needs an app menu for Quit, copy and paste to work at all. Elsewhere
// the same menu hides behind Alt.
export interface MenuOptions {
  development: boolean
  // Absent on Windows, where the shim (a shell script) does not apply.
  installCommandLineTool?: () => void
}

export function installMenu(options: MenuOptions) {
  const isMac = process.platform === 'darwin'
  const cliItems: MenuItemConstructorOptions[] = options.installCommandLineTool
    ? [{ label: 'Install Command Line Tool…', click: options.installCommandLineTool }, { type: 'separator' }]
    : []
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
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, ...cliItems, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } satisfies MenuItemConstructorOptions] : []),
    isMac ? { role: 'fileMenu' } : { label: 'File', submenu: [...cliItems, { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: view },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
