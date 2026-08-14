import { useState } from 'react'
import type { Game } from '@shared/types'
import CoverImage from './CoverImage'

interface Props {
  game: Game
  onCancel: () => void
  onSave: (patch: { name: string; favorite: boolean; tags: string[] }) => void
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

export default function EditGameDialog({
  game,
  onCancel,
  onSave,
  onChangeExePath,
  onBrowseCover,
  onSearchCover,
  saving
}: Props): JSX.Element {
  const [name, setName] = useState(game.name)
  const [favorite, setFavorite] = useState(game.favorite)
  const [tagsText, setTagsText] = useState(game.tags.join(', '))
  const [searchingCover, setSearchingCover] = useState(false)
  const [coverSearchMessage, setCoverSearchMessage] = useState<string | null>(null)

  function save(): void {
    if (!name.trim()) return
    onSave({ name: name.trim(), favorite, tags: parseTags(tagsText) })
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
