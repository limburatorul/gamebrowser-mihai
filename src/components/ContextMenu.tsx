import { useEffect, useRef, useState } from 'react'
import type { CompletionStatus, Game } from '@shared/types'
import { COMPLETION_STATUSES, COMPLETION_LABELS, PLATFORM_SOURCES } from '@shared/types'

interface Props {
  game: Game
  x: number
  y: number
  running: boolean
  onClose: () => void
  onLaunch: (id: string) => void
  onSetCompletion: (id: string, status: CompletionStatus | null) => void
  onOpenSaves: (id: string) => void
  onToggleFavorite: (id: string) => void
  onTogglePlaytimeIgnored: (id: string) => void
  onToggleHidden: (id: string) => void
  onEdit: (id: string) => void
  onSetCover: (id: string) => void
  onRemove: (id: string) => void
  onUninstall: (id: string) => void
  onDeleteFromDisk: (id: string) => void
}


export default function ContextMenu({
  game,
  x,
  y,
  running,
  onClose,
  onLaunch,
  onSetCompletion,
  onOpenSaves,
  onToggleFavorite,
  onTogglePlaytimeIgnored,
  onToggleHidden,
  onEdit,
  onSetCover,
  onRemove,
  onUninstall,
  onDeleteFromDisk
}: Props): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: Math.min(x, window.innerWidth - rect.width - 8),
      top: Math.min(y, window.innerHeight - rect.height - 8)
    })
  }, [x, y])

  useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  function run(action: (id: string) => void): void {
    action(game.id)
    onClose()
  }

  return (
    <div className="context-menu-overlay" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="context-menu-title">{game.name}</div>
        <button className="context-menu-item" disabled={running} onClick={() => run(onLaunch)}>
          ▶ Play
        </button>
        <button className="context-menu-item" onClick={() => run(onToggleFavorite)}>
          {game.favorite ? '★ Remove Favorite' : '☆ Favorite'}
        </button>
        {/* A row of glyphs rather than four menu lines: marking a game is the
            thing you do most often in here, and a submenu would put it two
            clicks away. Pressing the one already set clears it. */}
        <div className="context-menu-statuses">
          {COMPLETION_STATUSES.map((status) => (
            <button
              key={status}
              className={`context-menu-status ${game.completion === status ? 'active' : ''}`}
              title={game.completion === status ? `Clear "${COMPLETION_LABELS[status].label}"` : COMPLETION_LABELS[status].label}
              onClick={() => {
                onSetCompletion(game.id, game.completion === status ? null : status)
                onClose()
              }}
            >
              <span aria-hidden="true">{COMPLETION_LABELS[status].icon}</span>
              <span>{COMPLETION_LABELS[status].label}</span>
            </button>
          ))}
        </div>
        <button
          className="context-menu-item"
          title="Keeps tracking this game's playtime, but leaves it out of the most-played list, the library total, and the dashboard"
          onClick={() => run(onTogglePlaytimeIgnored)}
        >
          {game.excludeFromPlaytime ? '⏱ Count Playtime' : '⏱ Ignore Playtime'}
        </button>
        <button
          className="context-menu-item"
          title="Keeps the game in the library but out of the grid, the sidebar counts and the backdrop. Bring it back from Settings > Hidden Games."
          onClick={() => run(onToggleHidden)}
        >
          {game.hidden ? '👁 Unhide' : '👁 Hide'}
        </button>
        <button
          className="context-menu-item"
          title="Back up or restore this game's save files"
          onClick={() => run(onOpenSaves)}
        >
          💾 Backup / Restore Saves…
        </button>
        <button className="context-menu-item" onClick={() => run(onSetCover)}>
          Set Cover
        </button>
        <button className="context-menu-item" onClick={() => run(onEdit)}>
          Edit
        </button>
        <div className="context-menu-separator" />
        {PLATFORM_SOURCES.has(game.source) ? (
          <button className="context-menu-item" onClick={() => run(onUninstall)}>
            Uninstall
          </button>
        ) : (
          <button className="context-menu-item danger" onClick={() => run(onDeleteFromDisk)}>
            Delete from Disk
          </button>
        )}
        <button className="context-menu-item danger" onClick={() => run(onRemove)}>
          Remove
        </button>
      </div>
    </div>
  )
}
