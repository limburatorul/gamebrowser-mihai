import type { ChangelogEntry } from '../lib/changelog'

interface Props {
  title: string
  entries: ChangelogEntry[]
  onClose: () => void
}

export default function WhatsNewDialog({ title, entries, onClose }: Props): JSX.Element {
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal modal-small whats-new-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="whats-new-list">
          {entries.map((entry) => (
            <div key={entry.version} className="whats-new-entry">
              <div className="whats-new-version">v{entry.version}</div>
              <ul>
                {entry.changes.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
