interface Props {
  value: number | null
  onChange?: (value: number | null) => void
  size?: 'sm' | 'md' | 'lg'
}

const STARS = [1, 2, 3, 4, 5]

export default function StarRating({ value, onChange, size = 'md' }: Props): JSX.Element {
  const interactive = Boolean(onChange)
  return (
    <span className={`star-rating star-rating-${size} ${interactive ? 'interactive' : ''}`}>
      {STARS.map((n) => (
        <span
          key={n}
          className={`star ${value !== null && n <= value ? 'filled' : ''}`}
          onClick={interactive ? () => onChange?.(value === n ? null : n) : undefined}
          title={interactive ? `Rate ${n} star${n === 1 ? '' : 's'}` : undefined}
        >
          ★
        </span>
      ))}
    </span>
  )
}
