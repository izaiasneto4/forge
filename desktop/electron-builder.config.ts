// electron-builder configuration as code: one object per (platform, arch),
// because what goes in depends on the target and on which signing secrets exist.
// desktop/scripts/dist.ts writes it to JSON and hands it to the electron-builder CLI.

export const APP_ID = 'dev.ordem.app'
export const PRODUCT_NAME = 'Ordem'
export const EXECUTABLE_NAME = 'ordem'
export const GITHUB_OWNER = 'izaiasneto4'
export const GITHUB_REPO = 'ordem'

export type BuildPlatform = 'mac' | 'linux' | 'win'
export type BuildArch = 'arm64' | 'x64'

// electron-builder's ${platform} names, which scripts/build-server.ts uses for folders.
export const ELECTRON_PLATFORM: Readonly<Record<BuildPlatform, string>> = Object.freeze({ mac: 'darwin', linux: 'linux', win: 'win32' })

// Runtime libraries Electron needs on Debian and Ubuntu (electron-builder's
// defaults plus libgbm for GPU buffers).
export const DEB_DEPENDS: readonly string[] = Object.freeze(['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'libgbm1'])

export interface BuildOptions {
  platform: BuildPlatform
  arch: BuildArch
  // Apple Developer ID and notarization secrets are present (CSC_LINK, APPLE_API_KEY...).
  macSigning: boolean
}

export function serverResourceFolder(platform: BuildPlatform, arch: BuildArch) {
  return `prod-resources/server/${ELECTRON_PLATFORM[platform]}-${arch}`
}

export function updatesSupported(options: BuildOptions) {
  return options.platform !== 'mac' || options.macSigning
}

function macConfig(options: BuildOptions) {
  return {
    target: [
      { target: 'dmg', arch: [options.arch] },
      // electron-updater installs from the zip.
      { target: 'zip', arch: [options.arch] },
    ],
    category: 'public.app-category.developer-tools',
    icon: 'resources/icon.png',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
    // Without a Developer ID the app is ad hoc signed: it runs (arm64 requires a
    // signature) but Gatekeeper warns and Squirrel.Mac refuses updates.
    identity: options.macSigning ? undefined : '-',
    notarize: options.macSigning,
  }
}

export function resolveBuildConfig(options: BuildOptions) {
  return {
    appId: APP_ID,
    productName: PRODUCT_NAME,
    artifactName: `${PRODUCT_NAME}-\${version}-\${arch}.\${ext}`,
    copyright: 'Copyright © Izaias Oliveira',
    directories: { output: 'release', buildResources: 'resources' },
    // app.asar holds only Electron main and the preload; both are self-contained bundles.
    files: ['dist-electron/**', 'package.json', '!**/*.map'],
    // Real files under Resources/: the Bun server cannot read inside app.asar.
    extraResources: [
      { from: serverResourceFolder(options.platform, options.arch), to: 'server' },
      { from: '../backend/drizzle', to: 'drizzle' },
      { from: '../public', to: 'public', filter: ['**/*', '!**/*.map'] },
    ],
    asar: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    // The publish target makes electron-builder write the update feed (latest*.yml,
    // app-update.yml). Unsigned macOS builds get none: Squirrel.Mac refuses them.
    publish: updatesSupported(options) ? [{ provider: 'github', owner: GITHUB_OWNER, repo: GITHUB_REPO }] : null,
    mac: macConfig(options),
    dmg: {
      contents: [
        { x: 130, y: 220 },
        { x: 410, y: 220, type: 'link', path: '/Applications' },
      ],
    },
    linux: {
      target: [
        { target: 'AppImage', arch: [options.arch] },
        { target: 'deb', arch: [options.arch] },
      ],
      executableName: EXECUTABLE_NAME,
      category: 'Development',
      icon: 'resources/icon.png',
      synopsis: 'Automated GitHub pull request reviews',
      maintainer: 'Izaias Oliveira <izaiasneto.dev@gmail.com>',
      desktop: { entry: { StartupWMClass: PRODUCT_NAME } },
      // desktopName in package.json (ordem.desktop) becomes the Wayland app id.
      syncDesktopName: true,
    },
    // Static runtime: the AppImage runs on distributions with only FUSE 3.
    toolsets: { appimage: '1.0.3' },
    deb: {
      packageName: EXECUTABLE_NAME,
      depends: [...DEB_DEPENDS],
      fpm: [`resources/linux/${APP_ID}.metainfo.xml=/usr/share/metainfo/${APP_ID}.metainfo.xml`],
    },
    win: {
      target: [{ target: 'nsis', arch: [options.arch] }],
      icon: 'resources/icon.png',
      // Applies the icon and version info even when the build is unsigned.
      signAndEditExecutable: true,
    },
    nsis: {
      // No spaces: GitHub renames them in release assets and the update feed would 404.
      artifactName: `${PRODUCT_NAME}-Setup-\${version}-\${arch}.\${ext}`,
      differentialPackage: true,
      oneClick: true,
      perMachine: false,
      deleteAppDataOnUninstall: false,
    },
  }
}

export type BuildConfig = ReturnType<typeof resolveBuildConfig>
