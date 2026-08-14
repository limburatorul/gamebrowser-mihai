const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value)
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`
}

// Blends `hex` toward `target` by `t` (0 = hex, 1 = target). Used to derive
// muted/lightened variants of an accent color for dim/hover states.
export function mixHex(hex: string, target: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(hex)
  const [r2, g2, b2] = hexToRgb(target)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

// "r, g, b" form for use inside rgba(var(--accent-rgb), alpha) box-shadows etc.
export function hexToRgbString(hex: string): string {
  return hexToRgb(hex).join(', ')
}

export const ACCENT_PRESETS = [
  '#4c8bf5', // blue (default)
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#e5484d', // red
  '#f5a524', // orange
  '#eab308', // yellow
  '#4ade80', // green
  '#2dd4bf', // teal
  '#38bdf8' // sky
]

export const SIDEBAR_PRESETS = [
  '#17181b', // default (near-black)
  '#1a1523', // deep violet
  '#151d2e', // deep navy
  '#1a2420', // deep green
  '#241a1a', // deep maroon
  '#0f0f10' // pure black-ish
]
