import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { agentLabel } from '../lib/agents'
import { api } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { ACCENTS, desktopNotificationsEnabled, saveAccent, setDesktopNotifications, storedAccent } from '../lib/preferences'
import { queryKeys } from '../lib/queryKeys'
import { useToasts } from '../lib/toastContext'
import type { RepositoryListResponse, SettingsResponse, UiMutationResponse } from '../types/api'
import { useWorkspace } from '../workspace/context'
import type { SettingsTab } from '../workspace/routing'
import { AgentIcon, Avatar } from './Glyphs'
import { Icon, type IconName } from './Icon'

const TABS: Array<[SettingsTab, string, IconName]> = [
  ['general', 'General', 'gear'],
  ['agents', 'Agents', 'sparkles'],
  ['repositories', 'Repositories', 'folder'],
  ['github', 'GitHub', 'github'],
  ['shortcuts', 'Shortcuts', 'keyboard'],
]

const SHORTCUTS: Array<[string, string]> = [
  ['Search everything', '⌘K'],
  ['New review', 'N'],
  ['Next / previous pull request', 'J / K'],
  ['Focus the composer', 'R'],
  ['Start review or submit', '⌘↵'],
  ['Include / exclude finding', 'X'],
  ['Archive', 'E'],
  ['Toggle inspector', 'I'],
  ['Toggle sidebar', '⌘\\'],
  ['Settings', '⌘,'],
]

function Switch({ on, onChange, label }: { on: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={on ? 'switch on' : 'switch'} onClick={() => onChange(!on)} />
}

function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="grow">
      <div className="l">{label}{hint ? <small>{hint}</small> : null}</div>
      {children}
    </div>
  )
}

function useSettingsMutation() {
  const queryClient = useQueryClient()
  const { pushToast } = useToasts()

  return useMutation({
    mutationFn: (payload: { repos_folder: string; default_cli_client: string; auto_submit_enabled: boolean }) =>
      api.patch<UiMutationResponse>('/api/v1/settings', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap })
      queryClient.invalidateQueries({ queryKey: queryKeys.repositories })
      queryClient.invalidateQueries({ queryKey: queryKeys.pullRequestBoard })
    },
    onError: (error) => pushToast(errorMessage(error), 'error'),
  })
}

function General({ settings }: { settings: SettingsResponse }) {
  const mutation = useSettingsMutation()
  const [accent, setAccent] = useState(storedAccent)
  const [notify, setNotify] = useState(desktopNotificationsEnabled)

  return (
    <>
      <div className="group-label">Appearance</div>
      <div className="group">
        <Row label="Accent color">
          <div className="accents">
            {ACCENTS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Accent ${color}`}
                className={accent === color ? 'on' : ''}
                style={{ '--c': color }}
                onClick={() => {
                  saveAccent(color)
                  setAccent(color)
                }}
              />
            ))}
          </div>
        </Row>
      </div>

      <div className="group-label">Reviews</div>
      <div className="group">
        <Row label="Confirm before submitting to GitHub">
          <Switch
            label="Confirm before submitting"
            on={settings.auto_submit_enabled}
            onChange={(value) => mutation.mutate({ repos_folder: settings.repos_folder ?? '', default_cli_client: settings.default_cli_client, auto_submit_enabled: value })}
          />
        </Row>
        <Row label="Desktop notifications" hint="Get a macOS notification when a review finishes while Forge is in the background">
          <Switch label="Desktop notifications" on={notify} onChange={(value) => void setDesktopNotifications(value).then(setNotify)} />
        </Row>
      </div>
    </>
  )
}

function Agents({ settings }: { settings: SettingsResponse }) {
  const mutation = useSettingsMutation()

  return (
    <>
      <div className="group-label">Default agent</div>
      <div className="group">
        {settings.cli_clients.map((client) => {
          const isDefault = settings.default_cli_client === client
          return (
            <div key={client} className="grow agent-row clickable" onClick={() => mutation.mutate({ repos_folder: settings.repos_folder ?? '', default_cli_client: client, auto_submit_enabled: settings.auto_submit_enabled })}>
              <div className="agent-badge"><AgentIcon client={client} size={18} /></div>
              <div className="l">{agentLabel(client)}<small><code>{client}</code> CLI on your PATH</small></div>
              {isDefault ? <span className="ok-pill">Default</span> : <span className="ok-pill off">Use as default</span>}
            </div>
          )
        })}
      </div>
    </>
  )
}

function Repositories({ settings }: { settings: SettingsResponse }) {
  const mutation = useSettingsMutation()
  const { actions } = useWorkspace()
  const { pushToast } = useToasts()
  const [folder, setFolder] = useState(settings.repos_folder ?? '')
  const repositories = useQuery({
    queryKey: queryKeys.repositories,
    queryFn: () => api.get<RepositoryListResponse>('/api/v1/repositories'),
  })

  const save = (path: string) => mutation.mutate({ repos_folder: path, default_cli_client: settings.default_cli_client, auto_submit_enabled: settings.auto_submit_enabled })

  return (
    <>
      <div className="group-label">Repositories folder</div>
      <div className="group">
        <div className="grow">
          <Icon name="folder" />
          <input className="field" value={folder} placeholder="~/code" aria-label="Repositories folder" onChange={(event) => setFolder(event.target.value)} />
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                const response = await api.post<{ path: string | null }>('/api/v1/settings/pick_folder')
                if (response.path) {
                  setFolder(response.path)
                  save(response.path)
                }
              } catch (error) {
                pushToast(errorMessage(error), 'error')
              }
            }}
          >
            Choose…
          </button>
          <button type="button" className="btn primary" disabled={folder === (settings.repos_folder ?? '') || mutation.isPending} onClick={() => save(folder)}>Save</button>
        </div>
      </div>

      <div className="group-label">Repositories found</div>
      <div className="group">
        {repositories.isLoading ? <Row label="Scanning…" /> : null}
        {repositories.data?.items.length === 0 ? <Row label="No Git repositories found in this folder." /> : null}
        {repositories.data?.items.map((repo) => (
          <div key={repo.path} className={repo.current ? 'grow' : 'grow clickable'} onClick={() => { if (!repo.current && repo.slug) void actions.switchRepo(repo.slug) }}>
            <span className="repo-dot" style={{ background: repo.current ? 'var(--accent)' : 'var(--t4)' }} />
            <div className="l">{repo.slug ?? repo.name}<small className="mono">{repo.path}{repo.branch ? ` · ${repo.branch}` : ''}</small></div>
            {repo.current ? <span className="repo-current">Current</span> : null}
          </div>
        ))}
      </div>
    </>
  )
}

function GitHub() {
  const { bootstrap, board, actions } = useWorkspace()
  const login = bootstrap?.settings.github_login ?? null

  return (
    <>
      <div className="group-label">Account</div>
      <div className="group">
        <Row label={login ?? 'Not signed in'} hint={login ? 'Authenticated through the gh CLI' : 'Run gh auth login in a terminal'}>
          {login ? <Avatar name={login} size={28} /> : null}
        </Row>
      </div>
      <div className="group-label">Sync</div>
      <div className="group">
        <Row label="Only pull requests that request my review" hint="Other open pull requests in the repository stay out of Forge">
          <Switch label="Only requested reviews" on={board?.settings.only_requested_reviews ?? false} onChange={(value) => void actions.setOnlyRequested(value)} />
        </Row>
        <Row label="Sync now" hint="Forge also syncs every two minutes while the window is visible">
          <button type="button" className="btn" onClick={() => void actions.sync(true)}><Icon name="refresh" size={14} />Sync</button>
        </Row>
      </div>
    </>
  )
}

function Shortcuts() {
  return (
    <div className="group">
      {SHORTCUTS.map(([label, keys]) => <Row key={label} label={label}><kbd style={{ fontSize: 12 }}>{keys}</kbd></Row>)}
    </div>
  )
}

export function SettingsSheet({ tab }: { tab: SettingsTab }) {
  const { closeSettings, openSettings } = useWorkspace()
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: () => api.get<SettingsResponse>('/api/v1/settings') })
  const title = TABS.find(([key]) => key === tab)?.[1] ?? 'Settings'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSettings()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeSettings])

  return (
    <>
      <div className="scrim" onClick={closeSettings} />
      <div className="sheet" role="dialog" aria-label={`${title} settings`}>
        <div className="sheet-bar">
          <button type="button" className="tb-btn sheet-close" aria-label="Close settings" onClick={closeSettings}><Icon name="x" size={14} /></button>
          <div className="ttl">{title}</div>
          <div className="sheet-tabs" role="tablist">
            {TABS.map(([key, label, icon]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'sheet-tab on' : 'sheet-tab'} onClick={() => openSettings(key)}>
                <Icon name={icon} size={20} stroke={1.5} />{label}
              </button>
            ))}
          </div>
        </div>
        <div className="sheet-body">
          {settings.isLoading ? <div className="loading-line">Loading settings…</div> : null}
          {settings.error ? <div className="loading-line">{errorMessage(settings.error)}</div> : null}
          {settings.data && tab === 'general' ? <General settings={settings.data} /> : null}
          {settings.data && tab === 'agents' ? <Agents settings={settings.data} /> : null}
          {settings.data && tab === 'repositories' ? <Repositories key={settings.data.repos_folder ?? ''} settings={settings.data} /> : null}
          {tab === 'github' ? <GitHub /> : null}
          {tab === 'shortcuts' ? <Shortcuts /> : null}
        </div>
      </div>
    </>
  )
}
