import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Game } from '@shared/types'
import { COMPLETION_LABELS } from '@shared/types'
import CoverImage from './CoverImage'
import { formatDuration, formatPlaytime } from '../lib/localFile'
import { createGamepadReader, type PadAction } from '../lib/gamepad'

interface Props {
  games: Game[]
  runningIds: Set<string>
  onLaunch: (id: string) => void
  onExit: () => void
}

type Row = { key: string; label: string; games: Game[] }

const COLUMNS = 6

/**
 * The couch view: fullscreen, big art, driven by a controller.
 *
 * Deliberately not the desktop grid scaled up. Everything that makes the
 * desktop layout good — dense tiles, a sidebar of filters, a details bar with
 * ten buttons — is wrong at three metres with a stick in your hand, so this
 * has one focused item, a few rows, and two buttons that do anything.
 */
export default function BigPictureView({ games, runningIds, onLaunch, onExit }: Props): JSX.Element {
  const rows = useMemo<Row[]>(() => {
    const played = games
      .filter((g) => g.lastPlayed)
      .sort((a, b) => Date.parse(b.lastPlayed as string) - Date.parse(a.lastPlayed as string))
    const playing = games.filter((g) => g.completion === 'playing')
    const unplayed = games.filter((g) => g.playtimeSeconds === 0)
    const out: Row[] = []
    if (playing.length > 0) out.push({ key: 'playing', label: 'Playing', games: playing })
    if (played.length > 0) out.push({ key: 'recent', label: 'Recently played', games: played.slice(0, 24) })
    if (unplayed.length > 0) out.push({ key: 'unplayed', label: 'Never played', games: unplayed.slice(0, 60) })
    out.push({ key: 'all', label: 'All games', games })
    return out
  }, [games])

  const [rowIndex, setRowIndex] = useState(0)
  const [colIndex, setColIndex] = useState(0)
  const focusRef = useRef<HTMLDivElement>(null)

  const row = rows[Math.min(rowIndex, rows.length - 1)]
  const selected = row?.games[Math.min(colIndex, row.games.length - 1)] ?? null

  // Keeping the focused tile on screen is the whole navigation model here -
  // there is no pointer to scroll with.
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  }, [rowIndex, colIndex, rows.length])

  const move = useCallback(
    (action: PadAction): void => {
      if (action === 'left') setColIndex((c) => Math.max(0, c - 1))
      if (action === 'right') setColIndex((c) => Math.min((row?.games.length ?? 1) - 1, c + 1))
      if (action === 'up') {
        setRowIndex((r) => Math.max(0, r - 1))
        setColIndex((c) => Math.min(c, (rows[Math.max(0, rowIndex - 1)]?.games.length ?? 1) - 1))
      }
      if (action === 'down') {
        setRowIndex((r) => Math.min(rows.length - 1, r + 1))
        setColIndex((c) => Math.min(c, (rows[Math.min(rows.length - 1, rowIndex + 1)]?.games.length ?? 1) - 1))
      }
      if (action === 'confirm' && selected && !runningIds.has(selected.id)) onLaunch(selected.id)
      if (action === 'back' || action === 'menu') onExit()
    },
    [row, rows, rowIndex, selected, runningIds, onLaunch, onExit]
  )

  useEffect(() => createGamepadReader(move), [move])

  // The same actions from the keyboard, so this is usable without a pad and
  // testable without one plugged in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const map: Record<string, PadAction> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        Enter: 'confirm',
        Escape: 'back'
      }
      const action = map[e.key]
      if (!action) return
      e.preventDefault()
      move(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move])

  return (
    <div className="bigpicture">
      {/* Art from the focused game, blown up and darkened as a backdrop. It is
          the only thing at this size that reads from across a room. */}
      <div className="bigpicture-backdrop" key={selected?.id}>
        {selected && <CoverImage game={selected} className="bigpicture-backdrop-img" />}
      </div>

      <div className="bigpicture-header">
        <div className="bigpicture-title">{selected?.name ?? 'Nothing to show'}</div>
        {selected && (
          <div className="bigpicture-meta">
            <span>{formatPlaytime(selected.playtimeSeconds)}</span>
            {selected.completion && <span>{COMPLETION_LABELS[selected.completion].label}</span>}
            {selected.hltbMainSeconds !== null && (
              <span>To beat {formatDuration(selected.hltbMainSeconds)}</span>
            )}
            {selected.genres.length > 0 && <span>{selected.genres.slice(0, 3).join(' · ')}</span>}
          </div>
        )}
      </div>

      <div className="bigpicture-rows">
        {rows.map((r, ri) => (
          <div key={r.key} className="bigpicture-row">
            <div className="bigpicture-row-label">{r.label}</div>
            <div className="bigpicture-row-items">
              {/* Only a window of each row is rendered: "All games" is 544
                  entries and mounting them all would stutter every move. */}
              {r.games
                .slice(Math.max(0, (ri === rowIndex ? colIndex : 0) - COLUMNS), Math.max(0, (ri === rowIndex ? colIndex : 0) - COLUMNS) + COLUMNS * 3)
                .map((g, offset) => {
                  const actualIndex = Math.max(0, (ri === rowIndex ? colIndex : 0) - COLUMNS) + offset
                  const focused = ri === rowIndex && actualIndex === colIndex
                  return (
                    <div
                      key={g.id}
                      ref={focused ? focusRef : undefined}
                      className={`bigpicture-tile ${focused ? 'focused' : ''}`}
                    >
                      <CoverImage game={g} className="cover-img" />
                      {runningIds.has(g.id) && <div className="bigpicture-running">RUNNING</div>}
                    </div>
                  )
                })}
            </div>
          </div>
        ))}
      </div>

      <div className="bigpicture-hints">
        <span>
          <strong>A</strong> / Enter — Play
        </span>
        <span>
          <strong>B</strong> / Esc — Leave
        </span>
        <span>Stick or arrows to move</span>
      </div>
    </div>
  )
}
