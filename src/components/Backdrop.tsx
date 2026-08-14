import { useEffect, useMemo, useRef, useState } from 'react'
import { toLocalFileUrl } from '../lib/localFile'

interface Props {
  coverPaths: string[]
  enabled: boolean
  intervalSec: number
  brightness: number
  blurPx: number
}

// Fisher-Yates shuffle, seeded only by call time (fine — this just picks a display order, not anything security-sensitive).
function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export default function Backdrop({ coverPaths, enabled, intervalSec, brightness, blurPx }: Props): JSX.Element | null {
  const order = useMemo(() => shuffled(coverPaths), [coverPaths.join('|')])
  const indexRef = useRef(0)

  // Two permanently-mounted layers ("slots") whose image + active-ness are toggled,
  // instead of mounting/unmounting a div per cover — a freshly-mounted element has no
  // prior frame to transition from, so it was popping straight to its target opacity.
  const [slots, setSlots] = useState<[string | null, string | null]>([null, null])
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0)

  useEffect(() => {
    indexRef.current = 0
    if (order.length === 0) {
      setSlots([null, null])
      return
    }
    setSlots([toLocalFileUrl(order[0]), order.length > 1 ? toLocalFileUrl(order[1]) : null])
    setActiveSlot(0)
  }, [order])

  useEffect(() => {
    if (!enabled || order.length < 2) return
    const id = setInterval(() => {
      const nextIndex = (indexRef.current + 1) % order.length
      indexRef.current = nextIndex
      const nextUrl = toLocalFileUrl(order[nextIndex])
      const nextSlot = activeSlot === 0 ? 1 : 0
      setSlots((prev) => {
        const copy: [string | null, string | null] = [...prev]
        copy[nextSlot] = nextUrl
        return copy
      })
      setActiveSlot(nextSlot)
    }, intervalSec * 1000)
    return () => clearInterval(id)
  }, [enabled, order, intervalSec, activeSlot])

  if (!enabled || order.length === 0) return null

  return (
    <div
      className="backdrop-layer"
      style={{ '--backdrop-brightness': String(brightness), '--backdrop-blur': `${blurPx}px` } as React.CSSProperties}
    >
      {([0, 1] as const).map((slot) =>
        slots[slot] ? (
          <div
            key={slot}
            className={`backdrop-image ${slot === activeSlot ? 'is-active' : ''}`}
            style={{ backgroundImage: `url("${slots[slot]}")` }}
          />
        ) : null
      )}
    </div>
  )
}
