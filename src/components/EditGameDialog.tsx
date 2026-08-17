import { useState } from 'react'
import type { Category, CompletionStatus, Game, TrainerFileInfo } from '@shared/types'
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
