import { useState } from 'react'
import type { Category } from '@shared/types'
import StarRating from './StarRating'

interface Props {
  count: number
  categories: Category[]
  canUninstall: boolean
  canDeleteFromDisk: boolean
  onDelete: () => void
  onClear: () => void
  onAddToCategory: (categoryId: string) => void
  onRate: (rating: number | null) => void
  onUninstall: () => void
  onDeleteFromDisk: () => void
}

export default function BulkActionsBar({
  count,
  categories,
  canUninstall,
  canDeleteFromDisk,
  onDelete,
  onClear,
  onAddToCategory,
  onRate,
  onUninstall,
  onDeleteFromDisk
}: Props): JSX.Element {
  const [categorySelect, setCategorySelect] = useState('')

  return (
    <div className="details-bar">
      <div className="details-info">
        <div className="details-name">{count} games selected</div>
      </div>
      <div className="details-actions">
        <StarRating value={null} onChange={onRate} />
        {categories.length > 0 && (
          <select
            className="select"
            value={categorySelect}
            onChange={(e) => {
              const id = e.target.value
              if (id) {
                onAddToCategory(id)
                setCategorySelect('')
              }
            }}
          >
            <option value="">Add to Category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {canUninstall && (
          <button className="btn" onClick={onUninstall}>
            Uninstall Selected
          </button>
        )}
        {canDeleteFromDisk && (
          <button className="btn btn-danger" onClick={onDeleteFromDisk}>
            Delete Selected from Disk
          </button>
        )}
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
