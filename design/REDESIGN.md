# Ordem redesign

Prototype: `design/prototype/index.html` (static, mock data). Serve the folder and open it:

```bash
python3 -m http.server 4792 --directory design/prototype
```

URL params jump straight to a state: `?pr=479&box=reviewing`, `?hero`, `?theme=light`, `?inspector=files`, `?palette=pay`, `?settings=agents`, `?menu=depth`, `?bare` (no desktop frame).

## The core idea

Ordem works like a mail client for code review. Each PR is a thread, and the agent is a collaborator inside that thread. T3 Code uses the same model (project → threads with live status), and so do Mail and the ChatGPT desktop app.

Today the app is a web dashboard: top nav, four pages, two kanban-ish boards with **two separate status systems** (6 PR statuses and 7 task states). To answer "what do I need to do?" the user has to map one onto the other in their head.

## Information architecture

```
┌ Sidebar ─────────┬ List ──────────────┬ Detail ──────────────────────┬ Inspector (toggle) ┐
│ Search ⌘K        │ Inbox · 5 need you │ PR header                    │ Activity           │
│ Inbox          5 │ ─ Ready to send    │ What changed (brief)         │ Files              │
│ Reviewing   ◌  2 │ ─ Needs attention  │ Review (verdict / live run)  │ Agent log          │
│ Waiting on author│ ─ Requested from you│ Findings / Files            │                    │
│ My pull requests │ ─ Open in your repos│                             │                    │
│ Settled          │                    │ ╭ Composer (one action) ───╮ │                    │
│ Repositories     │                    │ ╰──────────────────────────╯ │                    │
└──────────────────┴────────────────────┴──────────────────────────────┴────────────────────┘
```

- **Mailboxes replace pages.** Inbox = everything that needs a human decision. Reviewing = agent working or queued. Waiting = ball is in the author's court. Settled = done.
- **Repos are filters, not a mode.** Clicking a repo scopes every mailbox. There's no more "switch current repo".
- **The PR is the only entity.** Review tasks stop being a separate board; the task is just the PR's current run.
- **Settings is a sheet** (macOS Settings window), not a route.

### One lifecycle (derived server-side)

| Lifecycle | Mailbox | Derived from |
|---|---|---|
| `needs_review` | Inbox | PR `pending_review`, no active task |
| `queued` | Reviewing | task `queued` / `pending_review` |
| `reviewing` | Reviewing | task `in_review` |
| `ready` | Inbox | task `reviewed`, comments not yet submitted |
| `failed` | Inbox | task `failed_review` / PR `review_failed` |
| `waiting` | Waiting | task/PR `waiting_implementation` (+ `new_commits` when head moved past reviewed snapshot) |
| `settled` | Settled | task `done`, PR `reviewed_by_me` / `reviewed_by_others`, archived, merged/closed |
| `authored` | My PRs | author == `github_login` |

Expose this as `lifecycle` on the PR payload so the UI and `bin/ordem` share one vocabulary. Drop the drag-and-drop task board. Those states are machine-driven, so letting users drag cards between them is a fake affordance.

## Interaction principles

1. **One primary action per screen, always in the composer.** Start review, retry, re-review, submit. Same place, same `⌘↵`.
2. **The composer changes with state.** Needs review: agent / depth / focus pills + send. Reviewing: Stop. Ready: event (Comment / Approve / Request changes) + AI-drafted summary + Submit.
3. **The AI makes the first call and you make the final one.** Brief, suggested verdict, and pre-checked findings are all editable before anything reaches GitHub.
4. **Ambient over modal.** Sync is a footer chip. When a run finishes you get a notification and the inbox updates, with no toasts and no `window.confirm`.
5. **Keyboard-first.** `⌘K` palette, `J/K` move, `X` include finding, `⌘↵` act, `E` archive, `I` inspector, `⌘\` sidebar. Submitting auto-advances to the next item (Superhuman-style).

## Visual language

- System font (SF Pro / SF Mono) at a 13px base, which is the macOS default. Drop Inter.
- Translucent sidebar (vibrancy), opaque content panes, 0.5px hairlines, 12px window radius.
- One user-selectable accent (default ember `#ff7a3d`). Apple system colors for semantics. The brand itself is monochrome; see [BRAND.md](BRAND.md).
- Status is a glyph, not a text badge: ring, spinner, filled send, red alert, half-moon, check.
- Motion: 120–300ms ease-out, spring on toggles and sheets, shimmer on the live agent step. Respects `prefers-reduced-motion`.

## Status

Shipped in the app (dark appearance only for now):

- 3-pane shell with mailboxes, repository switcher, sync chip, inspector (activity, agent log, history).
- Server-derived `lifecycle` + `has_new_commits` on PR payloads; the task board and drag-and-drop are gone.
- State-aware composer: start (agent, depth, focus lens + free text sent as `focus`), re-review, retry, live run, submit with include/exclude per finding and a suggested event. No verdict is suggested when the agent's output wasn't parsed into findings.
- Findings can be dismissed and restored; a PR can be archived (with undo) or deleted from Ordem; past runs expand in the inspector history.
- `⌘K` palette, `J/K`, `X`, `D`, `E`, `I`, `N`, `R`, `⌘↵`, `⌘\`, `⌘,`; auto-advance after submit/archive.
- macOS-style notifications (in-app banners + optional desktop notifications), confirm sheet, settings sheet (accent color, agents, repositories, GitHub, shortcuts).
- Mailbox URLs: `/inbox`, `/reviewing/:id`, `/waiting/:id`, `/mine`, `/settled`, `/new`. `/review_tasks/:id` redirects to the PR, or opens the review directly when its PR isn't on the board (merged, closed, other repository). Settled also lists reviewed PRs that were merged or closed.
- Narrow windows float the inspector and sidebar over the content; below 640px the list and the open PR take turns.
- Error pages and the app icon use the same design.

Still open: light appearance, multi-repo sync, file list per PR (no API yet), AI-drafted submission summary, editing finding text before submit, Tauri shell.

## Roadmap

1. **Shell + IA:** tokens, 3-pane shell, mailboxes, list, `lifecycle` in the API. Remove top nav and the task board.
2. **Detail + composer:** merge task detail into the PR view, findings with include toggles (existing toggle + submissions endpoints), inspector on the existing logs channel.
3. **Speed layer:** palette, shortcuts, optimistic updates, auto-advance, Notification API on `ReviewNotificationsChannel`.
4. **Native shell (Tauri v2):** real traffic lights (`titleBarStyle: overlay`), `NSVisualEffectView` vibrancy, menu bar, dock badge = inbox count, native notifications. CSS can't fake these, and they make the biggest difference to "feels like macOS".

### Backend gaps

- `lifecycle` + `new_commits` on PR payloads.
- Review create params: `depth` (`quick` / `standard` / `swarm`), `lens`, free-text `focus`.
- AI-drafted submission summary; editable comment bodies before submit.
- Multi-repo sync (sidebar shows all tracked repos at once). This is the biggest change.

### features.json items this covers

#3 search/filter (palette + filters), #4/#23 templates/presets (lens pill), #5 batch queue ("Review all requested"), #6 auto-review (setting), #8 draft comment mode, #9 iteration diff (re-review), #15 keyboard, #16 theme, #17/#18 size + stale (age coloring), #25 suggested conclusion (verdict).
