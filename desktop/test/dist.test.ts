import { describe, expect, test } from 'bun:test'
import { parseDistArgs, withoutEmptySigningVariables } from '../scripts/dist'

describe('dist', () => {
  test('treats empty signing secrets as unset and keeps real ones', () => {
    const certificate = 'base64-p12'

    const env = withoutEmptySigningVariables({ CSC_LINK: '', CSC_KEY_PASSWORD: '  ', APPLE_API_KEY: certificate, PATH: '/usr/bin' })

    expect(env).toEqual({ APPLE_API_KEY: certificate, PATH: '/usr/bin' })
  })

  test('reads the platform, arch and skip flags', () => {
    const options = parseDistArgs(['--linux', '--arch', 'arm64', '--skip-frontend'])

    expect(options).toMatchObject({ platform: 'linux', arch: 'arm64', bunTarget: 'bun-linux-arm64', skipFrontend: true, skipShell: false })
    expect(() => parseDistArgs(['--mac', '--win'])).toThrow()
  })
})
