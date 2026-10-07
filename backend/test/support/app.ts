import { createApp } from '../../src/app'
import { CableServer } from '../../src/realtime/cable-server'
import type { ApiServices } from '../../src/routes/shared'
import type { TestContext } from './context'

export const testPublicDir = new URL('../../../public', import.meta.url).pathname

export function unusedService(name: string): never {
  throw new Error(`Test called ${name} without stubbing it`)
}

// The full app wired to a test context; external services fail unless stubbed.
// Hosts are unrestricted unless a test asks for the real defaults (Eden Treaty
// requests use a placeholder host).
export function createTestApp(ctx: TestContext, services: Partial<ApiServices> = {}, options: { allowedHosts?: string[] } = {}) {
  const cable = new CableServer(ctx.db)
  return createApp({
    ctx,
    cable,
    publicDir: testPublicDir,
    allowedHosts: options.allowedHosts ?? ['*'],
    services: {
      runSync: async () => unusedService('runSync'),
      submitReview: async () => unusedService('submitReview'),
      pickFolder: async () => unusedService('pickFolder'),
      ...services,
    },
  })
}
