import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from './Icon'

export type MenuItem = {
  key: string
  label: string
  sub?: string
  icon?: ReactNode
  checked?: boolean
  shortcut?: string
  disabled?: boolean
}

export type MenuSection = {
  title?: string
  items: MenuItem[]
}

type MenuButtonProps = {
  sections: MenuSection[]
  onSelect: (key: string) => void
  align?: 'left' | 'right'
  className?: string
  title?: string
  disabled?: boolean
  children: ReactNode
}

export function MenuButton({ sections, onSelect, align = 'left', className = 'pill', title, disabled, children }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const items = sections.flatMap((section) => section.items).filter((item) => !item.disabled)

  const placeMenu = useCallback((menu: HTMLDivElement | null) => {
    menuRef.current = menu
    if (!menu || !anchorRef.current) return

    const anchor = anchorRef.current.getBoundingClientRect()
    const size = menu.getBoundingClientRect()
    const spaceBelow = window.innerHeight - anchor.bottom - 8
    const spaceAbove = anchor.top - 8
    const openUp = size.height > spaceBelow && spaceAbove > spaceBelow
    const maxHeight = Math.max(120, openUp ? spaceAbove : spaceBelow)
    menu.style.maxHeight = `${Math.min(size.height, maxHeight)}px`

    const fitted = menu.getBoundingClientRect()
    const top = openUp
      ? Math.max(8, anchor.top - fitted.height - 6)
      : Math.min(anchor.bottom + 6, window.innerHeight - fitted.height - 8)
    const left = align === 'right'
      ? Math.max(8, Math.min(anchor.right - fitted.width, window.innerWidth - fitted.width - 8))
      : Math.max(8, Math.min(anchor.left, window.innerWidth - fitted.width - 8))

    menu.style.top = `${top}px`
    menu.style.left = `${left}px`
    menu.style.transformOrigin = `${openUp ? 'bottom' : 'top'} ${align}`
    menu.style.visibility = 'visible'
  }, [align])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      setOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        anchorRef.current?.focus()
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlight((current) => (current + step + items.length) % items.length)
      } else if (event.key === 'Enter' && highlight >= 0) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        onSelect(items[highlight].key)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, items, highlight, onSelect])

  const highlightedKey = highlight >= 0 ? items[highlight]?.key : null

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={className}
        title={title}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setHighlight(-1)
          setOpen((current) => !current)
        }}
      >
        {children}
      </button>
      {open ? createPortal(
        <div
          ref={placeMenu}
          role="menu"
          className="menu"
          style={{ top: -9999, left: -9999, visibility: 'hidden' }}
        >
          {sections.map((section, index) => (
            <div key={section.title ?? index}>
              {index > 0 ? <div className="ms" /> : null}
              {section.title ? <div className="mh">{section.title}</div> : null}
              {section.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={Boolean(item.checked)}
                  className={item.key === highlightedKey ? 'mi hl' : 'mi'}
                  disabled={item.disabled}
                  onMouseEnter={() => setHighlight(items.findIndex((entry) => entry.key === item.key))}
                  onClick={() => {
                    setOpen(false)
                    onSelect(item.key)
                  }}
                >
                  <span className="tick">{item.checked ? <Icon name="check" size={13} stroke={2.2} /> : null}</span>
                  {item.icon}
                  <span className="mi-label">
                    {item.label}
                    {item.sub ? <span className="sub"> {item.sub}</span> : null}
                  </span>
                  {item.shortcut ? <span className="k">{item.shortcut}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
