import type { LibrarySyncEvent } from '@shared/types'

export interface SyncToast {
  id: string
  source: LibrarySyncEvent['source']
  kind: 'added' | 'removed'
  count: number
}

interface Props {
  toasts: SyncToast[]
  onDismiss: (id: string) => void
}

export default function SyncToasts({ toasts, onDismiss }: Props): JSX.Element | null {
  if (toasts.length === 0) return null
  return (
    <div className="sync-toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`sync-toast sync-toast-${t.kind}`} onClick={() => onDismiss(t.id)}>
          <span className={`sync-toast-count sync-toast-count-${t.kind}`}>
            {t.kind === 'added' ? '+' : '-'}
            {t.count}
          </span>
          <span className="sync-toast-text">
            {t.count} game{t.count === 1 ? '' : 's'} {t.kind === 'added' ? 'added to' : 'removed from'} {t.source}{' '}
            library
          </span>
        </div>
      ))}
    </div>
  )
}
