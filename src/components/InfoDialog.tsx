interface Props {
  title: string
  message: string
  onClose: () => void
}

export default function InfoDialog({ title, message, onClose }: Props): JSX.Element {
  return (
    <div className="modal-overlay">
      <div className="modal modal-small">
        <h2>{title}</h2>
        <p className="modal-sub">{message}</p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
