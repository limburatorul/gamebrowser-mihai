import { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu, shell } from 'electron'
import { join, dirname, basename, extname } from 'path'
import { promises as fs, watch, type Dirent } from 'fs'
import { randomUUID } from 'crypto'
import { fork, execFile, spawn, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import type {
  Game,
  GameCandidate,
  ScanProgress,
  CoverFetchResult,
  Settings,
  BackupPrefs,
  BackupResult,
  BackupListResult,
  ImportResult,
  UpdateCheckResult,
  UpdateApplyResult,
  LibrarySyncEvent,
  Category,
  SteamGameDetails,
  ScreenshotSweepResult,
  SteamPlaytimeSyncResult,
  MetadataSweepResult,
  DiskSizeSweepResult,
  TrainerScanResult
} from '../../shared/types'
import { createZip, extractZip } from './zip'
import { writeFileAtomic, copyFileAtomic } from './fsAtomic'
import { findGogGames, type GogGame } from './gog'
import { readSteamPlaytime } from './steamPlaytime'
import { scanTrainerFolder, matchTrainer, trainerSearchUrl } from './trainers'

const execFileAsync = promisify(execFile)

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

// Pin the app name so userData (library, covers, settings) stays in the same
// folder whether running via `npm run dev` or the packaged/portable build,
// regardless of the display productName used for the packaged .exe.
app.setName('game-browser')

// Two windows sharing one library.json is a footgun: each keeps its own
// in-memory copy, so a fetch/edit in one silently "disappears" in the other
// until restart. Only ever allow a single running instance; a second launch
// just focuses the existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // app.quit() only *schedules* a graceful shutdown — the rest of this
  // module (including app.whenReady, which loads and can rewrite
  // library.json) would still run in the meantime. Terminate this rejected
  // instance immediately, before any of that wiring happens.
  app.exit(0)
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

const userDataPath = app.getPath('userData')
const libraryFile = join(userDataPath, 'library.json')
const coversDir = join(userDataPath, 'covers')
const iconsDir = join(userDataPath, 'icons')
const screenshotsDir = join(userDataPath, 'screenshots')
// Matched trainers are copied in here so the set travels with the library and
// gets picked up by backups, instead of depending on wherever they were
// originally downloaded still existing.
const trainersDir = join(userDataPath, 'trainers')
const settingsFile = join(userDataPath, 'settings.json')
const categoriesFile = join(userDataPath, 'categories.json')

// This fork's self-updater points at its own repo, so it only ever sees
// releases published there - never the main repo's.
const UPDATE_REPO = 'limburatorul/gamebrowser-mihai'

let games: Game[] = []
let settings: Settings = {
  igdbClientId: '',
  igdbClientSecret: '',
  rawgApiKey: '',
  backupFolder: '',
  backupEnabled: false,
  backupIntervalHours: 24,
  backupKeepCount: 5,
  trainerFolder: '',
  watchDownloadsForTrainers: true,
  lastBackupAt: null,
  librarySyncEnabled: true
}
const runningProcesses = new Map<string, { child: ChildProcess; start: number }>()

async function loadLibrary(): Promise<void> {
  try {
    const raw = await fs.readFile(libraryFile, 'utf-8')
    const parsed = JSON.parse(raw) as Game[]
    games = parsed.map((g) => ({
      ...g,
      genres: g.genres ?? [],
      tags: g.tags ?? [],
      rating: g.rating ?? null,
      categoryIds: g.categoryIds ?? [],
      excludeFromPlaytime: g.excludeFromPlaytime ?? false,
      installSizeBytes: g.installSizeBytes ?? null,
      sizeMeasuredAt: g.sizeMeasuredAt ?? null,
      trainerPath: g.trainerPath ?? null,
      steamAppId: g.steamAppId ?? null,
      epicAppName: g.epicAppName ?? null,
      gogProductId: g.gogProductId ?? null,
      ubisoftId: g.ubisoftId ?? null
    }))
  } catch {
    games = []
  }
}

async function saveLibrary(): Promise<void> {
  await fs.writeFile(libraryFile, JSON.stringify(games, null, 2), 'utf-8')
}

async function loadSettings(): Promise<void> {
  try {
    const raw = await fs.readFile(settingsFile, 'utf-8')
    settings = { ...settings, ...JSON.parse(raw) }
  } catch {
    // no settings file yet, keep defaults
  }
}

async function saveSettingsToDisk(): Promise<void> {
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), 'utf-8')
}

let categories: Category[] = []

async function loadCategories(): Promise<void> {
  try {
    const raw = await fs.readFile(categoriesFile, 'utf-8')
    categories = JSON.parse(raw) as Category[]
  } catch {
    categories = []
  }
}

async function saveCategories(): Promise<void> {
  await fs.writeFile(categoriesFile, JSON.stringify(categories, null, 2), 'utf-8')
}

function broadcastCategories(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('categories:changed', categories)
}

function broadcastLibrary(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('library:changed', games)
}

function broadcastLibrarySynced(events: LibrarySyncEvent[]): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('library:synced', events)
}

function broadcastRunning(id: string, running: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('game:running-changed', { id, running })
}

function broadcastScanProgress(progress: ScanProgress | null): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('scan:progress', progress)
}

function broadcastCoverFetchProgress(progress: ScanProgress | null): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('cover-fetch:progress', progress)
}

function broadcastBackupProgress(progress: ScanProgress | null): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('backup:progress', progress)
}

function broadcastDiskSizeProgress(progress: ScanProgress | null): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('disk-size:progress', progress)
}

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
}

function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

const EDITION_SUFFIX_RE =
  /\b(game of the year|goty|definitive|deluxe|ultimate|complete|gold|enhanced|remastered|remaster|anniversary|director'?s cut|special|extended|standard|digital|premium)\s*(edition)?\b/g

function normalizeGameName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(EDITION_SUFFIX_RE, '')
    .replace(/[:\-–—'".,!?()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const RELEASE_GROUPS = [
  'CODEX', 'PLAZA', 'RELOADED', 'SKIDROW', 'EMPRESS', 'TENOKE', 'RUNE', 'FLT', 'HOODLUM',
  'DARKSIDERS', 'RAZOR1911', 'RAZOR', 'P2P', 'GOG', 'ELAMIGOS', 'FITGIRL', 'DODI', 'KAOS',
  'CPY', '3DM', 'PROPHET', 'TINYISO', 'FCKDRM', 'ANOMALY', 'SIMPLEX', 'ALI213', 'DOGE',
  'ROGUE', 'RIP', 'REPACK', 'PROPER', 'READNFO', 'CRACKED', 'UNLOCKED', 'GOTY'
]
const RELEASE_GROUP_SUFFIX_RE = new RegExp(`[\\s._-]+(${RELEASE_GROUPS.join('|')})\\b`, 'gi')

function cleanGameName(rawName: string): string {
  let name = rawName
    .replace(/^www\.[^\s._-]+\.[a-z]{2,}\s*[-_]?\s*/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')

  name = name
    .replace(/[._-]?\bv\d+(?:\.\d+)*\b/gi, ' ')
    .replace(/[._-]?\bbuild[._\s]?\d+\b/gi, ' ')
    .replace(/\bmulti\d*\b/gi, ' ')

  name = name.replace(/[._]/g, ' ')

  name = name.replace(/\b(incl\.?|including)?\s*(\+\s*)?(all\s+)?dlc(?:'s|s)?\b/gi, ' ')

  let prev: string
  do {
    prev = name
    name = name.replace(RELEASE_GROUP_SUFFIX_RE, '')
  } while (name !== prev)

  name = name
    .replace(/[-_]+$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return name.length > 0 ? name : rawName.trim()
}

interface IgdbToken {
  accessToken: string
  expiresAt: number
}

// net.fetch has no default timeout, and merely aborting the initial request
// isn't enough - a stall can just as easily happen mid-body (e.g. a large
// image/exe download whose connection stops making progress after headers
// already arrived). A single stuck request like that hangs forever, which
// is fatal for anything that calls it in a sequential loop: sweepMissingScreenshots
// processes hundreds of games one at a time with no per-request cutoff, so
// one bad connection permanently stops it partway through with nothing to
// show for it - exactly what silently happened before this existed. `fn`
// gets the abort signal to pass into net.fetch AND should do any body
// consumption (`.json()`/`.arrayBuffer()`) inside itself, so the whole
// operation - not just getting a response header - is bounded by timeoutMs.
async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

let igdbToken: IgdbToken | null = null

async function getIgdbToken(): Promise<string | null> {
  if (!settings.igdbClientId || !settings.igdbClientSecret) return null
  if (igdbToken && igdbToken.expiresAt > Date.now() + 60_000) return igdbToken.accessToken
  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(settings.igdbClientId)}&client_secret=${encodeURIComponent(settings.igdbClientSecret)}&grant_type=client_credentials`
  try {
    return await withTimeout(async (signal) => {
      const res = await net.fetch(url, { method: 'POST', signal })
      if (!res.ok) return null
      const data = (await res.json()) as { access_token: string; expires_in: number }
      igdbToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
      return igdbToken.accessToken
    })
  } catch {
    return null
  }
}

interface IgdbCoverMatch {
  name: string
  imageId: string
  genres: string[]
}

interface IgdbGameResult {
  name: string
  cover?: { image_id: string }
  genres?: { name: string }[]
}

async function searchIgdbCover(name: string): Promise<IgdbCoverMatch | null> {
  const token = await getIgdbToken()
  if (!token) return null
  const escaped = name.replace(/"/g, '\\"')
  const body = `search "${escaped}"; fields name,cover.image_id,genres.name; limit 5;`
  try {
    return await withTimeout(async (signal) => {
      const res = await net.fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
          'Client-ID': settings.igdbClientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain'
        },
        body,
        signal
      })
      if (!res.ok) return null
      const results = (await res.json()) as IgdbGameResult[]
      const withCover = results.filter(
        (r): r is IgdbGameResult & { cover: { image_id: string } } => !!r.cover?.image_id
      )
      if (withCover.length === 0) return null
      const norm = normalizeGameName(name)
      const exact = withCover.find((r) => normalizeGameName(r.name) === norm)
      const chosen = exact ?? withCover[0]
      return {
        name: chosen.name,
        imageId: chosen.cover.image_id,
        genres: chosen.genres?.map((g) => g.name) ?? []
      }
    })
  } catch {
    return null
  }
}

async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    return await withTimeout(async (signal) => {
      const res = await net.fetch(url, { signal })
      if (!res.ok) return false
      const buf = Buffer.from(await res.arrayBuffer())
      await writeFileAtomic(destPath, buf)
      return true
    }, 20000)
  } catch {
    return false
  }
}

async function searchIgdbCoverWithFallback(name: string): Promise<IgdbCoverMatch | null> {
  const direct = await searchIgdbCover(name)
  if (direct) return direct
  const simplified = name.split(/[:\-–—]/)[0].trim()
  if (simplified && simplified !== name && simplified.length >= 3) {
    return await searchIgdbCover(simplified)
  }
  return null
}

async function fetchIgdbMetadataForGame(game: Game, needsCover: boolean): Promise<boolean> {
  const match = await searchIgdbCoverWithFallback(game.name)
  if (!match) return false
  let changed = false
  if (needsCover) {
    const url = `https://images.igdb.com/igdb/image/upload/t_cover_big/${match.imageId}.jpg`
    const dest = join(coversDir, `${game.id}.jpg`)
    if (await downloadImage(url, dest)) {
      game.coverPath = dest
      changed = true
    }
  }
  if (game.genres.length === 0 && match.genres.length > 0) {
    game.genres = match.genres
    changed = true
  }
  return changed
}

interface SteamSearchItem {
  id: number
  name: string
}

interface SteamMatch {
  appid: number
  coverUrl: string
}

// Steam's CDN doesn't have a single guaranteed image per app - some only
// have header.jpg, not the taller library art. Tries the best option first.
async function findSteamCoverUrl(appid: number, signal: AbortSignal): Promise<string | null> {
  for (const variant of ['library_600x900_2x.jpg', 'library_600x900.jpg', 'header.jpg']) {
    const url = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/${variant}`
    try {
      const check = await net.fetch(url, { method: 'HEAD', signal })
      if (check.ok) return url
    } catch {
      // try next variant
    }
  }
  return null
}

async function searchSteamMatch(name: string): Promise<SteamMatch | null> {
  try {
    return await withTimeout(async (signal) => {
      const res = await net.fetch(
        `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=us`,
        { signal }
      )
      if (!res.ok) return null
      const data = (await res.json()) as { items?: SteamSearchItem[] }
      const item = data.items?.[0]
      if (!item) return null
      const coverUrl = await findSteamCoverUrl(item.id, signal)
      if (!coverUrl) return null
      return { appid: item.id, coverUrl }
    })
  } catch {
    return null
  }
}

async function fetchSteamGenres(appid: number): Promise<string[]> {
  try {
    return await withTimeout(async (signal) => {
      const res = await net.fetch(
        `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&filters=genres`,
        { signal }
      )
      if (!res.ok) return []
      const data = (await res.json()) as Record<
        string,
        { success: boolean; data?: { genres?: { description: string }[] } }
      >
      const entry = data[String(appid)]
      if (!entry?.success) return []
      return entry.data?.genres?.map((g) => g.description) ?? []
    })
  } catch {
    return []
  }
}

interface SteamAppDetailsResponse {
  short_description?: string
  header_image?: string
  screenshots?: { id: number; path_thumbnail: string; path_full: string }[]
  release_date?: { coming_soon: boolean; date: string }
  developers?: string[]
  publishers?: string[]
  genres?: { description: string }[]
  metacritic?: { score: number }
}

interface SteamAppDetailsFetch {
  details: SteamGameDetails | null
  rateLimited: boolean
}

async function fetchSteamAppDetails(appid: number): Promise<SteamAppDetailsFetch> {
  try {
    return await withTimeout(async (signal) => {
      const res = await net.fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`, {
        signal
      })
      if (res.status === 429) return { details: null, rateLimited: true }
      if (!res.ok) return { details: null, rateLimited: false }
      const data = (await res.json()) as Record<string, { success: boolean; data?: SteamAppDetailsResponse }>
      const entry = data[String(appid)]
      if (!entry?.success || !entry.data) return { details: null, rateLimited: false }
      const d = entry.data
      return {
        details: {
          appid,
          description: d.short_description ?? '',
          headerImage: d.header_image ?? null,
          screenshots: d.screenshots?.map((s) => s.path_full) ?? [],
          releaseDate: d.release_date?.date ?? null,
          developers: d.developers ?? [],
          publishers: d.publishers ?? [],
          genres: d.genres?.map((g) => g.description) ?? [],
          metacriticScore: d.metacritic?.score ?? null
        },
        rateLimited: false
      }
    })
  } catch {
    return { details: null, rateLimited: false }
  }
}

// Downloads the Steam-hosted header image and screenshots into screenshotsDir
// (cached by appid, so re-opening the same game's details doesn't re-fetch)
// and rewrites the details object to point at the local copies instead of
// the remote URLs - keeps them available offline and part of the backup zip.
async function localizeSteamImages(appid: number, details: SteamGameDetails): Promise<SteamGameDetails> {
  async function localize(url: string, filename: string): Promise<string | null> {
    const dest = join(screenshotsDir, filename)
    try {
      await fs.access(dest)
      return dest
    } catch {
      // not cached yet, fall through to download
    }
    return (await downloadImage(url, dest)) ? dest : null
  }

  const headerImage = details.headerImage ? await localize(details.headerImage, `${appid}-header.jpg`) : null

  const screenshots: string[] = []
  for (let i = 0; i < details.screenshots.length; i++) {
    const local = await localize(details.screenshots[i], `${appid}-${i}.jpg`)
    if (local) screenshots.push(local)
  }

  return { ...details, headerImage, screenshots }
}

async function hasLocalScreenshot(appid: number): Promise<boolean> {
  try {
    await fs.access(join(screenshotsDir, `${appid}-0.jpg`))
    return true
  } catch {
    return false
  }
}

// Gradually fills in the screenshots/banner cache for every Steam-tagged
// game that doesn't have one yet, so opening the Game Details panel later is
// instant instead of hitting Steam's API for the first time. Scoped to games
// with a known steamAppId only - matching non-Steam games by name for an
// opportunistic background sweep would mean a lot of speculative searches
// for titles that may not even have a Steam page; those still get fetched
// on demand (and cached) when the details panel is opened. A 1.5s gap
// between requests keeps this polite to Steam's API; safe to call again
// while a previous sweep is still running since each game is skipped once
// its files exist on disk, so overlapping sweeps just do redundant cache
// checks rather than duplicate downloads.
const SCREENSHOT_SWEEP_CONCURRENCY = 2
const SCREENSHOT_SWEEP_DELAY_MS = 1200
const SCREENSHOT_SWEEP_RATE_LIMIT_BASE_BACKOFF_MS = 60000
const SCREENSHOT_SWEEP_RATE_LIMIT_MAX_BACKOFF_MS = 15 * 60000

// Shared across sweep calls: once Steam responds 429, every worker (and any
// later sweep - next startup, next Steam import) waits out this window
// before trying again. Grows exponentially on repeated 429s instead of
// retrying the same fixed 60s wait indefinitely against a block that may
// well last longer than that, and resets back to the base once a request
// actually succeeds.
let steamRateLimitedUntil = 0
let steamRateLimitBackoffMs = SCREENSHOT_SWEEP_RATE_LIMIT_BASE_BACKOFF_MS

// Games (by id) where a name search already came back with no Steam match
// this session - skipped on later sweep passes instead of re-searching
// every 15 minutes forever. Session-only (resets on restart) since there's
// nowhere better to persist "we checked and there's no match" on a Game
// without adding a whole new field for it, and Steam's catalog changing
// enough to flip this answer is rare enough that a restart-scoped memory is
// good enough.
const noSteamMatchGameIds = new Set<string>()

// Result shape is shared with the renderer (shared/types.ts) so the manual
// "Check Now" trigger (Settings > Automation) can show the user what
// actually happened instead of the silent black box the automatic-only
// version was - "left it running overnight, nothing downloaded" was
// impossible to diagnose further without this.
async function sweepMissingScreenshots(): Promise<ScreenshotSweepResult> {
  const targets = games
  if (Date.now() < steamRateLimitedUntil) {
    return {
      totalGames: targets.length,
      alreadyCached: 0,
      attempted: 0,
      downloaded: 0,
      matchedByName: 0,
      noStorePage: 0,
      noMatch: 0,
      rateLimited: true,
      retryAfter: new Date(steamRateLimitedUntil).toISOString()
    }
  }

  let nextIndex = 0
  let rateLimitHit = false
  let libraryChanged = false
  let alreadyCached = 0
  let attempted = 0
  let downloaded = 0
  let matchedByName = 0
  let noStorePage = 0
  let noMatch = 0

  // A fixed pool of workers pulling from a shared cursor, rather than one
  // Promise.all over the whole list, so only SCREENSHOT_SWEEP_CONCURRENCY
  // requests are ever in flight at once regardless of library size - each
  // worker still paces its own requests SCREENSHOT_SWEEP_DELAY_MS apart to
  // stay reasonably polite to Steam's API while running faster than the old
  // single-file-at-a-time version. The *first* 429 stops this run entirely
  // (see rateLimitHit) rather than working through the rest of the list -
  // if Steam is blocking, every other request in this run would fail too,
  // so there's no point burning through them one by one; the next sweep
  // trigger picks up where this left off once the backoff window passes.
  async function worker(): Promise<void> {
    for (;;) {
      if (rateLimitHit) return
      const i = nextIndex++
      if (i >= targets.length) return
      const game = targets[i]

      let appid = game.steamAppId
      if (appid === null) {
        if (noSteamMatchGameIds.has(game.id)) continue
        const match = await searchSteamMatch(game.name)
        if (!match) {
          noSteamMatchGameIds.add(game.id)
          noMatch++
          continue
        }
        // Persisted so future sweeps/uninstall/Game Details all use this
        // directly instead of re-searching by name every time - same as
        // setting the Steam ID by hand in the Edit dialog, just automatic.
        // The user can always correct a wrong match there too.
        game.steamAppId = match.appid
        appid = match.appid
        matchedByName++
        libraryChanged = true
      }

      if (await hasLocalScreenshot(appid)) {
        alreadyCached++
        continue
      }

      attempted++
      const result = await fetchSteamAppDetails(appid)
      if (result.rateLimited) {
        rateLimitHit = true
        steamRateLimitBackoffMs = Math.min(steamRateLimitBackoffMs * 2, SCREENSHOT_SWEEP_RATE_LIMIT_MAX_BACKOFF_MS)
        steamRateLimitedUntil = Date.now() + steamRateLimitBackoffMs
        return
      }
      steamRateLimitBackoffMs = SCREENSHOT_SWEEP_RATE_LIMIT_BASE_BACKOFF_MS
      if (result.details) {
        await localizeSteamImages(appid, result.details)
        downloaded++
      } else {
        noStorePage++
      }
      await new Promise((r) => setTimeout(r, SCREENSHOT_SWEEP_DELAY_MS))
    }
  }

  await Promise.all(Array.from({ length: SCREENSHOT_SWEEP_CONCURRENCY }, () => worker()))

  if (libraryChanged) {
    await saveLibrary()
    broadcastLibrary()
  }

  return {
    totalGames: targets.length,
    alreadyCached,
    attempted,
    downloaded,
    matchedByName,
    noStorePage,
    noMatch,
    rateLimited: rateLimitHit,
    retryAfter: rateLimitHit ? new Date(steamRateLimitedUntil).toISOString() : null
  }
}

async function fetchSteamMetadataForGame(game: Game, needsCover: boolean): Promise<boolean> {
  const match = await searchSteamMatch(game.name)
  if (!match) return false
  let changed = false
  if (needsCover) {
    const dest = join(coversDir, `${game.id}.jpg`)
    if (await downloadImage(match.coverUrl, dest)) {
      game.coverPath = dest
      changed = true
    }
  }
  if (game.genres.length === 0) {
    const genres = await fetchSteamGenres(match.appid)
    if (genres.length > 0) {
      game.genres = genres
      changed = true
    }
  }
  return changed
}

// Used when the user manually sets/changes a game's Steam ID in the Edit
// dialog - unlike fetchSteamMetadataForGame, this trusts the given appid
// completely and re-fetches unconditionally (overwriting any existing
// cover/genres, even ones a name-based match had already filled in), since
// setting the ID is an explicit correction of whatever was auto-detected.
async function applySteamAppId(game: Game, appid: number): Promise<void> {
  const coverUrl = await withTimeout((signal) => findSteamCoverUrl(appid, signal)).catch(() => null)
  if (coverUrl) {
    const dest = join(coversDir, `${game.id}.jpg`)
    if (await downloadImage(coverUrl, dest)) game.coverPath = dest
  }
  const genres = await fetchSteamGenres(appid)
  if (genres.length > 0) game.genres = genres
}

interface RawgSearchItem {
  name: string
  background_image: string | null
  genres?: { name: string }[]
}

async function searchRawgMatch(name: string): Promise<{ imageUrl: string; genres: string[] } | null> {
  if (!settings.rawgApiKey) return null
  try {
    return await withTimeout(async (signal) => {
      const res = await net.fetch(
        `https://api.rawg.io/api/games?key=${encodeURIComponent(settings.rawgApiKey)}&search=${encodeURIComponent(name)}&page_size=1`,
        { signal }
      )
      if (!res.ok) return null
      const data = (await res.json()) as { results?: RawgSearchItem[] }
      const item = data.results?.[0]
      if (!item?.background_image) return null
      return { imageUrl: item.background_image, genres: item.genres?.map((g) => g.name) ?? [] }
    })
  } catch {
    return null
  }
}

async function fetchRawgMetadataForGame(game: Game, needsCover: boolean): Promise<boolean> {
  const match = await searchRawgMatch(game.name)
  if (!match) return false
  let changed = false
  if (needsCover) {
    const dest = join(coversDir, `${game.id}.jpg`)
    if (await downloadImage(match.imageUrl, dest)) {
      game.coverPath = dest
      changed = true
    }
  }
  if (game.genres.length === 0 && match.genres.length > 0) {
    game.genres = match.genres
    changed = true
  }
  return changed
}

async function fetchMetadataForGame(game: Game, options: { forceCover?: boolean } = {}): Promise<
  'igdb' | 'steam' | 'rawg' | null
> {
  const needsCover = options.forceCover === true || !game.coverPath
  if (settings.igdbClientId && settings.igdbClientSecret) {
    if (await fetchIgdbMetadataForGame(game, needsCover)) return 'igdb'
  }
  if (await fetchSteamMetadataForGame(game, needsCover)) return 'steam'
  if (await fetchRawgMetadataForGame(game, needsCover)) return 'rawg'
  return null
}

const coverAutoQueue: Game[] = []
let coverAutoQueueRunning = false

function enqueueAutoCoverFetch(game: Game): void {
  coverAutoQueue.push(game)
  if (!coverAutoQueueRunning) void runCoverAutoQueue()
}

async function runCoverAutoQueue(): Promise<void> {
  coverAutoQueueRunning = true
  while (coverAutoQueue.length > 0) {
    const game = coverAutoQueue.shift()
    if (game && (!game.coverPath || game.genres.length === 0)) {
      const source = await fetchMetadataForGame(game)
      if (source) {
        await saveLibrary()
        broadcastLibrary()
      }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  coverAutoQueueRunning = false
}

// Games with no match on any source. Session-only on purpose: a fresh launch
// retries them, in case the miss was really a transient failure rather than
// the game genuinely not existing on IGDB/Steam/RAWG.
const noMetadataMatchIds = new Set<string>()
let metadataSweepRunning = false

const METADATA_SWEEP_DELAY_MS = 700
const METADATA_SWEEP_INTERVAL_MS = 15 * 60 * 1000

/**
 * Fills in covers and genres that are still missing, and keeps doing it.
 *
 * enqueueAutoCoverFetch only ever fires when a game is *added*, so a fetch
 * that failed at that moment - network blip, expired IGDB token, a Steam
 * hiccup - left that game without a cover permanently, until someone noticed
 * and pressed "Fetch Covers" by hand. On this library that was 78 games with
 * no cover and 98 with no genres, 47 of them Steam imports whose appid was
 * known all along. Exactly the shape of the screenshot-sweep bug, so it gets
 * the same treatment: periodic retry plus a manual trigger that reports what
 * actually happened.
 */
async function sweepMissingMetadata(): Promise<MetadataSweepResult> {
  const result: MetadataSweepResult = {
    totalGames: games.length,
    missingCoverBefore: games.filter((g) => !g.coverPath).length,
    missingGenresBefore: games.filter((g) => g.genres.length === 0).length,
    attempted: 0,
    coversFilled: 0,
    genresFilled: 0,
    noMatch: 0,
    skippedAfterEarlierMiss: 0,
    alreadyRunning: false
  }
  if (metadataSweepRunning) return { ...result, alreadyRunning: true }
  metadataSweepRunning = true

  try {
    const pending = games.filter((g) => !g.coverPath || g.genres.length === 0)
    let changed = false

    for (const game of pending) {
      // The library can change under us mid-sweep (a sync removing a game, a
      // manual fetch filling one in), so re-check against the live object.
      const current = games.find((g) => g.id === game.id)
      if (!current || (current.coverPath && current.genres.length > 0)) continue
      if (noMetadataMatchIds.has(current.id)) {
        result.skippedAfterEarlierMiss++
        continue
      }

      const hadCover = !!current.coverPath
      const hadGenres = current.genres.length > 0
      result.attempted++

      const source = await fetchMetadataForGame(current)
      if (source) {
        if (!hadCover && current.coverPath) result.coversFilled++
        if (!hadGenres && current.genres.length > 0) result.genresFilled++
        changed = true
      } else {
        result.noMatch++
        noMetadataMatchIds.add(current.id)
      }

      await new Promise((r) => setTimeout(r, METADATA_SWEEP_DELAY_MS))
    }

    if (changed) {
      await saveLibrary()
      broadcastLibrary()
    }
    return result
  } catch (e) {
    return { ...result, error: e instanceof Error ? e.message : String(e) }
  } finally {
    metadataSweepRunning = false
  }
}

// Walking a folder tree is the slow part - roughly a second per game on a
// large library - so this is deliberately never called inline during import.
async function folderSizeBytes(dir: string): Promise<number | null> {
  let total = 0
  let sawAnything = false
  async function walk(current: string): Promise<void> {
    const entries = await safeReaddir(current)
    if (!entries) return
    sawAnything = true
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full)
          total += stat.size
        } catch {
          // file vanished mid-walk; skip it rather than abort the whole game
        }
      }
    }
  }
  await walk(dir)
  return sawAnything ? total : null
}

// Re-measure anything older than this, since installs grow with updates and
// DLC. Everything else is skipped, so repeat passes cost nothing.
const SIZE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000
const SIZE_SWEEP_DELAY_MS = 250
let diskSizeSweepRunning = false

async function sweepDiskSizes(force = false): Promise<DiskSizeSweepResult> {
  const result: DiskSizeSweepResult = {
    totalGames: games.length,
    measuredBefore: games.filter((g) => g.installSizeBytes !== null).length,
    measured: 0,
    failed: 0,
    totalSizeBytes: 0,
    alreadyRunning: false
  }
  if (diskSizeSweepRunning) return { ...result, alreadyRunning: true }
  diskSizeSweepRunning = true

  try {
    const now = Date.now()
    const pending = games.filter((g) => {
      if (force || g.installSizeBytes === null) return true
      const measured = g.sizeMeasuredAt ? Date.parse(g.sizeMeasuredAt) : 0
      return now - measured > SIZE_REFRESH_MS
    })

    let changed = false
    let sinceFlush = 0
    let done = 0
    for (const game of pending) {
      const current = games.find((g) => g.id === game.id)
      if (!current) continue
      broadcastDiskSizeProgress({ current: done, total: pending.length, currentName: current.name })
      done++

      const size = await folderSizeBytes(current.installDir)
      if (size === null) {
        result.failed++
      } else {
        current.installSizeBytes = size
        current.sizeMeasuredAt = new Date().toISOString()
        result.measured++
        changed = true
        sinceFlush++
      }
      // Publish as we go. A full pass over a large library runs for many
      // minutes, and saving only at the end meant the UI showed "0 measured"
      // that whole time - and lost everything if the app closed mid-sweep.
      if (sinceFlush >= 20) {
        sinceFlush = 0
        await saveLibrary()
        broadcastLibrary()
      }
      await new Promise((r) => setTimeout(r, SIZE_SWEEP_DELAY_MS))
    }

    if (changed) {
      await saveLibrary()
      broadcastLibrary()
    }
    result.totalSizeBytes = games.reduce((sum, g) => sum + (g.installSizeBytes ?? 0), 0)
    return result
  } catch (e) {
    return { ...result, error: e instanceof Error ? e.message : String(e) }
  } finally {
    diskSizeSweepRunning = false
    broadcastDiskSizeProgress(null)
  }
}

async function extractIcon(exePath: string, id: string): Promise<string | null> {
  try {
    const img = await app.getFileIcon(exePath, { size: 'large' })
    await fs.writeFile(join(iconsDir, `${id}.png`), img.toPNG())
    return join(iconsDir, `${id}.png`)
  } catch {
    return null
  }
}

const IGNORED_EXE_PATTERNS = [
  /^unins/i,
  /^setup/i,
  /^install/i,
  /^update/i,
  /redist/i,
  /vcredist/i,
  /directx/i,
  /dxsetup/i,
  /crashpad/i,
  /crashhandler/i,
  /crashreport/i,
  /oalinst/i,
  /^dotnet/i,
  /prereq/i,
  /^ue4?prereq/i,
  // Added after finding 23 of 566 entries in a real library pointing at an
  // installer instead of the game - pressing Play on Watch Dogs 2 launched
  // the PhysX installer. The existing entries covered `setup*` and `install*`
  // as *prefixes*, which misses every one of these. Matters twice over: an
  // unrecognised name is also invisible to repairIgnoredExePaths(), so a game
  // that landed on one of these was stuck there permanently.
  /^physx/i, // PhysX-9.19.0218-SystemSoftware.exe, PhysX_9.10.0513_...
  /websetup/i, // dxwebsetup.exe
  /installer/i, // UplayInstaller, UbisoftConnectInstaller, EpicOnlineServicesInstaller
  /^netfx/i, // netfx35_ia64.exe
  /^dotnetfx/i,
  /benchmark/i, // FC2BenchmarkTool.exe
  /easyanticheat/i,
  /^eac\.exe$/i, // anti-cheat bootstrapper sitting next to the real game exe
  // A dedicated-server launcher is never the game itself. Deliberately narrow:
  // plain "*Launcher.exe" is left alone, because for Tropico, Batman and
  // several others the launcher genuinely is the right entry point.
  /serverlauncher/i
]
const IGNORED_DIR_PATTERNS = [/redist/i, /^__installer$/i, /^\$recycle\.bin$/i]

async function safeReaddir(dir: string): Promise<Dirent[] | null> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
}

interface ExeCandidate {
  file: string
  size: number
  ignoredName: boolean
}

async function findExesRecursive(
  dir: string,
  depth: number,
  maxDepth: number,
  results: ExeCandidate[]
): Promise<void> {
  if (depth > maxDepth) return
  const entries = await safeReaddir(dir)
  if (!entries) return
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIR_PATTERNS.some((re) => re.test(entry.name))) continue
      await findExesRecursive(full, depth + 1, maxDepth, results)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
      const ignoredName = IGNORED_EXE_PATTERNS.some((re) => re.test(entry.name))
      try {
        const stat = await fs.stat(full)
        results.push({ file: full, size: stat.size, ignoredName })
      } catch {
        // ignore unreadable file
      }
    }
  }
}

async function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  const win = BrowserWindow.getFocusedWindow()
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
}

async function findBestExe(folder: string): Promise<string | null> {
  const results: ExeCandidate[] = []
  await findExesRecursive(folder, 0, 5, results)
  if (results.length === 0) return null
  // Prefer exes whose names don't look like helpers/installers; if the folder
  // holds nothing else (e.g. only a game installer), fall back to those so the
  // game still gets a launchable entry.
  const preferred = results.filter((r) => !r.ignoredName)
  const pool = preferred.length > 0 ? preferred : results
  // Compare names with punctuation and spacing stripped rather than requiring
  // an exact match. Real installs almost never line up character for character:
  // folder "Watch_Dogs2" holds WatchDogs2.exe, folder "Far Cry 2" holds
  // FarCry2.exe. Exact equality missed both, so the tie-break fell through to
  // "biggest file", which picked EAC.exe and FC2BenchmarkTool.exe instead.
  const normalize = (s: string): string => s.replace(/[^a-z0-9]/gi, '').toLowerCase()
  const folderKey = normalize(basename(folder))
  const score = (file: string): number => {
    const name = normalize(basename(file, '.exe'))
    if (!name || !folderKey) return 0
    if (name === folderKey) return 3
    // One containing the other covers "WatchDogs2.exe" in "Watch Dogs 2 v1.17
    // ALL DLCs" and the reverse, where a repack folder carries version noise.
    if (folderKey.includes(name) || name.includes(folderKey)) return 2
    // Shared opening run, for sequels that abbreviate: folder "Cities Skylines
    // II ..." holds Cities2.exe. Without this the tie-break falls through to
    // file size, and a small Unity launcher stub loses to a 7MB helper sitting
    // in a subfolder. Four characters is enough to stop coincidental hits.
    let common = 0
    while (common < name.length && common < folderKey.length && name[common] === folderKey[common]) common++
    return common >= 4 ? 1 : 0
  }
  pool.sort((a, b) => {
    const diff = score(b.file) - score(a.file)
    if (diff !== 0) return diff
    return b.size - a.size
  })
  return pool[0].file
}

async function findSteamPath(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'])
    const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)
    if (match) return match[1].trim().replace(/\//g, '\\')
  } catch {
    // registry lookup can fail (Steam never installed, or a locale-specific
    // key name) - fall back to the two standard install locations below
  }
  for (const candidate of ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // try next
    }
  }
  return null
}

async function findSteamLibraryFolders(steamPath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf-8')
    const paths = [...raw.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'))
    // Case-insensitive dedupe: the registry hands back a lowercased path while
    // libraryfolders.vdf carries the proper casing, so a plain Set treated the
    // same folder as two libraries and every manifest in it was parsed twice.
    const seen = new Map<string, string>()
    for (const p of [steamPath, ...paths]) {
      const key = p.replace(/[\\/]+$/, '').toLowerCase()
      if (!seen.has(key)) seen.set(key, p)
    }
    return [...seen.values()]
  } catch {
    return [steamPath]
  }
}

interface SteamManifest {
  appid: string
  name: string
  installdir: string
}

async function parseAppManifests(libraryPath: string): Promise<SteamManifest[]> {
  const steamappsDir = join(libraryPath, 'steamapps')
  const entries = await safeReaddir(steamappsDir)
  if (!entries) return []
  const manifests: SteamManifest[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !/^appmanifest_\d+\.acf$/i.test(entry.name)) continue
    try {
      const raw = await fs.readFile(join(steamappsDir, entry.name), 'utf-8')
      const appid = raw.match(/"appid"\s+"(\d+)"/i)?.[1]
      const name = raw.match(/"name"\s+"([^"]+)"/i)?.[1]
      const installdir = raw.match(/"installdir"\s+"([^"]+)"/i)?.[1]
      const stateFlags = Number(raw.match(/"StateFlags"\s+"(\d+)"/i)?.[1] ?? 0)
      // A manifest existing does NOT mean the game is installed - Steam keeps
      // one for anything it knows about locally. StateFlags is the truth:
      // bit 4 is "fully installed", while 1 (uninstalled), 32 (files missing)
      // and 64 (files corrupt) mean it isn't really there. Measured on a real
      // machine: 5 of 52 manifests were flagged 70 (= 64|4|2), and those were
      // exactly the entries the user could see in the library without having
      // them installed. Bit 2 (update required) is kept - the game is present
      // and launchable, Steam just wants to patch it.
      const installed = (stateFlags & 4) !== 0 && (stateFlags & (1 | 32 | 64)) === 0
      if (appid && name && installdir && installed) manifests.push({ appid, name, installdir })
    } catch {
      // skip an unreadable/partially-written manifest, move on to the next
    }
  }
  return manifests
}

const EPIC_MANIFESTS_DIR = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests'

interface EpicManifest {
  appName: string
  displayName: string
  installLocation: string
  launchExecutable: string
  catalogNamespace: string | null
  catalogItemId: string | null
}

async function parseEpicManifests(): Promise<EpicManifest[]> {
  const entries = await safeReaddir(EPIC_MANIFESTS_DIR)
  if (!entries) return []
  const manifests: EpicManifest[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.item')) continue
    try {
      const raw = await fs.readFile(join(EPIC_MANIFESTS_DIR, entry.name), 'utf-8')
      const data = JSON.parse(raw) as Record<string, unknown>
      const appName = typeof data.AppName === 'string' ? data.AppName : null
      const displayName = typeof data.DisplayName === 'string' ? data.DisplayName : null
      const installLocation = typeof data.InstallLocation === 'string' ? data.InstallLocation : null
      const launchExecutable = typeof data.LaunchExecutable === 'string' ? data.LaunchExecutable : null
      const catalogNamespace = typeof data.CatalogNamespace === 'string' ? data.CatalogNamespace : null
      const catalogItemId = typeof data.CatalogItemId === 'string' ? data.CatalogItemId : null
      if (appName && displayName && installLocation && launchExecutable) {
        manifests.push({ appName, displayName, installLocation, launchExecutable, catalogNamespace, catalogItemId })
      }
    } catch {
      // skip an unreadable/malformed .item manifest, move on to the next
    }
  }
  return manifests
}

interface InstalledSteamGame {
  appId: number
  name: string
  installDir: string
}

// Returns null when Steam itself isn't found (registry lookup + both standard
// install paths all failed) so callers can tell "not installed" apart from
// "installed with zero games" - the two need different handling for sync
// (skip removal vs. legitimately remove everything).
async function findInstalledSteamGames(): Promise<InstalledSteamGame[] | null> {
  const steamPath = await findSteamPath()
  if (!steamPath) return null
  const libraries = await findSteamLibraryFolders(steamPath)
  const result: InstalledSteamGame[] = []
  // Several appids can share one installdir - Half-Life 2, Lost Coast and both
  // episodes all live in "common\Half-Life 2", which produced four library
  // entries pointing at the same folder and the same executable. First appid
  // for a folder wins; the rest are DLC-like siblings of the same install.
  const claimedDirs = new Set<string>()
  const seenAppIds = new Set<number>()
  for (const lib of libraries) {
    const manifests = await parseAppManifests(lib)
    for (const m of manifests) {
      const appId = Number(m.appid)
      const installDir = join(lib, 'steamapps', 'common', m.installdir)
      const dirKey = installDir.toLowerCase()
      if (seenAppIds.has(appId) || claimedDirs.has(dirKey)) continue
      seenAppIds.add(appId)
      claimedDirs.add(dirKey)
      result.push({ appId, name: m.name, installDir })
    }
  }
  return result
}

async function addNewSteamGames(installed: InstalledSteamGame[]): Promise<Game[]> {
  const existingAppIds = new Set(games.map((g) => g.steamAppId).filter((id): id is number => id !== null))
  const added: Game[] = []
  for (const g of installed) {
    if (existingAppIds.has(g.appId)) continue
    const exe = await findBestExe(g.installDir)
    if (!exe) continue
    const id = randomUUID()
    const iconPath = await extractIcon(exe, id)
    const game: Game = {
      id,
      name: g.name,
      exePath: exe,
      installDir: g.installDir,
      coverPath: null,
      iconPath,
      favorite: false,
      dateAdded: new Date().toISOString(),
      lastPlayed: null,
      playtimeSeconds: 0,
      source: 'steam',
      genres: [],
      tags: [],
      rating: null,
      categoryIds: [],
      excludeFromPlaytime: false,
      installSizeBytes: null,
      sizeMeasuredAt: null,
      trainerPath: null,
      steamAppId: g.appId,
      epicAppName: null,
      gogProductId: null,
      ubisoftId: null
    }
    games.push(game)
    added.push(game)
    existingAppIds.add(g.appId)
  }
  return added
}

// null distinguishes "Epic Games Launcher not found" (manifests dir doesn't
// exist) from "found, but nothing installed" - same reasoning as Steam above.
async function findInstalledEpicGames(): Promise<EpicManifest[] | null> {
  const entries = await safeReaddir(EPIC_MANIFESTS_DIR)
  if (!entries) return null
  return parseEpicManifests()
}

async function addNewEpicGames(installed: EpicManifest[]): Promise<Game[]> {
  const existingAppNames = new Set(games.map((g) => g.epicAppName).filter((n): n is string => n !== null))
  const added: Game[] = []
  for (const m of installed) {
    if (existingAppNames.has(m.appName)) continue
    let exePath = join(m.installLocation, m.launchExecutable)
    try {
      await fs.access(exePath)
    } catch {
      const fallback = await findBestExe(m.installLocation)
      if (!fallback) continue
      exePath = fallback
    }
    const id = randomUUID()
    const iconPath = await extractIcon(exePath, id)
    const game: Game = {
      id,
      name: m.displayName,
      exePath,
      installDir: m.installLocation,
      coverPath: null,
      iconPath,
      favorite: false,
      dateAdded: new Date().toISOString(),
      lastPlayed: null,
      playtimeSeconds: 0,
      source: 'epic',
      genres: [],
      tags: [],
      rating: null,
      categoryIds: [],
      excludeFromPlaytime: false,
      installSizeBytes: null,
      sizeMeasuredAt: null,
      trainerPath: null,
      steamAppId: null,
      epicAppName: m.appName,
      gogProductId: null,
      ubisoftId: null
    }
    games.push(game)
    added.push(game)
    existingAppNames.add(m.appName)
  }
  return added
}

async function addNewGogGames(installed: GogGame[]): Promise<Game[]> {
  const existingProductIds = new Set(games.map((g) => g.gogProductId).filter((id): id is string => id !== null))
  const added: Game[] = []
  for (const g of installed) {
    if (existingProductIds.has(g.productId)) continue
    const exe = await findBestExe(g.installDir)
    if (!exe) continue
    const id = randomUUID()
    const iconPath = await extractIcon(exe, id)
    const game: Game = {
      id,
      name: g.name,
      exePath: exe,
      installDir: g.installDir,
      coverPath: null,
      iconPath,
      favorite: false,
      dateAdded: new Date().toISOString(),
      lastPlayed: null,
      playtimeSeconds: 0,
      source: 'gog',
      genres: [],
      tags: [],
      rating: null,
      categoryIds: [],
      excludeFromPlaytime: false,
      installSizeBytes: null,
      sizeMeasuredAt: null,
      trainerPath: null,
      steamAppId: null,
      epicAppName: null,
      gogProductId: g.productId,
      ubisoftId: null
    }
    games.push(game)
    added.push(game)
    existingProductIds.add(g.productId)
  }
  return added
}

interface InstalledUbisoftGame {
  id: string
  name: string
  installDir: string
}

// Ubisoft Connect (formerly Uplay) writes one registry subkey per installed
// game under Installs, each with just an InstallDir value - no friendly
// name anywhere in the registry, so the install folder's own name is the
// best available title (same fallback GOG uses when its title lookup
// misses). null distinguishes "Ubisoft Connect never installed" (key
// doesn't exist, reg query fails) from "installed, nothing there".
async function findInstalledUbisoftGames(): Promise<InstalledUbisoftGame[] | null> {
  try {
    const { stdout } = await execFileAsync('reg', [
      'query',
      'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs',
      '/s'
    ])
    const results: InstalledUbisoftGame[] = []
    let currentId: string | null = null
    for (const line of stdout.split(/\r?\n/)) {
      const keyMatch = line.match(/\\Installs\\([^\\]+)\s*$/)
      if (keyMatch) {
        currentId = keyMatch[1]
        continue
      }
      const valueMatch = line.match(/^\s*InstallDir\s+REG_SZ\s+(.+)$/i)
      if (valueMatch && currentId) {
        const installDir = valueMatch[1].trim()
        results.push({ id: currentId, name: cleanGameName(basename(installDir)), installDir })
        currentId = null
      }
    }
    return results
  } catch {
    return null
  }
}

async function addNewUbisoftGames(installed: InstalledUbisoftGame[]): Promise<Game[]> {
  const existingIds = new Set(games.map((g) => g.ubisoftId).filter((id): id is string => id !== null))
  const added: Game[] = []
  for (const g of installed) {
    if (existingIds.has(g.id)) continue
    const exe = await findBestExe(g.installDir)
    if (!exe) continue
    const id = randomUUID()
    const iconPath = await extractIcon(exe, id)
    const game: Game = {
      id,
      name: g.name,
      exePath: exe,
      installDir: g.installDir,
      coverPath: null,
      iconPath,
      favorite: false,
      dateAdded: new Date().toISOString(),
      lastPlayed: null,
      playtimeSeconds: 0,
      source: 'ubisoft',
      genres: [],
      tags: [],
      rating: null,
      categoryIds: [],
      excludeFromPlaytime: false,
      installSizeBytes: null,
      sizeMeasuredAt: null,
      trainerPath: null,
      steamAppId: null,
      epicAppName: null,
      gogProductId: null,
      ubisoftId: g.id
    }
    games.push(game)
    added.push(game)
    existingIds.add(g.id)
  }
  return added
}

async function syncUbisoftLibrary(): Promise<{ added: Game[]; removed: Game[] }> {
  const installed = await findInstalledUbisoftGames()
  if (installed === null) return { added: [], removed: [] }
  const installedIds = new Set(installed.map((g) => g.id))
  const removed = games.filter(
    (g) => g.source === 'ubisoft' && g.ubisoftId !== null && !installedIds.has(g.ubisoftId)
  )
  const added = await addNewUbisoftGames(installed)
  return { added, removed }
}

async function syncSteamLibrary(): Promise<{ added: Game[]; removed: Game[] }> {
  const installed = await findInstalledSteamGames()
  if (installed === null) return { added: [], removed: [] }
  const installedIds = new Set(installed.map((g) => g.appId))
  const removed = games.filter((g) => g.source === 'steam' && g.steamAppId !== null && !installedIds.has(g.steamAppId))
  const added = await addNewSteamGames(installed)
  return { added, removed }
}

async function syncEpicLibrary(): Promise<{ added: Game[]; removed: Game[] }> {
  const installed = await findInstalledEpicGames()
  if (installed === null) return { added: [], removed: [] }
  const installedNames = new Set(installed.map((g) => g.appName))
  const removed = games.filter(
    (g) => g.source === 'epic' && g.epicAppName !== null && !installedNames.has(g.epicAppName)
  )
  const added = await addNewEpicGames(installed)
  return { added, removed }
}

async function syncGogLibrary(): Promise<{ added: Game[]; removed: Game[] }> {
  let installed: GogGame[]
  try {
    installed = await findGogGames()
  } catch {
    return { added: [], removed: [] }
  }
  const installedIds = new Set(installed.map((g) => g.productId))
  const removed = games.filter(
    (g) => g.source === 'gog' && g.gogProductId !== null && !installedIds.has(g.gogProductId)
  )
  const added = await addNewGogGames(installed)
  return { added, removed }
}

// Runs once at startup (see whenReady): checks Steam/Epic/GOG for games that
// were installed or uninstalled since the last launch and mirrors that into
// the library, without requiring the user to press the manual Import
// buttons. Silent either way - same "just updates in the background" pattern
// as repairIgnoredExePaths, not a popup/toast.
async function syncPlatformLibraries(): Promise<void> {
  if (!settings.librarySyncEnabled) return
  const [steam, epic, gog, ubisoft] = await Promise.all([
    syncSteamLibrary().catch((): { added: Game[]; removed: Game[] } => ({ added: [], removed: [] })),
    syncEpicLibrary().catch((): { added: Game[]; removed: Game[] } => ({ added: [], removed: [] })),
    syncGogLibrary().catch((): { added: Game[]; removed: Game[] } => ({ added: [], removed: [] })),
    syncUbisoftLibrary().catch((): { added: Game[]; removed: Game[] } => ({ added: [], removed: [] }))
  ])
  const removed = [...steam.removed, ...epic.removed, ...gog.removed, ...ubisoft.removed]
  const added = [...steam.added, ...epic.added, ...gog.added, ...ubisoft.added]
  if (removed.length > 0) {
    const removedIds = new Set(removed.map((g) => g.id))
    games = games.filter((g) => !removedIds.has(g.id))
  }
  if (added.length === 0 && removed.length === 0) return
  await saveLibrary()
  broadcastLibrary()

  const events: LibrarySyncEvent[] = []
  for (const [source, result] of [
    ['Steam', steam],
    ['Epic', epic],
    ['GOG', gog],
    ['Ubisoft', ubisoft]
  ] as const) {
    if (result.added.length > 0 || result.removed.length > 0) {
      events.push({ source, added: result.added.length, removed: result.removed.length })
    }
  }
  if (events.length > 0) broadcastLibrarySynced(events)

  for (const game of added) enqueueAutoCoverFetch(game)
  for (const game of removed) {
    for (const p of [game.coverPath, game.iconPath]) {
      if (p) fs.unlink(p).catch(() => {})
    }
  }
}

// Games imported before an exe pattern was added to the ignore list may still
// point at a helper binary (e.g. UnityCrashHandler64.exe). Re-scan their
// install folder and swap in the real game executable.
async function repairIgnoredExePaths(): Promise<void> {
  let changed = 0
  for (const game of games) {
    const exeName = basename(game.exePath)
    if (!IGNORED_EXE_PATTERNS.some((re) => re.test(exeName))) continue
    const better = await findBestExe(game.installDir)
    if (better && better !== game.exePath) {
      game.exePath = better
      changed++
    }
  }
  if (changed > 0) {
    await saveLibrary()
    broadcastLibrary()
  }
}

const BACKUP_NAME_RE = /^game-browser-backup-.*\.zip$/i

// Nothing used to delete old archives, so with scheduled backups on, the
// folder grew forever - and once the screenshot cache landed that meant a
// ~3GB file per run. Keeps the newest `backupKeepCount`, deletes the rest.
// Also sweeps `.part` files, which a backup interrupted mid-write leaves.
async function pruneOldBackups(): Promise<void> {
  const keep = settings.backupKeepCount
  if (!settings.backupFolder) return
  try {
    const entries = await fs.readdir(settings.backupFolder, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip.part')) {
        await fs.rm(join(settings.backupFolder, entry.name), { force: true }).catch(() => undefined)
      }
    }
    if (keep <= 0) return
    const zips = entries.filter((e) => e.isFile() && BACKUP_NAME_RE.test(e.name)).map((e) => e.name)
    // The timestamp in the name sorts chronologically as plain text, so this
    // needs no stat() calls and can't be thrown off by mtimes changing.
    zips.sort((a, b) => b.localeCompare(a))
    for (const name of zips.slice(keep)) {
      await fs.rm(join(settings.backupFolder, name), { force: true }).catch(() => undefined)
    }
  } catch {
    // A backup folder we can't read isn't worth failing a good backup over.
  }
}

/**
 * Pulls Steam's own recorded playtime into the library. Without this, playtime
 * only ever reflects launches made through this app, which for an imported
 * library means the stat is close to meaningless.
 *
 * Values are merged with `max()`, never summed: launching a Steam game from
 * here still goes through Steam, so Steam has already counted that session and
 * adding the two would double it. Taking the larger also means a session Steam
 * somehow missed isn't thrown away.
 */
async function syncSteamPlaytime(): Promise<SteamPlaytimeSyncResult> {
  const matchable = games.filter((g) => g.steamAppId !== null)
  const base: SteamPlaytimeSyncResult = {
    steamFound: false,
    steamAppsWithPlaytime: 0,
    matchableGames: matchable.length,
    updated: 0,
    totalPlaytimeSeconds: 0
  }
  try {
    const steamPath = await findSteamPath()
    if (!steamPath) return base
    const playtime = await readSteamPlaytime(steamPath)
    base.steamFound = true
    base.steamAppsWithPlaytime = playtime.size
    if (playtime.size === 0) return base

    let updated = 0
    for (const game of matchable) {
      const entry = playtime.get(game.steamAppId as number)
      if (!entry) continue
      let changed = false

      const steamSeconds = entry.playtimeMinutes * 60
      if (steamSeconds > game.playtimeSeconds) {
        game.playtimeSeconds = steamSeconds
        changed = true
      }

      if (entry.lastPlayedUnix) {
        const steamLastPlayed = new Date(entry.lastPlayedUnix * 1000).toISOString()
        if (!game.lastPlayed || steamLastPlayed > game.lastPlayed) {
          game.lastPlayed = steamLastPlayed
          changed = true
        }
      }

      if (changed) updated++
    }

    base.updated = updated
    base.totalPlaytimeSeconds = games.reduce((sum, g) => sum + g.playtimeSeconds, 0)
    if (updated > 0) {
      await saveLibrary()
      broadcastLibrary()
    }
    return base
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Matches the user's own trainer files against the library and copies the ones
 * that match into userData, so the set is self-contained, survives the source
 * folder being cleaned out, and rides along in backups.
 *
 * Nothing is fetched from the internet here - see the note on
 * `trainerSearchUrl`; the app opens the site in the user's browser instead.
 */
async function scanTrainers(): Promise<TrainerScanResult> {
  const folder = settings.trainerFolder
  const result: TrainerScanResult = { folder, trainerFiles: 0, matched: 0, unmatchedFiles: 0 }

  // Sources, in priority order: whatever is already filed in userData, the
  // user's own folder, and Downloads when enabled - so a trainer downloaded a
  // minute ago counts without having to be moved anywhere first.
  const sources: string[] = [trainersDir]
  if (folder) sources.push(folder)
  if (settings.watchDownloadsForTrainers) {
    try {
      sources.push(app.getPath('downloads'))
    } catch {
      // no Downloads folder; skip
    }
  }
  if (sources.length === 1) return { ...result, error: 'No trainer folder set.' }

  try {
    await fs.mkdir(trainersDir, { recursive: true })
    const seen = new Set<string>()
    const trainers = []
    for (const source of sources) {
      for (const t of await scanTrainerFolder(source)) {
        const key = t.fileName.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        trainers.push(t)
      }
    }
    result.trainerFiles = trainers.length

    const usedFiles = new Set<string>()
    let changed = false
    for (const game of games) {
      const match = matchTrainer(game.name, trainers)
      if (!match) {
        // A trainer that was matched before but whose file is gone should stop
        // being advertised; one still present in userData stays put.
        if (game.trainerPath) {
          try {
            await fs.access(game.trainerPath)
          } catch {
            game.trainerPath = null
            changed = true
          }
        }
        continue
      }
      usedFiles.add(match.path)

      const dest = join(trainersDir, match.fileName)
      try {
        // Copy only when it isn't already there with the same size, so repeat
        // scans don't rewrite 85MB of executables every time.
        let needsCopy = true
        try {
          const [src, existing] = await Promise.all([fs.stat(match.path), fs.stat(dest)])
          needsCopy = src.size !== existing.size
        } catch {
          needsCopy = true
        }
        if (needsCopy) await copyFileAtomic(match.path, dest)
        if (game.trainerPath !== dest) {
          game.trainerPath = dest
          changed = true
        }
        result.matched++
      } catch {
        // couldn't copy this one - leave the game without a trainer
      }
    }

    result.unmatchedFiles = trainers.length - usedFiles.size
    if (changed) {
      await saveLibrary()
      broadcastLibrary()
    }
    return result
  } catch (e) {
    return { ...result, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Watches the trainer folder and, optionally, the OS Downloads folder, so a
 * trainer the user has just downloaded is matched and filed without them
 * going back to Settings to press Rescan. This is the substitute for
 * downloading automatically: the fetching stays a normal visit to the site,
 * everything after it is handled here.
 */
const trainerWatchers: import('fs').FSWatcher[] = []
let trainerRescanTimer: NodeJS.Timeout | null = null

function scheduleTrainerRescan(): void {
  // Downloads land in pieces (.crdownload, then a rename), and a folder copy
  // fires many events, so settle before doing the work.
  if (trainerRescanTimer) clearTimeout(trainerRescanTimer)
  trainerRescanTimer = setTimeout(() => {
    trainerRescanTimer = null
    void scanTrainers()
  }, 4000)
}

function startTrainerWatchers(): void {
  for (const w of trainerWatchers.splice(0)) w.close()
  const folders = new Set<string>()
  if (settings.trainerFolder) folders.add(settings.trainerFolder)
  if (settings.watchDownloadsForTrainers) {
    try {
      folders.add(app.getPath('downloads'))
    } catch {
      // no Downloads folder on this machine; nothing to watch
    }
  }
  for (const folder of folders) {
    try {
      const watcher = watch(folder, { persistent: false }, (_event, file) => {
        if (typeof file === 'string' && file.toLowerCase().endsWith('.exe')) scheduleTrainerRescan()
      })
      trainerWatchers.push(watcher)
    } catch {
      // unreadable/nonexistent folder - skip it rather than fail startup
    }
  }
}

async function runBackup(): Promise<BackupResult> {
  if (!settings.backupFolder) return { ok: false, error: 'No backup folder set.', settings }
  try {
    await fs.mkdir(settings.backupFolder, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = join(settings.backupFolder, `game-browser-backup-${stamp}.zip`)
    await createZip(
      [
        { zipPath: 'library.json', fsPath: libraryFile },
        { zipPath: 'settings.json', fsPath: settingsFile },
        { zipPath: 'categories.json', fsPath: categoriesFile },
        { zipPath: 'covers', fsPath: coversDir, isDir: true },
        { zipPath: 'icons', fsPath: iconsDir, isDir: true },
        { zipPath: 'screenshots', fsPath: screenshotsDir, isDir: true },
        { zipPath: 'trainers', fsPath: trainersDir, isDir: true }
      ],
      dest,
      (current, total, currentName) => broadcastBackupProgress({ current, total, currentName })
    )
    settings.lastBackupAt = new Date().toISOString()
    await saveSettingsToDisk()
    await pruneOldBackups()
    return { ok: true, path: dest, settings }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), settings }
  } finally {
    broadcastBackupProgress(null)
  }
}

async function restoreFromZip(zipPath: string): Promise<BackupResult> {
  try {
    await extractZip(zipPath, userDataPath)
    await loadLibrary()
    await loadSettings()
    await loadCategories()
    broadcastLibrary()
    broadcastCategories()
    return { ok: true, path: zipPath, settings }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), settings }
  }
}

// Catches the case where the app wasn't running when a scheduled backup was
// due — re-evaluated against wall-clock time, so downtime doesn't skip it,
// it just runs late on the next launch/check instead.
async function maybeRunScheduledBackup(): Promise<void> {
  if (!settings.backupEnabled || !settings.backupFolder) return
  const intervalMs = settings.backupIntervalHours * 60 * 60 * 1000
  const last = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : 0
  if (Date.now() - last >= intervalMs) {
    await runBackup()
  }
}

// Returns <0 if a<b, 0 if equal, >0 if a>b. Assumes plain x.y.z (no
// pre-release suffixes) - good enough since that's the only format this
// project's version numbers ever take.
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

const PORTABLE_EXE_NAME_RE = /^Game Browser (\d+\.\d+\.\d+)\.exe$/

// The portable NSIS wrapper self-extracts to a throwaway %TEMP% folder on
// every launch, so `process.execPath` never points at the file the user
// actually keeps/double-clicks - electron-builder's portable target sets
// PORTABLE_EXECUTABLE_DIR/_FILE env vars for exactly this reason. Every
// startup, sweep that real directory for older sibling exes (leftovers from
// a previous update, including ones a locked-file race left behind last
// time) and remove them now that they're very likely unlocked.
async function cleanupOldPortableExes(): Promise<void> {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR
  if (!dir) return
  const currentVersion = app.getVersion()
  const entries = await safeReaddir(dir)
  if (!entries) return
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = entry.name.match(PORTABLE_EXE_NAME_RE)
    if (!match) continue
    if (compareVersions(match[1], currentVersion) < 0) {
      await fs.unlink(join(dir, entry.name)).catch(() => {
        // still locked (that old instance may not have fully exited yet) - leave it, next launch retries
      })
    }
  }
}

interface GithubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GithubRelease {
  tag_name: string
  body: string | null
  assets: GithubReleaseAsset[]
}

async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  if (!UPDATE_REPO) return { available: false, currentVersion }
  try {
    return await withTimeout(async (signal) => {
      const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        headers: { 'User-Agent': 'game-browser-update-check', Accept: 'application/vnd.github+json' },
        signal
      })
      if (!res.ok) return { available: false, currentVersion, error: `GitHub API returned ${res.status}` }
      const release = (await res.json()) as GithubRelease
      const latestVersion = release.tag_name.replace(/^v/i, '')
      const asset = release.assets.find((a) => a.name.toLowerCase().endsWith('.exe'))
      if (compareVersions(latestVersion, currentVersion) <= 0 || !asset) {
        return { available: false, currentVersion, latestVersion }
      }
      return {
        available: true,
        currentVersion,
        latestVersion,
        notes: release.body ?? undefined,
        assetUrl: asset.browser_download_url,
        assetSize: asset.size
      }
    })
  } catch (e) {
    return { available: false, currentVersion, error: e instanceof Error ? e.message : String(e) }
  }
}

async function downloadUpdateAndRestart(
  assetUrl: string,
  assetSize: number,
  version: string
): Promise<UpdateApplyResult> {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR
  if (!dir) {
    return { ok: false, error: "Self-update only works from the portable .exe, not `npm run dev`." }
  }
  try {
    return await withTimeout(
      async (signal) => {
        const res = await net.fetch(assetUrl, { signal })
        if (!res.ok) return { ok: false, error: `Download failed: HTTP ${res.status}` }
        const buf = Buffer.from(await res.arrayBuffer())
        if (assetSize > 0 && buf.length !== assetSize) {
          return { ok: false, error: 'Downloaded file size does not match the release asset - try again.' }
        }
        const destPath = join(dir, `Game Browser ${version}.exe`)
        await writeFileAtomic(destPath, buf)
        const child = spawn(destPath, [], { detached: true, stdio: 'ignore' })
        child.unref()
        app.quit()
        return { ok: true }
      },
      // The exe itself can be tens of MB - a much longer window than the
      // default so a merely-slow connection doesn't get mistaken for a
      // stalled one.
      120000
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('games:getAll', async () => games)

  ipcMain.handle('games:addManual', async () => {
    const result = await showOpenDialog({
      properties: ['openFile'],
      title: 'Select game executable',
      filters: [{ name: 'Executable', extensions: ['exe'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const exePath = result.filePaths[0]
    const id = randomUUID()
    const iconPath = await extractIcon(exePath, id)
    const game: Game = {
      id,
      name: basename(exePath, extname(exePath)),
      exePath,
      installDir: dirname(exePath),
      coverPath: null,
      iconPath,
      favorite: false,
      dateAdded: new Date().toISOString(),
      lastPlayed: null,
      playtimeSeconds: 0,
      source: 'manual',
      genres: [],
      tags: [],
      rating: null,
      categoryIds: [],
      excludeFromPlaytime: false,
      installSizeBytes: null,
      sizeMeasuredAt: null,
      trainerPath: null,
      steamAppId: null,
      epicAppName: null,
      gogProductId: null,
      ubisoftId: null
    }
    games.push(game)
    await saveLibrary()
    broadcastLibrary()
    enqueueAutoCoverFetch(game)
    return game
  })

  ipcMain.handle('games:scanFolder', async (): Promise<GameCandidate[]> => {
    const result = await showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a folder containing your games'
    })
    if (result.canceled || result.filePaths.length === 0) return []
    const root = result.filePaths[0]
    const entries = await safeReaddir(root)
    if (!entries) return []
    const subdirs = entries.filter((e) => e.isDirectory())
    const candidates: GameCandidate[] = []
    try {
      if (subdirs.length > 0) {
        for (let i = 0; i < subdirs.length; i++) {
          const sub = subdirs[i]
          broadcastScanProgress({ current: i + 1, total: subdirs.length, currentName: sub.name })
          const full = join(root, sub.name)
          const exe = await findBestExe(full)
          if (exe) candidates.push({ name: cleanGameName(sub.name), exePath: exe, installDir: full })
        }
      }
      if (candidates.length === 0) {
        broadcastScanProgress({ current: 1, total: 1, currentName: basename(root) })
        const exe = await findBestExe(root)
        if (exe) candidates.push({ name: cleanGameName(basename(root)), exePath: exe, installDir: root })
      }
    } finally {
      broadcastScanProgress(null)
    }
    return candidates
  })

  ipcMain.handle('games:importCandidates', async (_e, candidates: GameCandidate[]): Promise<Game[]> => {
    const created: Game[] = []
    for (const c of candidates) {
      const id = randomUUID()
      const iconPath = await extractIcon(c.exePath, id)
      const game: Game = {
        id,
        name: c.name,
        exePath: c.exePath,
        installDir: c.installDir,
        coverPath: null,
        iconPath,
        favorite: false,
        dateAdded: new Date().toISOString(),
        lastPlayed: null,
        playtimeSeconds: 0,
        source: 'folder-scan',
        genres: [],
        tags: [],
        rating: null,
        categoryIds: [],
        excludeFromPlaytime: false,
        installSizeBytes: null,
        sizeMeasuredAt: null,
        trainerPath: null,
        steamAppId: null,
        epicAppName: null,
        gogProductId: null,
        ubisoftId: null
      }
      games.push(game)
      created.push(game)
    }
    await saveLibrary()
    broadcastLibrary()
    for (const game of created) enqueueAutoCoverFetch(game)
    return created
  })

  ipcMain.handle('steam:import', async (): Promise<ImportResult> => {
    const installed = await findInstalledSteamGames()
    if (installed === null) return { imported: 0, error: 'Steam installation not found.' }
    const created = await addNewSteamGames(installed)
    if (created.length > 0) {
      await saveLibrary()
      broadcastLibrary()
      for (const game of created) enqueueAutoCoverFetch(game)
      void sweepMissingScreenshots()
    }
    return { imported: created.length }
  })

  ipcMain.handle('epic:import', async (): Promise<ImportResult> => {
    const installed = await findInstalledEpicGames()
    if (installed === null) return { imported: 0, error: 'Epic Games Launcher not found.' }
    const created = await addNewEpicGames(installed)
    if (created.length > 0) {
      await saveLibrary()
      broadcastLibrary()
      for (const game of created) enqueueAutoCoverFetch(game)
    }
    return { imported: created.length }
  })

  ipcMain.handle('gog:import', async (): Promise<ImportResult> => {
    let gogGames: GogGame[]
    try {
      gogGames = await findGogGames()
    } catch (e) {
      return { imported: 0, error: e instanceof Error ? e.message : String(e) }
    }
    if (gogGames.length === 0) return { imported: 0, error: 'GOG Galaxy not found, or no games installed.' }
    const created = await addNewGogGames(gogGames)
    if (created.length > 0) {
      await saveLibrary()
      broadcastLibrary()
      for (const game of created) enqueueAutoCoverFetch(game)
    }
    return { imported: created.length }
  })

  ipcMain.handle('ubisoft:import', async (): Promise<ImportResult> => {
    const installed = await findInstalledUbisoftGames()
    if (installed === null) return { imported: 0, error: 'Ubisoft Connect installation not found.' }
    const created = await addNewUbisoftGames(installed)
    if (created.length > 0) {
      await saveLibrary()
      broadcastLibrary()
      for (const game of created) enqueueAutoCoverFetch(game)
    }
    return { imported: created.length }
  })

  ipcMain.handle('games:launch', async (_e, id: string) => {
    const game = games.find((g) => g.id === id)
    if (!game || runningProcesses.has(id)) return

    // Launching via a forked helper keeps the (potentially slow, AV-scanned)
    // CreateProcess call for the game's own .exe off the main process's event
    // loop, so the UI doesn't freeze while Windows starts the game.
    const helper = fork(join(__dirname, 'launcher-helper.js'), [game.exePath, game.installDir], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      silent: true
    })

    runningProcesses.set(id, { child: helper, start: Date.now() })
    broadcastRunning(id, true)
    const finish = async (): Promise<void> => {
      const info = runningProcesses.get(id)
      runningProcesses.delete(id)
      if (info) {
        game.playtimeSeconds += Math.round((Date.now() - info.start) / 1000)
      }
      game.lastPlayed = new Date().toISOString()
      await saveLibrary()
      broadcastLibrary()
      broadcastRunning(id, false)
    }
    helper.once('exit', () => void finish())
    helper.once('error', () => void finish())
  })

  ipcMain.handle(
    'games:update',
    async (
      _e,
      id: string,
      patch: Partial<
        Pick<
          Game,
          'name' | 'favorite' | 'tags' | 'rating' | 'categoryIds' | 'steamAppId' | 'excludeFromPlaytime'
        >
      >
    ) => {
      const game = games.find((g) => g.id === id)
      if (!game) return null
      const settingNewAppId = typeof patch.steamAppId === 'number' && patch.steamAppId !== game.steamAppId
      Object.assign(game, patch)
      if (settingNewAppId) await applySteamAppId(game, patch.steamAppId as number)
      await saveLibrary()
      broadcastLibrary()
      return game
    }
  )

  ipcMain.handle('games:setCover', async (_e, id: string) => {
    const game = games.find((g) => g.id === id)
    if (!game) return null
    const result = await showOpenDialog({
      properties: ['openFile'],
      title: 'Select cover image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const src = result.filePaths[0]
    const dest = join(coversDir, `${id}${extname(src)}`)
    await copyFileAtomic(src, dest)
    game.coverPath = dest
    await saveLibrary()
    broadcastLibrary()
    return game
  })

  ipcMain.handle('games:setExePath', async (_e, id: string) => {
    const game = games.find((g) => g.id === id)
    if (!game) return null
    const result = await showOpenDialog({
      properties: ['openFile'],
      title: 'Select game executable',
      filters: [{ name: 'Executable', extensions: ['exe'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    game.exePath = result.filePaths[0]
    game.installDir = dirname(result.filePaths[0])
    await saveLibrary()
    broadcastLibrary()
    return game
  })

  ipcMain.handle('games:remove', async (_e, id: string) => {
    const idx = games.findIndex((g) => g.id === id)
    if (idx === -1) return
    const [game] = games.splice(idx, 1)
    await saveLibrary()
    broadcastLibrary()
    for (const p of [game.coverPath, game.iconPath]) {
      if (p) fs.unlink(p).catch(() => {})
    }
  })

  ipcMain.handle('games:removeMany', async (_e, ids: string[]) => {
    const idSet = new Set(ids)
    const removed = games.filter((g) => idSet.has(g.id))
    games = games.filter((g) => !idSet.has(g.id))
    await saveLibrary()
    broadcastLibrary()
    for (const game of removed) {
      for (const p of [game.coverPath, game.iconPath]) {
        if (p) fs.unlink(p).catch(() => {})
      }
    }
  })

  // Hands off to each platform's own uninstaller rather than deleting files
  // ourselves - the platform needs to know too, or it'll keep thinking the
  // game is installed. The library entry itself is left alone; the startup
  // sync (syncPlatformLibraries) picks up the removal next launch once the
  // platform confirms it's actually gone, so we never race an uninstall the
  // user might still cancel in the platform's own confirmation dialog.
  ipcMain.handle('games:uninstall', async (_e, id: string): Promise<{ ok: boolean; error?: string }> => {
    const game = games.find((g) => g.id === id)
    if (!game) return { ok: false, error: 'Game not found.' }
    try {
      if (game.source === 'steam' && game.steamAppId !== null) {
        await shell.openExternal(`steam://uninstall/${game.steamAppId}`)
        return { ok: true }
      }
      if (game.source === 'epic' && game.epicAppName !== null) {
        const manifests = await parseEpicManifests()
        const m = manifests.find((x) => x.appName === game.epicAppName)
        if (!m?.catalogNamespace || !m?.catalogItemId) {
          return { ok: false, error: 'Could not find this game in the Epic Games Launcher anymore.' }
        }
        await shell.openExternal(
          `com.epicgames.launcher://apps/${m.catalogNamespace}%3A${m.catalogItemId}%3A${m.appName}?action=uninstall&silent=false`
        )
        return { ok: true }
      }
      if (game.source === 'gog') {
        const entries = await safeReaddir(game.installDir)
        const uninstaller = entries?.find((e) => e.isFile() && /^unins\d*\.exe$/i.test(e.name))
        if (!uninstaller) return { ok: false, error: 'Could not find the GOG uninstaller in the install folder.' }
        spawn(join(game.installDir, uninstaller.name), [], { detached: true, stdio: 'ignore' }).unref()
        return { ok: true }
      }
      if (game.source === 'ubisoft' && game.ubisoftId !== null) {
        // No direct uninstall URI is documented for Ubisoft Connect - this
        // opens the client to the game's own page, where Uninstall is one
        // click away, same end result as the other platforms just with one
        // extra click.
        await shell.openExternal(`uplay://open/game/${game.ubisoftId}`)
        return { ok: true }
      }
      return { ok: false, error: 'Uninstall is only available for Steam, Epic, GOG, and Ubisoft games.' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Only for manually-added/folder-scan games - Steam/Epic/GOG games must go
  // through games:uninstall above instead, so the owning platform stays in
  // sync with what's actually on disk.
  ipcMain.handle('games:deleteFromDisk', async (_e, id: string): Promise<{ ok: boolean; error?: string }> => {
    const idx = games.findIndex((g) => g.id === id)
    if (idx === -1) return { ok: false, error: 'Game not found.' }
    const game = games[idx]
    if (game.source !== 'manual' && game.source !== 'folder-scan') {
      return { ok: false, error: 'Delete from disk is only available for manually added games.' }
    }
    try {
      // Windows-specific: a recursive rmdir can transiently fail with
      // ENOTEMPTY/EBUSY if AV or Explorer still has a brief handle open on
      // something inside the tree (thumbnail cache, a file that was just
      // running) even though nothing is actually still using it a moment
      // later - maxRetries/retryDelay makes Node retry the whole operation
      // instead of failing on the first attempt.
      await fs.rm(game.installDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    games.splice(idx, 1)
    await saveLibrary()
    broadcastLibrary()
    for (const p of [game.coverPath, game.iconPath]) {
      if (p) fs.unlink(p).catch(() => {})
    }
    return { ok: true }
  })

  ipcMain.handle('games:cleanAllNames', async (): Promise<{ changed: number }> => {
    let changed = 0
    for (const game of games) {
      const cleaned = cleanGameName(game.name)
      if (cleaned && cleaned !== game.name) {
        game.name = cleaned
        changed++
      }
    }
    if (changed > 0) {
      await saveLibrary()
      broadcastLibrary()
    }
    return { changed }
  })

  ipcMain.handle('games:fetchCovers', async (): Promise<CoverFetchResult> => {
    const targets = games.filter((g) => !g.coverPath || g.genres.length === 0)
    const total = targets.length

    let matchedIgdb = 0
    let matchedSteam = 0
    let matchedRawg = 0
    if (targets.length > 0) {
      try {
        for (let i = 0; i < targets.length; i++) {
          const target = targets[i]
          broadcastCoverFetchProgress({ current: i + 1, total: targets.length, currentName: target.name })
          const source = await fetchMetadataForGame(target)
          if (source === 'igdb') matchedIgdb++
          else if (source === 'steam') matchedSteam++
          else if (source === 'rawg') matchedRawg++
          await new Promise((r) => setTimeout(r, 300))
        }
      } finally {
        broadcastCoverFetchProgress(null)
      }
    }

    if (matchedIgdb > 0 || matchedSteam > 0 || matchedRawg > 0) {
      await saveLibrary()
      broadcastLibrary()
    }

    return { ok: true, matchedIgdb, matchedSteam, matchedRawg, total }
  })

  ipcMain.handle('games:fetchCoverForOne', async (_e, id: string): Promise<{ ok: boolean; found: boolean }> => {
    const game = games.find((g) => g.id === id)
    if (!game) return { ok: false, found: false }
    const source = await fetchMetadataForGame(game, { forceCover: true })
    if (source) {
      await saveLibrary()
      broadcastLibrary()
    }
    return { ok: true, found: !!source }
  })

  ipcMain.handle('app:getInfo', async () => ({
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    dataPath: userDataPath
  }))

  ipcMain.handle('app:openDataFolder', async () => {
    await shell.openPath(userDataPath)
  })

  ipcMain.handle('settings:get', async (): Promise<Settings> => settings)

  ipcMain.handle('settings:save', async (_e, next: Settings): Promise<Settings> => {
    settings = {
      ...settings,
      igdbClientId: next.igdbClientId?.trim() ?? '',
      igdbClientSecret: next.igdbClientSecret?.trim() ?? '',
      rawgApiKey: next.rawgApiKey?.trim() ?? '',
      librarySyncEnabled: !!next.librarySyncEnabled
    }
    igdbToken = null
    await saveSettingsToDisk()
    return settings
  })

  ipcMain.handle('games:getSteamDetails', async (_e, id: string): Promise<SteamGameDetails | null> => {
    const game = games.find((g) => g.id === id)
    if (!game) return null
    let appid = game.steamAppId
    if (appid === null) {
      const match = await searchSteamMatch(game.name)
      if (!match) return null
      appid = match.appid
    }
    const result = await fetchSteamAppDetails(appid)
    if (!result.details) return null
    return localizeSteamImages(appid, result.details)
  })

  ipcMain.handle('screenshots:sweepNow', async (): Promise<ScreenshotSweepResult> => sweepMissingScreenshots())

  ipcMain.handle('steam:syncPlaytime', async (): Promise<SteamPlaytimeSyncResult> => syncSteamPlaytime())

  ipcMain.handle('metadata:sweepNow', async (): Promise<MetadataSweepResult> => sweepMissingMetadata())

  ipcMain.handle('sizes:measureNow', async (): Promise<DiskSizeSweepResult> => sweepDiskSizes(true))

  ipcMain.handle('trainers:pickFolder', async (): Promise<string | null> => {
    const result = await showOpenDialog({ properties: ['openDirectory'], title: 'Select your trainers folder' })
    if (result.canceled || result.filePaths.length === 0) return null
    settings = { ...settings, trainerFolder: result.filePaths[0] }
    await saveSettingsToDisk()
    startTrainerWatchers()
    return settings.trainerFolder
  })

  ipcMain.handle('trainers:scan', async (): Promise<TrainerScanResult> => scanTrainers())

  ipcMain.handle('trainers:launch', async (_e, id: string): Promise<{ ok: boolean; error?: string }> => {
    const game = games.find((g) => g.id === id)
    if (!game?.trainerPath) return { ok: false, error: 'No trainer for this game.' }
    // openPath rather than spawn: trainers frequently ask for elevation, and
    // this lets Windows put up its own prompt instead of failing silently.
    const error = await shell.openPath(game.trainerPath)
    return error ? { ok: false, error } : { ok: true }
  })

  ipcMain.handle('trainers:openSearch', async (_e, id: string): Promise<void> => {
    const game = games.find((g) => g.id === id)
    if (!game) return
    await shell.openExternal(trainerSearchUrl(game.name))
  })

  ipcMain.handle('categories:getAll', async (): Promise<Category[]> => categories)

  ipcMain.handle('categories:create', async (_e, name: string): Promise<Category> => {
    const category: Category = { id: randomUUID(), name: name.trim() }
    categories.push(category)
    await saveCategories()
    broadcastCategories()
    return category
  })

  ipcMain.handle('categories:rename', async (_e, id: string, name: string): Promise<Category | null> => {
    const category = categories.find((c) => c.id === id)
    if (!category) return null
    category.name = name.trim()
    await saveCategories()
    broadcastCategories()
    return category
  })

  ipcMain.handle('categories:delete', async (_e, id: string) => {
    categories = categories.filter((c) => c.id !== id)
    await saveCategories()
    broadcastCategories()
    let changed = false
    for (const game of games) {
      if (game.categoryIds.includes(id)) {
        game.categoryIds = game.categoryIds.filter((c) => c !== id)
        changed = true
      }
    }
    if (changed) {
      await saveLibrary()
      broadcastLibrary()
    }
  })

  ipcMain.handle('backup:pickFolder', async (): Promise<string | null> => {
    const result = await showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a folder to store backups in'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('backup:savePrefs', async (_e, prefs: BackupPrefs): Promise<Settings> => {
    settings = {
      ...settings,
      backupFolder: prefs.backupFolder?.trim() ?? '',
      backupEnabled: !!prefs.backupEnabled,
      backupIntervalHours: Number.isFinite(prefs.backupIntervalHours)
        ? Math.min(720, Math.max(1, Math.round(prefs.backupIntervalHours)))
        : settings.backupIntervalHours,
      backupKeepCount: Number.isFinite(prefs.backupKeepCount)
        ? Math.min(50, Math.max(0, Math.round(prefs.backupKeepCount)))
        : settings.backupKeepCount
    }
    await saveSettingsToDisk()
    // Lowering the limit should take effect straight away, not only after the
    // next backup happens to run.
    await pruneOldBackups()
    return settings
  })

  ipcMain.handle('backup:now', async (): Promise<BackupResult> => runBackup())

  ipcMain.handle('backup:restore', async (): Promise<BackupResult | null> => {
    const result = await showOpenDialog({
      properties: ['openFile'],
      title: 'Select a backup file to restore',
      defaultPath: settings.backupFolder || undefined,
      filters: [{ name: 'Game Browser Backup', extensions: ['zip'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return restoreFromZip(result.filePaths[0])
  })

  ipcMain.handle('backup:list', async (): Promise<BackupListResult> => {
    if (!settings.backupFolder) return { entries: [] }
    try {
      const entries = await fs.readdir(settings.backupFolder, { withFileTypes: true })
      const zips = entries.filter((e) => e.isFile() && /^game-browser-backup-.*\.zip$/i.test(e.name))
      const withStats = await Promise.all(
        zips.map(async (e) => {
          const full = join(settings.backupFolder, e.name)
          const stat = await fs.stat(full)
          return { name: e.name, path: full, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() }
        })
      )
      return { entries: withStats.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
    } catch (e) {
      return { entries: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('backup:restorePath', async (_e, path: string): Promise<BackupResult> => restoreFromZip(path))

  ipcMain.handle('update:check', async (): Promise<UpdateCheckResult> => checkForUpdate())

  ipcMain.handle(
    'update:downloadAndRestart',
    async (_e, assetUrl: string, assetSize: number, version: string): Promise<UpdateApplyResult> =>
      downloadUpdateAndRestart(assetUrl, assetSize, version)
  )
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    // Measured live over CDP, not estimated: shrinking the viewport until
    // anything in the topbar clips puts the real floor at 1444px of viewport
    // (1460px of window, +16px chrome) in the worst case - both the genre and
    // the tag filter visible, each capped at 160px by `.topbar-controls
    // .select` in index.css. 1500 leaves ~40px of headroom over that.
    // Re-measure the same way whenever the TopBar gains or loses a control,
    // and keep that select cap - without it this floor grows with the longest
    // genre/tag name and no fixed number here can be right.
    minWidth: 1500,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#141414',
    // In the packaged build the exe's own icon is used automatically; this
    // covers the dev-mode window/taskbar icon.
    icon: app.isPackaged ? undefined : join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Belt-and-suspenders alongside the app.exit(0) above: even if that somehow
// didn't terminate in time, a rejected second instance never reaches this
// block, so it can never load or overwrite library.json.
if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    await fs.mkdir(coversDir, { recursive: true })
    await fs.mkdir(iconsDir, { recursive: true })
    await fs.mkdir(screenshotsDir, { recursive: true })
    await fs.mkdir(trainersDir, { recursive: true })
    await loadLibrary()
    await loadSettings()
    await loadCategories()

    protocol.handle('local-file', async (request) => {
      const { pathname } = new URL(request.url)
      const filePath = decodeURIComponent(pathname.replace(/^\//, ''))
      try {
        const data = await fs.readFile(filePath)
        return new Response(data, { status: 200, headers: { 'Content-Type': mimeTypeFor(filePath) } })
      } catch {
        return new Response(null, { status: 404 })
      }
    })

    Menu.setApplicationMenu(null)
    registerIpcHandlers()
    createWindow()
    void repairIgnoredExePaths()
    // Playtime sync runs after the library sync so games imported on this
    // launch already exist (and carry a steamAppId) by the time it looks.
    // Gated by the same librarySyncEnabled preference as everything else that
    // reconciles the library against a platform.
    void syncPlatformLibraries()
      .then(() => (settings.librarySyncEnabled ? syncSteamPlaytime() : undefined))
      .then(() => sweepMissingMetadata())
      .then(() => sweepMissingScreenshots())
    void maybeRunScheduledBackup()
    void cleanupOldPortableExes()
    // The just-replaced old instance may still hold its exe file locked for
    // a moment after spawning the new one and calling app.quit() (which only
    // *schedules* shutdown) - the immediate sweep above often loses that
    // race right after an update. A couple of delayed retries catch it
    // within this same session instead of leaving the old file until the
    // user happens to relaunch again.
    setTimeout(() => void cleanupOldPortableExes(), 5000)
    setTimeout(() => void cleanupOldPortableExes(), 20000)
    // Cheap periodic re-check rather than scheduling exactly at the interval
    // boundary - correctly picks up backupEnabled/backupFolder/interval
    // changes made at runtime without needing to reset a timer.
    setInterval(() => void maybeRunScheduledBackup(), 15 * 60 * 1000)
    // sweepMissingScreenshots only otherwise runs once at startup (+ once
    // after a manual Steam import) - if that one attempt aborts early from
    // hitting Steam's rate limit, nothing else would ever retry it for the
    // rest of the session even long after the block has actually lifted,
    // since there's no periodic trigger. This one is cheap to call
    // repeatedly: it short-circuits instantly both while still inside an
    // active backoff window and once the whole library is already cached.
    setInterval(() => void sweepMissingScreenshots(), 15 * 60 * 1000)

    // Same reasoning for covers/genres: the per-game fetch on import is a
    // single attempt, so anything that failed once stayed missing forever.
    // Also cheap to re-run - it exits immediately once nothing is missing,
    // and skips games already found to have no match this session.
    setInterval(() => void sweepMissingMetadata(), METADATA_SWEEP_INTERVAL_MS)

    // Deliberately NOT chained behind the cover and screenshot sweeps. Those
    // are network-bound and can run for many minutes on a large library, and
    // chaining meant folder sizes hadn't started measuring at all after ten
    // minutes of uptime. Its own delayed start keeps it clear of the busy part
    // of startup without depending on anything else finishing; the interval
    // then picks up newly added games and the weekly re-measure, exiting
    // immediately when there's nothing due.
    startTrainerWatchers()
    // Catch anything that landed while the app was closed.
    if (settings.trainerFolder || settings.watchDownloadsForTrainers) void scanTrainers()

    setTimeout(() => void sweepDiskSizes(), 60 * 1000)
    setInterval(() => void sweepDiskSizes(), METADATA_SWEEP_INTERVAL_MS)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
