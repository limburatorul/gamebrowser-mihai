import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Game, ViewMode } from '@shared/types'
import CoverImage from './CoverImage'
import { formatPlaytime } from '../lib/localFile'

interface Props {
  games: Game[]
  viewMode: ViewMode
  tileWidth: number
  selectedIds: Set<string>
  runningIds: Set<string>
  onItemClick: (id: string, event: React.MouseEvent) => void
  onItemContextMenu: (id: string, event: React.MouseEvent) => void
  onBackgroundClick: () => void
  onLaunch: (id: string) => void
}

const GRID_GAP = 16
const TILE_TITLE_AREA = 34
const LIST_ROW_HEIGHT = 64

export default function GameGrid({
  games,
  viewMode,
  tileWidth,
  selectedIds,
  runningIds,
  onItemClick,
  onItemContextMenu,
  onBackgroundClick,
  onLaunch
}: Props): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const columns = viewMode === 'grid' ? Math.max(1, Math.floor((width + GRID_GAP) / (tileWidth + GRID_GAP))) : 1
  const rowCount = viewMode === 'grid' ? Math.ceil(games.length / columns) : games.length
  const rowHeight =
    viewMode === 'grid' ? Math.round(tileWidth * 1.4) + TILE_TITLE_AREA + GRID_GAP : LIST_ROW_HEIGHT

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 6
  })

  const virtualRows = rowVirtualizer.getVirtualItems()

  const emptyState = games.length === 0

  return (
    <div className="game-scroll" ref={parentRef} onClick={onBackgroundClick}>
      {emptyState ? (
        <div className="empty-state">
          <p>Your library is empty.</p>
          <p className="empty-state-sub">Add a game manually or scan a folder to get started.</p>
        </div>
      ) : (
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {virtualRows.map((virtualRow) => {
            if (viewMode === 'list') {
              const game = games[virtualRow.index]
              return (
                <ListRow
                  key={game.id}
                  game={game}
                  top={virtualRow.start}
                  selected={selectedIds.has(game.id)}
                  running={runningIds.has(game.id)}
                  onItemClick={onItemClick}
                  onItemContextMenu={onItemContextMenu}
                  onLaunch={onLaunch}
                />
              )
            }
            const start = virtualRow.index * columns
            const rowGames = games.slice(start, start + columns)
            return (
              <div
                key={virtualRow.key}
                className="grid-row"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                  gap: GRID_GAP
                }}
              >
                {rowGames.map((game) => (
                  <GameTile
                    key={game.id}
                    game={game}
                    tileWidth={tileWidth}
                    selected={selectedIds.has(game.id)}
                    running={runningIds.has(game.id)}
                    onItemClick={onItemClick}
                    onItemContextMenu={onItemContextMenu}
                    onLaunch={onLaunch}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function GameTile({
  game,
  tileWidth,
  selected,
  running,
  onItemClick,
  onItemContextMenu,
  onLaunch
}: {
  game: Game
  tileWidth: number
  selected: boolean
  running: boolean
  onItemClick: (id: string, event: React.MouseEvent) => void
  onItemContextMenu: (id: string, event: React.MouseEvent) => void
  onLaunch: (id: string) => void
}): JSX.Element {
  return (
    <div
      className={`game-tile ${selected ? 'selected' : ''}`}
      style={{ width: tileWidth }}
      onClick={(e) => {
        e.stopPropagation()
        onItemClick(game.id, e)
      }}
      onDoubleClick={() => onLaunch(game.id)}
      onContextMenu={(e) => onItemContextMenu(game.id, e)}
    >
      <div className="game-tile-cover" style={{ height: Math.round(tileWidth * 1.4) }}>
        <CoverImage game={game} className="cover-img" />
        {running && <div className="running-badge">RUNNING</div>}
        {game.favorite && <div className="favorite-badge">★</div>}
        {!running && (
          <button
            className="tile-play-btn"
            title="Play"
            onClick={(e) => {
              e.stopPropagation()
              onLaunch(game.id)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <polygon
                points="7.2,6 17.8,12 7.2,18"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      <div className="game-tile-title">{game.name}</div>
      <div className="game-tile-playtime">{formatPlaytime(game.playtimeSeconds)}</div>
    </div>
  )
}

function ListRow({
  game,
  top,
  selected,
  running,
  onItemClick,
  onItemContextMenu,
  onLaunch
}: {
  game: Game
  top: number
  selected: boolean
  running: boolean
  onItemClick: (id: string, event: React.MouseEvent) => void
  onItemContextMenu: (id: string, event: React.MouseEvent) => void
  onLaunch: (id: string) => void
}): JSX.Element {
  return (
    <div
      className={`list-row ${selected ? 'selected' : ''}`}
      style={{ position: 'absolute', top, left: 0, width: '100%', height: LIST_ROW_HEIGHT }}
      onClick={(e) => {
        e.stopPropagation()
        onItemClick(game.id, e)
      }}
      onDoubleClick={() => onLaunch(game.id)}
      onContextMenu={(e) => onItemContextMenu(game.id, e)}
    >
      <div className="list-row-cover">
        <CoverImage game={game} className="cover-img" />
      </div>
      <div className="list-row-name">
        {game.name}
        {game.favorite && <span className="favorite-inline">★</span>}
      </div>
      <div className="list-row-playtime">{formatPlaytime(game.playtimeSeconds)}</div>
      {running && <div className="running-badge inline">RUNNING</div>}
    </div>
  )
}
