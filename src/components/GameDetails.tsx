import { useState } from 'react'
import type { Game } from '@shared/types'
import CoverImage from './CoverImage'
import StarRating from './StarRating'
import { formatDate, formatDuration, formatPlaytime, formatSize } from '../lib/localFile'

interface Props {
  game: Game
  visible: boolean
  running: boolean
  onLaunch: (id: string) => void
  onLaunchAction: (id: string, actionId: string) => void
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
  onToggleHidden: (id: string) => void
}

const PLATFORM_SOURCES = new Set(['steam', 'epic', 'gog', 'ubisoft'])

export default function GameDetails({
  game,
  visible,
  running,
  onLaunch,
  onLaunchAction,
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
  onDeleteFromDisk,
  onToggleHidden
}: Props): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false)
  const run = (fn: (id: string) => void): void => {
    setMoreOpen(false)
    fn(game.id)
  }

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
          {/* The one that answers "can I finish this?", so it sits next to the
              time already spent rather than in a panel you have to open. */}
          {game.hltbMainSeconds !== null && (
            <span title="Main story, from HowLongToBeat">To beat: {formatDuration(game.hltbMainSeconds)}</span>
          )}
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
        {/* Rendered flat rather than behind a menu: a game that has these has
            one or two, and the whole point is that the mod launcher is as
            reachable as Play. */}
        {game.actions.map((action) => (
          <button
            key={action.id}
            className="btn"
            disabled={running}
            title={action.exePath || 'Starts the game with different arguments'}
            onClick={() => onLaunchAction(game.id, action.id)}
          >
            ▶ {action.name}
          </button>
        ))}
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
        {/* Uninstall, Delete from Disk and Remove used to sit inline, the last
            two in red, one button away from Edit. Tucking them behind a menu
            shortens a row of eight equal-weight buttons and puts a deliberate
            step in front of the destructive ones. */}
        <div className="import-menu-wrapper">
          <button
            className="btn details-more-btn"
            title="More actions"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
          >
            ⋯
          </button>
          {moreOpen && (
            <>
              <div className="import-menu-overlay" onClick={() => setMoreOpen(false)} />
              <div className="import-menu details-more-menu">
                <button
                  className="import-menu-item"
                  title="Keep it in the library but out of the grid, the sidebar counts and the backdrop"
                  onClick={() => run(onToggleHidden)}
                >
                  <span className="import-menu-icon">👁</span>
                  <span>{game.hidden ? 'Unhide' : 'Hide from library'}</span>
                </button>
                <div className="import-menu-separator" />
                {PLATFORM_SOURCES.has(game.source) ? (
                  <button className="import-menu-item" onClick={() => run(onUninstall)}>
                    <span className="import-menu-icon">⊘</span>
                    <span>Uninstall</span>
                  </button>
                ) : (
                  <button className="import-menu-item is-danger" onClick={() => run(onDeleteFromDisk)}>
                    <span className="import-menu-icon">🗑</span>
                    <span>Delete from Disk</span>
                  </button>
                )}
                <div className="import-menu-separator" />
                <button className="import-menu-item is-danger" onClick={() => run(onRemove)}>
                  <span className="import-menu-icon">✕</span>
                  <span>Remove from library</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
