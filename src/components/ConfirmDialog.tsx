interface Props {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
  busy?: boolean
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onCancel,
  onConfirm,
  busy = false
}: Props): JSX.Element {
  return (
    <div className="modal-overlay">
      <div className="modal modal-small">
        <h2>{title}</h2>
        <p className="modal-sub">{message}</p>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
