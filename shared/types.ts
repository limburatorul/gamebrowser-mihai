/**
 * Sources whose games are owned by a launcher, so removal is handed to it
 * rather than done here.
 *
 * Lives beside `Game['source']` because it is a subset of it, and because the
 * list has grown before (Steam, then Epic, then GOG, then Ubisoft) — it was
 * copied into four files, two of them untyped, which is exactly the shape that
 * gets missed when a fifth platform arrives.
 */
export const PLATFORM_SOURCES: ReadonlySet<Game['source']> = new Set(['steam', 'epic', 'gog', 'ubisoft'])

export const COMPLETION_STATUSES = ['backlog', 'playing', 'finished', 'dropped'] as const
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number]

/** Label and glyph for each status, so the sidebar, the Edit dialog, the
    context menu and the Dashboard cannot drift apart on wording. */
export const COMPLETION_LABELS: Record<CompletionStatus, { label: string; icon: string }> = {
  backlog: { label: 'Backlog', icon: '◷' },
  playing: { label: 'Playing', icon: '▶' },
  finished: { label: 'Finished', icon: '✓' },
  dropped: { label: 'Dropped', icon: '✕' }
}

export interface Game {
  id: string
  name: string
  exePath: string
  installDir: string
  coverPath: string | null
  iconPath: string | null
  favorite: boolean
  dateAdded: string
  /** Most recent play, from any source - our own launches and whatever Steam
      reports, whichever is later. This is the "everywhere" figure. */
  lastPlayed: string | null
  /** Set only when the game was started from this app, so Recently Played can
      be narrowed to that. Cannot be backfilled: before this existed the two
      sources were merged into `lastPlayed` with no way to tell them apart, so
      it starts empty on existing libraries and fills as games are launched. */
  lastLaunchedHere: string | null
  /** Total time played from any source. Our own tracking accumulates into it,
      and the Steam sync overwrites it whenever Steam's figure is larger, so
      it is the "everywhere" number. */
  playtimeSeconds: number
  /** Only the seconds this app measured itself, never touched by the Steam
      sync. Same caveat as `lastLaunchedHere`: it cannot be backfilled, since
      before it existed our own tally could be swallowed by Steam's larger
      figure. Starts at zero and grows from the next session played here. */
  playtimeSecondsHere: number
  source: 'manual' | 'folder-scan' | 'steam' | 'epic' | 'gog' | 'ubisoft'
  genres: string[]
  tags: string[]
  rating: number | null
  /** Where the game stands with you, set by hand and never inferred. `null` is
      "not said", which is deliberately different from `backlog` — most of a
      large library has simply never been judged, and filing all of it under
      "I intend to play this" would be a claim the user never made. */
  completion: CompletionStatus | null
  categoryIds: string[]
  // Keeps counting playtime, but leaves the game out of every aggregate:
  // the sidebar's most-played list, the library total, and the dashboard.
  // Toggling it back off restores the untouched number.
  excludeFromPlaytime: boolean
  /** Kept in the library but out of sight: no tile or row, no sidebar count,
      no most-played entry, and never picked for the rotating backdrop. The
      Dashboard still counts it, since hiding a game doesn't free its disk
      space. Managed from Settings > Hidden Games. */
  hidden: boolean
  // Size of installDir on disk. Filled in by a background sweep rather than at
  // import time - walking a game folder takes about a second, which is far too
  // slow to do inline while importing hundreds of them.
  installSizeBytes: number | null
  sizeMeasuredAt: string | null
  /** Matched from the local trainer folder, never downloaded automatically. */
  trainerPath: string | null
  /** Extra command-line arguments passed to the game's executable. */
  launchArgs: string
  /** Launch elevated. Costs playtime tracking - see launchGame. */
  runAsAdmin: boolean
  /** Extra launch targets beside Play. Empty for almost every game. */
  actions: GameAction[]
  /**
   * How long the game takes, in seconds, as reported by HowLongToBeat.
   *
   * **Entered by hand, never fetched.** HowLongToBeat has no public API, and
   * reading it automatically today means pulling a rotating endpoint out of
   * their JavaScript bundle, harvesting anti-bot tokens from an `/init` call
   * and randomising the User-Agent to look like different browsers — that is
   * defeating a protection measure, not consuming a feed. The app instead
   * opens the game's page on their site in the user's own browser, one click,
   * and these fields are typed in. Same shape as the Find Trainer button, and
   * the same reasoning that kept this project off flingtrainer.
   */
  hltbMainSeconds: number | null
  hltbMainExtraSeconds: number | null
  hltbCompletionistSeconds: number | null
  steamAppId: number | null
  epicAppName: string | null
  gogProductId: string | null
  ubisoftId: string | null
}

export interface Category {
  id: string
  name: string
}

/**
 * An extra way to start a game: a mod launcher, a config tool, an alternate
 * executable. The folder scan picks one exe and that becomes Play — for Arma 3
 * it picked the game itself, which starts without any of the user's mods,
 * because the launcher beside it is what loads them.
 *
 * `exePath` may be empty, which means "the game's own exe" — that makes an
 * action that only adds arguments (a windowed profile, a different mod line)
 * without repeating the path.
 */
export interface GameAction {
  id: string
  name: string
  exePath: string
  args: string
  runAsAdmin: boolean
}

/**
 * One session, appended when a game exits. Kept in its own `sessions.json`
 * rather than on `Game`, because the list grows forever and rewriting every
 * game's record to append one row would be wasteful.
 *
 * **Invariant worth keeping**: sessions are written by exactly the same code
 * path that adds to `playtimeSecondsHere`, with no threshold, so the sessions
 * recorded for a game always sum to the seconds this app measured itself.
 * Elevated launches produce neither, for the same reason — the game is not our
 * child process, so there is nothing to time.
 *
 * Like `playtimeSecondsHere`, this **cannot be backfilled**: before it existed
 * only running totals were kept, with no record of when the time was spent.
 */
export interface SaveBackupEntry {
  path: string
  createdAt: string
  sizeBytes: number
}

export interface SaveLocationsResult {
  /** False when the manifest has no entry for this game, which is the normal
      case for anything obscure — not an error, just nothing to offer. */
  known: boolean
  /** Save folders that exist right now. Empty means the game has never been
      played, or keeps its saves somewhere the manifest doesn't cover. */
  paths: string[]
  backups: SaveBackupEntry[]
  error?: string
}

export interface SaveBackupResult {
  ok: boolean
  path?: string
  locations?: string[]
  /** Succeeded by doing nothing: the saves had not changed since the last
      archive, so no copy of the same moment was written. */
  unchanged?: boolean
  error?: string
}

export interface PlaySession {
  gameId: string
  startedAt: string
  endedAt: string
  seconds: number
}

export interface GameCandidate {
  name: string
  exePath: string
  installDir: string
}

export interface FolderScanResult {
  candidates: GameCandidate[]
  /** Subfolders actually examined this run. */
  scanned: number
  /** Subfolders skipped because they're already in the library. */
  skipped: number
  /** Subfolders skipped because they're on the ignore list. */
  ignored: number
  roots: string[]
}

/**
 * How a delete-from-disk went, including what it had to escalate to. A plain
 * ok/error hides the fact that it killed a running game or asked for
 * elevation, both of which the user should be told about after the fact.
 */
export interface DeleteFromDiskResult {
  ok: boolean
  error?: string
  /** Human-readable account of what was attempted, in order. */
  steps: string[]
  /** Executables terminated because they were running from inside the folder. */
  killedProcesses: string[]
  /** True when it had to take ownership of the tree to get rid of it. */
  tookOwnership: boolean
}

export interface ScanProgress {
  current: number
  total: number
  currentName: string
}

export type SortKey = 'name' | 'dateAdded' | 'lastPlayed' | 'playtime' | 'rating' | 'size'
export type ViewMode = 'grid' | 'list'

export interface CoverFetchResult {
  ok: boolean
  error?: string
  matchedIgdb: number
  matchedSteam: number
  matchedRawg: number
  total: number
}

export interface Settings {
  igdbClientId: string
  igdbClientSecret: string
  rawgApiKey: string
  backupFolder: string
  backupEnabled: boolean
  backupIntervalHours: number
  // How many archives to keep in the backup folder; older ones are deleted
  // after each successful backup. 0 means keep everything.
  backupKeepCount: number
  /** Folders that have been scanned for games, so a rescan needs no picker
      and can look only at subfolders that aren't in the library yet. */
  scanRoots: string[]
  /** Folder the user keeps trainers in. Nothing is ever written there. */
  trainerFolder: string
  /** Optional second destination: matched trainers are mirrored here as well
      as into the app's own folder, so the user keeps a tidy copy of their own. */
  trainerMirrorFolder: string
  /** Also watch the OS Downloads folder, so a freshly downloaded trainer is
      filed away without the user going back to Settings to rescan. */
  watchDownloadsForTrainers: boolean
  lastBackupAt: string | null
  librarySyncEnabled: boolean
  /** Archive a game's saves when it exits. Skips writing anything when the
      files have not changed, and keeps the last ten per game. */
  autoBackupSavesOnExit: boolean
  /**
   * Version we last downloaded an installer for. Persisted so that a failed
   * install cannot turn into an endless cycle: the automatic check refuses to
   * offer a version it already tried and did not end up running, while the
   * manual check in About ignores this entirely. Cleared once the app is
   * actually running that version.
   */
  lastAttemptedUpdateVersion: string
  /** Where those archives are kept. Empty means the app's own data folder,
      which is where they started; pointing it at another drive is the reason
      this exists, since that is what makes them survive the disk dying. */
  saveBackupFolder: string
}

export interface BackupPrefs {
  backupFolder: string
  backupEnabled: boolean
  backupIntervalHours: number
  backupKeepCount: number
}

export interface BackupResult {
  ok: boolean
  path?: string
  error?: string
  settings: Settings
}

export interface BackupEntry {
  name: string
  path: string
  sizeBytes: number
  createdAt: string
}

export interface BackupListResult {
  entries: BackupEntry[]
  error?: string
}

export interface ImportResult {
  imported: number
  error?: string
}

export interface SteamGameDetails {
  appid: number
  description: string
  headerImage: string | null
  screenshots: string[]
  releaseDate: string | null
  developers: string[]
  publishers: string[]
  genres: string[]
  metacriticScore: number | null
}

export interface ScreenshotSweepResult {
  totalGames: number
  alreadyCached: number
  attempted: number
  downloaded: number
  matchedByName: number
  noStorePage: number
  noMatch: number
  rateLimited: boolean
  retryAfter: string | null
}

export interface TrainerFileInfo {
  fileName: string
  path: string
  /** True when some game already points at this file. */
  assigned: boolean
}

export interface DuplicateGroup {
  name: string
  copies: { id: string; name: string; installDir: string; source: Game['source']; sizeBytes: number | null }[]
  /** Disk freed by keeping only the largest copy; null until sizes are known. */
  reclaimableBytes: number | null
}

export interface DriveUsage {
  /** Volume root as Windows spells it, e.g. `D:\`. */
  root: string
  /** Library games installed on this drive. */
  gameCount: number
  /** Measured size of those games. Unmeasured ones contribute nothing, so
      this is a floor rather than a total whenever `unmeasured` is non-zero. */
  gameBytes: number
  unmeasured: number
  /** The part of `gameBytes` belonging to games that were never played -
      the actionable number when a drive is running out of room. */
  neverPlayedBytes: number
  /** Null when the volume can't be reached, typically an unplugged drive. */
  totalBytes: number | null
  freeBytes: number | null
  /** Windows drive type, e.g. `Fixed` or `Network`. Empty when unknown.
      Worth showing: a mapped share can appear under several letters, and each
      one reports the same underlying free space. */
  driveType: string
}

export interface MissingGameEntry {
  id: string
  name: string
  exePath: string
  installDir: string
  source: Game['source']
  /** True when the whole install folder is gone, not just the executable. */
  folderMissing: boolean
}

export interface MissingScanResult {
  totalGames: number
  /** Games actually probed, i.e. everything except those on an offline drive. */
  checked: number
  entries: MissingGameEntry[]
  /** Volume roots that couldn't be reached at all. Their games are skipped
      instead of reported missing - an unplugged drive is not a deleted game. */
  offlineRoots: string[]
  error?: string
}

export interface TrainerScanResult {
  folder: string
  trainerFiles: number
  matched: number
  /** Trainer files that matched no game in the library. */
  unmatchedFiles: number
  error?: string
}

export interface DiskSizeSweepResult {
  totalGames: number
  measuredBefore: number
  measured: number
  failed: number
  totalSizeBytes: number
  /** True when a sweep was already in flight, so this call did nothing. */
  alreadyRunning: boolean
  error?: string
}

export interface MetadataSweepResult {
  totalGames: number
  missingCoverBefore: number
  missingGenresBefore: number
  attempted: number
  coversFilled: number
  genresFilled: number
  /** Games this pass found nothing for on any source. */
  noMatch: number
  /** Skipped because an earlier pass this session already found nothing. */
  skippedAfterEarlierMiss: number
  /** True when a sweep was already in flight, so this call did nothing. */
  alreadyRunning: boolean
  error?: string
}

export interface SteamPlaytimeSyncResult {
  /** False when Steam isn't installed, or its local config couldn't be read. */
  steamFound: boolean
  /** Apps Steam has a playtime record for, across every account on the PC. */
  steamAppsWithPlaytime: number
  /** Library games carrying a steamAppId, i.e. the ones that can be matched. */
  matchableGames: number
  /** Games whose playtime or last-played was actually raised by this sync. */
  updated: number
  totalPlaytimeSeconds: number
  error?: string
}

export interface LibrarySyncEvent {
  source: 'Steam' | 'Epic' | 'GOG' | 'Ubisoft'
  added: number
  removed: number
}

export interface UpdateCheckResult {
  available: boolean
  currentVersion: string
  latestVersion?: string
  notes?: string
  assetUrl?: string
  assetSize?: number
  /** This exact version was downloaded and installed before, and yet here we
      are still running something else — so the install did not take. The
      automatic check stays quiet about it; the manual one does not. */
  previouslyFailed?: boolean
  error?: string
}

export interface UpdateApplyResult {
  ok: boolean
  error?: string
}

export interface AppInfo {
  version: string
  electronVersion: string
  dataPath: string
}

export interface GameApi {
  getAll(): Promise<Game[]>
  getAppInfo(): Promise<AppInfo>
  openDataFolder(): Promise<void>
  openGameFolder(id: string): Promise<void>
  addManual(): Promise<Game | null>
  scanFolder(): Promise<FolderScanResult>
  rescanFolders(): Promise<FolderScanResult>
  onScanProgress(cb: (progress: ScanProgress | null) => void): () => void
  importCandidates(candidates: GameCandidate[]): Promise<Game[]>
  launch(id: string, actionId?: string): Promise<void>
  pickActionExe(): Promise<string | null>
  openHltb(id: string): Promise<void>
  getSaveLocations(id: string): Promise<SaveLocationsResult>
  backupSaves(id: string): Promise<SaveBackupResult>
  restoreSaves(id: string, zipPath: string): Promise<SaveBackupResult>
  refreshSaveIndex(): Promise<{ ok: boolean; games?: number; error?: string }>
  pickSaveBackupFolder(): Promise<string | null>
  update(
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
  ): Promise<Game | null>
  listSessions(): Promise<PlaySession[]>
  setCover(id: string): Promise<Game | null>
  setExePath(id: string): Promise<Game | null>
  remove(id: string): Promise<void>
  removeMany(ids: string[]): Promise<void>
  uninstall(id: string): Promise<{ ok: boolean; error?: string }>
  deleteFromDisk(id: string): Promise<DeleteFromDiskResult>
  /** Folders the scan should skip from now on, remembered across runs. */
  getIgnoredFolders(): Promise<string[]>
  ignoreFolders(paths: string[]): Promise<string[]>
  unignoreFolder(path: string): Promise<string[]>
  cleanAllNames(): Promise<{ changed: number }>
  fetchCovers(): Promise<CoverFetchResult>
  fetchCoverForOne(id: string): Promise<{ ok: boolean; found: boolean }>
  onCoverFetchProgress(cb: (progress: ScanProgress | null) => void): () => void
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>
  onLibraryChanged(cb: (games: Game[]) => void): () => void
  onLibrarySynced(cb: (events: LibrarySyncEvent[]) => void): () => void
  onGameRunningChanged(cb: (payload: { id: string; running: boolean }) => void): () => void
  pickBackupFolder(): Promise<string | null>
  saveBackupPrefs(prefs: BackupPrefs): Promise<Settings>
  onBackupProgress(cb: (progress: ScanProgress | null) => void): () => void
  backupNow(): Promise<BackupResult>
  restoreFromBackup(): Promise<BackupResult | null>
  listBackups(): Promise<BackupListResult>
  restoreFromPath(path: string): Promise<BackupResult>
  importSteamLibrary(): Promise<ImportResult>
  importEpicLibrary(): Promise<ImportResult>
  importGogLibrary(): Promise<ImportResult>
  importUbisoftLibrary(): Promise<ImportResult>
  checkForUpdate(): Promise<UpdateCheckResult>
  downloadUpdateAndRestart(assetUrl: string, assetSize: number, version: string): Promise<UpdateApplyResult>
  getSteamDetails(id: string): Promise<SteamGameDetails | null>
  sweepScreenshotsNow(): Promise<ScreenshotSweepResult>
  syncSteamPlaytimeNow(): Promise<SteamPlaytimeSyncResult>
  sweepMetadataNow(): Promise<MetadataSweepResult>
  measureDiskSizesNow(): Promise<DiskSizeSweepResult>
  pickTrainerFolder(): Promise<string | null>
  pickTrainerMirrorFolder(): Promise<string | null>
  scanTrainers(): Promise<TrainerScanResult>
  listTrainerFiles(): Promise<TrainerFileInfo[]>
  assignTrainer(gameId: string, sourcePath: string | null): Promise<Game | null>
  getDuplicateGroups(): Promise<DuplicateGroup[]>
  getDriveUsage(): Promise<DriveUsage[]>
  scanMissingGames(): Promise<MissingScanResult>
  launchTrainer(id: string): Promise<{ ok: boolean; error?: string }>
  launchWithTrainer(id: string): Promise<{ ok: boolean; error?: string }>
  openTrainerSearch(id: string): Promise<void>
  onDiskSizeProgress(cb: (progress: ScanProgress | null) => void): () => void
  getCategories(): Promise<Category[]>
  createCategory(name: string): Promise<Category>
  renameCategory(id: string, name: string): Promise<Category | null>
  deleteCategory(id: string): Promise<void>
  onCategoriesChanged(cb: (categories: Category[]) => void): () => void
}

declare global {
  interface Window {
    api: GameApi
  }
}
