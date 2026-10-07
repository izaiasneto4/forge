import { useLayoutEffect, useRef, useState } from 'react'

import { composeFocus, type ReviewDepth, type ReviewLens } from '../lib/agents'
import { relativeAge } from '../lib/format'
import { isAuthoredBy } from '../lib/lifecycle'
import { splitPullRequestInput } from '../lib/pullRequestInput'
import { useWorkspace } from '../workspace/context'
import { BackToList } from './BackToList'
import { ReviewPills } from './Composer'
import { Icon } from './Icon'

export function NewReview() {
  const { board, items, login, defaultClient, actions, pending, openPullRequest, goToMailbox, requestedCount, sidebarOpen, toggleSidebar } = useWorkspace()
  const [text, setText] = useState('')
  const [client, setClient] = useState<string | null>(null)
  const [depth, setDepth] = useState<ReviewDepth>('review')
  const [lens, setLens] = useState<ReviewLens>('general')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { url, focus } = splitPullRequestInput(text)
  const agent = client ?? defaultClient

  useLayoutEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const open = items.filter((item) => item.lifecycle === 'needs_review' && !isAuthoredBy(item, login))
  const oldest = [...open].sort((a, b) => new Date(a.updated_at_github ?? 0).getTime() - new Date(b.updated_at_github ?? 0).getTime())[0]
  const ready = items.filter((item) => item.lifecycle === 'ready').length
  const newCommits = items.filter((item) => item.has_new_commits && item.lifecycle !== 'settled').length

  const start = () => {
    if (!url || pending.start) return
    void actions.startReviewFromUrl(url, { client: agent, depth, focus: composeFocus(lens, focus) })
  }

  return (
    <main className="detail">
      <div className="toolbar" style={{ borderBottomColor: 'transparent' }}>
        <BackToList />
        {!sidebarOpen ? <button type="button" className="tb-btn" onClick={toggleSidebar}><Icon name="sidebar" /></button> : null}
        <div className="crumbs"><b>New review</b></div>
      </div>
      <div className="hero">
        <div className="mark"><Icon name="flame" size={34} stroke={1.7} /></div>
        <h2>What should we review{board?.current_repo.name ? <> in <u>{board.current_repo.name}</u></> : null}?</h2>
        <p>Paste a pull request link, or let Forge pick up what’s waiting on you.</p>
        <div className="composer">
          <textarea
            id="composer-input"
            ref={textareaRef}
            rows={2}
            value={text}
            placeholder={`https://github.com/${board?.current_repo.slug ?? 'org/repo'}/pull/…`}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || !event.shiftKey) && url) {
                event.preventDefault()
                start()
              }
            }}
          />
          <div className="bar">
            <ReviewPills client={agent} depth={depth} lens={lens} onClient={setClient} onDepth={setDepth} onLens={setLens} />
            <button type="button" className="send" disabled={!url || pending.start} title="Start review  ↵" aria-label="Start review" onClick={start}>
              <Icon name="arrowUp" size={17} stroke={2.2} />
            </button>
          </div>
        </div>
        <div className="suggestions">
          {requestedCount > 0 ? (
            <button type="button" className="suggestion" onClick={() => void actions.reviewAllRequested()}>
              <Icon name="layers" size={14} />{requestedCount === 1 ? 'Review the PR requested from you' : `Review all ${requestedCount} requested from you`}
            </button>
          ) : null}
          {oldest ? (
            <button type="button" className="suggestion" onClick={() => openPullRequest(oldest.id)}>
              <Icon name="hourglass" size={14} />Oldest waiting: #{oldest.number} · {relativeAge(oldest.updated_at_github)}
            </button>
          ) : null}
          {ready > 0 ? (
            <button type="button" className="suggestion" onClick={() => goToMailbox('inbox')}>
              <Icon name="arrowUp" size={14} />{ready} ready to send
            </button>
          ) : null}
          {newCommits > 0 ? (
            <button type="button" className="suggestion" onClick={() => goToMailbox('waiting')}>
              <Icon name="branch" size={14} />{newCommits} with new commits
            </button>
          ) : null}
        </div>
      </div>
    </main>
  )
}
