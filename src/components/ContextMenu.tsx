import { useEffect, useRef, useState } from 'react'
import type { Game } from '@shared/types'

interface Props {
  game: Game
  x: number
  y: number
  running: boolean
  onClose: () => void
  onLaunch: (id: string) => void
  onToggleFavorite: (id: string) => void
  onEdit: (id: string) => void
  onSetCover: (id: string) => void
  onRemove: (id: string) => void
}

export default function ContextMenu({
  game,
  x,
  y,
  running,
  onClose,
  onLaunch,
  onToggleFavorite,
  onEdit,
  onSetCover,
  onRemove
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
        <button className="context-menu-item" onClick={() => run(onSetCover)}>
          Set Cover
        </button>
        <button className="context-menu-item" onClick={() => run(onEdit)}>
          Edit
        </button>
        <div className="context-menu-separator" />
        <button className="context-menu-item danger" onClick={() => run(onRemove)}>
          Remove
        </button>
      </div>
    </div>
  )
}
