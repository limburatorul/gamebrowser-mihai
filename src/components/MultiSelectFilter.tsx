import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Shown when nothing is picked, e.g. "All Genres". */
  emptyLabel: string
  /** Plural noun for the summary once several are picked, e.g. "genres". */
  noun: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  title?: string
}

/**
 * A filter that takes several values at once.
 *
 * Deliberately a button plus an absolutely-positioned panel rather than a
 * `<select multiple>`: the native one is a permanently-open scrolling box that
 * would wreck the topbar's height.
 *
 * **The width constraint is the thing to preserve here.** The topbar is what
 * sets this app's minimum window width, and it used to be unbounded because a
 * `<select>` sizes itself to its widest option — fixed by capping `.select` at
 * 160px. This trigger carries the same cap, and the panel is out of flow, so
 * the topbar's footprint does not grow with the longest genre or tag. Re-
 * measure with the CDP recipe if that ever changes.
 */
export default function MultiSelectFilter({
  emptyLabel,
  noun,
  options,
  selected,
  onChange,
  title
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // One pick reads better as its own name than as "1 genre"; past that the
  // names would not fit and a count is what the user is tracking anyway.
  const label = selected.length === 0 ? emptyLabel : selected.length === 1 ? selected[0] : `${selected.length} ${noun}`

  function toggle(value: string): void {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <div className="multiselect" ref={rootRef}>
      <button
        className={`select multiselect-trigger ${selected.length > 0 ? 'active' : ''}`}
        title={selected.length > 0 ? selected.join(', ') : title}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="multiselect-label">{label}</span>
      </button>
      {open && (
        <div className="multiselect-panel">
          <button className="multiselect-clear" disabled={selected.length === 0} onClick={() => onChange([])}>
            {emptyLabel}
          </button>
          <div className="multiselect-options">
            {options.map((option) => (
              <label key={option} className="multiselect-option">
                <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
