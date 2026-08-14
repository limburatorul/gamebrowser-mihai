import type { Game } from '@shared/types'
import CoverImage from './CoverImage'
import StarRating from './StarRating'
import { formatDate, formatPlaytime } from '../lib/localFile'

interface Props {
  game: Game
  running: boolean
  onLaunch: (id: string) => void
  onToggleFavorite: (id: string) => void
  onRate: (id: string, rating: number | null) => void
  onEdit: (id: string) => void
  onSetCover: (id: string) => void
  onRemove: (id: string) => void
}

export default function GameDetails({
  game,
  running,
  onLaunch,
  onToggleFavorite,
  onRate,
  onEdit,
  onSetCover,
  onRemove
}: Props): JSX.Element {
  return (
    <div className="details-bar">
      <div className="details-cover">
        <CoverImage game={game} className="cover-img" />
      </div>
      <div className="details-info">
        <div className="details-name">{game.name}</div>
        <div className="details-meta">
          <span>Playtime: {formatPlaytime(game.playtimeSeconds)}</span>
          <span>Last played: {formatDate(game.lastPlayed)}</span>
          <span>Added: {formatDate(game.dateAdded)}</span>
          <StarRating value={game.rating} onChange={(r) => onRate(game.id, r)} size="sm" />
        </div>
      </div>
      <div className="details-actions">
        <button className="btn btn-primary" onClick={() => onLaunch(game.id)} disabled={running}>
          {running ? 'Running…' : '▶ Play'}
        </button>
        <button className="btn" onClick={() => onToggleFavorite(game.id)}>
          {game.favorite ? '★ Favorite' : '☆ Favorite'}
        </button>
        <button className="btn" onClick={() => onSetCover(game.id)}>
          Set Cover
        </button>
        <button className="btn" onClick={() => onEdit(game.id)}>
          Edit
        </button>
        <button className="btn btn-danger" onClick={() => onRemove(game.id)}>
          Remove
        </button>
      </div>
    </div>
  )
}
