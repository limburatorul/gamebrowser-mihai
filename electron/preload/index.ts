import { contextBridge, ipcRenderer } from 'electron'
import type {
  Game,
  GameCandidate,
  GameApi,
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

const api: GameApi = {
  getAll: () => ipcRenderer.invoke('games:getAll'),
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  addManual: () => ipcRenderer.invoke('games:addManual'),
  scanFolder: () => ipcRenderer.invoke('games:scanFolder'),
  onScanProgress: (cb: (progress: ScanProgress | null) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, progress: ScanProgress | null): void => cb(progress)
    ipcRenderer.on('scan:progress', listener)
    return () => ipcRenderer.removeListener('scan:progress', listener)
  },
  importCandidates: (candidates: GameCandidate[]) => ipcRenderer.invoke('games:importCandidates', candidates),
  launch: (id: string) => ipcRenderer.invoke('games:launch', id),
  update: (id: string, patch) => ipcRenderer.invoke('games:update', id, patch),
  setCover: (id: string) => ipcRenderer.invoke('games:setCover', id),
  setExePath: (id: string) => ipcRenderer.invoke('games:setExePath', id),
  remove: (id: string) => ipcRenderer.invoke('games:remove', id),
  removeMany: (ids: string[]) => ipcRenderer.invoke('games:removeMany', ids),
  uninstall: (id: string) => ipcRenderer.invoke('games:uninstall', id),
  deleteFromDisk: (id: string) => ipcRenderer.invoke('games:deleteFromDisk', id),
  cleanAllNames: () => ipcRenderer.invoke('games:cleanAllNames'),
  fetchCovers: (): Promise<CoverFetchResult> => ipcRenderer.invoke('games:fetchCovers'),
  fetchCoverForOne: (id: string) => ipcRenderer.invoke('games:fetchCoverForOne', id),
  onCoverFetchProgress: (cb: (progress: ScanProgress | null) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, progress: ScanProgress | null): void => cb(progress)
    ipcRenderer.on('cover-fetch:progress', listener)
    return () => ipcRenderer.removeListener('cover-fetch:progress', listener)
  },
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Settings): Promise<Settings> => ipcRenderer.invoke('settings:save', settings),
  onLibraryChanged: (cb: (games: Game[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, games: Game[]): void => cb(games)
    ipcRenderer.on('library:changed', listener)
    return () => ipcRenderer.removeListener('library:changed', listener)
  },
  onLibrarySynced: (cb: (events: LibrarySyncEvent[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, events: LibrarySyncEvent[]): void => cb(events)
    ipcRenderer.on('library:synced', listener)
    return () => ipcRenderer.removeListener('library:synced', listener)
  },
  onGameRunningChanged: (cb: (payload: { id: string; running: boolean }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { id: string; running: boolean }): void => cb(payload)
    ipcRenderer.on('game:running-changed', listener)
    return () => ipcRenderer.removeListener('game:running-changed', listener)
  },
  pickBackupFolder: (): Promise<string | null> => ipcRenderer.invoke('backup:pickFolder'),
  saveBackupPrefs: (prefs: BackupPrefs): Promise<Settings> => ipcRenderer.invoke('backup:savePrefs', prefs),
  backupNow: (): Promise<BackupResult> => ipcRenderer.invoke('backup:now'),
  restoreFromBackup: (): Promise<BackupResult | null> => ipcRenderer.invoke('backup:restore'),
  listBackups: (): Promise<BackupListResult> => ipcRenderer.invoke('backup:list'),
  restoreFromPath: (path: string): Promise<BackupResult> => ipcRenderer.invoke('backup:restorePath', path),
  importSteamLibrary: (): Promise<ImportResult> => ipcRenderer.invoke('steam:import'),
  importEpicLibrary: (): Promise<ImportResult> => ipcRenderer.invoke('epic:import'),
  importGogLibrary: (): Promise<ImportResult> => ipcRenderer.invoke('gog:import'),
  importUbisoftLibrary: (): Promise<ImportResult> => ipcRenderer.invoke('ubisoft:import'),
  checkForUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('update:check'),
  downloadUpdateAndRestart: (assetUrl: string, assetSize: number, version: string): Promise<UpdateApplyResult> =>
    ipcRenderer.invoke('update:downloadAndRestart', assetUrl, assetSize, version),
  getSteamDetails: (id: string): Promise<SteamGameDetails | null> => ipcRenderer.invoke('games:getSteamDetails', id),
  getCategories: (): Promise<Category[]> => ipcRenderer.invoke('categories:getAll'),
  createCategory: (name: string): Promise<Category> => ipcRenderer.invoke('categories:create', name),
  renameCategory: (id: string, name: string): Promise<Category | null> =>
    ipcRenderer.invoke('categories:rename', id, name),
  deleteCategory: (id: string): Promise<void> => ipcRenderer.invoke('categories:delete', id),
  onCategoriesChanged: (cb: (categories: Category[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, categories: Category[]): void => cb(categories)
    ipcRenderer.on('categories:changed', listener)
    return () => ipcRenderer.removeListener('categories:changed', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
