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

export default function CoverImage({ game, className }: Props): JSX.Element {
  const src = toLocalFileUrl(game.coverPath) ?? toLocalFileUrl(game.iconPath)
  // Bumped on each retry to force a fresh <img> element (a bare src
  // reassignment on the same element can get treated as the same failed
  // request rather than triggering a real new fetch).
  const [attempt, setAttempt] = useState(0)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const retriesRef = useRef(0)

  useEffect(() => {
    retriesRef.current = 0
    setFailedSrc(null)
    setAttempt(0)
  }, [src])

  function handleError(): void {
    if (retriesRef.current < MAX_RETRIES) {
      retriesRef.current += 1
      setTimeout(() => setAttempt((a) => a + 1), 200 * retriesRef.current)
    } else if (src) {
      setFailedSrc(src)
    }
  }

  if (src && src !== failedSrc) {
    return (
      <img
        key={attempt}
        className={className}
        src={src}
        alt={game.name}
        draggable={false}
        onError={handleError}
      />
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
