import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Game, ViewMode } from '@shared/types'
import CoverImage from './CoverImage'
import { formatDate, formatPlaytime, formatSize } from '../lib/localFile'

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
  /** Keyboard cursor. Reported upward so App can move it, and watched here so
      the virtualiser scrolls it into view - rows that aren't rendered have no
      DOM node to scrollIntoView. */
  activeId: string | null
  onColumnsChange: (columns: number) => void
}

const GRID_GAP = 16
// Reserved height below the cover for title + playtime text, plus the
// tile's own padding/border - must track index.css's .game-tile-title /
// .game-tile-playtime font sizes, or rows start overlapping each other.
const TILE_TITLE_AREA = 56
const LIST_ROW_HEIGHT = 64
// Sits in normal flow above the virtualised rows and sticks to the top of the
// scroll box. The virtualiser is told about it via scrollMargin, or its idea
// of which rows are on screen (and where scrollToIndex lands) is off by this
// much.
const LIST_HEADER_HEIGHT = 34
// .game-scroll's padding-top, which exists so content passes under the
// translucent topbar. The virtualiser measures from the top of the scroll
// box, so it has to be told about it or scrollToIndex parks the selected row
// behind the topbar. Must match index.css.
const TOP_INSET = 68

export default function GameGrid({
  games,
  viewMode,
  tileWidth,
  selectedIds,
  runningIds,
  onItemClick,
  onItemContextMenu,
  onBackgroundClick,
  onLaunch,
  activeId,
  onColumnsChange
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

  const scrollMargin = TOP_INSET + (viewMode === 'list' ? LIST_HEADER_HEIGHT : 0)

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 6,
    scrollMargin
  })

  const virtualRows = rowVirtualizer.getVirtualItems()

  // App needs the column count to move the cursor up/down by a whole row.
  useEffect(() => {
    onColumnsChange(columns)
  }, [columns, onColumnsChange])

  useEffect(() => {
    if (!activeId) return
    const index = games.findIndex((g) => g.id === activeId)
    if (index === -1) return
    rowVirtualizer.scrollToIndex(viewMode === 'grid' ? Math.floor(index / columns) : index, { align: 'auto' })
    // rowVirtualizer is stable enough here; re-running on every render would
    // fight the user's own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, games, columns, viewMode])

  const emptyState = games.length === 0

  // Restarts the entrance animation whenever the visible set actually changes
  // - a new search, filter or sort - by remounting the row container. Cheap
  // (only the ~80 virtualised rows exist) and it is the one reliable way to
  // replay a CSS animation. Deliberately not keyed on the array identity,
  // which changes on every render of App and would re-animate constantly.
  const resultKey = `${games.length}|${games[0]?.id ?? ''}|${games[games.length - 1]?.id ?? ''}`

  return (
    <div className="game-scroll" ref={parentRef} onClick={onBackgroundClick}>
      {emptyState ? (
        <div className="empty-state">
          <p>Your library is empty.</p>
          <p className="empty-state-sub">Add a game manually or scan a folder to get started.</p>
        </div>
      ) : (
        <>
          {/* Reuses the rows' own column classes, so the widths line up by
              construction and the responsive rules that drop columns on a
              narrow window apply to both at once. */}
          {viewMode === 'list' && (
            <div className="list-header" style={{ height: LIST_HEADER_HEIGHT }}>
              <span className="list-row-cover" />
              <span className="list-row-name">Name</span>
              <span className="list-row-genres">Genres</span>
              <span className="list-row-size">Size</span>
              <span className="list-row-date">Last played</span>
              <span className="list-row-playtime">Playtime</span>
            </div>
          )}
          <div
            key={resultKey}
            className="game-results"
            style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}
          >
          {virtualRows.map((virtualRow) => {
            if (viewMode === 'list') {
              const game = games[virtualRow.index]
              return (
                <ListRow
                  key={game.id}
                  game={game}
                  // start is measured from the scroll box, which includes the
                  // sticky header; rows are placed inside the container that
                  // begins below it.
                  top={virtualRow.start - scrollMargin}
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
                  transform: `translateY(${virtualRow.start - scrollMargin}px)`,
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
        </>
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
        {/* Grouped so the size pill and the favourite star can share the top
            right corner without one needing to know the other's width. */}
        <div className="tile-badges-top">
          {game.trainerPath && (
            <span className="trainer-badge" title="A trainer is available for this game">
              ⚡
            </span>
          )}
          {game.favorite && <span className="favorite-badge">★</span>}
          {game.installSizeBytes !== null && (
            <span className="size-badge" title="Size on disk">
              {formatSize(game.installSizeBytes)}
            </span>
          )}
        </div>
        {game.rating !== null && <div className="rating-badge">★ {game.rating}</div>}
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
        {/* The grid puts a play button on the cover at hover; without one here
            the two view modes behaved differently for no reason. */}
        {!running && (
          <button
            className="list-play-btn"
            title="Play"
            onClick={(e) => {
              e.stopPropagation()
              onLaunch(game.id)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
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
      <div className="list-row-name">
        {game.name}
        {game.trainerPath && (
          <span className="trainer-inline" title="A trainer is available for this game">
            ⚡
          </span>
        )}
        {game.favorite && <span className="favorite-inline">★</span>}
        {game.rating !== null && <span className="rating-inline">★ {game.rating}</span>}
      </div>
      {/* A 1920px-wide row used to hold a thumbnail, a name and nothing else
          until the playtime at the far right. These columns are all data the
          library already carries, and they are what makes the list mode worth
          switching to over the grid. */}
      <div className="list-row-genres" title={game.genres.join(', ')}>
        {game.genres.join(', ')}
      </div>
      <div className="list-row-size">{game.installSizeBytes === null ? '' : formatSize(game.installSizeBytes)}</div>
      <div className="list-row-date">{game.lastPlayed ? formatDate(game.lastPlayed) : ''}</div>
      <div className="list-row-playtime">{formatPlaytime(game.playtimeSeconds)}</div>
      {running && <div className="running-badge inline">RUNNING</div>}
    </div>
  )
}
