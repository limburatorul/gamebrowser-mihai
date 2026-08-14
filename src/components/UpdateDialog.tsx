interface Props {
  currentVersion: string
  latestVersion: string
  notes?: string
  downloading: boolean
  error: string | null
  onUpdate: () => void
  onLater: () => void
}

export default function UpdateDialog({
  currentVersion,
  latestVersion,
  notes,
  downloading,
  error,
  onUpdate,
  onLater
}: Props): JSX.Element {
  return (
    <div className="modal-overlay">
      <div className="modal modal-small">
        <h2>Update Available</h2>
        <p className="modal-sub">
          v{latestVersion} is available — you have v{currentVersion}.
        </p>
        {notes && <p className="update-notes">{notes}</p>}
        {error && <p className="edit-cover-message">{error}</p>}
        <p className="settings-note">
          Downloads the new .exe next to this one and restarts. Delete the old version yourself, or it&apos;ll be
          cleaned up automatically the next time the app starts.
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onLater} disabled={downloading}>
            Later
          </button>
          <button className="btn btn-primary" onClick={onUpdate} disabled={downloading}>
            {downloading ? 'Downloading…' : 'Update & Restart'}
          </button>
        </div>
      </div>
    </div>
  )
}
