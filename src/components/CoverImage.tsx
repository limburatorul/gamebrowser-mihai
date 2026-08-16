import { useEffect, useRef, useState } from 'react'
import type { Game } from '@shared/types'
import { toLocalFileUrl, gradientForName } from '../lib/localFile'

interface Props {
  game: Pick<Game, 'name' | 'coverPath' | 'iconPath'>
  className?: string
}

// At startup the virtualized grid can mount well over a hundred covers at
// once (visible rows + overscan), all hitting the local-file:// protocol
// handler simultaneously - under that load a handful of reads transiently
// fail (resource contention / AV scanning the file) even though the file on
// disk is completely valid. A few retries clears these instead of
// permanently stranding the tile on the placeholder.
const MAX_RETRIES = 3

/** Width ÷ height of the cover box the grid draws (tileWidth × tileWidth*1.4). */
const BOX_RATIO = 1 / 1.4

/**
 * Whether this image can fill the box, or has to be fitted inside it.
 *
 * Cropping to fill only looks right for artwork roughly the box's own shape.
 * Steam moved newer apps to a wide `header.jpg` (no tall variant exists), and
 * games with no cover at all fall back to their 256px exe icon - filling with
 * either means throwing away most of the picture or upscaling a small square
 * into a blurry mess. Those get fitted whole instead, against a blurred copy
 * of themselves so the tile still reads as full-bleed rather than letterboxed.
 */
function shouldFit(naturalWidth: number, naturalHeight: number): boolean {
  if (!naturalWidth || !naturalHeight) return false
  return naturalWidth / naturalHeight > BOX_RATIO * 1.25 || naturalWidth < 200
}

export default function CoverImage({ game, className }: Props): JSX.Element {
  const src = toLocalFileUrl(game.coverPath) ?? toLocalFileUrl(game.iconPath)
  // Bumped on each retry to force a fresh <img> element (a bare src
  // reassignment on the same element can get treated as the same failed
  // request rather than triggering a real new fetch).
  const [attempt, setAttempt] = useState(0)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [fit, setFit] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const retriesRef = useRef(0)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    retriesRef.current = 0
    setFailedSrc(null)
    setAttempt(0)
    setFit(false)
    setLoaded(false)
  }, [src])

  // A cached image finishes loading before React attaches onLoad, so the event
  // never arrives and the cover would sit invisible at opacity 0 forever. Hit
  // constantly in practice: the details bar shows a cover the grid has already
  // pulled in. Must be declared after the reset effect above so it runs second
  // when both fire for the same src.
  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) {
      setFit(shouldFit(img.naturalWidth, img.naturalHeight))
      setLoaded(true)
    }
  }, [src, attempt])

  function handleError(): void {
    if (retriesRef.current < MAX_RETRIES) {
      retriesRef.current += 1
      setTimeout(() => setAttempt((a) => a + 1), 200 * retriesRef.current)
    } else if (src) {
      setFailedSrc(src)
    }
  }

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>): void {
    const img = e.currentTarget
    setFit(shouldFit(img.naturalWidth, img.naturalHeight))
    setLoaded(true)
  }

  if (src && src !== failedSrc) {
    return (
      <div className={`cover-frame ${className ?? ''} ${fit ? 'is-fitted' : ''}`}>
        {fit && (
          <span className="cover-fill" style={{ backgroundImage: `url("${src}")` }} aria-hidden="true" />
        )}
        <img
          key={attempt}
          ref={imgRef}
          className={`cover-photo ${loaded ? 'is-loaded' : ''}`}
          src={src}
          alt={game.name}
          draggable={false}
          onError={handleError}
          onLoad={handleLoad}
        />
      </div>
    )
  }

  const [from, to] = gradientForName(game.name)
  return (
    <div
      className={`${className ?? ''} cover-placeholder`}
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
    >
      <span>{game.name.trim().charAt(0).toUpperCase() || '?'}</span>
    </div>
  )
}
