import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Game, SteamGameDetails } from '@shared/types'
import { formatDuration, toLocalFileUrl } from '../lib/localFile'

interface Props {
  game: Game | null
  open: boolean
  onClose: () => void
  onLightboxOpenChange: (open: boolean) => void
}

export default function DetailsPanel({ game, open, onClose, onLightboxOpenChange }: Props): JSX.Element {
  const [details, setDetails] = useState<SteamGameDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [lightboxPath, setLightboxPath] = useState<string | null>(null)

  const hasTimeToBeat =
    game !== null &&
    (game.hltbMainSeconds !== null ||
      game.hltbMainExtraSeconds !== null ||
      game.hltbCompletionistSeconds !== null)

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

  const screenshots = details?.screenshots ?? []
  const lightboxIndex = lightboxPath ? screenshots.indexOf(lightboxPath) : -1

  function showPrev(): void {
    if (screenshots.length === 0) return
    const idx = lightboxIndex <= 0 ? screenshots.length - 1 : lightboxIndex - 1
    setLightboxPath(screenshots[idx])
  }

  function showNext(): void {
    if (screenshots.length === 0) return
    const idx = lightboxIndex === screenshots.length - 1 ? 0 : lightboxIndex + 1
    setLightboxPath(screenshots[idx])
  }

  useEffect(() => {
    onLightboxOpenChange(lightboxPath !== null)
  }, [lightboxPath, onLightboxOpenChange])

  useEffect(() => {
    if (!lightboxPath) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setLightboxPath(null)
      if (e.key === 'ArrowLeft') showPrev()
      if (e.key === 'ArrowRight') showNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxPath])

  return (
    <aside className={`details-panel ${open ? '' : 'details-panel-hidden'}`}>
      <div className="details-panel-header">
        <span className="details-panel-title">{game ? game.name : 'Game Details'}</span>
        <button className="btn icon-btn" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {/* Above the Steam content and outside it on purpose: these times are
          typed in by the user, so they must survive a game having no Steam
          page at all — which is exactly the obscure game someone bothered to
          fill in by hand. */}
      {game && hasTimeToBeat && (
        <div className="details-panel-hltb">
          <span className="details-panel-hltb-label">Time to beat</span>
          <div className="details-panel-hltb-values">
            {game.hltbMainSeconds !== null && (
              <span title="Main story">
                Main <strong>{formatDuration(game.hltbMainSeconds)}</strong>
              </span>
            )}
            {game.hltbMainExtraSeconds !== null && (
              <span title="Main story plus side content">
                + Extras <strong>{formatDuration(game.hltbMainExtraSeconds)}</strong>
              </span>
            )}
            {game.hltbCompletionistSeconds !== null && (
              <span title="Everything there is to do">
                100% <strong>{formatDuration(game.hltbCompletionistSeconds)}</strong>
              </span>
            )}
          </div>
        </div>
      )}

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

          {screenshots.length > 0 && (
            <>
              <div className="details-panel-heading">Screenshots</div>
              <div className="details-panel-screenshots">
                {screenshots.map((path) => (
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

      {/* Portaled straight to document.body: rendering this fixed-position
          overlay as a normal child of .details-panel kept it visually
          confined to the panel's box in testing even without any transform
          on the panel (sidebar/topbar/panel content still showed through
          around it) - a portal sidesteps whatever ancestor containment was
          causing that instead of chasing the exact CSS cause further. */}
      {lightboxPath &&
        createPortal(
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
            {screenshots.length > 1 && (
              <button
                className="screenshot-lightbox-nav screenshot-lightbox-prev"
                title="Previous"
                onClick={(e) => {
                  e.stopPropagation()
                  showPrev()
                }}
              >
                ‹
              </button>
            )}
            <img
              src={toLocalFileUrl(lightboxPath) ?? undefined}
              alt="Screenshot"
              className="screenshot-lightbox-img"
              onClick={(e) => e.stopPropagation()}
            />
            {screenshots.length > 1 && (
              <button
                className="screenshot-lightbox-nav screenshot-lightbox-next"
                title="Next"
                onClick={(e) => {
                  e.stopPropagation()
                  showNext()
                }}
              >
                ›
              </button>
            )}
          </div>,
          document.body
        )}
    </aside>
  )
}
