import type { Game } from '@shared/types'
import CoverImage from './CoverImage'
import StarRating from './StarRating'
import { formatDate, formatPlaytime, formatSize } from '../lib/localFile'

interface Props {
  game: Game
  visible: boolean
  running: boolean
  onLaunch: (id: string) => void
  onLaunchTrainer: (id: string) => void
  onLaunchWithTrainer: (id: string) => void
  onFindTrainer: (id: string) => void
  onOpenFolder: (id: string) => void
  onToggleFavorite: (id: string) => void
  onRate: (id: string, rating: number | null) => void
  onEdit: (id: string) => void
  onSetCover: (id: string) => void
  onRemove: (id: string) => void
  onUninstall: (id: string) => void
  onDeleteFromDisk: (id: string) => void
}

const PLATFORM_SOURCES = new Set(['steam', 'epic', 'gog', 'ubisoft'])

export default function GameDetails({
  game,
  visible,
  running,
  onLaunch,
  onLaunchTrainer,
  onLaunchWithTrainer,
  onFindTrainer,
  onOpenFolder,
  onToggleFavorite,
  onRate,
  onEdit,
  onSetCover,
  onRemove,
  onUninstall,
  onDeleteFromDisk
}: Props): JSX.Element {
  return (
    <div className={`details-bar ${visible ? '' : 'details-bar-hidden'}`}>
      <div className="details-cover">
        <CoverImage game={game} className="cover-img" />
      </div>
      <div className="details-info">
        <div className="details-name">{game.name}</div>
        <div className="details-meta">
          <span>Playtime: {formatPlaytime(game.playtimeSeconds)}</span>
          <span>Last played: {formatDate(game.lastPlayed)}</span>
          <span>Added: {formatDate(game.dateAdded)}</span>
          {game.installSizeBytes !== null && <span>Size: {formatSize(game.installSizeBytes)}</span>}
          <StarRating value={game.rating} onChange={(r) => onRate(game.id, r)} size="lg" />
        </div>
        {/* Own line rather than another item in the meta row: paths are long
            and would push everything else off the end. Ellipsised from the
            left, since the tail (the game's own folder) is what distinguishes
            a Steam copy from your own when both are in the library. */}
        <button
          className="details-path"
          title={`${game.installDir}\nClick to open in Explorer`}
          onClick={() => onOpenFolder(game.id)}
        >
          {game.installDir}
        </button>
      </div>
      <div className="details-actions">
        <button className="btn btn-primary" onClick={() => onLaunch(game.id)} disabled={running}>
          {running ? 'Running…' : '▶ Play'}
        </button>
        {game.trainerPath && (
          <button
            className="btn"
            title="Start the trainer, then the game"
            disabled={running}
            onClick={() => onLaunchWithTrainer(game.id)}
          >
            ▶ Play + Trainer
          </button>
        )}
        <button
          className="btn"
          title={
            game.trainerPath
              ? `Run ${game.trainerPath.split('\\').pop()} on its own`
              : 'Open the trainer site for this game in your browser'
          }
          onClick={() => (game.trainerPath ? onLaunchTrainer(game.id) : onFindTrainer(game.id))}
        >
          {game.trainerPath ? '⚡ Trainer' : 'Find Trainer'}
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
        {PLATFORM_SOURCES.has(game.source) ? (
          <button className="btn" onClick={() => onUninstall(game.id)}>
            Uninstall
          </button>
        ) : (
          <button className="btn btn-danger" onClick={() => onDeleteFromDisk(game.id)}>
            Delete from Disk
          </button>
        )}
        <button className="btn btn-danger" onClick={() => onRemove(game.id)}>
          Remove
        </button>
      </div>
    </div>
  )
}
