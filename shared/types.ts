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
  source: 'manual' | 'folder-scan' | 'steam' | 'epic' | 'gog'
  genres: string[]
  tags: string[]
  steamAppId: number | null
  epicAppName: string | null
  gogProductId: string | null
}

export interface GameCandidate {
  name: string
  exePath: string
  installDir: string
}

export interface ScanProgress {
  current: number
  total: number
  currentName: string
}

export type SortKey = 'name' | 'dateAdded' | 'lastPlayed' | 'playtime'
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
  lastBackupAt: string | null
}

export interface BackupPrefs {
  backupFolder: string
  backupEnabled: boolean
  backupIntervalHours: number
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

export interface ImportResult {
  imported: number
  error?: string
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
  addManual(): Promise<Game | null>
  scanFolder(): Promise<GameCandidate[]>
  onScanProgress(cb: (progress: ScanProgress | null) => void): () => void
  importCandidates(candidates: GameCandidate[]): Promise<Game[]>
  launch(id: string): Promise<void>
  update(id: string, patch: Partial<Pick<Game, 'name' | 'favorite' | 'tags'>>): Promise<Game | null>
  setCover(id: string): Promise<Game | null>
  setExePath(id: string): Promise<Game | null>
  remove(id: string): Promise<void>
  removeMany(ids: string[]): Promise<void>
  cleanAllNames(): Promise<{ changed: number }>
  fetchCovers(): Promise<CoverFetchResult>
  fetchCoverForOne(id: string): Promise<{ ok: boolean; found: boolean }>
  onCoverFetchProgress(cb: (progress: ScanProgress | null) => void): () => void
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>
  onLibraryChanged(cb: (games: Game[]) => void): () => void
  onGameRunningChanged(cb: (payload: { id: string; running: boolean }) => void): () => void
  pickBackupFolder(): Promise<string | null>
  saveBackupPrefs(prefs: BackupPrefs): Promise<Settings>
  backupNow(): Promise<BackupResult>
  restoreFromBackup(): Promise<BackupResult | null>
  listBackups(): Promise<BackupEntry[]>
  restoreFromPath(path: string): Promise<BackupResult>
  importSteamLibrary(): Promise<ImportResult>
  importEpicLibrary(): Promise<ImportResult>
  importGogLibrary(): Promise<ImportResult>
  checkForUpdate(): Promise<UpdateCheckResult>
  downloadUpdateAndRestart(assetUrl: string, assetSize: number, version: string): Promise<UpdateApplyResult>
}

declare global {
  interface Window {
    api: GameApi
  }
}
