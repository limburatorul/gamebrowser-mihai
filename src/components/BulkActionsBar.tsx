interface Props {
  count: number
  onDelete: () => void
  onClear: () => void
}

export default function BulkActionsBar({ count, onDelete, onClear }: Props): JSX.Element {
  return (
    <div className="details-bar">
      <div className="details-info">
        <div className="details-name">{count} games selected</div>
      </div>
      <div className="details-actions">
        <button className="btn" onClick={onClear}>
          Clear Selection
        </button>
        <button className="btn btn-danger" onClick={onDelete}>
          Delete Selected
        </button>
      </div>
    </div>
  )
}
