import { describe, expect, test } from 'bun:test'
import { compileArgs, hostTarget, SERVER_TARGETS, targetsFromArgs } from './build-server'

describe('build-server', () => {
  test('names folders the way electron-builder names platform and arch', () => {
    const linuxArm = SERVER_TARGETS.find((target) => target.bunTarget === 'bun-linux-arm64')

    expect(hostTarget('linux', 'arm64')).toEqual(linuxArm)
    expect(hostTarget('win32', 'x64')?.binary).toBe('ordem-server.exe')
    expect(hostTarget('win32', 'arm64')).toBeUndefined()
  })

  test('builds every target with --all and one with --target', () => {
    const requested = 'bun-darwin-x64'

    expect(targetsFromArgs(['--all'])).toEqual([...SERVER_TARGETS])
    expect(targetsFromArgs(['--target', requested]).map((target) => target.bunTarget)).toEqual([requested])
    expect(() => targetsFromArgs(['--target', 'bun-plan9-x64'])).toThrow('Unknown target')
  })

  test('hides the Windows console only when compiling on Windows', () => {
    const windows = SERVER_TARGETS.find((target) => target.folder === 'win32-x64')
    const outfile = 'out/ordem-server.exe'
    if (!windows) throw new Error('missing windows target')

    expect(compileArgs(windows, outfile, 'win32')).toContain('--windows-hide-console')
    expect(compileArgs(windows, outfile, 'darwin')).not.toContain('--windows-hide-console')
    expect(compileArgs(windows, outfile, 'darwin')).toContain(`--target=${windows.bunTarget}`)
  })
})
