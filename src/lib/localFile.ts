export function toLocalFileUrl(path: string | null): string | null {
  if (!path) return null
  // A non-empty placeholder host is required: Chromium only allows an empty
  // host (`scheme:///path`) for the literal "file" scheme, not custom ones,
  // and putting the real path in the host position breaks on the colon in
  // Windows drive letters (parsed as a port separator).
  return `local-file://cover/${encodeURIComponent(path)}`
}

const GRADIENTS = [
  ['#6a5acd', '#3a2f7d'],
  ['#2f855a', '#1a3d2b'],
  ['#c05621', '#5c2a0e'],
  ['#2b6cb0', '#153a5c'],
  ['#b83280', '#521636'],
  ['#2c7a7b', '#123939'],
  ['#975a16', '#432705']
]

export function gradientForName(name: string): [string, string] {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return GRADIENTS[hash % GRADIENTS.length] as [string, string]
}

export function formatPlaytime(seconds: number): string {
  if (seconds < 60) return 'Not played'
  const hours = seconds / 3600
  if (hours < 1) return `${Math.round(seconds / 60)} min`
  return `${hours.toFixed(1)} h`
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return 'Not measured'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  const gb = bytes / (1024 * 1024 * 1024)
  // Individual games never get this big, but whole-drive totals do, and
  // "27649 GB" is not a number anyone can read at a glance.
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
