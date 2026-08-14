import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/types'
import { formatPlaytime } from '../lib/localFile'

interface Props {
  gameCount: number
  totalPlaytimeSeconds: number
  onClose: () => void
  onCheckForUpdate: () => void
  checkingForUpdate: boolean
  onViewChangelog: () => void
}

export default function AboutDialog({
  gameCount,
  totalPlaytimeSeconds,
  onClose,
  onCheckForUpdate,
  checkingForUpdate,
  onViewChangelog
}: Props): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    window.api.getAppInfo().then(setInfo)
  }, [])

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal modal-small about-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="about-header">
          <div className="about-title">Game Browser</div>
          <div className="about-version">v{info?.version ?? '…'}</div>
        </div>

        <p className="about-credit">
          Made by <strong>The Protagonist</strong> · 2026
        </p>
        <p className="about-dedication">for Mihai 🫡</p>

        <div className="about-stats">
          <div className="about-stat">
            <span className="about-stat-value">{gameCount}</span>
            <span className="about-stat-label">games in library</span>
          </div>
          <div className="about-stat">
            <span className="about-stat-value">{formatPlaytime(totalPlaytimeSeconds)}</span>
            <span className="about-stat-label">total playtime</span>
          </div>
        </div>

        <p className="about-details">
          Covers and genres from IGDB, Steam, and RAWG. Built with Electron {info?.electronVersion ?? '…'} + React.
        </p>

        <p className="about-data-path" title={info?.dataPath ?? ''}>
          Your data: {info?.dataPath ?? '…'}
        </p>

        <div className="modal-actions">
          <button className="btn" onClick={onCheckForUpdate} disabled={checkingForUpdate}>
            {checkingForUpdate ? 'Checking…' : 'Check for Updates'}
          </button>
          <button className="btn" onClick={onViewChangelog}>
            View Changelog
          </button>
          <button className="btn" onClick={() => void window.api.openDataFolder()}>
            Open Data Folder
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
