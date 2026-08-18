import { useMemo, useState } from 'react'
import type { Game } from '@shared/types'
import { COMPLETION_LABELS, PLATFORM_SOURCES } from '@shared/types'
import { formatPlaytime, formatSize } from '../lib/localFile'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  games: Game[]
  onClose: () => void
}


type Scope = 'never-played' | 'finished' | 'all'

const SCOPES: { key: Scope; label: string; hint: string }[] = [
  { key: 'never-played', label: 'Never played', hint: 'Installed, never started — the usual place space hides' },
  { key: 'finished', label: 'Finished or dropped', hint: 'Games you have marked as done with' },
  { key: 'all', label: 'Everything measured', hint: 'Every game whose size on disk is known' }
]

interface Outcome {
  name: string
  ok: boolean
  detail: string
}

/**
 * Turns the Dashboard's storage reports into something you can act on.
 *
 * The reports answer "where did the space go"; this answers "get it back".
 * It deliberately does the same two things the details bar does, per game and
 * by the same rules — platform games are handed to their launcher to
 * uninstall, everything else is deleted from disk — rather than inventing a
 * third kind of removal.
 */
export default function CleanupDialog({ games, onClose }: Props): JSX.Element {
  const [scope, setScope] = useState<Scope>('never-played')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null)

  const candidates = useMemo(() => {
    // Only games whose size is known: offering to reclaim an unknown amount
    // is not a decision anyone can make, and the sweep fills these in anyway.
    const measured = games.filter((g) => g.installSizeBytes !== null)
    const inScope = measured.filter((g) => {
      if (scope === 'never-played') return g.playtimeSeconds === 0
      if (scope === 'finished') return g.completion === 'finished' || g.completion === 'dropped'
      return true
    })
    return inScope.sort((a, b) => (b.installSizeBytes ?? 0) - (a.installSizeBytes ?? 0))
  }, [games, scope])

  // Selection survives switching scope, but the total must only count what is
  // actually still on screen, or it claims space the list cannot explain.
  const visibleSelected = useMemo(
    () => candidates.filter((g) => selected.has(g.id)),
    [candidates, selected]
  )
  const selectedBytes = visibleSelected.reduce((sum, g) => sum + (g.installSizeBytes ?? 0), 0)
  const totalBytes = candidates.reduce((sum, g) => sum + (g.installSizeBytes ?? 0), 0)

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function run(): Promise<void> {
    setConfirming(false)
    const results: Outcome[] = []
    // Sequential on purpose: a platform uninstall opens that launcher's own
    // window, and firing five at once would bury the user in dialogs.
    for (const game of visibleSelected) {
      setRunning(game.name)
      try {
        if (PLATFORM_SOURCES.has(game.source)) {
          const r = await window.api.uninstall(game.id)
          results.push({
            name: game.name,
            ok: r.ok,
            detail: r.ok ? 'Handed to its launcher to uninstall' : (r.error ?? 'Could not start the uninstaller')
          })
        } else {
          const r = await window.api.deleteFromDisk(game.id)
          const extra = [
            r.killedProcesses.length > 0 ? `stopped ${r.killedProcesses.join(', ')}` : '',
            r.tookOwnership ? 'took ownership of the folder' : ''
          ].filter(Boolean)
          results.push({
            name: game.name,
            ok: r.ok,
            detail: r.ok
              ? ['Deleted from disk', ...extra].join(' — ')
              : (r.error ?? r.steps[r.steps.length - 1] ?? 'Could not delete the folder')
          })
        }
      } catch (e) {
        results.push({ name: game.name, ok: false, detail: e instanceof Error ? e.message : String(e) })
      }
    }
    setRunning(null)
    setSelected(new Set())
    setOutcomes(results)
  }

  const platformCount = visibleSelected.filter((g) => PLATFORM_SOURCES.has(g.source)).length
  const diskCount = visibleSelected.length - platformCount

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Reclaim Space</h2>

        <div className="cleanup-scopes">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              className={`btn ${scope === s.key ? 'btn-primary' : ''}`}
              title={s.hint}
              onClick={() => setScope(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <p className="settings-note">
          {candidates.length} {candidates.length === 1 ? 'game' : 'games'} in this list, {formatSize(totalBytes)} in
          total. Games bought through a launcher are handed to it to uninstall; everything else is deleted from disk
          here, which cannot be undone.
        </p>

        {outcomes ? (
          <>
            <h3 className="settings-section">What happened</h3>
            <div className="session-list">
              {outcomes.map((o) => (
                <div key={o.name} className="cleanup-outcome">
                  <span className={o.ok ? 'cleanup-ok' : 'cleanup-fail'}>{o.ok ? '✓' : '✕'}</span>
                  <span className="session-name" title={o.name}>
                    {o.name}
                  </span>
                  <span className="cleanup-detail">{o.detail}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="cleanup-list">
            {candidates.length === 0 && <p className="settings-note">Nothing here — try another list above.</p>}
            {candidates.map((g) => (
              <label key={g.id} className="cleanup-row">
                <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)} />
                <span className="cleanup-name" title={g.installDir}>
                  {g.name}
                </span>
                <span className="cleanup-tag">
                  {g.completion ? COMPLETION_LABELS[g.completion].label : PLATFORM_SOURCES.has(g.source) ? 'Launcher' : 'Own copy'}
                </span>
                <span className="cleanup-playtime">{formatPlaytime(g.playtimeSeconds)}</span>
                <span className="cleanup-size">{formatSize(g.installSizeBytes)}</span>
              </label>
            ))}
          </div>
        )}

        <div className="modal-actions">
          {!outcomes && (
            <span className="cleanup-total">
              {visibleSelected.length > 0
                ? `${visibleSelected.length} selected · ${formatSize(selectedBytes)} to reclaim`
                : 'Nothing selected'}
            </span>
          )}
          <button className="btn" onClick={onClose} disabled={running !== null}>
            {outcomes ? 'Close' : 'Cancel'}
          </button>
          {!outcomes && (
            <button
              className="btn btn-danger"
              disabled={visibleSelected.length === 0 || running !== null}
              onClick={() => setConfirming(true)}
            >
              {running ? `Working on ${running}…` : `Reclaim ${formatSize(selectedBytes)}`}
            </button>
          )}
        </div>

        {confirming && (
          <ConfirmDialog
            title="Reclaim space?"
            message={
              `${visibleSelected.length} ${visibleSelected.length === 1 ? 'game' : 'games'}, ${formatSize(selectedBytes)}.` +
              (diskCount > 0
                ? ` ${diskCount} will be deleted from disk and cannot be recovered.`
                : '') +
              (platformCount > 0
                ? ` ${platformCount} will be handed to their launcher, which will ask you to confirm separately.`
                : '')
            }
            confirmLabel="Reclaim"
            danger
            onConfirm={() => void run()}
            onCancel={() => setConfirming(false)}
          />
        )}
      </div>
    </div>
  )
}
