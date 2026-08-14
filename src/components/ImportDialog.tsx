import { useState } from 'react'
import type { GameCandidate } from '@shared/types'

interface Props {
  candidates: GameCandidate[]
  onCancel: () => void
  onConfirm: (selected: GameCandidate[]) => void
  importing: boolean
}

export default function ImportDialog({ candidates, onCancel, onConfirm, importing }: Props): JSX.Element {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(candidates.map((_, i) => i)))
  const [names, setNames] = useState<string[]>(() => candidates.map((c) => c.name))

  function toggle(i: number): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function renameAt(i: number, value: string): void {
    setNames((prev) => {
      const next = [...prev]
      next[i] = value
      return next
    })
  }

  function handleConfirm(): void {
    const selected = candidates
      .map((c, i) => ({ ...c, name: names[i] }))
      .filter((_, i) => checked.has(i))
    onConfirm(selected)
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Import Games</h2>
        {candidates.length === 0 ? (
          <p>No executable (.exe) found in the selected folder.</p>
        ) : (
          <>
            <p className="modal-sub">
              Found {candidates.length} game(s). You can edit the names before importing and untick anything you
              don&apos;t want.
            </p>
            <div className="candidate-list">
              {candidates.map((c, i) => (
                <div key={c.exePath} className="candidate-row">
                  <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                  <div className="candidate-info">
                    <input
                      className="candidate-name-input"
                      value={names[i]}
                      onChange={(e) => renameAt(i, e.target.value)}
                    />
                    <div className="candidate-path">{c.exePath}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={importing}>
            Cancel
          </button>
          {candidates.length > 0 && (
            <button className="btn btn-primary" disabled={importing || checked.size === 0} onClick={handleConfirm}>
              {importing ? 'Importing…' : `Import ${checked.size} game(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
