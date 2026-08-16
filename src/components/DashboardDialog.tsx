import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DriveUsage, DuplicateGroup, Game, MissingScanResult } from '@shared/types'
import { formatPlaytime, formatSize } from '../lib/localFile'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  games: Game[]
  onClose: () => void
}

/**
 * One drive as a single stacked bar: the part your games take, the part
 * everything else takes, and what's left. Seeing games against the whole
 * volume is the point - a games folder is rarely the only thing on the disk.
 */
function DriveRow({ drive }: { drive: DriveUsage }): JSX.Element {
  const offline = drive.totalBytes === null || drive.freeBytes === null
  const total = drive.totalBytes ?? 0
  const used = offline ? 0 : total - (drive.freeBytes ?? 0)
  const pct = (bytes: number): number => (total > 0 ? (bytes / total) * 100 : 0)
  // Games can't exceed what the volume reports as used, but sizes are measured
  // at different times than free space is read, so clamp rather than overflow.
  const gamesPct = Math.min(pct(drive.gameBytes), pct(used))
  const otherPct = Math.max(0, pct(used) - gamesPct)

  return (
    <li className="drive-row">
      <div className="drive-head">
        <span className="drive-name">
          {drive.root}
          {drive.driveType === 'Network' && <span className="drive-type"> network</span>}
        </span>
        <span className="drive-summary">
          {offline
            ? 'Capacity unavailable'
            : `${formatSize(drive.freeBytes)} free of ${formatSize(drive.totalBytes)}`}
        </span>
      </div>
      {!offline && (
        <span className="drive-track">
          <span className="drive-fill drive-fill-games" style={{ width: `${gamesPct}%` }} />
          <span className="drive-fill drive-fill-other" style={{ width: `${otherPct}%` }} />
        </span>
      )}
      <div className="drive-meta">
        <span>
          {drive.gameCount} {drive.gameCount === 1 ? 'game' : 'games'} ·{' '}
          {/* "0 KB" would read as "these games take no room" rather than
              "the background sweep hasn't got to them yet". */}
          {drive.gameBytes === 0 && drive.unmeasured > 0
            ? 'size not measured yet'
            : `${formatSize(drive.gameBytes)}${
                drive.unmeasured > 0 ? ` (${drive.unmeasured} not measured yet)` : ''
              }`}
        </span>
        {drive.neverPlayedBytes > 0 && (
          <span className="drive-unplayed">{formatSize(drive.neverPlayedBytes)} never played</span>
        )}
      </div>
    </li>
  )
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
      {rows.map((row, i) => (
        <li key={row.label} className="dashboard-bar-row">
          <span className="dashboard-bar-label" title={row.label}>
            {row.label}
          </span>
          <span className="dashboard-bar-track">
            <span
              className="dashboard-bar-fill"
              style={{
                width: `${Math.max(3, Math.round((row.value / max) * 100))}%`,
                // Each rank a shade fainter than the one above it. Every bar
                // being the same flat accent made the lists read as one solid
                // block; fading by position gives the ranking some depth
                // without inventing colours the user's accent doesn't have.
                opacity: Math.max(0.42, 1 - i * 0.11)
              }}
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
  gog: 'GOG import',
  ubisoft: 'Ubisoft import'
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

  // Only the playtime-based stats honour the "ignore playtime" flag - the
  // count breakdowns above still cover the whole library, since a game being
  // excluded from playtime doesn't make it stop existing.
  const countedForPlaytime = useMemo(() => games.filter((g) => !g.excludeFromPlaytime), [games])

  const genresByPlaytime = useMemo<BarRow[]>(() => {
    const totals = new Map<string, number>()
    for (const g of countedForPlaytime)
      for (const genre of g.genres) totals.set(genre, (totals.get(genre) ?? 0) + g.playtimeSeconds)
    return [...totals.entries()]
      .filter(([, secs]) => secs > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([genre, secs]) => ({ label: genre, value: secs, display: formatPlaytime(secs) }))
  }, [countedForPlaytime])

  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([])
  useEffect(() => {
    void window.api.getDuplicateGroups().then(setDuplicates)
  }, [games])

  const [drives, setDrives] = useState<DriveUsage[]>([])
  useEffect(() => {
    void window.api.getDriveUsage().then(setDrives)
  }, [games])

  // The missing-file scan touches the disk once per game, so it runs on demand
  // rather than every time the dashboard opens.
  const [missing, setMissing] = useState<MissingScanResult | null>(null)
  const [scanningMissing, setScanningMissing] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [removing, setRemoving] = useState(false)

  const runMissingScan = useCallback(async (): Promise<void> => {
    setScanningMissing(true)
    try {
      setMissing(await window.api.scanMissingGames())
    } finally {
      setScanningMissing(false)
    }
  }, [])

  const removeMissing = useCallback(async (): Promise<void> => {
    if (!missing) return
    setRemoving(true)
    try {
      await window.api.removeMany(missing.entries.map((e) => e.id))
      setConfirmingRemoval(false)
      // Rescan rather than clearing the list: the library the user is looking
      // at has just changed underneath it.
      await runMissingScan()
    } finally {
      setRemoving(false)
    }
  }, [missing, runMissingScan])
  const totalReclaimable = useMemo(
    () => duplicates.reduce((sum, g) => sum + (g.reclaimableBytes ?? 0), 0),
    [duplicates]
  )

  const measured = useMemo(() => games.filter((g) => g.installSizeBytes !== null), [games])
  const totalSizeBytes = useMemo(() => measured.reduce((sum, g) => sum + (g.installSizeBytes ?? 0), 0), [measured])

  const biggestGames = useMemo<BarRow[]>(
    () =>
      [...measured]
        .sort((a, b) => (b.installSizeBytes ?? 0) - (a.installSizeBytes ?? 0))
        .slice(0, 6)
        .map((g) => ({ label: g.name, value: g.installSizeBytes ?? 0, display: formatSize(g.installSizeBytes) })),
    [measured]
  )

  // The point of measuring sizes at all: disk taken up by things never played.
  const biggestUnplayed = useMemo<BarRow[]>(
    () =>
      measured
        .filter((g) => g.playtimeSeconds === 0)
        .sort((a, b) => (b.installSizeBytes ?? 0) - (a.installSizeBytes ?? 0))
        .slice(0, 6)
        .map((g) => ({ label: g.name, value: g.installSizeBytes ?? 0, display: formatSize(g.installSizeBytes) })),
    [measured]
  )

  const unplayedSizeBytes = useMemo(
    () => measured.filter((g) => g.playtimeSeconds === 0).reduce((sum, g) => sum + (g.installSizeBytes ?? 0), 0),
    [measured]
  )

  const totalPlaytimeSeconds = useMemo(
    () => countedForPlaytime.reduce((sum, g) => sum + g.playtimeSeconds, 0),
    [countedForPlaytime]
  )
  const withCover = games.filter((g) => g.coverPath).length
  const played = countedForPlaytime.filter((g) => g.playtimeSeconds > 0).length

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
          <div className="about-stat">
            <span className="about-stat-value">{formatSize(totalSizeBytes)}</span>
            <span className="about-stat-label">
              on disk{measured.length < games.length ? ` (${measured.length} of ${games.length} measured)` : ''}
            </span>
          </div>
          <div className="about-stat">
            <span className="about-stat-value">{formatSize(unplayedSizeBytes)}</span>
            <span className="about-stat-label">never played</span>
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

        <h3 className="settings-section">Storage by Drive</h3>
        {drives.length > 0 ? (
          <ul className="drive-list">
            {drives.map((drive) => (
              <DriveRow key={drive.root} drive={drive} />
            ))}
          </ul>
        ) : (
          <p className="settings-note">No games with an install folder yet.</p>
        )}

        <h3 className="settings-section">Biggest on Disk</h3>
        {biggestGames.length > 0 ? (
          <BarList rows={biggestGames} />
        ) : (
          <p className="settings-note">
            Sizes are still being measured in the background — it takes a while on a large library.
          </p>
        )}

        <h3 className="settings-section">Installed in More Than One Place</h3>
        {duplicates.length > 0 ? (
          <>
            <p className="settings-note">
              Same title, different folders. Nothing is removed automatically — the paths are here so you can decide
              which copy to keep.
              {totalReclaimable > 0 && ` Dropping the smaller copies would free about ${formatSize(totalReclaimable)}.`}
            </p>
            <ul className="dupe-list">
              {duplicates.map((group) => (
                <li key={group.name} className="dupe-group">
                  <div className="dupe-name">{group.name}</div>
                  {group.copies.map((copy) => (
                    <div key={copy.id} className="dupe-copy">
                      <span className="dupe-path" title={copy.installDir}>
                        {copy.installDir}
                      </span>
                      <span className="dupe-size">
                        {copy.source} · {copy.sizeBytes === null ? 'not measured' : formatSize(copy.sizeBytes)}
                      </span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="settings-note">No game appears in two different folders.</p>
        )}

        <h3 className="settings-section">Biggest Never Played</h3>
        {biggestUnplayed.length > 0 ? (
          <BarList rows={biggestUnplayed} />
        ) : (
          <p className="settings-note">Nothing measured yet, or everything measured has been played.</p>
        )}

        <h3 className="settings-section">Missing Files</h3>
        <p className="settings-note">
          Checks that every game's executable is still on disk. Deleting a game outside this app leaves its entry
          behind, where it looks fine until you press Play.
        </p>
        <button className="btn" onClick={() => void runMissingScan()} disabled={scanningMissing}>
          {scanningMissing ? 'Checking…' : 'Check Now'}
        </button>
        {missing && (
          <div className="missing-result">
            {missing.error && <p className="settings-note backup-list-error">{missing.error}</p>}
            {missing.offlineRoots.length > 0 && (
              <p className="settings-note">
                Skipped {missing.offlineRoots.join(', ')} — not available right now, so games there were left alone.
              </p>
            )}
            {missing.entries.length === 0 ? (
              <p className="settings-note">All {missing.checked} games checked are still where they should be.</p>
            ) : (
              <>
                <p className="settings-note">
                  {missing.entries.length} of {missing.checked} games no longer have their executable on disk.
                </p>
                <ul className="missing-list">
                  {missing.entries.map((entry) => (
                    <li key={entry.id} className="missing-entry">
                      <div className="missing-name">{entry.name}</div>
                      <span className="missing-path" title={entry.exePath}>
                        {entry.exePath}
                      </span>
                      <span className="missing-tag">
                        {entry.source} · {entry.folderMissing ? 'folder gone' : 'folder still there'}
                      </span>
                    </li>
                  ))}
                </ul>
                <button className="btn btn-danger" onClick={() => setConfirmingRemoval(true)}>
                  Remove {missing.entries.length} {missing.entries.length === 1 ? 'entry' : 'entries'} from library
                </button>
              </>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>

        {confirmingRemoval && missing && (
          <ConfirmDialog
            title="Remove missing entries?"
            message={`This removes ${missing.entries.length} ${
              missing.entries.length === 1 ? 'entry' : 'entries'
            } from the library, along with their ratings, tags and playtime. Nothing is deleted from disk — those files are already gone.`}
            confirmLabel="Remove"
            danger
            busy={removing}
            onCancel={() => setConfirmingRemoval(false)}
            onConfirm={() => void removeMissing()}
          />
        )}
      </div>
    </div>
  )
}
