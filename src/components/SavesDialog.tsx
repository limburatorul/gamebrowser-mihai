import { useCallback, useEffect, useState } from 'react'
import type { Game, SaveLocationsResult } from '@shared/types'
import { formatDate, formatSize } from '../lib/localFile'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  game: Game
  onClose: () => void
}

/**
 * Backing up and restoring one game's saves.
 *
 * Save folders are the one thing in a library that cannot be re-fetched —
 * covers, genres and screenshots all come back on their own. That matters more
 * since Reclaim Space started deleting game folders.
 */
export default function SavesDialog({ game, onClose }: Props): JSX.Element {
  const [info, setInfo] = useState<SaveLocationsResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setInfo(await window.api.getSaveLocations(game.id))
  }, [game.id])

  useEffect(() => {
    void load()
  }, [load])

  async function backup(): Promise<void> {
    setBusy('Backing up…')
    setMessage(null)
    try {
      const r = await window.api.backupSaves(game.id)
      setMessage(r.ok ? `Backed up ${r.locations?.length ?? 0} location(s).` : (r.error ?? 'Backup failed.'))
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function restore(zipPath: string): Promise<void> {
    setConfirmRestore(null)
    setBusy('Restoring…')
    setMessage(null)
    try {
      const r = await window.api.restoreSaves(game.id, zipPath)
      setMessage(r.ok ? `Restored to ${r.locations?.length ?? 0} location(s).` : (r.error ?? 'Restore failed.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal modal-small" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Saves — {game.name}</h2>

        {info === null && <p className="settings-note">Looking up where this game keeps its saves…</p>}

        {info && !info.known && (
          <p className="settings-note">
            {info.error ??
              'No save location is known for this game. The list comes from the Ludusavi manifest, built from PCGamingWiki — if this game is missing there, adding it upstream makes it work for everyone.'}
          </p>
        )}

        {info?.known && info.paths.length === 0 && (
          <p className="settings-note">
            A save location is known, but nothing exists on disk yet — the game may not have been played.
          </p>
        )}

        {info?.known && info.paths.length > 0 && (
          <>
            <label className="settings-label">Save folders</label>
            <div className="session-list">
              {info.paths.map((p) => (
                <div key={p} className="save-path" title={p}>
                  {p}
                </div>
              ))}
            </div>
          </>
        )}

        {info && info.backups.length > 0 && (
          <>
            <label className="settings-label">Backups</label>
            <div className="session-list">
              {info.backups.map((b) => (
                <div key={b.path} className="save-backup-row">
                  <span>{formatDate(b.createdAt)}</span>
                  <span className="save-backup-size">{formatSize(b.sizeBytes)}</span>
                  <button className="btn" disabled={busy !== null} onClick={() => setConfirmRestore(b.path)}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {message && <p className="settings-note">{message}</p>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy !== null}>
            Close
          </button>
          <button
            className="btn btn-primary"
            disabled={busy !== null || !info?.known || info.paths.length === 0}
            onClick={() => void backup()}
          >
            {busy ?? 'Back Up Now'}
          </button>
        </div>

        {confirmRestore && (
          <ConfirmDialog
            title="Restore these saves?"
            message="This writes the backed-up files back over the game's current save folders. Whatever is there now is replaced, and that cannot be undone — back up first if you are unsure."
            confirmLabel="Restore"
            danger
            onCancel={() => setConfirmRestore(null)}
            onConfirm={() => void restore(confirmRestore)}
          />
        )}
      </div>
    </div>
  )
}
