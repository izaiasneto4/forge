import { describe, expect, test } from 'bun:test'
import { mergePathLists, parseEnvOutput, pathKey, recoverShellEnvironment, type Probe } from '../src/shell-env'

describe('parseEnvOutput', () => {
  test('reads only the lines between the markers, skipping session noise', () => {
    const banner = 'Welcome back!\nPATH=/banner/should/not/count'
    const output = `${banner}\n__ORDEM_ENV_START__\nPATH=/opt/homebrew/bin:/usr/bin\nGH_HOST=github.com\nPWD=/tmp\nEQUALS=a=b\nnot a variable\n__ORDEM_ENV_END__\ntrailing=1`

    expect(parseEnvOutput(output)).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin', GH_HOST: 'github.com', EQUALS: 'a=b' })
  })
})

describe('mergePathLists', () => {
  test('keeps the first list order and appends only missing entries', () => {
    const shellPath = '/opt/homebrew/bin:/usr/bin'
    const launchPath = '/usr/bin:/bin'

    expect(mergePathLists([shellPath, undefined, launchPath], ':')).toBe('/opt/homebrew/bin:/usr/bin:/bin')
  })
})

describe('pathKey', () => {
  test('finds the Windows spelling and uses PATH elsewhere', () => {
    expect(pathKey({ Path: 'C:\\Windows' }, 'win32')).toBe('Path')
    expect(pathKey({ Path: 'x' }, 'linux')).toBe('PATH')
  })
})

describe('recoverShellEnvironment', () => {
  test('merges the login shell and launchctl PATH over the launch PATH on macOS', async () => {
    const shell = '/bin/zsh'
    const calls: string[] = []
    const probe: Probe = async (command) => {
      calls.push(command)
      if (command === shell) return { stdout: '__ORDEM_ENV_START__\nPATH=/opt/homebrew/bin:/usr/bin\nANTHROPIC_MODEL=claude\n__ORDEM_ENV_END__\n' }
      return { stdout: '/usr/local/bin:/usr/bin\n' }
    }

    const recovered = await recoverShellEnvironment({ env: { SHELL: shell, PATH: '/usr/bin:/bin' }, platform: 'darwin', probe })

    expect(calls).toEqual([shell, '/bin/launchctl'])
    expect(recovered.PATH).toBe('/opt/homebrew/bin:/usr/bin:/usr/local/bin:/bin')
    expect(recovered.ANTHROPIC_MODEL).toBe('claude')
  })

  test('falls back to the launch PATH and logs when the shell probe fails', async () => {
    const launchPath = '/usr/bin:/bin'
    const messages: string[] = []
    const probe: Probe = async () => {
      throw new Error('timed out')
    }

    const recovered = await recoverShellEnvironment({ env: { SHELL: '/bin/bash', PATH: launchPath }, platform: 'linux', probe, log: (message) => messages.push(message) })

    expect(recovered).toEqual({ PATH: launchPath })
    expect(messages.join('\n')).toContain('timed out')
  })

  test('reads PATH from PowerShell on Windows', async () => {
    const profilePath = 'C:\\Users\\dev\\scoop\\shims;C:\\Windows'
    const probe: Probe = async () => ({ stdout: profilePath })

    const recovered = await recoverShellEnvironment({ env: { Path: 'C:\\Windows' }, platform: 'win32', probe })

    expect(recovered).toEqual({ Path: profilePath })
  })
})
