import { useState } from 'react'
import type { SortKey, ViewMode } from '@shared/types'
import { SteamIcon, EpicIcon, GogIcon, UbisoftIcon } from './icons/PlatformIcons'

interface Props {
  search: string
  onSearchChange: (v: string) => void
  /** So typing anywhere in the window can hand focus to the search box. */
  searchRef?: React.RefObject<HTMLInputElement>
  sortKey: SortKey
  onSortChange: (v: SortKey) => void
  viewMode: ViewMode
  onViewModeChange: (v: ViewMode) => void
  onAddGame: () => void
  onScanFolder: () => void
  onRescanFolders: () => void
  onImportSteam: () => void
  onImportEpic: () => void
  onImportGog: () => void
  onImportUbisoft: () => void
  onFetchCovers: () => void
  onCleanNames: () => void
  onOpenSettings: () => void
  detailsPanelOpen: boolean
  onToggleDetailsPanel: () => void
  tileWidth: number
  onTileWidthChange: (v: number) => void
  genres: string[]
  genreFilter: string
  onGenreFilterChange: (v: string) => void
  tags: string[]
  tagFilter: string
  onTagFilterChange: (v: string) => void
  busy: boolean
}

export default function TopBar({
  search,
  onSearchChange,
  searchRef,
  sortKey,
  onSortChange,
  viewMode,
  onViewModeChange,
  onAddGame,
  onScanFolder,
  onRescanFolders,
  onImportSteam,
  onImportEpic,
  onImportGog,
  onImportUbisoft,
  onFetchCovers,
  onCleanNames,
  onOpenSettings,
  detailsPanelOpen,
  onToggleDetailsPanel,
  tileWidth,
  onTileWidthChange,
  genres,
  genreFilter,
  onGenreFilterChange,
  tags,
  tagFilter,
  onTagFilterChange,
  busy
}: Props): JSX.Element {
  const [importMenuOpen, setImportMenuOpen] = useState(false)

  function runImport(action: () => void): void {
    action()
    setImportMenuOpen(false)
  }

  return (
    <header className="topbar">
      <div className="topbar-actions">
        <button className="btn btn-primary" onClick={onAddGame} disabled={busy}>
          + Add Game
        </button>
        <button className="btn" onClick={onScanFolder} disabled={busy}>
          Scan Folder
        </button>
        <div className="import-menu-wrapper">
          <button className="btn" onClick={() => setImportMenuOpen((v) => !v)} disabled={busy}>
            Import ▾
          </button>
          {importMenuOpen && (
            <>
              <div className="import-menu-overlay" onClick={() => setImportMenuOpen(false)} />
              <div className="import-menu">
                <button className="import-menu-item" onClick={() => runImport(onImportSteam)}>
                  <SteamIcon />
                  <span>Steam</span>
                </button>
                <button className="import-menu-item" onClick={() => runImport(onImportEpic)}>
                  <EpicIcon />
                  <span>Epic Games</span>
                </button>
                <button className="import-menu-item" onClick={() => runImport(onImportGog)}>
                  <GogIcon />
                  <span>GOG</span>
                </button>
                <button className="import-menu-item" onClick={() => runImport(onImportUbisoft)}>
                  <UbisoftIcon />
                  <span>Ubisoft Connect</span>
                </button>
                <div className="import-menu-separator" />
                <button
                  className="import-menu-item"
                  title="Re-check the folders you have scanned before, looking only at what isn't in the library yet"
                  onClick={() => runImport(onRescanFolders)}
                >
                  <span className="import-menu-icon">⟳</span>
                  <span>Rescan Folders</span>
                </button>
              </div>
            </>
          )}
        </div>
        <button
          className="btn"
          onClick={onFetchCovers}
          disabled={busy}
          title="Search online (IGDB and Steam) for covers and genres of games missing them"
        >
          Fetch Covers
        </button>
        <button
          className="btn"
          onClick={onCleanNames}
          disabled={busy}
          title="Strip dots, repack tags, and release-group names from game titles"
        >
          Clean Names
        </button>
      </div>

      {/* The wrapper carries the flex sizing the input used to own, so the
          topbar's layout (and its measured minimum width) is unchanged. */}
      <div className="search-wrap">
        <input
          ref={searchRef}
          className="search-input"
          type="text"
          placeholder="Search library..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && search) {
              e.stopPropagation()
              onSearchChange('')
            }
          }}
        />
        {search && (
          <button className="search-clear" type="button" title="Clear search" onClick={() => onSearchChange('')}>
            ×
          </button>
        )}
      </div>

      <div className="topbar-controls">
        <select className="select" value={sortKey} onChange={(e) => onSortChange(e.target.value as SortKey)}>
          <option value="name">Name</option>
          <option value="dateAdded">Date Added</option>
          <option value="lastPlayed">Last Played</option>
          <option value="playtime">Playtime</option>
          <option value="rating">Rating</option>
          <option value="size">Size on Disk</option>
        </select>

        {genres.length > 0 && (
          <select
            className="select"
            value={genreFilter}
            onChange={(e) => onGenreFilterChange(e.target.value)}
            title="Filter by genre"
          >
            <option value="">All Genres</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}

        {tags.length > 0 && (
          <select
            className="select"
            value={tagFilter}
            onChange={(e) => onTagFilterChange(e.target.value)}
            title="Filter by tag"
          >
            <option value="">All Tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        {viewMode === 'grid' && (
          <div className="tile-size-slider" title="Cover size">
            <span className="tile-size-icon small">🖼</span>
            <input
              type="range"
              min={110}
              max={260}
              step={10}
              value={tileWidth}
              onChange={(e) => onTileWidthChange(Number(e.target.value))}
            />
            <span className="tile-size-icon large">🖼</span>
          </div>
        )}

        <div className="view-toggle">
          <button
            className={viewMode === 'grid' ? 'active' : ''}
            title="Grid view"
            onClick={() => onViewModeChange('grid')}
          >
            ▦
          </button>
          <button
            className={viewMode === 'list' ? 'active' : ''}
            title="List view"
            onClick={() => onViewModeChange('list')}
          >
            ☰
          </button>
        </div>

        <button
          className={`btn icon-btn ${detailsPanelOpen ? 'active' : ''}`}
          title="Game Details Panel"
          onClick={onToggleDetailsPanel}
        >
          ⓘ
        </button>

        <button className="btn icon-btn" title="Settings" onClick={onOpenSettings}>
          ⚙
        </button>
      </div>
    </header>
  )
}
