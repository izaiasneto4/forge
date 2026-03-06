import { describe, it, expect, vi } from 'vitest'

vi.mock('controllers', () => ({}))

describe('application bootstrap', () => {
  it('loads turbo rails and controllers entrypoint', async () => {
    await expect(import('../../app/javascript/application.js')).resolves.toBeDefined()
  })
})
