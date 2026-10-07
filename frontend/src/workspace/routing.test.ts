import { describe, expect, it } from 'vitest'

import { splitPullRequestInput } from '../lib/pullRequestInput'
import { composeFocus, LENSES } from '../lib/agents'
import { mailboxPath, parseRoute } from './routing'

describe('parseRoute', () => {
  it('reads mailbox and pull request ids from the path', () => {
    const id = 42

    expect(parseRoute('/')).toEqual({ kind: 'mailbox', mailbox: 'inbox', id: null })
    expect(parseRoute(mailboxPath('waiting', id))).toEqual({ kind: 'mailbox', mailbox: 'waiting', id })
    expect(parseRoute('/settled/not-a-number')).toEqual({ kind: 'mailbox', mailbox: 'settled', id: null })
  })

  it('keeps legacy links working', () => {
    const taskId = 7

    expect(parseRoute(`/review_tasks/${taskId}`)).toEqual({ kind: 'task', taskId })
    expect(parseRoute('/review_tasks')).toEqual({ kind: 'mailbox', mailbox: 'reviewing', id: null })
    expect(parseRoute('/settings')).toEqual({ kind: 'settings', tab: 'general' })
    expect(parseRoute('/repositories')).toEqual({ kind: 'settings', tab: 'repositories' })
  })

  it('recognizes the new review screen and falls back to the inbox', () => {
    expect(parseRoute('/new')).toEqual({ kind: 'new' })
    expect(parseRoute('/unknown')).toEqual({ kind: 'mailbox', mailbox: 'inbox', id: null })
  })
})

describe('splitPullRequestInput', () => {
  it('separates the pull request link from the focus text', () => {
    const url = 'https://github.com/acme/api/pull/12'
    const focus = 'check the retries'

    expect(splitPullRequestInput(`${url} ${focus}`)).toEqual({ url, focus })
    expect(splitPullRequestInput(focus)).toEqual({ url: null, focus })
  })
})

describe('composeFocus', () => {
  it('prefixes the lens instructions to the free-form focus', () => {
    const text = 'look at the webhook path'

    expect(composeFocus('general', text)).toBe(text)
    expect(composeFocus('security', text)).toBe(`${LENSES.security.focus}\n\n${text}`)
    expect(composeFocus('security', '  ')).toBe(LENSES.security.focus)
  })
})
