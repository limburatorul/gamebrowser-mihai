import { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu, shell, screen } from 'electron'
import { join, dirname, basename, extname, parse as parsePath } from 'path'
import { homedir, userInfo } from 'os'
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
  FolderScanResult,
  DiskSizeSweepResult,
  TrainerScanResult,
  TrainerFileInfo,
  DuplicateGroup,
  DriveUsage,
  MissingGameEntry,
  MissingScanResult,
  DeleteFromDiskResult,
  PlaySession,
  SaveBackupEntry,
  SaveBackupResult,
  SaveLocationsResult
} from '../../shared/types'
import { createZip, extractZip } from './zip'
import { writeFileAtomic, copyFileAtomic } from './fsAtomic'
import { findGogGames, type GogGame } from './gog'
import { readSteamPlaytime } from './steamPlaytime'
import { scanTrainerFolder, matchTrainer, trainerSearchUrl } from './trainers'
import {
  buildIndexFromManifest,
  downloadManifest,
  findSaveEntry,
  newestMtimeMs,
  resolveExistingSaves,
  MANIFEST_MAX_AGE_MS,
  type Placeholders,
  type SaveIndex
} from './saves'

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
// Window geometry lives in its own file rather than settings.json: it changes
// on every resize and drag, and settings.json holds things worth not rewriting
// dozens of times a minute.
const windowStateFile = join(userDataPath, 'window.json')
const settingsFile = join(userDataPath, 'settings.json')
const categoriesFile = join(userDataPath, 'categories.json')
// Folders the user has told the scan to leave alone. Its own file rather than
// a settings field: it is a list that grows every time a folder is scanned,
// and settings.json holds things worth not rewriting constantly.
const ignoredFoldersFile = join(userDataPath, 'ignoredFolders.json')
// Append-only log of finished sessions. Its own file for the same reason
// window.json is: it grows on its own schedule and shouldn't drag the whole
// library through a rewrite every time a game exits.
const sessionsFile = join(userDataPath, 'sessions.json')

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
  scanRoots: [],
  trainerFolder: '',
  trainerMirrorFolder: '',
  watchDownloadsForTrainers: true,
  lastBackupAt: null,
  librarySyncEnabled: true,
  autoBackupSavesOnExit: true
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
      completion: g.completion ?? null,
      categoryIds: g.categoryIds ?? [],
      excludeFromPlaytime: g.excludeFromPlaytime ?? false,
      hidden: g.hidden ?? false,
      lastLaunchedHere: g.lastLaunchedHere ?? null,
      playtimeSecondsHere: g.playtimeSecondsHere ?? 0,
      installSizeBytes: g.installSizeBytes ?? null,
      sizeMeasuredAt: g.sizeMeasuredAt ?? null,
      trainerPath: g.trainerPath ?? null,
      launchArgs: g.launchArgs ?? '',
      runAsAdmin: g.runAsAdmin ?? false,
      actions: g.actions ?? [],
      hltbMainSeconds: g.hltbMainSeconds ?? null,
      hltbMainExtraSeconds: g.hltbMainExtraSeconds ?? null,
      hltbCompletionistSeconds: g.hltbCompletionistSeconds ?? null,
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

const saveIndexFile = join(userDataPath, 'saveIndex.json')
// Where a game's save backups land. Its own folder inside userData so they
// ride along in the app's own backups without any extra wiring.
const saveBackupsDir = join(userDataPath, 'save-backups')
let saveIndex: SaveIndex | null = null

/** Everything the manifest's `<placeholder>` tokens can expand to on this
    machine. `documents` goes through Electron rather than `~/Documents`
    because OneDrive redirects it, and getting that wrong means backing up an
    empty folder and reporting success. */
function placeholdersFor(game: Game): Placeholders {
  return {
    base: game.installDir,
    home: homedir(),
    winAppData: process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
    winLocalAppData: process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
    winLocalAppDataLow: join(homedir(), 'AppData', 'LocalLow'),
    winDocuments: app.getPath('documents'),
    winPublic: process.env.PUBLIC ?? 'C:\\Users\\Public',
    winProgramData: process.env.PROGRAMDATA ?? 'C:\\ProgramData',
    winDir: process.env.WINDIR ?? 'C:\\Windows',
    osUserName: userInfo().username
  }
}

/** The zip writer takes files off disk, so the little index of what came from
    where has to exist as a file before it can go in. */
async function writeTempJson(value: unknown): Promise<string> {
  const path = join(app.getPath('temp'), `gb-saves-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  await fs.writeFile(path, JSON.stringify(value, null, 2), 'utf-8')
  return path
}

async function listSaveBackups(gameId: string): Promise<SaveBackupEntry[]> {
  try {
    const dir = join(saveBackupsDir, gameId)
    const out: SaveBackupEntry[] = []
    for (const name of await fs.readdir(dir)) {
      if (!name.toLowerCase().endsWith('.zip')) continue
      const path = join(dir, name)
      const stat = await fs.stat(path)
      out.push({ path, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size })
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

/** Kept per game. Ten is enough to walk back past a bad save without the
    folder growing without limit; the oldest are dropped after each new one. */
const SAVE_BACKUP_KEEP = 10

async function pruneSaveBackups(gameId: string): Promise<void> {
  const existing = await listSaveBackups(gameId)
  for (const old of existing.slice(SAVE_BACKUP_KEEP)) {
    try {
      await fs.rm(old.path, { force: true })
    } catch {
      // locked or already gone; the next prune will get it
    }
  }
}

/**
 * Backs up one game's saves.
 *
 * `skipIfUnchanged` is what makes the automatic backup on exit sane: starting
 * and quitting a game without saving leaves the files untouched, and writing an
 * identical archive each time would fill the retention window with copies of
 * the same moment.
 */
async function backupSavesFor(id: string, skipIfUnchanged: boolean): Promise<SaveBackupResult> {
  const game = games.find((g) => g.id === id)
  if (!game) return { ok: false, error: 'Game not found.' }
  if (!saveIndex) await refreshSaveIndex()
  if (!saveIndex) return { ok: false, error: 'Could not download the list of save locations.' }
  const entry = findSaveEntry(saveIndex, game)
  if (!entry) return { ok: false, error: 'No save location is known for this game.' }
  const resolved = await resolveExistingSaves(entry, placeholdersFor(game))
  if (resolved.length === 0) {
    return { ok: false, error: 'The save folders for this game do not exist yet — has it been played?' }
  }
  if (skipIfUnchanged) {
    const [latest] = await listSaveBackups(id)
    if (latest && (await newestMtimeMs(resolved)) <= Date.parse(latest.createdAt)) {
      return { ok: true, unchanged: true, locations: resolved.map((r) => r.path) }
    }
  }
  try {
    await fs.mkdir(join(saveBackupsDir, id), { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = join(saveBackupsDir, id, `${stamp}.zip`)
    // Each location goes in under an index, and a manifest records which
    // index came from where - that is what makes restore able to put things
    // back rather than dumping them in one folder.
    const manifest = resolved.map((r, i) => ({ zipPath: `files/${i}`, originalPath: r.path, isDir: r.isDir }))
    await createZip(
      [
        ...manifest.map((m, i) => ({ zipPath: m.zipPath, fsPath: resolved[i].path, isDir: resolved[i].isDir })),
        { zipPath: 'saves.json', fsPath: await writeTempJson({ game: game.name, gameId: id, entries: manifest }) }
      ],
      dest,
      () => {}
    )
    await pruneSaveBackups(id)
    return { ok: true, path: dest, locations: resolved.map((r) => r.path) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function loadSaveIndex(): Promise<void> {
  try {
    saveIndex = JSON.parse(await fs.readFile(saveIndexFile, 'utf-8')) as SaveIndex
  } catch {
    saveIndex = null
  }
}

/**
 * Downloads and re-boils the Ludusavi manifest. 17MB to fetch and parse, so it
 * happens on a schedule and off the startup path - never in front of a user
 * waiting to back something up.
 */
async function refreshSaveIndex(force = false): Promise<{ ok: boolean; games?: number; error?: string }> {
  if (!force && saveIndex) {
    const age = Date.now() - Date.parse(saveIndex.builtAt)
    if (Number.isFinite(age) && age < MANIFEST_MAX_AGE_MS) {
      return { ok: true, games: Object.keys(saveIndex.byTitle).length }
    }
  }
  try {
    const index = buildIndexFromManifest(await downloadManifest())
    saveIndex = index
    await writeFileAtomic(saveIndexFile, Buffer.from(JSON.stringify(index), 'utf-8'))
    return { ok: true, games: Object.keys(index.byTitle).length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

let sessions: PlaySession[] = []

async function loadSessions(): Promise<void> {
  try {
    sessions = JSON.parse(await fs.readFile(sessionsFile, 'utf-8')) as PlaySession[]
  } catch {
    sessions = []
  }
}

/**
 * Never throws: a session is a nice-to-have record, and failing to write one
 * must not take down the exit handler that also saves the playtime it belongs
 * to. Written atomically so a crash mid-write can't leave unparseable JSON
 * that would silently reset the whole history to empty on next load.
 */
async function appendSession(session: PlaySession): Promise<void> {
  sessions.push(session)
  try {
    await writeFileAtomic(sessionsFile, Buffer.from(JSON.stringify(sessions), 'utf-8'))
  } catch {
    // history is lossy by design rather than fatal
  }
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

/** Stored as given so the UI can show a readable path; compared normalised. */
let ignoredFolders: string[] = []

const folderKey = (p: string): string => p.replace(/\//g, '\\').replace(/[\\]+$/, '').toLowerCase()

async function loadIgnoredFolders(): Promise<void> {
  try {
    const raw = await fs.readFile(ignoredFoldersFile, 'utf-8')
    const parsed = JSON.parse(raw)
    ignoredFolders = Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    ignoredFolders = []
  }
}

async function saveIgnoredFolders(): Promise<void> {
  await fs.writeFile(ignoredFoldersFile, JSON.stringify(ignoredFolders, null, 2), 'utf-8')
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
  /** Null when Steam has the app but no usable image for it. */
  coverUrl: string | null
}

// Steam's CDN doesn't have a single guaranteed image per app - some only
// have header.jpg, not the taller library art. Tries the best option first.
async function findSteamCoverUrl(appid: number, signal: AbortSignal): Promise<string | null> {
  // Classic layout first: it's the only one carrying the tall 600x900 library
  // art, which is what the grid actually wants.
  for (const variant of ['library_600x900_2x.jpg', 'library_600x900.jpg', 'header.jpg']) {
    const url = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/${variant}`
    try {
      const check = await net.fetch(url, { method: 'HEAD', signal })
      if (check.ok) return url
    } catch {
      // try next variant
    }
  }

  // Newer apps aren't served from that path at all - their assets live under
  // store_item_assets/… with a content hash in the URL, which can't be guessed.
  // Verified on appid 4512570: every classic variant 404s, while the store API
  // hands back a working header.jpg. Only header exists on the new path (the
  // 600x900 variants 404 there too), so this is a wide cover rather than a
  // tall one - still far better than the game having none at all.
  try {
    const res = await net.fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`,
      { signal }
    )
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, { success?: boolean; data?: { header_image?: string } }>
    const header = data[String(appid)]?.data?.header_image
    return typeof header === 'string' && header ? header : null
  } catch {
    return null
  }
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
      // A missing cover used to abort the whole match, which also threw away
      // the genres and the resolved appid - so a game Steam knows perfectly
      // well ended up with nothing at all. The appid is the valuable part.
      const coverUrl = await findSteamCoverUrl(item.id, signal)
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
  // Remember the resolved appid even when there's no cover - it saves every
  // later lookup (details panel, screenshots, genres) from name-searching
  // again, and lets a cover be picked up once Steam has one.
  if (game.steamAppId === null) {
    game.steamAppId = match.appid
    changed = true
  }
  if (needsCover && match.coverUrl) {
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

/**
 * Returns null - not an empty list - when the library folder can't be read.
 * The difference decides whether games there get removed from the library:
 * "this folder holds no installed games" and "this folder wasn't there when I
 * looked" produce the same empty manifest list but mean opposite things, and
 * one of this user's Steam libraries is a network share.
 */
async function parseAppManifests(libraryPath: string): Promise<SteamManifest[] | null> {
  const steamappsDir = join(libraryPath, 'steamapps')
  const entries = await safeReaddir(steamappsDir)
  if (!entries) return null
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
interface SteamScan {
  games: InstalledSteamGame[]
  /** Library folders that could actually be read this run. A game installed
      under a folder absent from this list is never treated as uninstalled. */
  readableLibraries: string[]
}

async function findInstalledSteamGames(): Promise<SteamScan | null> {
  const steamPath = await findSteamPath()
  if (!steamPath) return null
  const libraries = await findSteamLibraryFolders(steamPath)
  const readableLibraries: string[] = []
  const result: InstalledSteamGame[] = []
  // Several appids can share one installdir - Half-Life 2, Lost Coast and both
  // episodes all live in "common\Half-Life 2", which produced four library
  // entries pointing at the same folder and the same executable. First appid
  // for a folder wins; the rest are DLC-like siblings of the same install.
  const claimedDirs = new Set<string>()
  const seenAppIds = new Set<number>()
  for (const lib of libraries) {
    const manifests = await parseAppManifests(lib)
    if (manifests === null) continue
    readableLibraries.push(lib)
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
  return { games: result, readableLibraries }
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
      lastLaunchedHere: null,
      playtimeSeconds: 0,
      playtimeSecondsHere: 0,
      source: 'steam',
      genres: [],
      tags: [],
      rating: null,
      completion: null,
      actions: [],
      hltbMainSeconds: null,
      hltbMainExtraSeconds: null,
      hltbCompletionistSeconds: null,
      categoryIds: [],
      excludeFromPlaytime: false,
      hidden: false,
      installSizeBytes: null,
      sizeMeasuredAt: null,
      trainerPath: null,
      launchArgs: '',
      runAsAdmin: false,
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
      lastLaunchedHere: null,
      playtimeSeconds: 0,
      playtimeSecondsHere: 0,
      source: 'epic',
      genres: [],
      tags: [],
      rating: null,
      completion: null,
      actions: [],
      hltbMainSeconds: null,
      hltbMainExtraSeconds: null,
      hltbCompletionistSeconds: null,
      categoryIds: [],
      excludeFromPlaytime: false,
      hidden: false,
      installSizeBytes: null,
      sizeMeasuredAt: null,
      trainerPath: null,
      launchArgs: '',
      runAsAdmin: false,
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
      lastLaunchedHere: null,
      playtimeSeconds: 0,
      playtimeSecondsHere: 0,
      source: 'gog',
      genres: [],
      tags: [],
      rating: null,
      completion: null,
      actions: [],
      hltbMainSeconds: null,
      hltbMainExtraSeconds: null,
      hltbCompletionistSeconds: null,
      categoryIds: [],
      excludeFromPlaytime: false,
      hidden: false,
      installSizeBytes: null,
      sizeMeasuredAt: null,
      trainerPath: null,
      launchArgs: '',
      runAsAdmin: false,
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
      lastLaunchedHere: null,
      playtimeSeconds: 0,
      playtimeSecondsHere: 0,
      source: 'ubisoft',
      genres: [],
      tags: [],
      rating: null,
      completion: null,
      actions: [],
      hltbMainSeconds: null,
      hltbMainExtraSeconds: null,
      hltbCompletionistSeconds: null,
      categoryIds: [],
      excludeFromPlaytime: false,
      hidden: false,
      installSizeBytes: null,
      sizeMeasuredAt: null,
      trainerPath: null,
      launchArgs: '',
      runAsAdmin: false,
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

/** True when `child` sits inside `parent`, comparing Windows-style. */
function isInsideFolder(child: string, parent: string): boolean {
  const norm = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(p + '\\')
}

async function syncSteamLibrary(): Promise<{ added: Game[]; removed: Game[] }> {
  const scan = await findInstalledSteamGames()
  if (scan === null) return { added: [], removed: [] }
  const installedIds = new Set(scan.games.map((g) => g.appId))

  const removed = games.filter((g) => {
    if (g.source !== 'steam') return false
    if (g.steamAppId !== null && installedIds.has(g.steamAppId)) return false
    // Only drop a game when its own Steam library folder was readable this
    // run. 24 of this library's 34 Steam manifests live on a network share,
    // and if that share isn't mounted every one of them looks uninstalled -
    // which would delete the entries along with their covers and icons.
    // Anything we couldn't positively check stays put; a stale entry is
    // cheap, and the Dashboard's missing-files check catches it anyway.
    // Note this deliberately does not require a steamAppId: an entry that
    // lost its appid could previously never be removed at all.
    return scan.readableLibraries.some((lib) => isInsideFolder(g.installDir, lib))
  })

  const added = await addNewSteamGames(scan.games)
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

// Runs at startup AND on an interval (see whenReady). Startup-only meant that
// with the app left open, uninstalling a game in Steam was never noticed - 16
// entries sat here for over a day with their manifests long gone, the same
// one-shot-task mistake the screenshot and cover sweeps were both fixed for.
// Checks Steam/Epic/GOG for games that
// were installed or uninstalled since the last launch and mirrors that into
// the library, without requiring the user to press the manual Import
// buttons. Silent either way - same "just updates in the background" pattern
// as repairIgnoredExePaths, not a popup/toast.
const LIBRARY_SYNC_INTERVAL_MS = 15 * 60 * 1000
let librarySyncRunning = false

async function syncPlatformLibraries(): Promise<void> {
  if (!settings.librarySyncEnabled) return
  // A slow network library can make a run outlast the interval; overlapping
  // runs would compute `removed` from the same stale snapshot twice.
  if (librarySyncRunning) return
  librarySyncRunning = true
  try {
    await runPlatformSync()
  } finally {
    librarySyncRunning = false
  }
}

async function runPlatformSync(): Promise<void> {
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
/**
 * Optional second home for a matched trainer. The copy in userData is the one
 * the app uses and backs up; this is purely the user's own tidy collection, so
 * a failure here never fails the scan.
 */
async function mirrorTrainerFile(sourcePath: string, fileName: string): Promise<void> {
  const folder = settings.trainerMirrorFolder
  if (!folder) return
  try {
    await fs.mkdir(folder, { recursive: true })
    const dest = join(folder, fileName)
    try {
      const [src, existing] = await Promise.all([fs.stat(sourcePath), fs.stat(dest)])
      if (src.size === existing.size) return
    } catch {
      // not there yet, or unreadable - copy below
    }
    await copyFileAtomic(sourcePath, dest)
  } catch {
    // mirror folder unwritable; the real copy in userData is unaffected
  }
}

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
        await mirrorTrainerFile(dest, match.fileName)
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

// Extracted from the games:launch handler so "Play with Trainer" can reuse it
// rather than duplicating the playtime bookkeeping.
//
// An action overrides what gets started, but nothing else: the same playtime
// tracking, the same running-state broadcast, the same session record. Starting
// a game through its mod launcher is still playing it.
async function launchGame(id: string, actionId?: string): Promise<void> {
  const game = games.find((g) => g.id === id)
  if (!game || runningProcesses.has(id)) return

  const action = actionId ? game.actions.find((a) => a.id === actionId) : undefined
  // An action with no exe of its own means "the game, with different
  // arguments", so fall back to the game's path rather than refusing.
  const exePath = action?.exePath?.trim() || game.exePath
  const launchArgs = action ? action.args : game.launchArgs
  const runAsAdmin = action ? action.runAsAdmin : game.runAsAdmin
  // A launcher that lives in its own subfolder generally expects to run from
  // there; the plain game launch keeps using installDir, as it always has.
  const workingDir = action?.exePath?.trim() ? dirname(action.exePath) : game.installDir

  // Launching via a forked helper keeps the (potentially slow, AV-scanned)
  // CreateProcess call for the game's own .exe off the main process's event
  // loop, so the UI doesn't freeze while Windows starts the game.
  // Elevated launches go through PowerShell's Start-Process -Verb RunAs, the
  // only way to raise UAC from here. The cost is playtime: the elevated game
  // isn't our child, so PowerShell returns immediately and there's nothing to
  // wait on. The Edit dialog says so next to the checkbox.
  if (runAsAdmin) {
    const args = launchArgs.trim()
    const psArgs = args ? `-ArgumentList ${JSON.stringify(args)} ` : ''
    const command =
      `Start-Process -FilePath ${JSON.stringify(exePath)} ` +
      `-WorkingDirectory ${JSON.stringify(workingDir)} ${psArgs}-Verb RunAs`
    try {
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
    } catch {
      // user declined the UAC prompt, or the exe is gone
    }
    game.lastPlayed = new Date().toISOString()
    game.lastLaunchedHere = game.lastPlayed
    await saveLibrary()
    broadcastLibrary()
    return
  }

  const helper = fork(
    join(__dirname, 'launcher-helper.js'),
    [exePath, workingDir, ...(launchArgs.trim() ? launchArgs.trim().split(/\s+/) : [])],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      silent: true
    }
  )

  runningProcesses.set(id, { child: helper, start: Date.now() })
  broadcastRunning(id, true)
  // Stamped now, not in finish() below, so a game shows up under "Recently
  // played - from here" the moment it starts. finish() only runs when the
  // game exits, which for a long session is hours later, and never at all if
  // the app is closed first. finish() refreshes it anyway, so the value stays
  // accurate; this only makes it appear immediately.
  game.lastLaunchedHere = new Date().toISOString()
  void saveLibrary().then(broadcastLibrary)

  const finish = async (): Promise<void> => {
    const info = runningProcesses.get(id)
    runningProcesses.delete(id)
    if (info) {
      const seconds = Math.round((Date.now() - info.start) / 1000)
      game.playtimeSeconds += seconds
      // Tracked separately because the Steam sync overwrites playtimeSeconds
      // with its own figure whenever that is larger, which swallows whatever
      // we measured. This tally is only ever written here.
      game.playtimeSecondsHere += seconds
      // Same code path, no threshold: that is what keeps a game's recorded
      // sessions summing to exactly its playtimeSecondsHere. Filtering short
      // ones out here would quietly break that, so any "was this a real
      // session?" judgement belongs in whatever displays them.
      await appendSession({
        gameId: id,
        startedAt: new Date(info.start).toISOString(),
        endedAt: new Date().toISOString(),
        seconds
      })
    }
    game.lastPlayed = new Date().toISOString()
    game.lastLaunchedHere = game.lastPlayed
    await saveLibrary()
    broadcastLibrary()
    broadcastRunning(id, false)
    // Deliberately last, unawaited and swallowed: zipping a save folder takes
    // long enough to notice, and the playtime this function just recorded must
    // not be held up by it — nor lost if it fails. Skips writing anything when
    // the saves have not changed since the last archive.
    if (settings.autoBackupSavesOnExit) {
      void backupSavesFor(id, true).catch(() => {
        /* a missed automatic backup is not worth surfacing after a game exits */
      })
    }
  }
  helper.once('exit', () => void finish())
  helper.once('error', () => void finish())
}

/**
 * Games that look like the same title installed in more than one place.
 *
 * A *report* rather than an action: automatic merging was rejected because
 * name matching got 1 of 7 pairs wrong, and both copies are usually real
 * installs on disk. Reusing the trainer matcher's series-number guard keeps
 * "Far Cry" and "Far Cry 5" apart, but the user still decides what goes.
 */
function findDuplicateGroups(): DuplicateGroup[] {
  const normalize = (s: string): string => s.replace(/[^a-z0-9]/gi, '').toLowerCase()
  const buckets = new Map<string, Game[]>()
  for (const game of games) {
    const key = normalize(game.name)
    if (!key) continue
    buckets.set(key, [...(buckets.get(key) ?? []), game])
  }

  const groups: DuplicateGroup[] = []
  for (const copies of buckets.values()) {
    if (copies.length < 2) continue
    // Same folder twice isn't a duplicate install, just two entries.
    const distinctDirs = new Set(copies.map((g) => g.installDir.replace(/[\\/]+$/, '').toLowerCase()))
    if (distinctDirs.size < 2) continue

    const sizes = copies.map((g) => g.installSizeBytes)
    const allMeasured = sizes.every((s): s is number => s !== null)
    groups.push({
      name: copies[0].name,
      copies: copies.map((g) => ({
        id: g.id,
        name: g.name,
        installDir: g.installDir,
        source: g.source,
        sizeBytes: g.installSizeBytes
      })),
      // Keeping one copy: everything but the largest is recoverable.
      reclaimableBytes: allMeasured
        ? sizes.reduce((sum, s) => sum + s, 0) - Math.max(...(sizes as number[]))
        : null
    })
  }
  return groups.sort((a, b) => (b.reclaimableBytes ?? 0) - (a.reclaimableBytes ?? 0))
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Processes running from inside a folder.
 *
 * The path goes through the environment rather than the command line, and the
 * comparison is `StartsWith` rather than PowerShell's `-like`: real game
 * folders contain characters `-like` treats as wildcards - this library has a
 * game whose folder is literally `Lu[idle]`, which as a pattern would match
 * the wrong thing or nothing at all.
 */
async function processesUnder(dir: string): Promise<{ pid: number; name: string }[]> {
  const script =
    'Get-CimInstance Win32_Process | ' +
    'Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:GB_DIR, [System.StringComparison]::OrdinalIgnoreCase) } | ' +
    'ForEach-Object { "{0}|{1}" -f $_.ProcessId, $_.Name }'
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 20000,
      env: { ...process.env, GB_DIR: dir.replace(/[\\/]+$/, '') + '\\' }
    })
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split('|'))
      .filter((parts) => parts.length === 2 && Number.isFinite(Number(parts[0])))
      .map(([pid, name]) => ({ pid: Number(pid), name }))
  } catch {
    return []
  }
}

/**
 * Deletes a game folder, escalating only as far as it has to.
 *
 * A plain recursive delete covers almost everything - `fs.rm`'s own retries
 * already handle a transient AV or Explorer handle. What it cannot get past
 * is the game still running, or an ACL the user no longer has rights over,
 * and those are exactly the cases that leave a folder undeletable forever.
 *
 * Killing is deliberately scoped to processes whose executable lives *inside
 * the folder being deleted* - the game, its launcher, an anti-cheat shipped
 * alongside it. Nothing outside that tree is ever touched.
 *
 * Taking ownership needs elevation, so Windows puts up its own UAC prompt;
 * declining it just ends the attempt with the folder intact.
 */
async function deleteFolderThoroughly(dir: string): Promise<DeleteFromDiskResult> {
  const result: DeleteFromDiskResult = { ok: false, steps: [], killedProcesses: [], tookOwnership: false }

  const attempt = async (): Promise<string | null> => {
    try {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  let error = await attempt()
  if (error === null) {
    result.steps.push('Deleted normally.')
    return { ...result, ok: true }
  }
  result.steps.push(`Normal delete failed: ${error}`)

  const running = await processesUnder(dir)
  if (running.length === 0) {
    result.steps.push('Nothing is running from that folder.')
  } else {
    result.steps.push(`Found ${running.length} process(es) running from the folder.`)
    for (const proc of running) {
      try {
        process.kill(proc.pid)
        result.killedProcesses.push(proc.name)
      } catch {
        result.steps.push(`Could not stop ${proc.name}.`)
      }
    }
    if (result.killedProcesses.length > 0) {
      result.steps.push(`Stopped ${result.killedProcesses.join(', ')}.`)
      // Windows releases the handles a moment after the process actually goes.
      await new Promise((r) => setTimeout(r, 1500))
      error = await attempt()
      if (error === null) {
        result.steps.push('Deleted after stopping it.')
        return { ...result, ok: true }
      }
      result.steps.push(`Still failing: ${error}`)
    }
  }

  // Whatever is left is a permissions problem rather than a lock.
  result.steps.push('Taking ownership of the folder — Windows will ask for permission.')
  const quoted = `"${dir.replace(/"/g, '')}"`
  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Start-Process -FilePath cmd.exe -ArgumentList '/c takeown /f ${quoted} /r /d Y & icacls ${quoted} /grant "%USERNAME%":(OI)(CI)F /t /c' -Verb RunAs -Wait -WindowStyle Hidden`
      ],
      { windowsHide: true, timeout: 180000 }
    )
    result.tookOwnership = true
  } catch {
    result.steps.push('Ownership change was declined or failed.')
    return { ...result, error: error ?? 'Could not delete the folder.' }
  }

  error = await attempt()
  if (error === null) {
    result.steps.push('Deleted after taking ownership.')
    return { ...result, ok: true }
  }
  result.steps.push(`Still failing after taking ownership: ${error}`)
  return { ...result, error }
}

/**
 * The volume a path lives on, as a comparable key: `D:\`, or a UNC share root.
 *
 * Separators are normalised first: Windows accepts either, and the library
 * really does hold both spellings (`G:\SteamLibrary\…` next to
 * `G:/XBOX/Anno 1800/`), which `path.parse` would otherwise report as the two
 * distinct roots `G:\` and `G:/` — one drive showing up as two.
 */
function driveRootOf(p: string): string {
  return parsePath(p.replace(/\//g, '\\')).root.toUpperCase()
}

interface DriveSpace {
  totalBytes: number
  freeBytes: number
  driveType: string
}

/**
 * Capacity and free space for every ready volume, in one shot.
 *
 * Deliberately *not* `fs.statfs`: this Electron's Node clamps its `blocks`
 * field to 32 bits on Windows, so every volume over 4 TiB reports exactly
 * 4 TiB. It's a quiet wrong answer rather than an error - `bavail` is usually
 * under the ceiling, so free space stays correct while the total is nonsense -
 * and this user's game library lives on a 26 TB share. .NET's DriveInfo
 * returns real Int64 sizes, and throws in the drive type for free.
 */
async function readDriveSpace(): Promise<Map<string, DriveSpace>> {
  const spaces = new Map<string, DriveSpace>()
  try {
    const script =
      '[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady } | ForEach-Object ' +
      '{ "{0}|{1}|{2}|{3}" -f $_.Name, $_.TotalSize, $_.AvailableFreeSpace, $_.DriveType }'
    // Timed out rather than awaited indefinitely: IsReady blocks on a dead
    // network mapping, and this runs when the dashboard opens.
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 8000 }
    )
    for (const line of stdout.split(/\r?\n/)) {
      const [name, total, free, type] = line.trim().split('|')
      const totalBytes = Number(total)
      const freeBytes = Number(free)
      if (!name || !Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) continue
      spaces.set(name.toUpperCase(), { totalBytes, freeBytes, driveType: type ?? '' })
    }
  } catch {
    // PowerShell missing or too slow; the caller falls back to statfs
  }
  return spaces
}

/**
 * Disk usage per drive, so "the games drive is nearly full" becomes a number
 * against a specific volume rather than one library-wide total. Sizes come
 * from the background sweep; free space is read live.
 */
async function computeDriveUsage(): Promise<DriveUsage[]> {
  const byRoot = new Map<string, DriveUsage>()
  for (const game of games) {
    const root = driveRootOf(game.installDir)
    if (!root) continue
    let entry = byRoot.get(root)
    if (!entry) {
      entry = {
        root,
        gameCount: 0,
        gameBytes: 0,
        unmeasured: 0,
        neverPlayedBytes: 0,
        totalBytes: null,
        freeBytes: null,
        driveType: ''
      }
      byRoot.set(root, entry)
    }
    entry.gameCount++
    if (game.installSizeBytes === null) entry.unmeasured++
    else {
      entry.gameBytes += game.installSizeBytes
      if (game.playtimeSeconds === 0) entry.neverPlayedBytes += game.installSizeBytes
    }
  }

  const spaces = await readDriveSpace()
  await Promise.all(
    [...byRoot.values()].map(async (entry) => {
      const known = spaces.get(entry.root)
      if (known) {
        entry.totalBytes = known.totalBytes
        entry.freeBytes = known.freeBytes
        entry.driveType = known.driveType
        return
      }
      try {
        const stat = await fs.statfs(entry.root)
        // See readDriveSpace: `blocks` sitting exactly at the 32-bit ceiling
        // means the real volume is bigger than this can express. Leave the
        // numbers null so the UI says nothing rather than something wrong.
        if (stat.blocks >= 0xffffffff) return
        entry.totalBytes = stat.blocks * stat.bsize
        // bavail, not bfree: what this user can actually write to.
        entry.freeBytes = stat.bavail * stat.bsize
      } catch {
        // drive unplugged or not ready; the counts above still stand
      }
    })
  )

  return [...byRoot.values()].sort((a, b) => b.gameBytes - a.gameBytes)
}

/**
 * Library entries whose executable is no longer on disk - games deleted
 * outside the app, which otherwise sit there looking fine until Play does
 * nothing.
 *
 * Each volume is probed once *before* its games are, and everything on an
 * unreachable one is skipped: an unplugged drive would otherwise report every
 * game on it as missing, and this list is offered to the user for deletion.
 */
async function scanMissingGames(): Promise<MissingScanResult> {
  const result: MissingScanResult = {
    totalGames: games.length,
    checked: 0,
    entries: [],
    offlineRoots: []
  }

  try {
    const offline = new Set<string>()
    for (const root of new Set(games.map((g) => driveRootOf(g.installDir)).filter(Boolean))) {
      if (!(await pathExists(root))) offline.add(root)
    }
    result.offlineRoots = [...offline].sort()

    const entries: MissingGameEntry[] = []
    for (const game of games) {
      if (offline.has(driveRootOf(game.installDir))) continue
      result.checked++
      if (await pathExists(game.exePath)) continue
      entries.push({
        id: game.id,
        name: game.name,
        exePath: game.exePath,
        installDir: game.installDir,
        source: game.source,
        folderMissing: !(await pathExists(game.installDir))
      })
    }
    result.entries = entries.sort((a, b) => a.name.localeCompare(b.name))
    return result
  } catch (e) {
    return { ...result, error: e instanceof Error ? e.message : String(e) }
  }
}

async function rememberScanRoot(root: string): Promise<void> {
  const key = root.replace(/[\\/]+$/, '').toLowerCase()
  if (settings.scanRoots.some((r) => r.replace(/[\\/]+$/, '').toLowerCase() === key)) return
  settings = { ...settings, scanRoots: [...settings.scanRoots, root] }
  await saveSettingsToDisk()
}

/**
 * Walks the given roots, examining only subfolders that aren't already in the
 * library.
 *
 * The old version ran findBestExe - itself a depth-5 recursive walk - on every
 * subfolder of the root, every time. On a folder holding 500-odd already
 * imported games that meant re-walking the entire drive to find the three new
 * ones, which is exactly what it felt like. An installDir is a stable identity
 * for a folder-scanned game, so anything already claimed is skipped outright.
 */
async function scanRoots(roots: string[]): Promise<FolderScanResult> {
  const known = new Set(games.map((g) => folderKey(g.installDir)))
  const ignored = new Set(ignoredFolders.map(folderKey))
  const candidates: GameCandidate[] = []
  let scanned = 0
  let skipped = 0
  let ignoredCount = 0

  try {
    // Counted up front so the progress bar reflects the real amount of work
    // rather than restarting per root.
    const pending: { root: string; name: string; full: string }[] = []
    for (const root of roots) {
      const entries = await safeReaddir(root)
      if (!entries) continue
      for (const entry of entries.filter((e) => e.isDirectory())) {
        const full = join(root, entry.name)
        const key = folderKey(full)
        if (known.has(key)) {
          skipped++
          continue
        }
        // Counted apart from `skipped` so the result can say "and N you told
        // me to ignore" rather than lumping them in with already-imported.
        if (ignored.has(key)) {
          ignoredCount++
          continue
        }
        pending.push({ root, name: entry.name, full })
      }
    }

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]
      broadcastScanProgress({ current: i + 1, total: pending.length, currentName: item.name })
      const exe = await findBestExe(item.full)
      scanned++
      if (exe) candidates.push({ name: cleanGameName(item.name), exePath: exe, installDir: item.full })
    }

    // A root that is itself a single game rather than a folder of games - only
    // worth checking when it has no unclaimed subfolders to explain it.
    if (candidates.length === 0 && pending.length === 0 && skipped === 0 && ignoredCount === 0) {
      for (const root of roots) {
        if (known.has(folderKey(root)) || ignored.has(folderKey(root))) continue
        broadcastScanProgress({ current: 1, total: 1, currentName: basename(root) })
        const exe = await findBestExe(root)
        scanned++
        if (exe) candidates.push({ name: cleanGameName(basename(root)), exePath: exe, installDir: root })
      }
    }
  } finally {
    broadcastScanProgress(null)
  }

  return { candidates, scanned, skipped, ignored: ignoredCount, roots: settings.scanRoots }
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
        { zipPath: 'sessions.json', fsPath: sessionsFile },
        { zipPath: 'save-backups', fsPath: saveBackupsDir, isDir: true },
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
    await loadIgnoredFolders()
    await loadSessions()
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

/**
 * True when this process is the old portable build rather than an installed
 * one. electron-builder's portable target sets these env vars; the installed
 * app never has them.
 *
 * It matters for updating, because a portable build's `process.execPath` sits
 * in a throwaway `%TEMP%` extraction folder — telling an installer to install
 * *there* would put the app somewhere Windows wipes.
 */
function isPortableBuild(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE)
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

/**
 * Hands off to the downloaded installer and arranges for the app to come back.
 *
 * The awkward part is that the installer has to replace the very executable
 * that is running it, so this app must be gone before it can finish — which
 * means nothing in this process can wait for it or start anything afterwards.
 * A detached one-shot .cmd does both: it runs the installer, waits, and only
 * then starts the app again. This process just quits.
 *
 * **Silent only when we are already installed.** A silent NSIS run reuses the
 * remembered install directory, which is right for an upgrade but has nowhere
 * to come from on the portable build everyone is currently running — those get
 * the visible installer once, and pick a folder. `/S` also suppresses the
 * installer's own "run after finish", which is the other reason the script
 * launches the app itself rather than leaving it to `runAfterFinish`.
 */
async function runInstallerAndRelaunch(installerPath: string): Promise<void> {
  const silent = !isPortableBuild()
  const exeToStart = silent ? process.execPath : ''
  const scriptPath = join(app.getPath('temp'), `gb-update-${Date.now()}.cmd`)
  const lines = [
    '@echo off',
    // Give this process a moment to actually be gone; the installer refuses to
    // replace files still held open.
    'ping -n 3 127.0.0.1 >nul',
    silent ? `start /wait "" "${installerPath}" /S` : `start /wait "" "${installerPath}"`,
    exeToStart ? `start "" "${exeToStart}"` : '',
    `del "%~f0"`
  ].filter(Boolean)
  await fs.writeFile(scriptPath, lines.join('\r\n'), 'utf-8')
  const child = spawn('cmd.exe', ['/c', scriptPath], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

async function downloadUpdateAndRestart(
  assetUrl: string,
  assetSize: number,
  version: string
): Promise<UpdateApplyResult> {
  if (!app.isPackaged) {
    return { ok: false, error: 'Self-update only works from a built app, not `npm run dev`.' }
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
        // Into temp, not next to the app: the installer is scaffolding, and
        // the folder it installs into is about to be rewritten by it.
        const installerPath = join(app.getPath('temp'), `Game Browser Setup ${version}.exe`)
        await writeFileAtomic(installerPath, buf)
        await runInstallerAndRelaunch(installerPath)
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
      lastLaunchedHere: null,
      playtimeSeconds: 0,
      playtimeSecondsHere: 0,
      source: 'manual',
      genres: [],
      tags: [],
      rating: null,
      completion: null,
      actions: [],
      hltbMainSeconds: null,
      hltbMainExtraSeconds: null,
      hltbCompletionistSeconds: null,
      categoryIds: [],
      excludeFromPlaytime: false,
      hidden: false,
      installSizeBytes: null,
      sizeMeasuredAt: null,
      trainerPath: null,
      launchArgs: '',
      runAsAdmin: false,
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

  ipcMain.handle('games:scanFolder', async (): Promise<FolderScanResult> => {
    const result = await showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a folder containing your games'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { candidates: [], scanned: 0, skipped: 0, ignored: 0, roots: settings.scanRoots }
    }
    const root = result.filePaths[0]
    await rememberScanRoot(root)
    return scanRoots([root])
  })

  ipcMain.handle('games:rescanFolders', async (): Promise<FolderScanResult> => scanRoots(settings.scanRoots))

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
        lastLaunchedHere: null,
        playtimeSeconds: 0,
        playtimeSecondsHere: 0,
        source: 'folder-scan',
        genres: [],
        tags: [],
        rating: null,
        completion: null,
      actions: [],
      hltbMainSeconds: null,
      hltbMainExtraSeconds: null,
      hltbCompletionistSeconds: null,
        categoryIds: [],
        excludeFromPlaytime: false,
        hidden: false,
        installSizeBytes: null,
        sizeMeasuredAt: null,
        trainerPath: null,
        launchArgs: '',
        runAsAdmin: false,
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
    const created = await addNewSteamGames(installed.games)
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

  ipcMain.handle('games:launch', async (_e, id: string, actionId?: string) => launchGame(id, actionId))

  // Opens the search on their own site in the user's browser - a normal visit,
  // made by a person. Deliberately the whole of the HowLongToBeat integration:
  // see the note on Game.hltbMainSeconds for why nothing is fetched.
  ipcMain.handle('games:openHltb', async (_e, id: string): Promise<void> => {
    const game = games.find((g) => g.id === id)
    if (!game) return
    await shell.openExternal(`https://howlongtobeat.com/?q=${encodeURIComponent(game.name)}`)
  })

  ipcMain.handle('saves:refreshIndex', async () => refreshSaveIndex(true))

  ipcMain.handle('saves:locations', async (_e, id: string): Promise<SaveLocationsResult> => {
    const game = games.find((g) => g.id === id)
    if (!game) return { known: false, paths: [], backups: [] }
    if (!saveIndex) await refreshSaveIndex()
    const backups = await listSaveBackups(id)
    if (!saveIndex) return { known: false, paths: [], backups, error: 'Save locations are not downloaded yet.' }
    const entry = findSaveEntry(saveIndex, game)
    if (!entry) return { known: false, paths: [], backups }
    const resolved = await resolveExistingSaves(entry, placeholdersFor(game))
    return { known: true, paths: resolved.map((r) => r.path), backups }
  })

  ipcMain.handle('saves:backup', async (_e, id: string): Promise<SaveBackupResult> => backupSavesFor(id, false))

  // The game id is accepted for symmetry with the other saves: calls but
  // deliberately unused — the archive's own saves.json is what says where each
  // entry belongs, which is the only trustworthy answer once a game has been
  // renamed or re-added under a new id.
  ipcMain.handle('saves:restore', async (_e, _id: string, zipPath: string): Promise<SaveBackupResult> => {
    try {
      const staging = join(app.getPath('temp'), `gb-save-restore-${Date.now()}`)
      await extractZip(zipPath, staging)
      const meta = JSON.parse(await fs.readFile(join(staging, 'saves.json'), 'utf-8')) as {
        entries: { zipPath: string; originalPath: string; isDir: boolean }[]
      }
      for (const item of meta.entries) {
        const from = join(staging, item.zipPath)
        await fs.mkdir(dirname(item.originalPath), { recursive: true })
        await fs.cp(from, item.originalPath, { recursive: item.isDir, force: true })
      }
      await fs.rm(staging, { recursive: true, force: true })
      return { ok: true, path: zipPath, locations: meta.entries.map((e) => e.originalPath) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('games:pickActionExe', async (): Promise<string | null> => {
    const result = await showOpenDialog({
      properties: ['openFile'],
      title: 'Select the program this action should start',
      filters: [{ name: 'Programs', extensions: ['exe', 'bat', 'cmd', 'lnk'] }]
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(
    'games:update',
    async (
      _e,
      id: string,
      patch: Partial<
        Pick<
          Game,
          | 'name'
          | 'favorite'
          | 'tags'
          | 'rating'
          | 'completion'
          | 'categoryIds'
          | 'steamAppId'
          | 'excludeFromPlaytime'
          | 'hidden'
          | 'launchArgs'
          | 'runAsAdmin'
          | 'actions'
          | 'hltbMainSeconds'
          | 'hltbMainExtraSeconds'
          | 'hltbCompletionistSeconds'
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

  // Whole log in one go: it is small (a row per session), the Dashboard wants
  // to aggregate over all of it anyway, and paging would buy nothing here.
  ipcMain.handle('sessions:list', async (): Promise<PlaySession[]> => sessions)

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
  ipcMain.handle('games:deleteFromDisk', async (_e, id: string): Promise<DeleteFromDiskResult> => {
    const idx = games.findIndex((g) => g.id === id)
    const fail = (error: string): DeleteFromDiskResult => ({
      ok: false,
      error,
      steps: [],
      killedProcesses: [],
      tookOwnership: false
    })
    if (idx === -1) return fail('Game not found.')
    const game = games[idx]
    if (game.source !== 'manual' && game.source !== 'folder-scan') {
      return fail('Delete from disk is only available for manually added games.')
    }
    // Escalates through stopping the game and taking ownership if a plain
    // recursive delete can't do it - see deleteFolderThoroughly.
    const outcome = await deleteFolderThoroughly(game.installDir)
    if (!outcome.ok) return outcome
    games.splice(idx, 1)
    await saveLibrary()
    broadcastLibrary()
    for (const p of [game.coverPath, game.iconPath]) {
      if (p) fs.unlink(p).catch(() => {})
    }
    return outcome
  })

  ipcMain.handle('folders:getIgnored', async (): Promise<string[]> => ignoredFolders)

  ipcMain.handle('folders:ignore', async (_e, paths: string[]): Promise<string[]> => {
    const have = new Set(ignoredFolders.map(folderKey))
    for (const p of paths) {
      if (!have.has(folderKey(p))) {
        ignoredFolders.push(p)
        have.add(folderKey(p))
      }
    }
    await saveIgnoredFolders()
    return ignoredFolders
  })

  ipcMain.handle('folders:unignore', async (_e, path: string): Promise<string[]> => {
    ignoredFolders = ignoredFolders.filter((p) => folderKey(p) !== folderKey(path))
    await saveIgnoredFolders()
    return ignoredFolders
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

  // Reveals the game's own executable rather than just opening the folder, so
  // with two copies of a game side by side it's obvious which one this entry
  // actually points at.
  ipcMain.handle('games:openFolder', async (_e, id: string): Promise<void> => {
    const game = games.find((g) => g.id === id)
    if (!game) return
    try {
      await fs.access(game.exePath)
      shell.showItemInFolder(game.exePath)
    } catch {
      await shell.openPath(game.installDir)
    }
  })

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
      librarySyncEnabled: !!next.librarySyncEnabled,
      autoBackupSavesOnExit: !!next.autoBackupSavesOnExit
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

  ipcMain.handle('trainers:pickMirrorFolder', async (): Promise<string | null> => {
    const result = await showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a folder to also keep matched trainers in'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    settings = { ...settings, trainerMirrorFolder: result.filePaths[0] }
    await saveSettingsToDisk()
    return settings.trainerMirrorFolder
  })

  ipcMain.handle('trainers:scan', async (): Promise<TrainerScanResult> => scanTrainers())

  ipcMain.handle('trainers:list', async (): Promise<TrainerFileInfo[]> => {
    const assigned = new Set(
      games.map((g) => g.trainerPath?.toLowerCase()).filter((p): p is string => typeof p === 'string')
    )
    const sources = [trainersDir, settings.trainerFolder].filter(Boolean)
    const seen = new Set<string>()
    const out: TrainerFileInfo[] = []
    for (const source of sources) {
      for (const t of await scanTrainerFolder(source)) {
        const key = t.fileName.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ fileName: t.fileName, path: t.path, assigned: assigned.has(t.path.toLowerCase()) })
      }
    }
    return out.sort((a, b) => a.fileName.localeCompare(b.fileName))
  })

  // Manual override for the 38-odd files whose names don't line up with any
  // game, and for the cases where automatic matching picks the wrong one.
  ipcMain.handle(
    'trainers:assign',
    async (_e, gameId: string, sourcePath: string | null): Promise<Game | null> => {
      const game = games.find((g) => g.id === gameId)
      if (!game) return null
      if (sourcePath === null) {
        game.trainerPath = null
      } else {
        await fs.mkdir(trainersDir, { recursive: true })
        const fileName = basename(sourcePath)
        const dest = join(trainersDir, fileName)
        if (sourcePath.toLowerCase() !== dest.toLowerCase()) await copyFileAtomic(sourcePath, dest)
        await mirrorTrainerFile(dest, fileName)
        game.trainerPath = dest
      }
      await saveLibrary()
      broadcastLibrary()
      return game
    }
  )

  ipcMain.handle('games:duplicates', async (): Promise<DuplicateGroup[]> => findDuplicateGroups())

  ipcMain.handle('storage:drives', async (): Promise<DriveUsage[]> => computeDriveUsage())

  ipcMain.handle('games:scanMissing', async (): Promise<MissingScanResult> => scanMissingGames())

  ipcMain.handle('trainers:launch', async (_e, id: string): Promise<{ ok: boolean; error?: string }> => {
    const game = games.find((g) => g.id === id)
    if (!game?.trainerPath) return { ok: false, error: 'No trainer for this game.' }
    // openPath rather than spawn: trainers frequently ask for elevation, and
    // this lets Windows put up its own prompt instead of failing silently.
    const error = await shell.openPath(game.trainerPath)
    return error ? { ok: false, error } : { ok: true }
  })

  // Starts the trainer first, then the game. FLiNG trainers attach to the
  // running process and poll for it, so having it up first means it hooks as
  // soon as the game appears rather than needing a manual re-scan.
  ipcMain.handle('trainers:launchWithGame', async (_e, id: string): Promise<{ ok: boolean; error?: string }> => {
    const game = games.find((g) => g.id === id)
    if (!game) return { ok: false, error: 'Game not found.' }
    if (game.trainerPath) {
      const error = await shell.openPath(game.trainerPath)
      if (error) return { ok: false, error }
      await new Promise((r) => setTimeout(r, 1200))
    }
    await launchGame(id)
    return { ok: true }
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

interface WindowState {
  width: number
  height: number
  x: number | null
  y: number | null
  maximized: boolean
}

async function loadWindowState(): Promise<WindowState | null> {
  try {
    const raw = await fs.readFile(windowStateFile, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WindowState>
    if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return null
    return {
      width: Math.max(1500, Math.round(parsed.width as number)),
      height: Math.max(640, Math.round(parsed.height as number)),
      x: Number.isFinite(parsed.x) ? Math.round(parsed.x as number) : null,
      y: Number.isFinite(parsed.y) ? Math.round(parsed.y as number) : null,
      maximized: !!parsed.maximized
    }
  } catch {
    return null
  }
}

/**
 * A saved position is only usable if it still lands on a display that exists -
 * otherwise unplugging the monitor it was last on reopens the window somewhere
 * invisible, with no obvious way to get it back.
 */
function positionIsOnSomeDisplay(x: number, y: number, width: number): boolean {
  return screen.getAllDisplays().some((display) => {
    const b = display.workArea
    // Require a decent chunk of the titlebar to be reachable, not just a pixel.
    return x + width > b.x + 80 && x < b.x + b.width - 80 && y >= b.y - 8 && y < b.y + b.height - 40
  })
}

function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (win.isDestroyed()) return
      const maximized = win.isMaximized()
      // getNormalBounds is the un-maximized geometry, which is what should be
      // restored when the user un-maximizes later.
      const bounds = win.getNormalBounds()
      const state: WindowState = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized
      }
      void fs.writeFile(windowStateFile, JSON.stringify(state, null, 2), 'utf-8').catch(() => undefined)
    }, 500)
  }
  // Registered one by one rather than looping a union of event names, which
  // doesn't line up with BrowserWindow's per-event overloads.
  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', save)
}

function createWindow(saved: WindowState | null): void {
  // A saved position only survives if the display it referred to still exists,
  // otherwise unplugging a monitor reopens the window off-screen.
  const usePosition =
    saved?.x !== null &&
    saved?.y !== undefined &&
    saved !== null &&
    saved.x !== null &&
    saved.y !== null &&
    // Height is not part of the test on purpose: what has to be reachable is
    // the titlebar, which the y check covers.
    positionIsOnSomeDisplay(saved.x, saved.y, saved.width)

  const win = new BrowserWindow({
    width: saved?.width ?? 1920,
    height: saved?.height ?? 1080,
    ...(usePosition && saved ? { x: saved.x as number, y: saved.y as number } : {}),
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

  if (saved?.maximized) win.maximize()
  trackWindowState(win)

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
    await loadIgnoredFolders()
    await loadSessions()
    await loadSaveIndex()
    await fs.mkdir(saveBackupsDir, { recursive: true })

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
    createWindow(await loadWindowState())
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
    // Nothing sweeps old executables any more: the installer replaces the app
    // in place, so there are no leftover versioned exes piling up beside it.
    // That whole dance existed only because the portable build kept every
    // downloaded version as a separate file in the user's own folder.
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

    // Games get installed and uninstalled while this app sits open for days,
    // and nothing re-checked that after the startup pass. Cheap to repeat:
    // it exits immediately when the preference is off, and a pass that finds
    // no change saves nothing and broadcasts nothing.
    setInterval(() => void syncPlatformLibraries(), LIBRARY_SYNC_INTERVAL_MS)

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

    // Well off the startup path: 17MB to fetch and parse, and nothing needs it
    // until the user asks to back a game's saves up.
    setTimeout(() => void refreshSaveIndex(), 90 * 1000)

    setTimeout(() => void sweepDiskSizes(), 60 * 1000)
    setInterval(() => void sweepDiskSizes(), METADATA_SWEEP_INTERVAL_MS)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void loadWindowState().then(createWindow)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
