import { useState } from 'react'
import type { GameCandidate } from '@shared/types'

interface Props {
  candidates: GameCandidate[]
  onCancel: () => void
  /** `ignored` folders are remembered and skipped by every later scan. */
  onConfirm: (selected: GameCandidate[], ignored: string[]) => void
  importing: boolean
}

export default function ImportDialog({ candidates, onCancel, onConfirm, importing }: Props): JSX.Element {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(candidates.map((_, i) => i)))
  const [ignored, setIgnored] = useState<Set<number>>(() => new Set())
  const [names, setNames] = useState<string[]>(() => candidates.map((c) => c.name))

  function toggle(i: number): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  // Importing and ignoring are opposites, so marking one clears the other
  // rather than letting a row be ticked for both at once.
  function toggleIgnore(i: number): void {
    setIgnored((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
    setChecked((prev) => {
      const next = new Set(prev)
      next.delete(i)
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
    onConfirm(
      selected,
      candidates.filter((_, i) => ignored.has(i)).map((c) => c.installDir)
    )
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
              don&apos;t want. Mark a folder <strong>Ignore</strong> and it will be left out of every future scan
              too — the list is kept, and you can undo it in Settings under Automation.
            </p>
            <div className="candidate-list">
              {candidates.map((c, i) => (
                <div key={c.exePath} className={`candidate-row ${ignored.has(i) ? 'is-ignored' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked.has(i)}
                    disabled={ignored.has(i)}
                    title="Import this game"
                    onChange={() => toggle(i)}
                  />
                  <div className="candidate-info">
                    <input
                      className="candidate-name-input"
                      value={names[i]}
                      disabled={ignored.has(i)}
                      onChange={(e) => renameAt(i, e.target.value)}
                    />
                    <div className="candidate-path">{c.installDir}</div>
                  </div>
                  <button
                    type="button"
                    className={`btn candidate-ignore ${ignored.has(i) ? 'active' : ''}`}
                    title="Never offer this folder again"
                    onClick={() => toggleIgnore(i)}
                  >
                    {ignored.has(i) ? 'Ignored' : 'Ignore'}
                  </button>
                </div>
              ))}
            </div>
            {ignored.size > 0 && (
              <p className="settings-note">
                {ignored.size} folder(s) will be remembered and skipped from now on.
              </p>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={importing}>
            Cancel
          </button>
          {candidates.length > 0 && (
            <button
              className="btn btn-primary"
              disabled={importing || (checked.size === 0 && ignored.size === 0)}
              onClick={handleConfirm}
            >
              {importing
                ? 'Importing…'
                : checked.size === 0
                  ? `Ignore ${ignored.size} folder(s)`
                  : `Import ${checked.size} game(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
