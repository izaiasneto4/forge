import type { Lifecycle } from '../types/api'

const CLAUDE_RAYS = Array.from({ length: 12 }, (_, index) => index * 30)

export function AgentIcon({ client, size = 16 }: { client: string | null | undefined; size?: number }) {
  if (client === 'codex') {
    return (
      <svg className="i" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zM13.26 22.43a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5zM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06l-4.83 2.79a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9A4.49 4.49 0 0 1 4.7 5.92v5.68a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0L4 14.02A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.86-5.84-3.39 2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.67a.79.79 0 0 0-.4-.67zm2-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.4 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.3 12.86 6.28 11.7a.08.08 0 0 1-.04-.06V6.08a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.7 5.46a.8.8 0 0 0-.39.68zm1.1-2.37 2.6-1.5 2.61 1.5v3l-2.6 1.5-2.6-1.5z" />
      </svg>
    )
  }

  if (client === 'opencode') {
    return (
      <svg className="i" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 5h7v14H3V5zm2 2v10h3V7H5zm11-2h5v2h-5v4h3v2h-3v4h5v2h-7V5h2z" />
      </svg>
    )
  }

  return (
    <svg className="i" width={size} height={size} viewBox="0 0 100 100" fill="#D97757" aria-hidden="true">
      {CLAUDE_RAYS.map((angle) => <path key={angle} d="M50 6 L54 42 L50 50 L46 42 Z" transform={`rotate(${angle} 50 50)`} />)}
      <circle cx="50" cy="50" r="11" />
    </svg>
  )
}

export function Spinner({ size = 16, stroke = 1.8 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="var(--t4)" strokeWidth={stroke - 0.2} />
      <path className="spin" d="M8 2a6 6 0 0 1 6 6" stroke="var(--t1)" strokeWidth={stroke} fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function CheckBadge({ size = 16, color = 'var(--t3)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill={color} />
      <path d="m5.2 8.2 1.9 1.9 3.8-4" stroke="#161618" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function StatusGlyph({ lifecycle, requested = false, size = 16 }: { lifecycle: Lifecycle; requested?: boolean; size?: number }) {
  const box = { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true }

  switch (lifecycle) {
    case 'needs_review':
      return requested ? (
        <svg {...box}><circle cx="8" cy="8" r="6" fill="none" stroke="var(--t1)" strokeWidth="1.6" /><circle cx="8" cy="8" r="2.4" fill="var(--t1)" /></svg>
      ) : (
        <svg {...box}><circle cx="8" cy="8" r="6" fill="none" stroke="var(--t3)" strokeWidth="1.6" strokeDasharray="2.6 2.1" /></svg>
      )
    case 'queued':
      return <svg {...box}><circle cx="8" cy="8" r="6" fill="none" stroke="var(--t3)" strokeWidth="1.6" /><path d="M8 5v3.2l2 1.3" stroke="var(--t2)" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
    case 'reviewing':
      return <Spinner size={size} />
    case 'ready':
      return <svg {...box}><circle cx="8" cy="8" r="7" fill="var(--accent)" /><path d="M8 11V5.3M5.6 7.5 8 5.1l2.4 2.4" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    case 'failed':
      return <svg {...box}><circle cx="8" cy="8" r="7" fill="var(--red)" /><path d="M8 4.6v4.1" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" /><circle cx="8" cy="11.2" r="1" fill="#fff" /></svg>
    case 'waiting':
      return <svg {...box}><circle cx="8" cy="8" r="6" fill="none" stroke="var(--t3)" strokeWidth="1.6" /><path d="M8 4a4 4 0 0 1 0 8z" fill="var(--t3)" /></svg>
    case 'settled':
      return <CheckBadge size={size} />
    case 'authored':
      return <svg {...box}><circle cx="8" cy="8" r="6" fill="none" stroke="var(--t3)" strokeWidth="1.6" /><circle cx="8" cy="8" r="2.4" fill="none" stroke="var(--t3)" strokeWidth="1.4" /></svg>
  }
}

export function Avatar({ name, url, size = 20 }: { name: string | null; url?: string | null; size?: number }) {
  const label = name ?? '?'
  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) }

  if (url) {
    return <img className="avatar" src={url} alt={label} style={style} />
  }

  return (
    <span className="avatar" style={style}>
      {label.charAt(0).toUpperCase()}
    </span>
  )
}
