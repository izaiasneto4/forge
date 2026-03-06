import { describe, it, expect } from 'vitest'

describe('controllers/application', () => {
  it('exports a started stimulus application', async () => {
    const { application } = await import('../../../app/javascript/controllers/application.js')

    expect(application).toBeDefined()
    expect(application.debug).toBe(false)
    expect(window.Stimulus).toBe(application)
  })
})
