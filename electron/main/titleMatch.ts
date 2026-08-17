/**
 * Matching a game in this library against a title from somewhere else.
 *
 * Extracted from the trainer matcher, which is where these rules were worked
 * out and proved: plain substring containment matched 39 games and was **wrong
 * on 9** — "Far Cry" collected the Far Cry 5 trainer, "WATCH DOGS" got Watch
 * Dogs 2, Van Helsing got Van Helsing III. Two guards fixed it, and both are
 * needed by anything else matching an outside catalogue by name, which is why
 * they live here now rather than inside `trainers.ts`.
 */

export const normalize = (s: string): string => s.replace(/[^a-z0-9]/gi, '').toLowerCase()

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 }

/**
 * The trailing number in a title, if any. This is what stops "Far Cry" from
 * being handed Far Cry 5's data: plain substring matching says one contains
 * the other, and they are different games. Roman numerals count too, so Van
 * Helsing doesn't collect Van Helsing III.
 */
export function seriesNumber(raw: string): number | null {
  const m = raw.trim().toLowerCase().match(/(?:^|[\s:_-])(\d{1,2}|[ivx]{1,4})$/)
  if (!m) return null
  const token = m[1]
  if (/^\d+$/.test(token)) return Number(token)
  return ROMAN[token] ?? null
}

// Words that describe a release rather than a different game, so a title can
// carry them and still refer to the same thing ("Mad Max Game" / "Mad Max").
const EDITION_WORDS = [
  'game', 'edition', 'goty', 'remastered', 'remaster', 'definitive', 'deluxe', 'complete',
  'ultimate', 'enhanced', 'hd', 'redux', 'anniversary', 'collection', 'gold', 'premium',
  'directorscut', 'sce', 'repack', 'the', 'classic', 'reloaded', 'special'
]

export function extraIsOnlyEditionNoise(longer: string, shorter: string): boolean {
  let rest = longer.replace(shorter, '')
  if (!rest) return true
  for (const word of EDITION_WORDS) rest = rest.split(word).join('')
  return rest.length === 0
}

/**
 * True when two titles name the same game. Exact normalised equality, or one
 * containing the other with the same series number and nothing left over but
 * edition words.
 */
export function titlesMatch(a: string, b: string): boolean {
  const ka = normalize(a)
  const kb = normalize(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  if (!(ka.includes(kb) || kb.includes(ka))) return false
  if (seriesNumber(a) !== seriesNumber(b)) return false
  const [longer, shorter] = ka.length >= kb.length ? [ka, kb] : [kb, ka]
  return extraIsOnlyEditionNoise(longer, shorter)
}
