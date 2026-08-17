import { useState } from 'react'
import type { Category, CompletionStatus } from '@shared/types'
import { COMPLETION_STATUSES, COMPLETION_LABELS } from '@shared/types'
import StarRating from './StarRating'

interface Props {
  count: number
  categories: Category[]
  canUninstall: boolean
  canDeleteFromDisk: boolean
  onDelete: () => void
  onClear: () => void
  onAddToCategory: (categoryId: string) => void
  onSetCompletion: (status: CompletionStatus | null) => void
  onRate: (rating: number | null) => void
  onUninstall: () => void
  onDeleteFromDisk: () => void
  onHide: () => void
}

export default function BulkActionsBar({
  count,
  categories,
  canUninstall,
  canDeleteFromDisk,
  onDelete,
  onClear,
  onAddToCategory,
  onSetCompletion,
  onRate,
  onUninstall,
  onDeleteFromDisk,
  onHide
}: Props): JSX.Element {
  const [categorySelect, setCategorySelect] = useState('')
  const [statusSelect, setStatusSelect] = useState('')

  return (
    <div className="details-bar">
      <div className="details-info">
        <div className="details-name">{count} games selected</div>
      </div>
      <div className="details-actions">
        <StarRating value={null} onChange={onRate} />
        {/* "Clear" is an explicit option rather than the blank one, so setting
            a status and unsetting it are equally reachable in bulk. */}
        <select
          className="select"
          value={statusSelect}
          onChange={(e) => {
            const value = e.target.value
            if (!value) return
            onSetCompletion(value === 'clear' ? null : (value as CompletionStatus))
            setStatusSelect('')
          }}
        >
          <option value="">Set Status…</option>
          {COMPLETION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {COMPLETION_LABELS[s].label}
            </option>
          ))}
          <option value="clear">Clear status</option>
        </select>
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
        <button
          className="btn"
          title="Keep them in the library but out of the grid, the sidebar counts and the backdrop"
          onClick={onHide}
        >
          👁 Hide Selected
        </button>
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
