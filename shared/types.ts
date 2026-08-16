export interface Game {
  id: string
  name: string
  exePath: string
  installDir: string
  coverPath: string | null
  iconPath: string | null
  favorite: boolean
  dateAdded: string
  lastPlayed: string | null
  playtimeSeconds: number
  source: 'manual' | 'folder-scan' | 'steam' | 'epic' | 'gog' | 'ubisoft'
  genres: string[]
  tags: string[]
  rating: number | null
  categoryIds: string[]
  // Keeps counting playtime, but leaves the game out of every aggregate:
  // the sidebar's most-played list, the library total, and the dashboard.
  // Toggling it back off restores the untouched number.
  excludeFromPlaytime: boolean
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
  steamAppId: number | null
  epicAppName: string | null
  gogProductId: string | null
  ubisoftId: string | null
}

export interface Category {
  id: string
  name: string
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
  roots: string[]
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
  launch(id: string): Promise<void>
  update(
    id: string,
    patch: Partial<
      Pick<
        Game,
        | 'name'
        | 'favorite'
        | 'tags'
        | 'rating'
        | 'categoryIds'
        | 'steamAppId'
        | 'excludeFromPlaytime'
        | 'launchArgs'
        | 'runAsAdmin'
      >
    >
  ): Promise<Game | null>
  setCover(id: string): Promise<Game | null>
  setExePath(id: string): Promise<Game | null>
  remove(id: string): Promise<void>
  removeMany(ids: string[]): Promise<void>
  uninstall(id: string): Promise<{ ok: boolean; error?: string }>
  deleteFromDisk(id: string): Promise<{ ok: boolean; error?: string }>
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
