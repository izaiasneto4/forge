import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { channelForVersion, DEB_DEPENDS, resolveBuildConfig, serverResourceFolder } from '../electron-builder.config'
import { SERVER_TARGETS } from '../../scripts/build-server'

const desktopRoot = join(import.meta.dir, '..')

describe('resolveBuildConfig', () => {
  test('ships the server, migrations and web build as real files next to a JS-only asar', () => {
    const config = resolveBuildConfig({ platform: 'linux', arch: 'x64', macSigning: false })

    expect(config.files).toEqual(['dist-electron/**', 'package.json', '!**/*.map'])
    expect(config.extraResources.map((resource) => resource.to)).toEqual(['server', 'drizzle', 'public'])
    expect(config.extraResources[0]?.from).toBe(serverResourceFolder('linux', 'x64'))
  })

  test('uses the server folders scripts/build-server.ts produces', () => {
    const builtFolders = SERVER_TARGETS.map((target) => `prod-resources/server/${target.folder}`)

    expect(builtFolders).toContain(serverResourceFolder('mac', 'arm64'))
    expect(builtFolders).toContain(serverResourceFolder('mac', 'x64'))
    expect(builtFolders).toContain(serverResourceFolder('linux', 'arm64'))
    expect(builtFolders).toContain(serverResourceFolder('win', 'x64'))
  })

  test('publishes an update feed except for unsigned macOS builds', () => {
    expect(resolveBuildConfig({ platform: 'mac', arch: 'arm64', macSigning: false }).publish).toBeNull()
    expect(resolveBuildConfig({ platform: 'mac', arch: 'arm64', macSigning: true }).publish).not.toBeNull()
    expect(resolveBuildConfig({ platform: 'win', arch: 'x64', macSigning: false }).publish).not.toBeNull()
  })

  test('signs macOS ad hoc without a Developer ID and notarizes with one', () => {
    const unsigned = resolveBuildConfig({ platform: 'mac', arch: 'arm64', macSigning: false }).mac
    const signed = resolveBuildConfig({ platform: 'mac', arch: 'arm64', macSigning: true }).mac

    expect(unsigned).toMatchObject({ identity: '-', notarize: false, hardenedRuntime: true })
    expect(signed).toMatchObject({ identity: undefined, notarize: true, hardenedRuntime: true })
  })

  test('targets AppImage and deb on Linux with Electron runtime libraries', () => {
    const config = resolveBuildConfig({ platform: 'linux', arch: 'arm64', macSigning: false })

    expect(config.linux.target.map((target) => target.target)).toEqual(['AppImage', 'deb'])
    expect(config.deb.depends).toEqual([...DEB_DEPENDS])
  })

  test('points at resources that exist', () => {
    const config = resolveBuildConfig({ platform: 'mac', arch: 'arm64', macSigning: false })

    expect(existsSync(join(desktopRoot, config.mac.entitlements))).toBe(true)
    expect(existsSync(join(desktopRoot, config.mac.icon))).toBe(true)
    expect(existsSync(join(desktopRoot, 'resources', 'linux', 'dev.ordem.app.metainfo.xml'))).toBe(true)
  })

  test('puts nightly versions on their own update channel', () => {
    const nightly = '1.2.0-nightly.20261008.42'
    const stable = '1.2.0'

    expect(channelForVersion(nightly)).toBe('nightly')
    expect(channelForVersion(stable)).toBe('latest')
    expect(resolveBuildConfig({ platform: 'linux', arch: 'x64', macSigning: false, channel: 'nightly' }).publish?.[0]?.channel).toBe('nightly')
  })
})
