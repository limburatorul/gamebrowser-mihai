import { useEffect, useState } from 'react'
import type { Game, SteamGameDetails } from '@shared/types'

interface Props {
  game: Game | null
  onClose: () => void
}

export default function DetailsPanel({ game, onClose }: Props): JSX.Element {
  const [details, setDetails] = useState<SteamGameDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    setDetails(null)
    setNotFound(false)
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
            <img src={details.headerImage} alt="" className="details-panel-banner" />
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
                {details.screenshots.map((url) => (
                  <img key={url} src={url} alt="Screenshot" className="details-panel-screenshot" />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  )
}
