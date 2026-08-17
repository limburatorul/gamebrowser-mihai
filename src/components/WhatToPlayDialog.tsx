import { useCallback, useMemo, useState } from 'react'
import type { Game } from '@shared/types'
import CoverImage from './CoverImage'
import { formatDuration, formatSize } from '../lib/localFile'
import { pickOne, recommend, type Recommendation } from '../lib/recommend'

interface Props {
  games: Game[]
  onClose: () => void
  onLaunch: (id: string) => void
}

/** Top genres shown as the reason, and how many alternatives to list. */
const PROFILE_GENRES = 4
const ALTERNATIVES = 3
/** How many recent picks to avoid repeating. */
const RECENT_MEMORY = 8

export default function WhatToPlayDialog({ games, onClose, onLaunch }: Props): JSX.Element {
  // Derived from the library on every render, so the profile follows playtime
  // around by itself - after a Steam sync or an evening on something new, the
  // next press already reflects it.
  const { affinities, ranked, blind } = useMemo(() => recommend(games), [games])

  const [pick, setPick] = useState<Recommendation | null>(() => pickOne(ranked))
  // The last few, not just the current one, so "Pick another" doesn't circle
  // back to something you saw two presses ago.
  const [recent, setRecent] = useState<string[]>(() => (pick ? [pick.game.id] : []))

  const show = useCallback((next: Recommendation | null) => {
    if (!next) return
    setPick(next)
    setRecent((prev) => [next.game.id, ...prev].slice(0, RECENT_MEMORY))
  }, [])

  const again = useCallback(() => show(pickOne(ranked, recent)), [ranked, recent, show])

  const alternatives = useMemo(
    () => ranked.filter((r) => r.game.id !== pick?.game.id).slice(0, ALTERNATIVES),
    [ranked, pick]
  )

  const profile = affinities.slice(0, PROFILE_GENRES)

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal whattoplay-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>What should I play?</h2>

        {pick === null ? (
          <p className="settings-note">
            {games.some((g) => !g.hidden)
              ? 'You have played everything in your library. Nothing left to suggest.'
              : 'Your library is empty.'}
          </p>
        ) : (
          <>
            <p className="modal-sub">
              {blind ? (
                <>
                  Not enough to go on yet — nothing you have played shares a genre with anything you have not, so
                  this is simply a random pick from your unplayed games. It will get smarter as you play.
                </>
              ) : (
                <>
                  Drawn from the games you have never played, weighted towards what you actually spend time on.
                  Press again for another.
                </>
              )}
            </p>

            <div className="whattoplay-pick">
              <div className="whattoplay-cover">
                <CoverImage game={pick.game} className="cover-img" />
              </div>
              <div className="whattoplay-info">
                <div className="whattoplay-name">{pick.game.name}</div>
                {pick.game.genres.length > 0 && (
                  <div className="whattoplay-genres">{pick.game.genres.join(' · ')}</div>
                )}
                {pick.matchedGenres.length > 0 && (
                  <div className="whattoplay-why">
                    Because you play{' '}
                    {pick.matchedGenres.map((genre, i) => (
                      <span key={genre}>
                        {i > 0 && (i === pick.matchedGenres.length - 1 ? ' and ' : ', ')}
                        <strong>{genre}</strong>
                      </span>
                    ))}
                  </div>
                )}
                <div className="whattoplay-meta">
                  {pick.game.installSizeBytes !== null && <span>{formatSize(pick.game.installSizeBytes)}</span>}
                  {pick.game.trainerPath && <span>⚡ Trainer</span>}
                </div>
              </div>
            </div>

            <div className="whattoplay-actions">
              <button className="btn btn-primary" onClick={() => onLaunch(pick.game.id)}>
                ▶ Play
              </button>
              <button className="btn" onClick={again}>
                Pick another
              </button>
            </div>

            {alternatives.length > 0 && (
              <>
                <h3 className="settings-section">Also worth a look</h3>
                <ul className="whattoplay-alts">
                  {alternatives.map((alt) => (
                    <li key={alt.game.id}>
                      <button className="whattoplay-alt" onClick={() => show(alt)}>
                        <span className="whattoplay-alt-name">{alt.game.name}</span>
                        <span className="whattoplay-alt-why">
                          {alt.matchedGenres.length > 0 ? alt.matchedGenres.join(', ') : 'no genre match'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {profile.length > 0 && (
          <>
            <h3 className="settings-section">What you actually play</h3>
            <ul className="whattoplay-profile">
              {profile.map((a) => (
                <li key={a.genre} className="whattoplay-profile-row">
                  <span className="whattoplay-profile-genre">{a.genre}</span>
                  <span className="whattoplay-profile-track">
                    <span
                      className="whattoplay-profile-fill"
                      style={{ width: `${Math.max(3, Math.round((a.share / profile[0].share) * 100))}%` }}
                    />
                  </span>
                  <span className="whattoplay-profile-value">{formatDuration(a.seconds)}</span>
                </li>
              ))}
            </ul>
            <p className="settings-note">
              A game&apos;s hours are split across its genres, so a game tagged with six of them does not count six
              times. Anything set to &ldquo;ignore playtime&rdquo; is left out.
            </p>
          </>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
