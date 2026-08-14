import { formatPlaytime } from '../lib/localFile'
import { SteamIcon, EpicIcon, GogIcon } from './icons/PlatformIcons'

export type LibraryFilter = 'all' | 'favorites' | 'recent' | 'no-cover' | 'steam' | 'epic' | 'gog'

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
  noCoverCount: number
  steamCount: number
  epicCount: number
  gogCount: number
  totalPlaytimeSeconds: number
  playtimeEntries: PlaytimeEntry[]
  selectedIds: Set<string>
  onSelectGame: (id: string) => void
  onOpenAbout: () => void
  onOpenDashboard: () => void
}

const ITEMS: { key: LibraryFilter; label: string; icon: JSX.Element | string }[] = [
  { key: 'all', label: 'All Games', icon: '▦' },
  { key: 'recent', label: 'Recently Played', icon: '⏱' },
  { key: 'favorites', label: 'Favorites', icon: '★' },
  { key: 'no-cover', label: 'Missing Cover', icon: '🖼' },
  { key: 'steam', label: 'Steam', icon: <SteamIcon /> },
  { key: 'epic', label: 'Epic', icon: <EpicIcon /> },
  { key: 'gog', label: 'GOG', icon: <GogIcon /> }
]

export default function Sidebar({
  filter,
  onFilterChange,
  totalCount,
  favoriteCount,
  noCoverCount,
  steamCount,
  epicCount,
  gogCount,
  totalPlaytimeSeconds,
  playtimeEntries,
  selectedIds,
  onSelectGame,
  onOpenAbout,
  onOpenDashboard
}: Props): JSX.Element {
  function countFor(key: LibraryFilter): number | '' {
    if (key === 'all') return totalCount
    if (key === 'favorites') return favoriteCount
    if (key === 'no-cover') return noCoverCount
    if (key === 'steam') return steamCount
    if (key === 'epic') return epicCount
    if (key === 'gog') return gogCount
    return ''
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">Game Browser</div>
      <ul className="sidebar-list">
        {ITEMS.map((item) => (
          <li key={item.key}>
            <button
              className={`sidebar-item ${filter === item.key ? 'active' : ''}`}
              onClick={() => onFilterChange(item.key)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span>{item.label}</span>
              <span className="sidebar-count">{countFor(item.key)}</span>
            </button>
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
