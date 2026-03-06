import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

describe('service worker template', () => {
  it('documents push notification handlers', () => {
    const source = readFileSync('app/views/pwa/service-worker.js', 'utf8')

    expect(source).toContain('self.addEventListener("push"')
    expect(source).toContain('self.addEventListener("notificationclick"')
  })
})
