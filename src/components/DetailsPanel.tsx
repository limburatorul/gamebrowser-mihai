import { useEffect, useState } from 'react'
import type { Game, SteamGameDetails } from '@shared/types'
import { toLocalFileUrl } from '../lib/localFile'

interface Props {
  game: Game | null
  onClose: () => void
}

export default function DetailsPanel({ game, onClose }: Props): JSX.Element {
  const [details, setDetails] = useState<SteamGameDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [lightboxPath, setLightboxPath] = useState<string | null>(null)

  useEffect(() => {
    setDetails(null)
    setNotFound(false)
    setLightboxPath(null)
    if (!game) return
    setLoading(true)
    let cancelled = false
    window.api
      .getSteamDetails(game.id)
      .then((result) => {
        if (cancelled) return
        if (result) setDetails(result)
        else setNotFound(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [game?.id])

  useEffect(() => {
    if (!lightboxPath) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setLightboxPath(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxPath])

  return (
    <aside className="details-panel">
      <div className="details-panel-header">
        <span className="details-panel-title">{game ? game.name : 'Game Details'}</span>
        <button className="btn icon-btn" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {!game && <p className="details-panel-empty">Select a game to see its Steam page details.</p>}

      {game && loading && <p className="details-panel-empty">Loading…</p>}

      {game && !loading && notFound && (
        <p className="details-panel-empty">No Steam page found for this game.</p>
      )}

      {game && !loading && details && (
        <div className="details-panel-body">
          {details.headerImage && (
            <img src={toLocalFileUrl(details.headerImage) ?? undefined} alt="" className="details-panel-banner" />
          )}

          {details.description && <p className="details-panel-description">{details.description}</p>}

          {(details.releaseDate ||
            details.developers.length > 0 ||
            details.publishers.length > 0 ||
            details.genres.length > 0 ||
            details.metacriticScore !== null) && (
            <div className="details-panel-facts">
              {details.releaseDate && (
                <div className="details-panel-fact">
                  <span className="details-panel-fact-label">Released</span>
                  <span>{details.releaseDate}</span>
                </div>
              )}
              {details.developers.length > 0 && (
                <div className="details-panel-fact">
                  <span className="details-panel-fact-label">Developer</span>
                  <span>{details.developers.join(', ')}</span>
                </div>
              )}
              {details.publishers.length > 0 && (
                <div className="details-panel-fact">
                  <span className="details-panel-fact-label">Publisher</span>
                  <span>{details.publishers.join(', ')}</span>
                </div>
              )}
              {details.genres.length > 0 && (
                <div className="details-panel-fact">
                  <span className="details-panel-fact-label">Genres</span>
                  <span>{details.genres.join(', ')}</span>
                </div>
              )}
              {details.metacriticScore !== null && (
                <div className="details-panel-fact">
                  <span className="details-panel-fact-label">Metacritic</span>
                  <span>{details.metacriticScore}</span>
                </div>
              )}
            </div>
          )}

          {details.screenshots.length > 0 && (
            <>
              <div className="details-panel-heading">Screenshots</div>
              <div className="details-panel-screenshots">
                {details.screenshots.map((path) => (
                  <img
                    key={path}
                    src={toLocalFileUrl(path) ?? undefined}
                    alt="Screenshot"
                    className="details-panel-screenshot"
                    onClick={() => setLightboxPath(path)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {lightboxPath && (
        <div className="screenshot-lightbox-overlay" onClick={() => setLightboxPath(null)}>
          <button
            className="screenshot-lightbox-close"
            title="Close"
            onClick={(e) => {
              e.stopPropagation()
              setLightboxPath(null)
            }}
          >
            ✕
          </button>
          <img
            src={toLocalFileUrl(lightboxPath) ?? undefined}
            alt="Screenshot"
            className="screenshot-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </aside>
  )
}
