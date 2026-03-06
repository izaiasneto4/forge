import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import { createConsumer } from '@rails/actioncable'
import AgentLogsController from '../../../app/javascript/controllers/agent_logs_controller.js'

describe('AgentLogsController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('agent-logs', AgentLogsController)
    document.body.innerHTML = `
      <div data-controller="agent-logs" data-agent-logs-review-task-id-value="1">
        <div data-agent-logs-target="container" style="height: 200px; overflow-y: auto;">
          <div data-agent-logs-target="log">Initial log</div>
        </div>
        <div data-agent-logs-target="status">Status</div>
      </div>
    `
    const element = document.querySelector('[data-controller="agent-logs"]')
    controller = application.getControllerForElementAndIdentifier(element, 'agent-logs')
  })

  it('connects and creates ActionCable subscription', () => {
    expect(controller).toBeDefined()
    expect(createConsumer).toHaveBeenCalled()
    expect(controller.reviewTaskIdValue).toBe(1)
  })

  it('handles message and appends log', () => {
    const initialCount = controller.containerTarget.children.length

    controller.handleMessage({
      type: 'info',
      message: 'Test message',
      log_type: 'info'
    })

    expect(controller.containerTarget.children.length).toBe(initialCount + 1)
  })

  it('reloads on completion message', () => {
    const reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => {})

    controller.handleMessage({
      type: 'completed'
    })

    expect(reloadSpy).toHaveBeenCalled()
    reloadSpy.mockRestore()
  })

  it('scrolls to bottom after message', () => {
    const scrollTopSpy = vi.spyOn(controller.containerTarget, 'scrollTop', 'set')

    controller.handleMessage({
      type: 'info',
      message: 'Test message',
      log_type: 'info'
    })

    expect(scrollTopSpy).toHaveBeenCalled()
  })

  it('returns correct log class for error', () => {
    const logClass = controller.getLogClass('error')
    expect(logClass).toContain('text-red-400')
  })

  it('returns correct log class for status', () => {
    const logClass = controller.getLogClass('status')
    expect(logClass).toContain('text-[color:var(--color-accent)]')
  })

  it('returns default log class for other types', () => {
    const logClass = controller.getLogClass('info')
    expect(logClass).toContain('text-[color:var(--color-text-secondary)]')
  })

  it('disconnects and cleans up subscription', () => {
    const unsubscribeSpy = vi.fn()
    controller.subscription = { unsubscribe: unsubscribeSpy }

    controller.disconnect()

    expect(unsubscribeSpy).toHaveBeenCalled()
  })
})
