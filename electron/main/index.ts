import { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu, shell } from 'electron'
import { join, dirname, basename, extname } from 'path'
import { promises as fs, type Dirent } from 'fs'
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
  SteamGameDetails
} from '../../shared/types'
import { createZip, extractZip } from './zip'
import { writeFileAtomic, copyFileAtomic } from './fsAtomic'
import { findGogGames, type GogGame } from './gog'

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
const settingsFile = join(userDataPath, 'settings.json')
const categoriesFile = join(userDataPath, 'categories.json')

const UPDATE_REPO = 'limburatorul/gamebrowser-mihai'

let games: Game[] = []
let settings: Settings = {
  igdbClientId: '',
  igdbClientSecret: '',
  rawgApiKey: '',
  backupFolder: '',
  backupEnabled: false,
  backupIntervalHours: 24,
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
      steamAppId: g.steamAppId ?? null,
      epicAppName: g.epicAppName ?? null,
      gogProductId: g.gogProductId ?? null
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

let igdbToken: IgdbToken | null = null

async function getIgdbToken(): Promise<string | null> {
  if (!settings.igdbClientId || !settings.igdbClientSecret) return null
  if (igdbToken && igdbToken.expiresAt > Date.now() + 60_000) return igdbToken.accessToken
  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(settings.igdbClientId)}&client_secret=${encodeURIComponent(settings.igdbClientSecret)}&grant_type=client_credentials`
  try {
    const res = await net.fetch(url, { method: 'POST' })
    if (!res.ok) return null
    const data = (await res.json()) as { access_token: string; expires_in: number }
    igdbToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
    return igdbToken.accessToken
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
    const res = await net.fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': settings.igdbClientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body
    })
    if (!res.ok) return null
    const results = (await res.json()) as IgdbGameResult[]
    const withCover = results.filter((r): r is IgdbGameResult & { cover: { image_id: string } } => !!r.cover?.image_id)
    if (withCover.length === 0) return null
    const norm = normalizeGameName(name)
    const exact = withCover.find((r) => normalizeGameName(r.name) === norm)
    const chosen = exact ?? withCover[0]
    return {
      name: chosen.name,
      imageId: chosen.cover.image_id,
      genres: chosen.genres?.map((g) => g.name) ?? []
    }
  } catch {
    return null
  }
}

async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await net.fetch(url)
    if (!res.ok) return false
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFileAtomic(destPath, buf)
    return true
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

async function searchSteamMatch(name: string): Promise<SteamMatch | null> {
  try {
    const res = await net.fetch(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=us`
    )
    if (!res.ok) return null
    const data = (await res.json()) as { items?: SteamSearchItem[] }
    const item = data.items?.[0]
    if (!item) return null
    for (const variant of ['library_600x900_2x.jpg', 'library_600x900.jpg', 'header.jpg']) {
      const url = `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/${variant}`
      try {
        const check = await net.fetch(url, { method: 'HEAD' })
        if (check.ok) return { appid: item.id, coverUrl: url }
      } catch {
        // try next variant
      }
    }
    return null
  } catch {
    return null
  }
}

async function fetchSteamGenres(appid: number): Promise<string[]> {
  try {
    const res = await net.fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&filters=genres`
    )
    if (!res.ok) return []
    const data = (await res.json()) as Record<
      string,
      { success: boolean; data?: { genres?: { description: string }[] } }
    >
    const entry = data[String(appid)]
    if (!entry?.success) return []
    return entry.data?.genres?.map((g) => g.description) ?? []
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

async function fetchSteamAppDetails(appid: number): Promise<SteamGameDetails | null> {
  try {
    const res = await net.fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`)
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, { success: boolean; data?: SteamAppDetailsResponse }>
    const entry = data[String(appid)]
    if (!entry?.success || !entry.data) return null
    const d = entry.data
    return {
      appid,
      description: d.short_description ?? '',
      headerImage: d.header_image ?? null,
      screenshots: d.screenshots?.map((s) => s.path_full) ?? [],
      releaseDate: d.release_date?.date ?? null,
      developers: d.developers ?? [],
      publishers: d.publishers ?? [],
      genres: d.genres?.map((g) => g.description) ?? [],
      metacriticScore: d.metacritic?.score ?? null
    }
  } catch {
    return null
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

interface RawgSearchItem {
  name: string
  background_image: string | null
  genres?: { name: string }[]
}

async function searchRawgMatch(name: string): Promise<{ imageUrl: string; genres: string[] } | null> {
  if (!settings.rawgApiKey) return null
  try {
    const res = await net.fetch(
      `https://api.rawg.io/api/games?key=${encodeURIComponent(settings.rawgApiKey)}&search=${encodeURIComponent(name)}&page_size=1`
    )
    if (!res.ok) return null
    const data = (await res.json()) as { results?: RawgSearchItem[] }
    const item = data.results?.[0]
    if (!item?.background_image) return null
    return { imageUrl: item.background_image, genres: item.genres?.map((g) => g.name) ?? [] }
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
  /^ue4?prereq/i
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
  const folderName = basename(folder).toLowerCase()
  pool.sort((a, b) => {
    const aMatch = basename(a.file, '.exe').toLowerCase() === folderName ? 1 : 0
    const bMatch = basename(b.file, '.exe').toLowerCase() === folderName ? 1 : 0
    if (aMatch !== bMatch) return bMatch - aMatch
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
    return [...new Set([steamPath, ...paths])]
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
      if (appid && name && installdir) manifests.push({ appid, name, installdir })
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
  for (const lib of libraries) {
    const manifests = await parseAppManifests(lib)
    for (const m of manifests) {
      result.push({ appId: Number(m.appid), name: m.name, installDir: join(lib, 'steamapps', 'common', m.installdir) })
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
      steamAppId: g.appId,
      epicAppName: null,
      gogProductId: null
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
      steamAppId: null,
      epicAppName: m.appName,
      gogProductId: null
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
      steamAppId: null,
      epicAppName: null,
      gogProductId: g.productId
    }
    games.push(game)
    added.push(game)
    existingProductIds.add(g.productId)
  }
  return added
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
  const [steam, epic, gog] = await Promise.all([
    syncSteamLibrary().catch((): { added: Game[]; removed: Game[] } => ({ added: [], removed: [] })),
    syncEpicLibrary().catch((): { added: Game[]; removed: Game[] } => ({ added: [], removed: [] })),
    syncGogLibrary().catch((): { added: Game[]; removed: Game[] } => ({ added: [], removed: [] }))
  ])
  const removed = [...steam.removed, ...epic.removed, ...gog.removed]
  const added = [...steam.added, ...epic.added, ...gog.added]
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
    ['GOG', gog]
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
        { zipPath: 'screenshots', fsPath: screenshotsDir, isDir: true }
      ],
      dest
    )
    settings.lastBackupAt = new Date().toISOString()
    await saveSettingsToDisk()
    return { ok: true, path: dest, settings }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), settings }
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
    const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'game-browser-update-check', Accept: 'application/vnd.github+json' }
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
    const res = await net.fetch(assetUrl)
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
      steamAppId: null,
      epicAppName: null,
      gogProductId: null
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
        steamAppId: null,
        epicAppName: null,
        gogProductId: null
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
    async (_e, id: string, patch: Partial<Pick<Game, 'name' | 'favorite' | 'tags' | 'rating' | 'categoryIds'>>) => {
      const game = games.find((g) => g.id === id)
      if (!game) return null
      Object.assign(game, patch)
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
      return { ok: false, error: 'Uninstall is only available for Steam, Epic, and GOG games.' }
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
      await fs.rm(game.installDir, { recursive: true, force: true })
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
    const details = await fetchSteamAppDetails(appid)
    if (!details) return null
    return localizeSteamImages(appid, details)
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
        : settings.backupIntervalHours
    }
    await saveSettingsToDisk()
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
    minWidth: 1850,
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
    void syncPlatformLibraries()
    void maybeRunScheduledBackup()
    void cleanupOldPortableExes()
    // Cheap periodic re-check rather than scheduling exactly at the interval
    // boundary - correctly picks up backupEnabled/backupFolder/interval
    // changes made at runtime without needing to reset a timer.
    setInterval(() => void maybeRunScheduledBackup(), 15 * 60 * 1000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
