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
  // Keeps a screen's worth of covers either side of the cursor mounted.
  const windowStart = Math.max(0, colIndex - COLUMNS)

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

  // `move` is rebuilt on every render - it closes over the current position,
  // and App hands down a fresh onLaunch each time. Attaching the listeners to
  // it directly meant tearing them down and re-adding them constantly, which
  // is how input ends up feeling stuck. The ref keeps one stable listener
  // reading the latest logic instead.
  const moveRef = useRef(move)
  useEffect(() => {
    moveRef.current = move
  }, [move])

  useEffect(() => createGamepadReader((action) => moveRef.current(action)), [])

  // The same actions from the keyboard, so this is usable without a pad and
  // testable without one plugged in.
  useEffect(() => {
    const map: Record<string, PadAction> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Enter: 'confirm',
      Escape: 'back'
    }
    const onKey = (e: KeyboardEvent): void => {
      const action = map[e.key]
      if (!action) return
      e.preventDefault()
      moveRef.current(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="bigpicture">
      {/* Art from the focused game, blown up and darkened as a backdrop. It is
          the only thing at this size that reads from across a room. */}
      <div className="bigpicture-backdrop" key={selected?.id}>
        {selected && <CoverImage game={selected} className="bigpicture-backdrop-img" />}
      </div>

      {/* Hero band: one big thing, the way Steam does it, rather than four
          stacked shelves competing for attention. The art on the right is the
          same cover at a size that carries across a room; everything you can
          act on is on the left, in reading order. */}
      <div className="bigpicture-hero">
        <div className="bigpicture-hero-text">
          <div className="bigpicture-title">{selected?.name ?? 'Nothing to show'}</div>
          {selected && (
            <div className="bigpicture-meta">
              <span>{formatPlaytime(selected.playtimeSeconds)}</span>
              {selected.completion && <span>{COMPLETION_LABELS[selected.completion].label}</span>}
              {selected.hltbMainSeconds !== null && (
                <span>To beat {formatDuration(selected.hltbMainSeconds)}</span>
              )}
            </div>
          )}
          {selected && selected.genres.length > 0 && (
            <div className="bigpicture-genres">{selected.genres.slice(0, 4).join(' · ')}</div>
          )}
          {selected && (
            <div className={`bigpicture-play ${runningIds.has(selected.id) ? 'running' : ''}`}>
              {runningIds.has(selected.id) ? 'Running' : '▶  Play'}
            </div>
          )}
        </div>
        {selected && (
          <div className="bigpicture-hero-art" key={`art-${selected.id}`}>
            <CoverImage game={selected} className="cover-img" />
          </div>
        )}
      </div>

      {/* One shelf at a time, with the other rows named above it, so the eye
          has a single line of covers to track instead of four. */}
      <div className="bigpicture-shelf">
        <div className="bigpicture-tabs">
          {rows.map((r, ri) => (
            <span key={r.key} className={`bigpicture-tab ${ri === rowIndex ? 'active' : ''}`}>
              {r.label}
              <span className="bigpicture-tab-count">{r.games.length}</span>
            </span>
          ))}
        </div>
        <div className="bigpicture-row-items">
          {/* Only a window of the row is rendered: "All games" is 544 entries
              and mounting them all would stutter every move. */}
          {row?.games.slice(windowStart, windowStart + COLUMNS * 3).map((g, offset) => {
            const actualIndex = windowStart + offset
            const focused = actualIndex === colIndex
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

      <div className="bigpicture-hints">
        <span>
          <strong>A</strong> / Enter — Play
        </span>
        <span>
          <strong>B</strong> / Esc — Leave
        </span>
        <span>
          <strong>↕</strong> Change shelf
        </span>
        <span>
          <strong>↔</strong> Browse
        </span>
      </div>
    </div>
  )
}
