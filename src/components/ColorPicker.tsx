import { useEffect, useState } from 'react'
import { isValidHex } from '../lib/color'

interface Props {
  label: string
  value: string
  presets: string[]
  onChange: (hex: string) => void
}

export default function ColorPicker({ label, value, presets, onChange }: Props): JSX.Element {
  const [hexText, setHexText] = useState(value)

  useEffect(() => {
    setHexText(value)
  }, [value])

  function handleHexInput(v: string): void {
    setHexText(v)
    if (isValidHex(v)) onChange(v)
  }

  return (
    <div className="color-picker-row">
      <span className="settings-slider-label">{label}</span>
      <div className="color-picker-swatches">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`color-swatch ${value.toLowerCase() === preset.toLowerCase() ? 'selected' : ''}`}
            style={{ background: preset }}
            title={preset}
            onClick={() => onChange(preset)}
          />
        ))}
        <label className="color-swatch color-swatch-custom" title="Custom color" style={{ background: value }}>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="color-swatch-input"
          />
        </label>
        <input
          className="color-hex-input"
          type="text"
          value={hexText}
          maxLength={7}
          onChange={(e) => handleHexInput(e.target.value)}
          onBlur={() => setHexText(value)}
        />
      </div>
    </div>
  )
}
