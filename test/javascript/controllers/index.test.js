import { describe, it, expect, vi } from 'vitest'

const application = { id: 'stimulus-app' }
const eagerLoadControllersFrom = vi.fn()

vi.mock('controllers/application', () => ({ application }))
vi.mock('@hotwired/stimulus-loading', () => ({ eagerLoadControllersFrom }))

describe('controllers/index', () => {
  it('eager loads controllers using the shared stimulus application', async () => {
    await import('../../../app/javascript/controllers/index.js')

    expect(eagerLoadControllersFrom).toHaveBeenCalledWith('controllers', application)
  })
})
