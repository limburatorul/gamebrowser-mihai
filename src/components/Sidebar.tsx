import { useState } from 'react'
import type { Category } from '@shared/types'
import { formatPlaytime } from '../lib/localFile'
import type { RecentSource } from '../lib/uiPrefs'
import { SteamIcon, EpicIcon, GogIcon, UbisoftIcon } from './icons/PlatformIcons'
import ConfirmDialog from './ConfirmDialog'

export type LibraryFilter =
  | 'all'
  | 'favorites'
  | 'recent'
  | 'never-played'
  | 'has-trainer'
  | 'no-cover'
  | 'steam'
  | 'epic'
  | 'gog'
  | 'ubisoft'
  | `category:${string}`

export interface PlaytimeEntry {
  id: string
  name: string
  playtimeSeconds: number
}

interface Props {
  filter: LibraryFilter
  onFilterChange: (filter: LibraryFilter) => void
  totalCount: number
  favoriteCount: number
  neverPlayedCount: number
  hasTrainerCount: number
  noCoverCount: number
  steamCount: number
  epicCount: number
  gogCount: number
  ubisoftCount: number
  categories: Category[]
  categoryCounts: Record<string, number>
  totalPlaytimeSeconds: number
  playtimeEntries: PlaytimeEntry[]
  selectedIds: Set<string>
  onSelectGame: (id: string) => void
  onOpenAbout: () => void
  onOpenDashboard: () => void
  onOpenWhatToPlay: () => void
  recentSource: RecentSource
  onRecentSourceChange: (source: RecentSource) => void
}

const ITEMS: { key: LibraryFilter; label: string; icon: JSX.Element | string }[] = [
  { key: 'all', label: 'All Games', icon: '▦' },
  { key: 'recent', label: 'Recently Played', icon: '⏱' },
  { key: 'never-played', label: 'Never Played', icon: '◌' },
  { key: 'has-trainer', label: 'Has Trainer', icon: '⚡' },
  { key: 'favorites', label: 'Favorites', icon: '★' },
  { key: 'no-cover', label: 'Missing Cover', icon: '🖼' },
  { key: 'steam', label: 'Steam', icon: <SteamIcon /> },
  { key: 'epic', label: 'Epic', icon: <EpicIcon /> },
  { key: 'gog', label: 'GOG', icon: <GogIcon /> },
  { key: 'ubisoft', label: 'Ubisoft', icon: <UbisoftIcon /> }
]

export default function Sidebar({
  filter,
  onFilterChange,
  totalCount,
  favoriteCount,
  neverPlayedCount,
  hasTrainerCount,
  noCoverCount,
  steamCount,
  epicCount,
  gogCount,
  ubisoftCount,
  categories,
  categoryCounts,
  totalPlaytimeSeconds,
  playtimeEntries,
  selectedIds,
  onSelectGame,
  onOpenAbout,
  onOpenDashboard,
  onOpenWhatToPlay,
  recentSource,
  onRecentSourceChange
}: Props): JSX.Element {
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null)
  const [busy, setBusy] = useState(false)

  function countFor(key: LibraryFilter): number | '' {
    if (key === 'all') return totalCount
    if (key === 'favorites') return favoriteCount
    if (key === 'never-played') return neverPlayedCount
    if (key === 'has-trainer') return hasTrainerCount
    if (key === 'no-cover') return noCoverCount
    if (key === 'steam') return steamCount
    if (key === 'epic') return epicCount
    if (key === 'gog') return gogCount
    if (key === 'ubisoft') return ubisoftCount
    return ''
  }

  async function handleAddCategory(): Promise<void> {
    if (busy) return
    const name = newCategoryName.trim()
    if (!name) {
      setAddingCategory(false)
      return
    }
    setBusy(true)
    try {
      const category = await window.api.createCategory(name)
      onFilterChange(`category:${category.id}`)
    } finally {
      setBusy(false)
      setAddingCategory(false)
      setNewCategoryName('')
    }
  }

  function startRename(category: Category): void {
    setRenamingId(category.id)
    setRenameText(category.name)
  }

  async function handleRename(): Promise<void> {
    if (busy) return
    const name = renameText.trim()
    if (!renamingId || !name) {
      setRenamingId(null)
      return
    }
    setBusy(true)
    try {
      await window.api.renameCategory(renamingId, name)
    } finally {
      setBusy(false)
      setRenamingId(null)
    }
  }

  async function handleDeleteCategory(): Promise<void> {
    if (!deletingCategory) return
    setBusy(true)
    try {
      await window.api.deleteCategory(deletingCategory.id)
      if (filter === `category:${deletingCategory.id}`) onFilterChange('all')
    } finally {
      setBusy(false)
      setDeletingCategory(null)
    }
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">Game Browser</div>
      <ul className="sidebar-list">
        {/* Above the filters: it is an action, not a way of narrowing the
            library, and it is the one thing here you reach for deliberately. */}
        <li>
          <button
            className="sidebar-item"
            title="Suggests something from your unplayed games, based on the genres you actually spend time on"
            onClick={onOpenWhatToPlay}
          >
            <span className="sidebar-icon" data-key="what-to-play">
              🎲
            </span>
            <span>What to Play</span>
            <span className="sidebar-count"></span>
          </button>
        </li>
        <li className="sidebar-divider" aria-hidden="true" />
        {ITEMS.map((item) => (
          <li key={item.key}>
            <button
              className={`sidebar-item ${filter === item.key ? 'active' : ''}`}
              onClick={() => onFilterChange(item.key)}
            >
              {/* data-key so each filter's glyph can carry its own colour.
                  The platform entries render an SVG and ignore it, and the
                  couple of glyphs Windows draws as colour emoji keep their
                  own palette either way. */}
              <span className="sidebar-icon" data-key={item.key}>
                {item.icon}
              </span>
              <span>{item.label}</span>
              <span className="sidebar-count">{countFor(item.key)}</span>
            </button>
            {/* Only while that filter is the active one - a permanent pair of
                sub-items would be clutter for a choice most people set once. */}
            {item.key === 'recent' && filter === 'recent' && (
              <div className="sidebar-subchoice">
                <button
                  className={recentSource === 'everywhere' ? 'active' : ''}
                  title="Anything played recently, including sessions Steam recorded outside this app"
                  onClick={() => onRecentSourceChange('everywhere')}
                >
                  Everywhere
                </button>
                <button
                  className={recentSource === 'here' ? 'active' : ''}
                  title="Only games you started from Game Browser"
                  onClick={() => onRecentSourceChange('here')}
                >
                  From here
                </button>
              </div>
            )}
          </li>
        ))}
        <li>
          <button className="sidebar-item" onClick={onOpenDashboard}>
            <span className="sidebar-icon">▤</span>
            <span>Dashboard</span>
            <span className="sidebar-count"></span>
          </button>
        </li>
        <li>
          <button className="sidebar-item" onClick={onOpenAbout}>
            <span className="sidebar-icon">ⓘ</span>
            <span>About</span>
            <span className="sidebar-count"></span>
          </button>
        </li>
      </ul>

      <div className="sidebar-section-title">Categories</div>
      <ul className="sidebar-list">
        {categories.map((category) => {
          const key: LibraryFilter = `category:${category.id}`
          return (
            <li key={category.id} className="sidebar-category-row">
              {renamingId === category.id ? (
                <input
                  className="sidebar-category-input"
                  autoFocus
                  value={renameText}
                  disabled={busy}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => void handleRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                />
              ) : (
                <button
                  className={`sidebar-item ${filter === key ? 'active' : ''}`}
                  onClick={() => onFilterChange(key)}
                >
                  <span className="sidebar-icon">▸</span>
                  <span>{category.name}</span>
                  <span className="sidebar-count">{categoryCounts[category.id] ?? 0}</span>
                </button>
              )}
              {renamingId !== category.id && (
                <span className="sidebar-category-actions">
                  <button
                    className="sidebar-category-action"
                    title="Rename"
                    onClick={() => startRename(category)}
                  >
                    ✎
                  </button>
                  <button
                    className="sidebar-category-action"
                    title="Delete"
                    onClick={() => setDeletingCategory(category)}
                  >
                    🗑
                  </button>
                </span>
              )}
            </li>
          )
        })}
        <li>
          {addingCategory ? (
            <input
              className="sidebar-category-input"
              autoFocus
              placeholder="Category name…"
              value={newCategoryName}
              disabled={busy}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onBlur={() => void handleAddCategory()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAddCategory()
                if (e.key === 'Escape') {
                  setAddingCategory(false)
                  setNewCategoryName('')
                }
              }}
            />
          ) : (
            <button className="sidebar-item sidebar-add-category" onClick={() => setAddingCategory(true)}>
              <span className="sidebar-icon">+</span>
              <span>New Category</span>
            </button>
          )}
        </li>
      </ul>

      {deletingCategory && (
        <ConfirmDialog
          title="Delete Category"
          message={`Delete "${deletingCategory.name}"? Games stay in your library — only the category itself is removed.`}
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => setDeletingCategory(null)}
          onConfirm={() => void handleDeleteCategory()}
        />
      )}

      {playtimeEntries.length > 0 && (
        <>
          <div className="sidebar-section-title">Playtime</div>
          <ul className="sidebar-playtime-list">
            {playtimeEntries.map((entry) => {
              const max = playtimeEntries[0].playtimeSeconds
              const pct = Math.max(3, Math.round((entry.playtimeSeconds / max) * 100))
              return (
                <li key={entry.id}>
                  <button
                    className={`sidebar-playtime-item ${selectedIds.has(entry.id) ? 'active' : ''}`}
                    title={entry.name}
                    onClick={() => onSelectGame(entry.id)}
                  >
                    <span className="sidebar-playtime-row">
                      <span className="sidebar-playtime-name">{entry.name}</span>
                      <span className="sidebar-playtime-value">{formatPlaytime(entry.playtimeSeconds)}</span>
                    </span>
                    <span className="sidebar-playtime-track">
                      <span className="sidebar-playtime-bar" style={{ width: `${pct}%` }} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <div className="sidebar-footer">
        <span className="sidebar-footer-label">Total Playtime</span>
        <span className="sidebar-footer-value">{formatPlaytime(totalPlaytimeSeconds)}</span>
      </div>
    </nav>
  )
}
