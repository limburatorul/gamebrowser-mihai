import { promises as fs } from 'fs'
import { join, sep } from 'path'
import { load as parseYaml } from 'js-yaml'
import { normalize, titlesMatch } from './titleMatch'

/**
 * Working out where each game keeps its saves.
 *
 * The locations come from the **Ludusavi manifest** — a YAML file compiled from
 * PCGamingWiki, covering 10,000+ games, published explicitly for tools to
 * consume and rebuilt daily. That is why this feature exists at all: it is a
 * real data source with an open licence, not a site being scraped.
 *
 * The manifest is ~17MB, so it is parsed **once** when refreshed and boiled
 * down to a small index that is what actually gets loaded from then on.
 */

const MANIFEST_URL = 'https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml'

/** Rebuilt at most weekly: the upstream file changes daily, but a save
    location that moves is rare and a 17MB download is not free. */
export const MANIFEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface SaveEntry {
  /** Manifest paths, still carrying their `<placeholder>` tokens. */
  paths: string[]
}

export interface SaveIndex {
  builtAt: string
  /** Steam app id → entry. Exact, so it is tried first. */
  bySteamId: Record<string, SaveEntry>
  /** Normalised game title → entry, for everything not from Steam. */
  byTitle: Record<string, SaveEntry>
  /** Kept so name matching can apply the series-number guard, which needs the
      original title rather than the normalised key. */
  titles: string[]
}

interface ManifestWhen {
  os?: string
  store?: string
}

interface ManifestFile {
  tags?: string[]
  when?: ManifestWhen[]
}

interface ManifestGame {
  files?: Record<string, ManifestFile>
  steam?: { id?: number }
}

/**
 * Only what this app can act on: entries tagged `save`, that apply on Windows,
 * and that are not registry keys.
 *
 * Untagged entries are deliberately excluded. In the manifest an untagged path
 * means "some game data", which in practice is often the whole install folder —
 * backing that up would turn a save backup into a second copy of the game.
 */
function windowsSavePaths(game: ManifestGame): string[] {
  const out: string[] = []
  for (const [path, info] of Object.entries(game.files ?? {})) {
    if (!info?.tags?.includes('save')) continue
    const when = info.when ?? []
    // No `when` at all means "everywhere"; otherwise at least one clause must
    // either name Windows or not constrain the OS.
    if (when.length > 0 && !when.some((w) => !w.os || w.os === 'windows')) continue
    out.push(path)
  }
  return out
}

export function buildIndexFromManifest(yamlText: string): SaveIndex {
  const parsed = parseYaml(yamlText) as Record<string, ManifestGame>
  const index: SaveIndex = { builtAt: new Date().toISOString(), bySteamId: {}, byTitle: {}, titles: [] }
  for (const [title, game] of Object.entries(parsed ?? {})) {
    const paths = windowsSavePaths(game)
    if (paths.length === 0) continue
    const entry: SaveEntry = { paths }
    const steamId = game.steam?.id
    if (typeof steamId === 'number') index.bySteamId[String(steamId)] = entry
    const key = normalize(title)
    if (key && !index.byTitle[key]) {
      index.byTitle[key] = entry
      index.titles.push(title)
    }
  }
  return index
}

export async function downloadManifest(): Promise<string> {
  const res = await fetch(MANIFEST_URL, { headers: { 'User-Agent': 'game-browser' } })
  if (!res.ok) throw new Error(`Manifest download failed: HTTP ${res.status}`)
  return res.text()
}

export interface GameIdentity {
  name: string
  steamAppId: number | null
}

/**
 * Steam id first because it is exact. Falling back to the title uses the same
 * guards the trainer matcher proved out — see `titleMatch.ts` — so "Far Cry"
 * cannot be handed Far Cry 5's save folder. That mistake would be worse here
 * than it was for trainers: restoring into the wrong game's folder overwrites
 * real saves.
 */
export function findSaveEntry(index: SaveIndex, game: GameIdentity): SaveEntry | null {
  if (game.steamAppId !== null) {
    const bySteam = index.bySteamId[String(game.steamAppId)]
    if (bySteam) return bySteam
  }
  const key = normalize(game.name)
  const exact = index.byTitle[key]
  if (exact) return exact
  const loose = index.titles.find((t) => titlesMatch(t, game.name))
  return loose ? index.byTitle[normalize(loose)] : null
}

export interface Placeholders {
  base: string
  home: string
  winAppData: string
  winLocalAppData: string
  winLocalAppDataLow: string
  winDocuments: string
  winPublic: string
  winProgramData: string
  winDir: string
  osUserName: string
}

/**
 * Turns one manifest path into concrete paths on this machine.
 *
 * Placeholders this app cannot know — `<storeUserId>`, `<storeGameId>` — become
 * `*`, because they name a per-account folder that has to be discovered on
 * disk. Everything is returned as a glob for the caller to expand.
 */
export function resolvePath(manifestPath: string, p: Placeholders): string {
  const replaced = manifestPath
    .replace(/<base>/g, p.base)
    .replace(/<game>/g, p.base)
    .replace(/<root>/g, p.base)
    .replace(/<home>/g, p.home)
    .replace(/<winAppData>/g, p.winAppData)
    .replace(/<winLocalAppDataLow>/g, p.winLocalAppDataLow)
    .replace(/<winLocalAppData>/g, p.winLocalAppData)
    .replace(/<winDocuments>/g, p.winDocuments)
    .replace(/<winPublic>/g, p.winPublic)
    .replace(/<winProgramData>/g, p.winProgramData)
    .replace(/<winDir>/g, p.winDir)
    .replace(/<osUserName>/g, p.osUserName)
    .replace(/<storeUserId>/g, '*')
    .replace(/<storeGameId>/g, '*')
  return replaced.split('/').join(sep)
}

/**
 * Expands `*` segments against the real filesystem. Hand-rolled rather than
 * pulled in as a dependency: the manifest only ever uses `*` within a single
 * segment, so full glob semantics would be far more than is needed.
 */
export async function expandGlob(pattern: string): Promise<string[]> {
  const segments = pattern.split(sep)
  let candidates = [segments[0] + sep]
  for (const segment of segments.slice(1)) {
    if (!segment) continue
    const next: string[] = []
    for (const base of candidates) {
      if (!segment.includes('*')) {
        next.push(join(base, segment))
        continue
      }
      const re = new RegExp(`^${segment.split('*').map(escapeRegex).join('.*')}$`, 'i')
      try {
        for (const item of await fs.readdir(base)) if (re.test(item)) next.push(join(base, item))
      } catch {
        // unreadable or missing directory - that branch simply has no matches
      }
    }
    candidates = next
    if (candidates.length === 0) break
  }
  return candidates
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

export interface ResolvedSave {
  path: string
  isDir: boolean
}

/** Only locations that actually exist, so nothing offers to back up a folder
    the game has never created. */
export async function resolveExistingSaves(entry: SaveEntry, p: Placeholders): Promise<ResolvedSave[]> {
  const out: ResolvedSave[] = []
  const seen = new Set<string>()
  for (const manifestPath of entry.paths) {
    for (const candidate of await expandGlob(resolvePath(manifestPath, p))) {
      const key = candidate.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      try {
        const stat = await fs.stat(candidate)
        out.push({ path: candidate, isDir: stat.isDirectory() })
      } catch {
        // not created yet by this game
      }
    }
  }
  return out
}
