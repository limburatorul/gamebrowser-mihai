import { promises as fs } from 'fs'
import { join } from 'path'

export interface SteamPlaytimeEntry {
  appid: number
  playtimeMinutes: number
  /** Unix seconds, or null when Steam never recorded one. */
  lastPlayedUnix: number | null
}

/**
 * Steam records per-game playtime locally, in
 * `<steam>/userdata/<accountId>/config/localconfig.vdf`, under
 * Software > Valve > Steam > apps as `"Playtime"` (minutes) and `"LastPlayed"`
 * (unix seconds). No web API, no key, no network - the same shape of local
 * file the Steam library import already reads.
 *
 * The file is a nested VDF, and plenty of *other* sections in it also use
 * numeric keys, so this deliberately walks down to the `apps` block by brace
 * matching before pattern-matching entries. A regex over the whole file would
 * happily pick up numbers from unrelated sections.
 */

/**
 * Returns the body of `"<key>" { ... }` starting the search at `from`, or null.
 * Brace counting ignores braces inside quoted strings, and understands VDF's
 * backslash escapes so a path value like "C:\\games\\{weird}" can't derail it.
 */
function findBlock(text: string, key: string, from = 0): { body: string; end: number } | null {
  const needle = `"${key}"`
  let i = text.indexOf(needle, from)
  while (i !== -1) {
    let j = i + needle.length
    while (j < text.length && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r' || text[j] === '\n')) j++
    if (text[j] === '{') {
      let depth = 0
      let inString = false
      for (let k = j; k < text.length; k++) {
        const c = text[k]
        if (inString) {
          if (c === '\\') k++
          else if (c === '"') inString = false
          continue
        }
        if (c === '"') inString = true
        else if (c === '{') depth++
        else if (c === '}') {
          depth--
          if (depth === 0) return { body: text.slice(j + 1, k), end: k }
        }
      }
      return null
    }
    i = text.indexOf(needle, i + needle.length)
  }
  return null
}

function parseLocalConfig(text: string): SteamPlaytimeEntry[] {
  let block: { body: string; end: number } | null = { body: text, end: 0 }
  for (const key of ['Software', 'Valve', 'Steam', 'apps']) {
    block = findBlock(block.body, key)
    if (!block) return []
  }

  const out: SteamPlaytimeEntry[] = []
  const body = block.body
  // Each direct child is `"<appid>" { ... }`. Walking with findBlock from the
  // last match keeps us on this level rather than descending into nested
  // sub-blocks that some apps have (cloud sync state, and so on).
  const appIdRe = /"(\d+)"\s*\{/g
  let m: RegExpExecArray | null
  let searchFrom = 0
  while ((m = appIdRe.exec(body)) !== null) {
    if (m.index < searchFrom) continue
    const entry = findBlock(body, m[1], m.index)
    if (!entry) continue
    const playtime = entry.body.match(/"Playtime"\s+"(\d+)"/i)
    const lastPlayed = entry.body.match(/"LastPlayed"\s+"(\d+)"/i)
    if (playtime) {
      out.push({
        appid: Number(m[1]),
        playtimeMinutes: Number(playtime[1]),
        lastPlayedUnix: lastPlayed ? Number(lastPlayed[1]) : null
      })
    }
    // Skip past this entry so nested numeric keys aren't treated as apps.
    searchFrom = entry.end
    appIdRe.lastIndex = entry.end
  }
  return out
}

/**
 * Merges every Steam account on this machine. A shared PC can have several,
 * and the highest recorded playtime for an app is the useful one.
 */
export async function readSteamPlaytime(steamPath: string): Promise<Map<number, SteamPlaytimeEntry>> {
  const merged = new Map<number, SteamPlaytimeEntry>()
  let userDirs: string[]
  try {
    const entries = await fs.readdir(join(steamPath, 'userdata'), { withFileTypes: true })
    userDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return merged
  }

  for (const user of userDirs) {
    let raw: string
    try {
      raw = await fs.readFile(join(steamPath, 'userdata', user, 'config', 'localconfig.vdf'), 'utf-8')
    } catch {
      continue
    }
    for (const entry of parseLocalConfig(raw)) {
      const existing = merged.get(entry.appid)
      if (!existing || entry.playtimeMinutes > existing.playtimeMinutes) merged.set(entry.appid, entry)
    }
  }
  return merged
}
