import { useMemo } from 'react'
import type { Game } from '@shared/types'
import { formatPlaytime } from '../lib/localFile'

interface Props {
  games: Game[]
  onClose: () => void
}

interface BarRow {
  label: string
  value: number
  display: string
}

function BarList({ rows }: { rows: BarRow[] }): JSX.Element {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="dashboard-bar-list">
      {rows.map((row) => (
        <li key={row.label} className="dashboard-bar-row">
          <span className="dashboard-bar-label" title={row.label}>
            {row.label}
          </span>
          <span className="dashboard-bar-track">
            <span
              className="dashboard-bar-fill"
              style={{ width: `${Math.max(3, Math.round((row.value / max) * 100))}%` }}
            />
          </span>
          <span className="dashboard-bar-value">{row.display}</span>
        </li>
      ))}
    </ul>
  )
}

const SOURCE_LABELS: Record<Game['source'], string> = {
  manual: 'Added manually',
  'folder-scan': 'Folder scan',
  steam: 'Steam import',
  epic: 'Epic import',
  gog: 'GOG import'
}

export default function DashboardDialog({ games, onClose }: Props): JSX.Element {
  const sourceRows = useMemo<BarRow[]>(() => {
    const counts = new Map<string, number>()
    for (const g of games) counts.set(g.source, (counts.get(g.source) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({
        label: SOURCE_LABELS[source as Game['source']] ?? source,
        value: count,
        display: String(count)
      }))
  }, [games])

  const genresByCount = useMemo<BarRow[]>(() => {
    const counts = new Map<string, number>()
    for (const g of games) for (const genre of g.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([genre, count]) => ({ label: genre, value: count, display: String(count) }))
  }, [games])

  const genresByPlaytime = useMemo<BarRow[]>(() => {
    const totals = new Map<string, number>()
    for (const g of games) for (const genre of g.genres) totals.set(genre, (totals.get(genre) ?? 0) + g.playtimeSeconds)
    return [...totals.entries()]
      .filter(([, secs]) => secs > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([genre, secs]) => ({ label: genre, value: secs, display: formatPlaytime(secs) }))
  }, [games])

  const totalPlaytimeSeconds = useMemo(() => games.reduce((sum, g) => sum + g.playtimeSeconds, 0), [games])
  const withCover = games.filter((g) => g.coverPath).length
  const played = games.filter((g) => g.playtimeSeconds > 0).length

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal dashboard-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Dashboard</h2>

        <div className="about-stats dashboard-totals">
          <div className="about-stat">
            <span className="about-stat-value">{games.length}</span>
            <span className="about-stat-label">games in library</span>
          </div>
          <div className="about-stat">
            <span className="about-stat-value">{formatPlaytime(totalPlaytimeSeconds)}</span>
            <span className="about-stat-label">total playtime</span>
          </div>
          <div className="about-stat">
            <span className="about-stat-value">{played}</span>
            <span className="about-stat-label">games played</span>
          </div>
          <div className="about-stat">
            <span className="about-stat-value">{withCover}</span>
            <span className="about-stat-label">have a cover</span>
          </div>
        </div>

        <h3 className="settings-section">By Source</h3>
        {sourceRows.length > 0 ? <BarList rows={sourceRows} /> : <p className="settings-note">No games yet.</p>}

        <h3 className="settings-section">Top Genres (by game count)</h3>
        {genresByCount.length > 0 ? (
          <BarList rows={genresByCount} />
        ) : (
          <p className="settings-note">No genres recorded yet — try Fetch Covers.</p>
        )}

        <h3 className="settings-section">Top Genres (by playtime)</h3>
        {genresByPlaytime.length > 0 ? (
          <BarList rows={genresByPlaytime} />
        ) : (
          <p className="settings-note">No playtime recorded yet.</p>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
