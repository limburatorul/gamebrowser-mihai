import type { SortKey, ViewMode } from '@shared/types'

interface Props {
  search: string
  onSearchChange: (v: string) => void
  sortKey: SortKey
  onSortChange: (v: SortKey) => void
  viewMode: ViewMode
  onViewModeChange: (v: ViewMode) => void
  onAddGame: () => void
  onScanFolder: () => void
  onImportSteam: () => void
  onImportEpic: () => void
  onImportGog: () => void
  onFetchCovers: () => void
  onCleanNames: () => void
  onOpenSettings: () => void
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
  sortKey,
  onSortChange,
  viewMode,
  onViewModeChange,
  onAddGame,
  onScanFolder,
  onImportSteam,
  onImportEpic,
  onImportGog,
  onFetchCovers,
  onCleanNames,
  onOpenSettings,
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
  return (
    <header className="topbar">
      <div className="topbar-actions">
        <button className="btn btn-primary" onClick={onAddGame} disabled={busy}>
          + Add Game
        </button>
        <button className="btn" onClick={onScanFolder} disabled={busy}>
          Scan Folder
        </button>
        <button
          className="btn"
          onClick={onImportSteam}
          disabled={busy}
          title="Detect and import games already installed through Steam"
        >
          Import Steam
        </button>
        <button
          className="btn"
          onClick={onImportEpic}
          disabled={busy}
          title="Detect and import games already installed through the Epic Games Launcher"
        >
          Import Epic
        </button>
        <button
          className="btn"
          onClick={onImportGog}
          disabled={busy}
          title="Detect and import games already installed through GOG Galaxy"
        >
          Import GOG
        </button>
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

      <input
        className="search-input"
        type="text"
        placeholder="Search library..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      <div className="topbar-controls">
        <select className="select" value={sortKey} onChange={(e) => onSortChange(e.target.value as SortKey)}>
          <option value="name">Name</option>
          <option value="dateAdded">Date Added</option>
          <option value="lastPlayed">Last Played</option>
          <option value="playtime">Playtime</option>
          <option value="rating">Rating</option>
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

        <button className="btn icon-btn" title="Settings" onClick={onOpenSettings}>
          ⚙
        </button>
      </div>
    </header>
  )
}
