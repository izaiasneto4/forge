import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXECUTABLE_NAME, PRODUCT_NAME, type BuildArch } from '../electron-builder.config'

// Where electron-builder leaves the unpacked app for each platform and arch.
export const RELEASE_DIR = fileURLToPath(new URL('../release', import.meta.url))

export function unpackedApp(platform: NodeJS.Platform, arch: BuildArch, releaseDir = RELEASE_DIR) {
  if (platform === 'darwin') {
    const bundle = join(releaseDir, arch === 'arm64' ? 'mac-arm64' : 'mac', `${PRODUCT_NAME}.app`)
    return { bundle, executable: join(bundle, 'Contents', 'MacOS', PRODUCT_NAME), resources: join(bundle, 'Contents', 'Resources') }
  }
  const folder = join(releaseDir, `${platform === 'win32' ? 'win' : 'linux'}${arch === 'arm64' ? '-arm64' : ''}-unpacked`)
  const executable = join(folder, platform === 'win32' ? `${PRODUCT_NAME}.exe` : EXECUTABLE_NAME)
  return { bundle: folder, executable, resources: join(folder, 'resources') }
}
