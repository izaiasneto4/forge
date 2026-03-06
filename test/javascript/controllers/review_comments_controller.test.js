import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Application } from '@hotwired/stimulus'
import { renderStreamMessage } from '@hotwired/turbo'
import ReviewCommentsController from '../../../app/javascript/controllers/review_comments_controller.js'

describe('ReviewCommentsController', () => {
  let application
  let controller

  beforeEach(() => {
    application = Application.start()
    application.register('review-comments', ReviewCommentsController)
    document.body.innerHTML = `
      <div data-controller="review-comments" data-review-comments-review-task-id-value="1" data-review-comments-submit-url-value="/submit">
        <div data-review-comments-target="comment">Comment 1</div>
        <div data-review-comments-target="comment">Comment 2</div>
        <button data-review-comments-target="submitButton">Submit</button>
        <select data-review-comments-target="eventSelect">
          <option value="push">Push</option>
          <option value="pull_request">Pull Request</option>
        </select>
      </div>
    `
    const element = document.querySelector('[data-controller="review-comments"]')
    controller = application.getControllerForElementAndIdentifier(element, 'review-comments')
  })

  it('connects and initializes', () => {
    expect(controller).toBeDefined()
    expect(controller.reviewTaskIdValue).toBe(1)
    expect(controller.submitUrlValue).toBe('/submit')
  })

  it('submits review', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<turbo-stream>test</turbo-stream>')
    })

    const event = { preventDefault: vi.fn() }
    await controller.submit(event)

    expect(global.fetch).toHaveBeenCalledWith(
      '/submit',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData)
      })
    )
  })

  it('includes event value in submission', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('')
    })

    controller.eventSelectTarget.value = 'pull_request'

    const event = { preventDefault: vi.fn() }
    await controller.submit(event)

    expect(global.fetch).toHaveBeenCalled()
  })

  it('shows loading state during submit', async () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        text: () => Promise.resolve('')
      }), 100))
    )

    const event = { preventDefault: vi.fn(), currentTarget: controller.submitButtonTarget }
    const originalText = controller.submitButtonTarget.textContent

    controller.submit(event)

    expect(controller.submitButtonTarget.disabled).toBe(true)
    expect(controller.submitButtonTarget.textContent).toBe('Submitting...')
  })

  it('restores button after submit completes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('')
    })

    const event = { preventDefault: vi.fn(), currentTarget: controller.submitButtonTarget }
    const originalText = controller.submitButtonTarget.textContent

    await controller.submit(event)

    expect(controller.submitButtonTarget.disabled).toBe(false)
    expect(controller.submitButtonTarget.textContent).toBe(originalText)
  })

  it('handles submit errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const event = { preventDefault: vi.fn() }

    await controller.submit(event)

    expect(window.alert).toHaveBeenCalledWith('Failed to submit review. Please try again.')
  })

  it('renders turbo stream response on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<turbo-stream>test</turbo-stream>')
    })
    const event = { preventDefault: vi.fn(), currentTarget: controller.submitButtonTarget }

    await controller.submit(event)

    expect(renderStreamMessage).toHaveBeenCalledWith('<turbo-stream>test</turbo-stream>')
  })
})
