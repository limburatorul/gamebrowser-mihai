import { useState } from 'react'
import type { Category, CompletionStatus, Game, GameAction, TrainerFileInfo } from '@shared/types'
import { COMPLETION_STATUSES, COMPLETION_LABELS } from '@shared/types'
import CoverImage from './CoverImage'
import StarRating from './StarRating'

interface Props {
  game: Game
  categories: Category[]
  onCancel: () => void
  onSave: (patch: {
    name: string
    favorite: boolean
    tags: string[]
    rating: number | null
    completion: CompletionStatus | null
    actions: GameAction[]
    hltbMainSeconds: number | null
    hltbMainExtraSeconds: number | null
    hltbCompletionistSeconds: number | null
    categoryIds: string[]
    steamAppId: number | null
    launchArgs: string
    runAsAdmin: boolean
  }) => void
  trainerFiles: TrainerFileInfo[]
  onAssignTrainer: (sourcePath: string | null) => Promise<void>
  onChangeExePath: () => void
  onBrowseCover: () => void
  onSearchCover: () => Promise<boolean>
  saving: boolean
}

function parseTags(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.split(',')) {
    const t = raw.trim()
    if (t) seen.add(t)
  }
  return [...seen]
}

/** Stored in seconds like every other duration; shown and typed in hours. */
function hoursText(seconds: number | null): string {
  return seconds === null ? '' : String(Math.round((seconds / 3600) * 10) / 10)
}

function parseHours(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'))
  return text.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 3600) : null
}

function parseSteamAppId(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const urlMatch = trimmed.match(/\/app\/(\d+)/)
  if (urlMatch) return Number(urlMatch[1])
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

export default function EditGameDialog({
  game,
  categories,
  onCancel,
  onSave,
  trainerFiles,
  onAssignTrainer,
  onChangeExePath,
  onBrowseCover,
  onSearchCover,
  saving
}: Props): JSX.Element {
  const [name, setName] = useState(game.name)
  const [favorite, setFavorite] = useState(game.favorite)
  const [tagsText, setTagsText] = useState(game.tags.join(', '))
  const [rating, setRating] = useState(game.rating)
  const [completion, setCompletion] = useState(game.completion)
  const [actions, setActions] = useState<GameAction[]>(game.actions)
  // Held as text so a half-typed "1." doesn't fight the input on every
  // keystroke; converted on save.
  const [hltbMain, setHltbMain] = useState(hoursText(game.hltbMainSeconds))
  const [hltbExtra, setHltbExtra] = useState(hoursText(game.hltbMainExtraSeconds))
  const [hltbFull, setHltbFull] = useState(hoursText(game.hltbCompletionistSeconds))

  function addAction(): void {
    setActions((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: '', exePath: '', args: '', runAsAdmin: false }
    ])
  }

  function updateAction(index: number, patch: Partial<GameAction>): void {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  }

  function removeAction(index: number): void {
    setActions((prev) => prev.filter((_, i) => i !== index))
  }
  const [categoryIds, setCategoryIds] = useState<string[]>(game.categoryIds)
  const [steamAppIdText, setSteamAppIdText] = useState(game.steamAppId !== null ? String(game.steamAppId) : '')
  const [launchArgs, setLaunchArgs] = useState(game.launchArgs)
  const [runAsAdmin, setRunAsAdmin] = useState(game.runAsAdmin)
  const [assigningTrainer, setAssigningTrainer] = useState(false)
  const [searchingCover, setSearchingCover] = useState(false)
  const [coverSearchMessage, setCoverSearchMessage] = useState<string | null>(null)

  function toggleCategory(id: string): void {
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }

  function save(): void {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      favorite,
      tags: parseTags(tagsText),
      rating,
      completion,
      // Unnamed rows are abandoned edits, not options - a button with no label
      // would be unusable next to Play.
      actions: actions.filter((a) => a.name.trim()).map((a) => ({ ...a, name: a.name.trim() })),
      hltbMainSeconds: parseHours(hltbMain),
      hltbMainExtraSeconds: parseHours(hltbExtra),
      hltbCompletionistSeconds: parseHours(hltbFull),
      categoryIds,
      steamAppId: parseSteamAppId(steamAppIdText),
      launchArgs: launchArgs.trim(),
      runAsAdmin
    })
  }

  async function handleSearchCover(): Promise<void> {
    setSearchingCover(true)
    setCoverSearchMessage(null)
    try {
      const found = await onSearchCover()
      setCoverSearchMessage(found ? null : 'Nothing found online for this game.')
    } finally {
      setSearchingCover(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-small">
        <h2>Edit Game</h2>

        <div className="edit-cover-row">
          <div className="edit-cover-preview">
            <CoverImage game={game} className="cover-img" />
          </div>
          <div className="edit-cover-actions">
            <button className="btn" onClick={onBrowseCover} disabled={searchingCover}>
              Browse Image…
            </button>
            <button className="btn" onClick={handleSearchCover} disabled={searchingCover}>
              {searchingCover ? 'Searching…' : 'Search Online'}
            </button>
            {coverSearchMessage && <p className="edit-cover-message">{coverSearchMessage}</p>}
          </div>
        </div>

        <label className="settings-label">Name</label>
        <input
          className="search-input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) save()
            if (e.key === 'Escape') onCancel()
          }}
        />

        <label className="settings-label">Executable</label>
        <div className="edit-path-row">
          <span className="edit-path-value" title={game.exePath}>
            {game.exePath}
          </span>
          <button className="btn" onClick={onChangeExePath}>
            Change…
          </button>
        </div>

        <label className="settings-label">Steam ID</label>
        <input
          className="search-input"
          value={steamAppIdText}
          onChange={(e) => setSteamAppIdText(e.target.value)}
          placeholder="e.g. 570, or paste the store.steampowered.com/app/570/… URL"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) save()
            if (e.key === 'Escape') onCancel()
          }}
        />
        <p className="settings-note">
          Overrides the cover/genres with this exact Steam store page, regardless of the detected name — useful
          when auto-matching picked the wrong game.
        </p>

        <label className="settings-label">Launch options</label>
        <input
          className="search-input"
          value={launchArgs}
          onChange={(e) => setLaunchArgs(e.target.value)}
          placeholder="Command-line arguments, e.g. -windowed -novid"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) save()
            if (e.key === 'Escape') onCancel()
          }}
        />
        <div className="settings-slider-row">
          <span className="settings-slider-label">Run as administrator</span>
          <input type="checkbox" checked={runAsAdmin} onChange={(e) => setRunAsAdmin(e.target.checked)} />
        </div>
        <p className="settings-note">
          Elevating goes through Windows&apos; own UAC prompt. Playtime can&apos;t be measured for an elevated
          launch — the game runs outside this app&apos;s reach, so there is nothing to time.
        </p>

        <label className="settings-label">Trainer</label>
        <select
          className="select edit-trainer-select"
          disabled={assigningTrainer}
          value={game.trainerPath ?? ''}
          onChange={async (e) => {
            setAssigningTrainer(true)
            try {
              await onAssignTrainer(e.target.value || null)
            } finally {
              setAssigningTrainer(false)
            }
          }}
        >
          <option value="">No trainer</option>
          {game.trainerPath && !trainerFiles.some((t) => t.path === game.trainerPath) && (
            <option value={game.trainerPath}>{game.trainerPath.split('\\').pop()}</option>
          )}
          {trainerFiles.map((t) => (
            <option key={t.path} value={t.path}>
              {t.fileName}
              {t.assigned && t.path !== game.trainerPath ? '  (used by another game)' : ''}
            </option>
          ))}
        </select>
        <p className="settings-note">
          Pick one by hand when the automatic match missed it — it is copied into the app&apos;s trainer folder and
          takes effect straight away, without waiting for Save.
        </p>

        <label className="settings-label">Tags</label>
        <input
          className="search-input"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="e.g. Coop with friends, To finish"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) save()
            if (e.key === 'Escape') onCancel()
          }}
        />
        <p className="settings-note">Comma-separated. Your own labels, separate from auto-fetched genres.</p>

        <label className="settings-label">How long to beat</label>
        <div className="hltb-row">
          {(
            [
              ['Main story', hltbMain, setHltbMain],
              ['Main + extras', hltbExtra, setHltbExtra],
              ['Completionist', hltbFull, setHltbFull]
            ] as const
          ).map(([label, value, set]) => (
            <label key={label} className="hltb-field">
              <span>{label}</span>
              <input
                className="search-input"
                value={value}
                inputMode="decimal"
                placeholder="hours"
                onChange={(e) => set(e.target.value)}
              />
            </label>
          ))}
        </div>
        <button className="btn" onClick={() => void window.api.openHltb(game.id)}>
          Look up on HowLongToBeat
        </button>
        <p className="settings-note">
          Opens the game on howlongtobeat.com in your browser so you can read the times off and type them in. They
          are not fetched automatically — the site has no public API, and reading it by machine means working around
          the protection they put there on purpose.
        </p>

        <label className="settings-label">Extra launch options</label>
        <div className="action-list">
          {actions.map((action, i) => (
            <div key={action.id} className="action-row">
              <input
                className="search-input action-name"
                value={action.name}
                placeholder="Name, e.g. Launcher (mods)"
                onChange={(e) => updateAction(i, { name: e.target.value })}
              />
              <button
                className="btn action-path"
                title={action.exePath || 'Uses the game’s own executable'}
                onClick={async () => {
                  const picked = await window.api.pickActionExe()
                  if (picked) updateAction(i, { exePath: picked })
                }}
              >
                {action.exePath ? action.exePath.split('\\').pop() : 'Same exe…'}
              </button>
              <input
                className="search-input action-args"
                value={action.args}
                placeholder="Arguments"
                onChange={(e) => updateAction(i, { args: e.target.value })}
              />
              <button className="action-remove" title="Remove" onClick={() => removeAction(i)}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <button className="btn" onClick={addAction}>
          Add launch option
        </button>
        <p className="settings-note">
          A second way to start this game — a mod launcher, a config tool, or the same executable with different
          arguments. It appears next to Play. Useful when the game&apos;s own launcher is what loads your mods, and
          starting the executable directly skips them.
        </p>

        <label className="settings-label">Status</label>
        <select
          className="select"
          value={completion ?? ''}
          onChange={(e) => setCompletion((e.target.value || null) as CompletionStatus | null)}
        >
          <option value="">Not set</option>
          {COMPLETION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {COMPLETION_LABELS[s].label}
            </option>
          ))}
        </select>

        <label className="settings-label">Your Rating</label>
        <StarRating value={rating} onChange={setRating} />

        {categories.length > 0 && (
          <>
            <label className="settings-label">Categories</label>
            <div className="edit-category-list">
              {categories.map((c) => (
                <label key={c.id} className="edit-checkbox-row">
                  <input
                    type="checkbox"
                    checked={categoryIds.includes(c.id)}
                    onChange={() => toggleCategory(c.id)}
                  />
                  <span>{c.name}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <label className="edit-checkbox-row">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
          <span>Favorite</span>
        </label>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving || !name.trim()} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
