import { describe, it, expect, beforeEach } from 'vitest'
import { Application } from '@hotwired/stimulus'
import CliClientIconController from '../../../app/javascript/controllers/cli_client_icon_controller.js'

describe('CliClientIconController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('cli-client-icon', CliClientIconController)
    document.body.innerHTML = `
      <div data-controller="cli-client-icon">
        <select data-action="change->cli-client-icon#update">
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="opencode">OpenCode</option>
        </select>
        <div class="cli-client-icon">
          <svg class="w-3.5 h-3.5" viewBox="0 0 100 100" fill="#D97757"><path d="M50 8 L53 42 L50 50 L47 42 Z"/></svg>
        </div>
      </div>
    `
    const element = document.querySelector('[data-controller="cli-client-icon"]')
    controller = application.getControllerForElementAndIdentifier(element, 'cli-client-icon')
  })

  it('connects', () => {
    expect(controller).toBeDefined()
  })

  it('updates icon on client change', () => {
    const select = document.querySelector('select')
    select.value = 'codex'

    controller.update({ target: select })

    const iconContainer = document.querySelector('.cli-client-icon')
    expect(iconContainer.innerHTML).toContain('<svg')
  })

  it('preserves existing size classes', () => {
    const select = document.querySelector('select')
    select.value = 'claude'

    controller.update({ target: select })

    const iconContainer = document.querySelector('.cli-client-icon')
    const svg = iconContainer.querySelector('svg')
    expect(svg.getAttribute('class')).toContain('w-3.5')
    expect(svg.getAttribute('class')).toContain('h-3.5')
  })

  it('handles unknown client', () => {
    const select = document.querySelector('select')
    select.value = 'unknown'

    const initialHTML = document.querySelector('.cli-client-icon').innerHTML

    controller.update({ target: select })

    const iconContainer = document.querySelector('.cli-client-icon')
    expect(iconContainer.innerHTML).toBe(initialHTML)
  })
})
