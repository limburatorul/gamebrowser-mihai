import type { ScanProgress } from '@shared/types'

interface Props {
  progress: ScanProgress
  title?: string
}

export default function ScanProgressOverlay({ progress, title = 'Scanning Folder…' }: Props): JSX.Element {
  const pct = Math.min(100, Math.round((progress.current / Math.max(1, progress.total)) * 100))

  return (
    <div className="modal-overlay">
      <div className="modal modal-small scan-progress">
        <h2>{title}</h2>
        <p className="modal-sub">
          {progress.current} / {progress.total} — {progress.currentName}
        </p>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="progress-pct">{pct}%</p>
      </div>
    </div>
  )
}
