import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BackupPrefs,
  Category,
  CompletionStatus,
  FolderScanResult,
  TrainerFileInfo,
  Game,
  GameCandidate,
  LibrarySyncEvent,
  ScanProgress,
  Settings,
  SortKey,
  UpdateCheckResult,
  ViewMode
} from '@shared/types'
import { COMPLETION_STATUSES, PLATFORM_SOURCES } from '@shared/types'
import { formatPlaytime, formatSize } from './lib/localFile'
import Sidebar, { type LibraryFilter } from './components/Sidebar'
import TopBar from './components/TopBar'
import GameGrid from './components/GameGrid'
import GameDetails from './components/GameDetails'
import BulkActionsBar from './components/BulkActionsBar'
import ImportDialog from './components/ImportDialog'
import EditGameDialog from './components/EditGameDialog'
import ConfirmDialog from './components/ConfirmDialog'
import ScanProgressOverlay from './components/ScanProgressOverlay'
import InfoDialog from './components/InfoDialog'
import SettingsDialog from './components/SettingsDialog'
import ContextMenu from './components/ContextMenu'
import DetailsPanel from './components/DetailsPanel'
import AboutDialog from './components/AboutDialog'
import DashboardDialog from './components/DashboardDialog'
import WhatToPlayDialog from './components/WhatToPlayDialog'
import UpdateDialog from './components/UpdateDialog'
import WhatsNewDialog from './components/WhatsNewDialog'
import SavesDialog from './components/SavesDialog'
import BigPictureView from './components/BigPictureView'
import Backdrop from './components/Backdrop'
import SyncToasts, { type SyncToast } from './components/SyncToasts'
import { loadUiPrefs, saveUiPrefs, type UiPrefs } from './lib/uiPrefs'
import { mixHex, hexToRgbString } from './lib/color'
import { CHANGELOG, getChangesSince, type ChangelogEntry } from './lib/changelog'

const LAST_SEEN_VERSION_KEY = 'gb_lastSeenVersion'
/** How often to look for a new release while the app stays open. */
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

export default function App(): JSX.Element {
  const [games, setGames] = useState<Game[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [genreFilter, setGenreFilter] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [busy, setBusy] = useState(false)
  const [candidates, setCandidates] = useState<GameCandidate[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [coverFetchProgress, setCoverFetchProgress] = useState<ScanProgress | null>(null)
  const [backupProgress, setBackupProgress] = useState<ScanProgress | null>(null)
  const [infoMessage, setInfoMessage] = useState<{ title: string; message: string } | null>(null)
  const [syncToasts, setSyncToasts] = useState<SyncToast[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [settings, setSettings] = useState<Settings>({
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
    autoBackupSavesOnExit: true,
    saveBackupFolder: ''
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [confirmUninstallId, setConfirmUninstallId] = useState<string | null>(null)
  const [uninstalling, setUninstalling] = useState(false)
  const [confirmDeleteDiskId, setConfirmDeleteDiskId] = useState<string | null>(null)
  const [deletingDisk, setDeletingDisk] = useState(false)
  const [confirmBulkUninstall, setConfirmBulkUninstall] = useState(false)
  const [bulkUninstalling, setBulkUninstalling] = useState(false)
  const [confirmBulkDeleteDisk, setConfirmBulkDeleteDisk] = useState(false)
  const [bulkDeletingDisk, setBulkDeletingDisk] = useState(false)
  const [tileWidth, setTileWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('tileWidth'))
    return saved >= 110 && saved <= 260 ? saved : 180
  })
  const [uiPrefs, setUiPrefs] = useState<UiPrefs>(loadUiPrefs)
  const [contextMenu, setContextMenu] = useState<{ gameId: string; x: number; y: number } | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [savesGameId, setSavesGameId] = useState<string | null>(null)
  const [bigPicture, setBigPicture] = useState(false)
  const [whatToPlayOpen, setWhatToPlayOpen] = useState(false)
  const [ignoredFolders, setIgnoredFolders] = useState<string[]>([])
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null)
  // Deliberately a ref and deliberately not persisted: within a session
  // "Later" means "stop asking", but a fresh launch is a fair moment to
  // mention it again. Never consulted by the manual check in About - asking
  // explicitly should always get an answer.
  const dismissedUpdateRef = useRef<string | null>(null)
  const [checkingForUpdate, setCheckingForUpdate] = useState(false)
  const [sweepingScreenshots, setSweepingScreenshots] = useState(false)
  const [syncingPlaytime, setSyncingPlaytime] = useState(false)
  const [sweepingMetadata, setSweepingMetadata] = useState(false)
  const [measuringSizes, setMeasuringSizes] = useState(false)
  const [scanningTrainers, setScanningTrainers] = useState(false)
  const [trainerFiles, setTrainerFiles] = useState<TrainerFileInfo[]>([])
  const [diskSizeProgress, setDiskSizeProgress] = useState<ScanProgress | null>(null)
  // Column count comes back from the grid, which is the only place that knows
  // how many tiles fit. Needed so Up/Down move by a whole row.
  const [columns, setColumns] = useState(1)
  // The keyboard handler reads the current list through a ref so the window
  // listener isn't torn down and re-attached on every keystroke in the search
  // box, which is what happens if the list itself is a dependency.
  const visibleGamesRef = useRef<Game[]>([])
  // Lets a keystroke anywhere in the window hand focus to the search box.
  const searchRef = useRef<HTMLInputElement>(null)
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [whatsNew, setWhatsNew] = useState<{ title: string; entries: ChangelogEntry[] } | null>(null)
  const [detailsPanelOpen, setDetailsPanelOpen] = useState(false)
  const [detailsPanelMounted, setDetailsPanelMounted] = useState(false)
  const [screenshotLightboxOpen, setScreenshotLightboxOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('tileWidth', String(tileWidth))
  }, [tileWidth])

  useEffect(() => {
    saveUiPrefs(uiPrefs)
  }, [uiPrefs])

  useEffect(() => {
    window.api.getAll().then(setGames)
    window.api.getSettings().then(setSettings)
    window.api.getCategories().then(setCategories)
    window.api.getIgnoredFolders().then(setIgnoredFolders)
    const offCategories = window.api.onCategoriesChanged(setCategories)
    const offLibrary = window.api.onLibraryChanged(setGames)
    const offLibrarySynced = window.api.onLibrarySynced((events: LibrarySyncEvent[]) => {
      const newToasts: SyncToast[] = []
      for (const e of events) {
        if (e.added > 0) newToasts.push({ id: `${e.source}-added-${Date.now()}`, source: e.source, kind: 'added', count: e.added })
        if (e.removed > 0)
          newToasts.push({ id: `${e.source}-removed-${Date.now()}`, source: e.source, kind: 'removed', count: e.removed })
      }
      setSyncToasts((prev) => [...prev, ...newToasts])
      for (const t of newToasts) {
        setTimeout(() => setSyncToasts((prev) => prev.filter((x) => x.id !== t.id)), 6000)
      }
    })
    const offRunning = window.api.onGameRunningChanged(({ id, running }) => {
      setRunningIds((prev) => {
        const next = new Set(prev)
        if (running) next.add(id)
        else next.delete(id)
        return next
      })
    })
    const offScanProgress = window.api.onScanProgress(setScanProgress)
    const offCoverFetchProgress = window.api.onCoverFetchProgress(setCoverFetchProgress)
    const offBackupProgress = window.api.onBackupProgress(setBackupProgress)
    const offDiskSizeProgress = window.api.onDiskSizeProgress(setDiskSizeProgress)
    return () => {
      offDiskSizeProgress()
      offLibrary()
      offLibrarySynced()
      offCategories()
      offRunning()
      offScanProgress()
      offCoverFetchProgress()
      offBackupProgress()
    }
  }, [])

  useEffect(() => {
    // Silent either way - only surface the dialog if an update actually is
    // available, never a "you're up to date" or error toast for a check the
    // user didn't ask for.
    //
    // Repeats rather than running once at startup: this app gets left open for
    // days, and a startup-only check means a release published this morning is
    // not seen until the next restart. Same lesson as the cover, screenshot,
    // disk-size and platform sweeps, all of which shipped startup-only first.
    const check = (): void => {
      void window.api.checkForUpdate().then((result) => {
        // Not a version the user has already waved away this session. Without
        // this, "Later" would buy exactly thirty minutes of peace.
        if (result.available && result.latestVersion !== dismissedUpdateRef.current) setUpdateCheck(result)
      })
    }
    const first = setTimeout(check, 3000)
    const repeat = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(repeat)
    }
  }, [])

  // The window title comes from the page's <title>, so the version has to be
  // stamped in from here - win.setTitle() in main would just get overwritten.
  useEffect(() => {
    window.api.getAppInfo().then((info) => {
      document.title = `Game Browser ${info.version}`
    })
  }, [])

  useEffect(() => {
    window.api.getAppInfo().then((info) => {
      const lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY)
      // No recorded version yet: either a genuinely fresh install, or an
      // upgrade from a build that predates this feature entirely (can't
      // tell the two apart) - either way, showing just the current
      // version's own entry is the right amount of noise for a first run.
      const entries = lastSeen ? getChangesSince(lastSeen, info.version) : CHANGELOG.filter((e) => e.version === info.version)
      if (entries.length > 0) {
        setWhatsNew({ title: `What's New in v${info.version}`, entries })
      }
      localStorage.setItem(LAST_SEEN_VERSION_KEY, info.version)
    })
  }, [])

  const anyModalOpen =
    settingsOpen ||
    candidates !== null ||
    editingId !== null ||
    confirmBulkDelete ||
    confirmUninstallId !== null ||
    confirmDeleteDiskId !== null ||
    confirmBulkUninstall ||
    confirmBulkDeleteDisk ||
    infoMessage !== null ||
    aboutOpen ||
    dashboardOpen ||
    whatToPlayOpen ||
    updateCheck !== null ||
    whatsNew !== null

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null)
          return
        }
        if (!anyModalOpen) setSelectedIds(new Set())
        return
      }

      if (anyModalOpen || contextMenu) return
      // Never steal keys from a text field - the search box, the category
      // rename input, anything in a dialog.
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return

      // Start typing anywhere and it goes to the search box. Only a bare
      // printable character counts: any modifier means a shortcut (Ctrl+F,
      // Alt+Tab), and e.key is a whole word ('ArrowLeft', 'F5', 'Dead' for an
      // IME dead key) for everything that isn't one. Space is left out - it
      // can't usefully start a query, and once the first character has landed
      // the box has focus, so the rest of the phrase reaches it directly.
      //
      // Deliberately ahead of the empty-list check below: a search matching
      // nothing must still accept more typing.
      if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && e.key !== ' ' && searchRef.current) {
        e.preventDefault()
        const input = searchRef.current
        // Functional update because `search` isn't a dependency of this
        // effect, so the value captured in this closure would be stale.
        setSearch((current) => current + e.key)
        input.focus()
        // After React has re-rendered with the new value, or the caret can be
        // left wherever it was and the next characters land mid-word.
        requestAnimationFrame(() => {
          const end = input.value.length
          input.setSelectionRange(end, end)
        })
        return
      }

      const list = visibleGamesRef.current
      if (list.length === 0) return

      const step =
        e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? columns : e.key === 'ArrowUp' ? -columns : null

      if (step !== null) {
        e.preventDefault()
        const current = anchorId ? list.findIndex((g) => g.id === anchorId) : -1
        // Nothing selected yet: the first key press lands on the first game
        // rather than jumping into the middle of the list.
        const next = current === -1 ? 0 : Math.min(list.length - 1, Math.max(0, current + step))
        const target = list[next]
        if (target) {
          setSelectedIds(new Set([target.id]))
          setAnchorId(target.id)
        }
        return
      }

      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        const target = e.key === 'Home' ? list[0] : list[list.length - 1]
        setSelectedIds(new Set([target.id]))
        setAnchorId(target.id)
        return
      }

      if (e.key === 'Enter' && anchorId) {
        e.preventDefault()
        handleLaunch(anchorId)
      }
    }
    // Its own listener, outside the guards above: Big Picture should be
    // reachable even with a game selected or the grid focused, and it is the
    // one shortcut people expect to work everywhere.
    const onBigPictureKey = (e: KeyboardEvent): void => {
      if (e.key === 'F11' && !anyModalOpen) {
        e.preventDefault()
        setBigPicture(true)
      }
    }
    window.addEventListener('keydown', onBigPictureKey)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keydown', onBigPictureKey)
    }
  }, [contextMenu, anyModalOpen, anchorId, columns])

  const availableGenres = useMemo(() => {
    const set = new Set<string>()
    for (const g of games) for (const genre of g.genres) set.add(genre)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [games])

  const availableTags = useMemo(() => {
    const set = new Set<string>()
    for (const g of games) for (const tag of g.tags) set.add(tag)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [games])

  // Everything you browse works from this rather than `games`: the grid, the
  // sidebar counts and its most-played list, and the backdrop. The Dashboard
  // is deliberately the exception and still sees the whole library - it
  // reports on what is on disk, and hiding a game doesn't free its space.
  const browsableGames = useMemo(() => games.filter((g) => !g.hidden), [games])

  const completionCounts = useMemo(() => {
    const counts = Object.fromEntries(COMPLETION_STATUSES.map((s) => [s, 0])) as Record<CompletionStatus, number>
    for (const g of browsableGames) if (g.completion) counts[g.completion]++
    return counts
  }, [browsableGames])
  const hiddenGames = useMemo(() => games.filter((g) => g.hidden), [games])

  // Games flagged "ignore playtime" keep their recorded seconds but are left
  // out of every aggregate - the library total here, the most-played list
  // below, and the dashboard's totals and breakdowns.
  const countedForPlaytime = useMemo(
    () => browsableGames.filter((g) => !g.excludeFromPlaytime),
    [browsableGames]
  )

  // The sidebar's playtime list and its total both follow the chosen source.
  // The Dashboard deliberately does not - it reports on the library as a
  // whole, where the merged figure is the honest one.
  const playtimeOf = useCallback(
    (g: Game): number => (uiPrefs.playtimeSource === 'here' ? g.playtimeSecondsHere : g.playtimeSeconds),
    [uiPrefs.playtimeSource]
  )

  const totalPlaytimeSeconds = useMemo(
    () => countedForPlaytime.reduce((sum, g) => sum + playtimeOf(g), 0),
    [countedForPlaytime, playtimeOf]
  )

  const backdropCoverPaths = useMemo(
    () => browsableGames.map((g) => g.coverPath).filter((p): p is string => Boolean(p)),
    [browsableGames]
  )

  const playtimeEntries = useMemo(
    () =>
      countedForPlaytime
        .filter((g) => playtimeOf(g) >= 60)
        .sort((a, b) => playtimeOf(b) - playtimeOf(a))
        .map((g) => ({ id: g.id, name: g.name, playtimeSeconds: playtimeOf(g) })),
    [countedForPlaytime, playtimeOf]
  )

  const visibleGames = useMemo(() => {
    let list = browsableGames
    if (filter === 'favorites') list = list.filter((g) => g.favorite)
    // "Recently played" means either everywhere or only from this app - see
    // RecentSource. Sorting by lastPlayed below still uses the merged value;
    // only membership of the filter narrows.
    if (filter === 'recent')
      list = list.filter((g) => (uiPrefs.recentSource === 'here' ? g.lastLaunchedHere : g.lastPlayed))
    if (filter === 'never-played') list = list.filter((g) => g.playtimeSeconds === 0)
    if (filter === 'has-trainer') list = list.filter((g) => g.trainerPath)
    if (filter === 'no-cover') list = list.filter((g) => !g.coverPath)
    if (filter === 'steam') list = list.filter((g) => g.source === 'steam')
    if (filter === 'epic') list = list.filter((g) => g.source === 'epic')
    if (filter === 'gog') list = list.filter((g) => g.source === 'gog')
    if (filter === 'ubisoft') list = list.filter((g) => g.source === 'ubisoft')
    if (filter.startsWith('category:')) {
      const categoryId = filter.slice('category:'.length)
      list = list.filter((g) => g.categoryIds.includes(categoryId))
    }
    if (filter.startsWith('status:')) {
      const status = filter.slice('status:'.length)
      list = list.filter((g) => g.completion === status)
    }
    // Any-of within a group, and-ed across the two: picking Action and RPG
    // asks for games in either, the way a storefront's facets behave, while
    // adding a tag on top narrows that result rather than widening it.
    if (genreFilter.length > 0) list = list.filter((g) => genreFilter.some((f) => g.genres.includes(f)))
    if (tagFilter.length > 0) list = list.filter((g) => tagFilter.some((f) => g.tags.includes(f)))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((g) => g.name.toLowerCase().includes(q))
    }
    const sorted = [...list]
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'dateAdded':
          return b.dateAdded.localeCompare(a.dateAdded)
        case 'lastPlayed': {
          // Follows the same source as the filter, or narrowing to "from this
          // app" would still order the list by when Steam last saw them.
          const when = (g: Game): string =>
            (uiPrefs.recentSource === 'here' && filter === 'recent' ? g.lastLaunchedHere : g.lastPlayed) ?? ''
          return when(b).localeCompare(when(a))
        }
        case 'playtime':
          return b.playtimeSeconds - a.playtimeSeconds
        case 'rating':
          return (b.rating ?? -1) - (a.rating ?? -1)
        case 'size':
          // Unmeasured games sort last rather than as zero, so a partly
          // measured library doesn't look like it's full of empty folders.
          return (b.installSizeBytes ?? -1) - (a.installSizeBytes ?? -1)
        default:
          return 0
      }
    })
    return sorted
  }, [browsableGames, filter, genreFilter, tagFilter, search, sortKey, uiPrefs.recentSource])

  useEffect(() => {
    visibleGamesRef.current = visibleGames
  }, [visibleGames])

  const handleColumnsChange = useCallback((n: number) => setColumns(n), [])

  // Only loaded while the Edit dialog is open - walking the trainer folders on
  // every render would be wasteful, and the list only matters in there.
  useEffect(() => {
    if (editingId === null) return
    void window.api.listTrainerFiles().then(setTrainerFiles)
  }, [editingId])

  const selectedGame = useMemo(() => {
    if (selectedIds.size !== 1) return null
    const [id] = selectedIds
    return games.find((g) => g.id === id) ?? null
  }, [games, selectedIds])

  // Keeps the last-selected game around after deselection so the details bar
  // has something to show while it slides out, instead of vanishing instantly.
  const [lastSelectedGame, setLastSelectedGame] = useState<Game | null>(null)
  useEffect(() => {
    if (selectedGame) setLastSelectedGame(selectedGame)
  }, [selectedGame])
  const detailsBarVisible = selectedGame !== null && !screenshotLightboxOpen

  // Same idea for the details panel's game, but frozen the moment the panel
  // closes rather than tracking every selection change - reopening later
  // still shows the right game since it's only frozen while actually closed.
  const [lastPanelGame, setLastPanelGame] = useState<Game | null>(null)
  useEffect(() => {
    if (detailsPanelOpen) setLastPanelGame(selectedGame)
  }, [detailsPanelOpen, selectedGame])
  useEffect(() => {
    if (detailsPanelOpen) setDetailsPanelMounted(true)
  }, [detailsPanelOpen])

  function handleItemClick(id: string, event: React.MouseEvent): void {
    if (event.shiftKey && anchorId) {
      const ids = visibleGames.map((g) => g.id)
      const anchorIdx = ids.indexOf(anchorId)
      const clickIdx = ids.indexOf(id)
      if (anchorIdx !== -1 && clickIdx !== -1) {
        const [start, end] = anchorIdx < clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx]
        setSelectedIds(new Set(ids.slice(start, end + 1)))
      }
      return
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      setAnchorId(id)
      return
    }
    setSelectedIds(new Set([id]))
    setAnchorId(id)
  }

  function handleItemContextMenu(id: string, event: React.MouseEvent): void {
    event.preventDefault()
    event.stopPropagation()
    setSelectedIds(new Set([id]))
    setAnchorId(id)
    setContextMenu({ gameId: id, x: event.clientX, y: event.clientY })
  }

  function handleBackgroundClick(): void {
    setSelectedIds(new Set())
    setContextMenu(null)
  }

  async function handleAddGame(): Promise<void> {
    setBusy(true)
    try {
      const game = await window.api.addManual()
      if (game) {
        setSelectedIds(new Set([game.id]))
        setAnchorId(game.id)
      }
    } finally {
      setBusy(false)
    }
  }

  function reportScan(result: FolderScanResult, title: string): void {
    if (result.candidates.length > 0) {
      setCandidates(result.candidates)
      return
    }
    if (result.scanned === 0 && result.skipped === 0) return
    setInfoMessage({
      title,
      message:
        `Nothing new. Looked at ${result.scanned} folder${result.scanned === 1 ? '' : 's'}` +
        (result.skipped > 0 ? `, skipped ${result.skipped} already in your library.` : '.')
    })
  }

  async function handleScanFolder(): Promise<void> {
    setBusy(true)
    try {
      reportScan(await window.api.scanFolder(), 'Scan Folder')
    } finally {
      setBusy(false)
    }
  }

  async function handleRescanFolders(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.rescanFolders()
      if (result.roots.length === 0) {
        setInfoMessage({
          title: 'Rescan Folders',
          message: 'No folders have been scanned yet — use Scan Folder once and they will be remembered.'
        })
        return
      }
      reportScan(result, 'Rescan Folders')
    } finally {
      setBusy(false)
    }
  }

  async function handleImportSteam(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.importSteamLibrary()
      setInfoMessage({
        title: 'Import Steam',
        message: result.error
          ? `Couldn't import from Steam: ${result.error}`
          : result.imported === 0
            ? 'No new Steam games found — everything already installed is already in your library.'
            : `Imported ${result.imported} game(s) from Steam.`
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleImportEpic(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.importEpicLibrary()
      setInfoMessage({
        title: 'Import Epic',
        message: result.error
          ? `Couldn't import from Epic Games: ${result.error}`
          : result.imported === 0
            ? 'No new Epic Games titles found — everything already installed is already in your library.'
            : `Imported ${result.imported} game(s) from Epic Games.`
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleImportGog(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.importGogLibrary()
      setInfoMessage({
        title: 'Import GOG',
        message: result.error
          ? `Couldn't import from GOG: ${result.error}`
          : result.imported === 0
            ? 'No new GOG games found — everything already installed is already in your library.'
            : `Imported ${result.imported} game(s) from GOG.`
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleImportUbisoft(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.importUbisoftLibrary()
      setInfoMessage({
        title: 'Import Ubisoft',
        message: result.error
          ? `Couldn't import from Ubisoft Connect: ${result.error}`
          : result.imported === 0
            ? 'No new Ubisoft games found — everything already installed is already in your library.'
            : `Imported ${result.imported} game(s) from Ubisoft Connect.`
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleSweepScreenshotsNow(): Promise<void> {
    setSweepingScreenshots(true)
    try {
      const r = await window.api.sweepScreenshotsNow()
      if (r.totalGames === 0) {
        setInfoMessage({ title: 'Screenshot Cache', message: 'Your library is empty.' })
        return
      }
      const lines = [`${r.alreadyCached} of ${r.totalGames} games already have cached screenshots.`]
      if (r.matchedByName > 0) {
        lines.push(`Matched ${r.matchedByName} more to a Steam store page by name just now.`)
      }
      if (r.attempted > 0) {
        lines.push(
          `Checked ${r.attempted}: downloaded ${r.downloaded}, ${r.noStorePage} had no usable Steam page.`
        )
      }
      if (r.noMatch > 0) {
        lines.push(`${r.noMatch} games have no matching Steam store page at all.`)
      }
      if (r.rateLimited) {
        const retryTime = r.retryAfter ? new Date(r.retryAfter).toLocaleTimeString() : 'shortly'
        lines.push(`Steam is currently rate-limiting requests — will retry automatically after ${retryTime}.`)
      }
      setInfoMessage({ title: 'Screenshot Cache', message: lines.join(' ') })
    } finally {
      setSweepingScreenshots(false)
    }
  }

  async function handleSweepMetadataNow(): Promise<void> {
    setSweepingMetadata(true)
    try {
      const r = await window.api.sweepMetadataNow()
      if (r.alreadyRunning) {
        setInfoMessage({ title: 'Covers & Genres', message: 'A sweep is already running — give it a moment.' })
        return
      }
      if (r.error) {
        setInfoMessage({ title: 'Covers & Genres', message: `Something went wrong: ${r.error}` })
        return
      }
      if (r.missingCoverBefore === 0 && r.missingGenresBefore === 0) {
        setInfoMessage({
          title: 'Covers & Genres',
          message: `All ${r.totalGames} games already have a cover and genres.`
        })
        return
      }
      const lines = [
        `${r.missingCoverBefore} games were missing a cover and ${r.missingGenresBefore} were missing genres.`
      ]
      if (r.attempted > 0) {
        lines.push(`Checked ${r.attempted}: filled in ${r.coversFilled} covers and ${r.genresFilled} genre lists.`)
      }
      if (r.noMatch > 0) {
        lines.push(`${r.noMatch} had no match on any configured source — they'll be retried next time you start up.`)
      }
      if (r.skippedAfterEarlierMiss > 0) {
        lines.push(`${r.skippedAfterEarlierMiss} were skipped, already checked without a match this session.`)
      }
      setInfoMessage({ title: 'Covers & Genres', message: lines.join(' ') })
    } finally {
      setSweepingMetadata(false)
    }
  }

  async function handleMeasureDiskSizes(): Promise<void> {
    setMeasuringSizes(true)
    try {
      const r = await window.api.measureDiskSizesNow()
      if (r.alreadyRunning) {
        setInfoMessage({ title: 'Size on Disk', message: 'Already measuring — it runs in the background.' })
        return
      }
      if (r.error) {
        setInfoMessage({ title: 'Size on Disk', message: `Something went wrong: ${r.error}` })
        return
      }
      const lines = [`Measured ${r.measured} of ${r.totalGames} games — ${formatSize(r.totalSizeBytes)} in total.`]
      if (r.failed > 0) lines.push(`${r.failed} install folders could not be read.`)
      setInfoMessage({ title: 'Size on Disk', message: lines.join(' ') })
    } finally {
      setMeasuringSizes(false)
    }
  }

  async function handleSyncSteamPlaytime(): Promise<void> {
    setSyncingPlaytime(true)
    try {
      const r = await window.api.syncSteamPlaytimeNow()
      if (r.error) {
        setInfoMessage({ title: 'Steam Playtime', message: `Couldn't read Steam's playtime: ${r.error}` })
        return
      }
      if (!r.steamFound) {
        setInfoMessage({ title: 'Steam Playtime', message: "Steam doesn't appear to be installed on this PC." })
        return
      }
      const lines = [
        `Steam has playtime recorded for ${r.steamAppsWithPlaytime} games; ${r.matchableGames} of yours carry a Steam ID.`
      ]
      lines.push(
        r.updated > 0
          ? `Updated ${r.updated}. Your library now totals ${formatPlaytime(r.totalPlaytimeSeconds)}.`
          : 'Everything was already up to date.'
      )
      setInfoMessage({ title: 'Steam Playtime', message: lines.join(' ') })
    } finally {
      setSyncingPlaytime(false)
    }
  }

  async function handleCheckForUpdate(): Promise<void> {
    setCheckingForUpdate(true)
    try {
      const result = await window.api.checkForUpdate()
      setAboutOpen(false)
      if (result.available) {
        setUpdateCheck(result)
      } else {
        setInfoMessage({
          title: 'Check for Updates',
          message: result.error ? `Couldn't check for updates: ${result.error}` : "You're on the latest version."
        })
      }
    } finally {
      setCheckingForUpdate(false)
    }
  }

  function handleViewChangelog(): void {
    setAboutOpen(false)
    setWhatsNew({ title: 'Changelog', entries: CHANGELOG })
  }

  async function handleDownloadUpdate(): Promise<void> {
    if (!updateCheck?.assetUrl || !updateCheck.assetSize || !updateCheck.latestVersion) return
    setUpdateDownloading(true)
    setUpdateError(null)
    try {
      const result = await window.api.downloadUpdateAndRestart(
        updateCheck.assetUrl,
        updateCheck.assetSize,
        updateCheck.latestVersion
      )
      // On success the main process quits this instance right after
      // launching the new one - nothing left to do here. Only a failure
      // path actually returns control to this code.
      if (!result.ok) setUpdateError(result.error ?? 'Update failed.')
    } finally {
      setUpdateDownloading(false)
    }
  }

  async function handleConfirmImport(selected: GameCandidate[], ignored: string[]): Promise<void> {
    setBusy(true)
    try {
      // Recorded first: if importing then fails, the folders the user marked
      // to ignore are still remembered rather than silently lost.
      if (ignored.length > 0) setIgnoredFolders(await window.api.ignoreFolders(ignored))
      const created = selected.length > 0 ? await window.api.importCandidates(selected) : []
      if (created.length > 0) {
        setSelectedIds(new Set([created[0].id]))
        setAnchorId(created[0].id)
      }
      setCandidates(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleFetchCovers(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.fetchCovers()
      if (result.total === 0) {
        setInfoMessage({
          title: 'Fetch Covers',
          message: 'Every game in the library already has a cover and genre.'
        })
      } else {
        const lines = []
        if (settings.igdbClientId && settings.igdbClientSecret) {
          lines.push(`IGDB: ${result.matchedIgdb} matched.`)
        } else {
          lines.push('IGDB: not configured — open Settings for better matching.')
        }
        lines.push(`Steam: ${result.matchedSteam} matched.`)
        if (settings.rawgApiKey) {
          lines.push(`RAWG: ${result.matchedRawg} matched.`)
        } else {
          lines.push('RAWG: not configured — open Settings to catch what IGDB and Steam miss.')
        }
        const totalMatched = result.matchedIgdb + result.matchedSteam + result.matchedRawg
        lines.push(`Total: ${totalMatched} of ${result.total} games missing a cover or genre.`)
        setInfoMessage({ title: 'Fetch Covers', message: lines.join(' ') })
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleCleanNames(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.cleanAllNames()
      setInfoMessage({
        title: 'Clean Names',
        message:
          result.changed === 0
            ? 'All names were already clean.'
            : `Cleaned up the names of ${result.changed} game(s).`
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveSettings(next: Settings): Promise<void> {
    setSavingSettings(true)
    try {
      const saved = await window.api.saveSettings(next)
      setSettings(saved)
      setSettingsOpen(false)
    } finally {
      setSavingSettings(false)
    }
  }

  async function handlePickBackupFolder(): Promise<string | null> {
    return window.api.pickBackupFolder()
  }

  async function handleSaveBackupPrefs(prefs: BackupPrefs): Promise<void> {
    const saved = await window.api.saveBackupPrefs(prefs)
    setSettings(saved)
  }

  async function handleBackupNow(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.backupNow()
      setSettings(result.settings)
      setInfoMessage({
        title: 'Backup',
        message: result.ok ? `Backup saved to ${result.path}.` : `Backup failed: ${result.error}`
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleRestoreBackup(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.restoreFromBackup()
      if (!result) return
      setSettings(result.settings)
      if (result.ok) setSettingsOpen(false)
      setInfoMessage({
        title: 'Restore',
        message: result.ok ? `Library and settings restored from ${result.path}.` : `Restore failed: ${result.error}`
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleRestoreFromPath(path: string): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.restoreFromPath(path)
      setSettings(result.settings)
      if (result.ok) setSettingsOpen(false)
      setInfoMessage({
        title: 'Restore',
        message: result.ok ? `Library and settings restored from ${result.path}.` : `Restore failed: ${result.error}`
      })
    } finally {
      setBusy(false)
    }
  }

  function handleLaunch(id: string): void {
    void window.api.launch(id)
  }

  function handleLaunchAction(id: string, actionId: string): void {
    void window.api.launch(id, actionId)
  }

  function handleToggleFavorite(id: string): void {
    const game = games.find((g) => g.id === id)
    if (!game) return
    void window.api.update(id, { favorite: !game.favorite })
  }

  function handleLaunchTrainer(id: string): void {
    void window.api.launchTrainer(id).then((r) => {
      if (!r.ok) setInfoMessage({ title: 'Trainer', message: r.error ?? 'Could not start the trainer.' })
    })
  }

  function handleLaunchWithTrainer(id: string): void {
    void window.api.launchWithTrainer(id).then((r) => {
      if (!r.ok) setInfoMessage({ title: 'Trainer', message: r.error ?? 'Could not start the trainer.' })
    })
  }

  function handleOpenGameFolder(id: string): void {
    void window.api.openGameFolder(id)
  }

  function handleFindTrainer(id: string): void {
    void window.api.openTrainerSearch(id)
  }

  async function handleScanTrainers(): Promise<void> {
    setScanningTrainers(true)
    try {
      const r = await window.api.scanTrainers()
      if (r.error) {
        setInfoMessage({ title: 'Trainers', message: r.error })
        return
      }
      setInfoMessage({
        title: 'Trainers',
        message:
          `Found ${r.trainerFiles} trainer files and matched ${r.matched} of your games. ` +
          `${r.unmatchedFiles} files matched nothing in the library. ` +
          `Matched trainers were copied into the app's data folder, so they are included in backups.`
      })
    } finally {
      setScanningTrainers(false)
    }
  }

  async function handlePickTrainerFolder(): Promise<string | null> {
    const picked = await window.api.pickTrainerFolder()
    if (picked) setSettings(await window.api.getSettings())
    return picked
  }

  async function handlePickTrainerMirrorFolder(): Promise<string | null> {
    const picked = await window.api.pickTrainerMirrorFolder()
    if (picked) setSettings(await window.api.getSettings())
    return picked
  }

  function handleTogglePlaytimeIgnored(id: string): void {
    const game = games.find((g) => g.id === id)
    if (!game) return
    void window.api.update(id, { excludeFromPlaytime: !game.excludeFromPlaytime })
  }

  function handleToggleHidden(id: string): void {
    const game = games.find((g) => g.id === id)
    if (!game) return
    void window.api.update(id, { hidden: !game.hidden })
    // A hidden game disappears from the grid, so leaving it selected would
    // leave the details bar showing something that is no longer on screen.
    if (!game.hidden) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function handleBulkHide(): Promise<void> {
    await Promise.all([...selectedIds].map((id) => window.api.update(id, { hidden: true })))
    setSelectedIds(new Set())
  }

  function handleRateGame(id: string, rating: number | null): void {
    void window.api.update(id, { rating })
  }

  function handleBulkRate(rating: number | null): void {
    for (const id of selectedIds) {
      void window.api.update(id, { rating })
    }
  }

  function handleSetCompletion(id: string, completion: CompletionStatus | null): void {
    void window.api.update(id, { completion })
  }

  function handleBulkSetCompletion(completion: CompletionStatus | null): void {
    for (const id of selectedIds) {
      void window.api.update(id, { completion })
    }
  }

  async function handleBulkAddToCategory(categoryId: string): Promise<void> {
    await Promise.all(
      [...selectedIds].map((id) => {
        const game = games.find((g) => g.id === id)
        if (!game || game.categoryIds.includes(categoryId)) return Promise.resolve(null)
        return window.api.update(id, { categoryIds: [...game.categoryIds, categoryId] })
      })
    )
  }

  function handleEdit(id: string): void {
    setEditingId(id)
  }

  async function handleSaveEdit(patch: {
    name: string
    favorite: boolean
    tags: string[]
    rating: number | null
    categoryIds: string[]
    steamAppId: number | null
    launchArgs: string
    runAsAdmin: boolean
  }): Promise<void> {
    if (!editingId) return
    setSavingEdit(true)
    try {
      await window.api.update(editingId, patch)
      setEditingId(null)
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleAssignTrainer(sourcePath: string | null): Promise<void> {
    if (!editingId) return
    await window.api.assignTrainer(editingId, sourcePath)
  }

  function handleChangeExePath(): void {
    if (editingId) void window.api.setExePath(editingId)
  }

  function handleSetCover(id: string): void {
    void window.api.setCover(id)
  }

  function handleBrowseCoverInEdit(): void {
    if (editingId) void window.api.setCover(editingId)
  }

  async function handleSearchCoverInEdit(): Promise<boolean> {
    if (!editingId) return false
    const result = await window.api.fetchCoverForOne(editingId)
    return result.found
  }

  async function handleRemove(id: string): Promise<void> {
    await window.api.remove(id)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  async function handleConfirmBulkDelete(): Promise<void> {
    setBulkDeleting(true)
    try {
      await window.api.removeMany([...selectedIds])
      setSelectedIds(new Set())
      setConfirmBulkDelete(false)
    } finally {
      setBulkDeleting(false)
    }
  }

  async function handleConfirmUninstall(): Promise<void> {
    if (!confirmUninstallId) return
    setUninstalling(true)
    try {
      const result = await window.api.uninstall(confirmUninstallId)
      if (!result.ok) {
        setInfoMessage({ title: 'Uninstall', message: result.error ?? 'Could not start the uninstaller.' })
      }
    } finally {
      setUninstalling(false)
      setConfirmUninstallId(null)
    }
  }

  async function handleConfirmDeleteDisk(): Promise<void> {
    if (!confirmDeleteDiskId) return
    const id = confirmDeleteDiskId
    setDeletingDisk(true)
    try {
      const result = await window.api.deleteFromDisk(id)
      if (!result.ok) {
        // The steps say what it tried, which is far more useful than the raw
        // EBUSY that ends up in `error`.
        setInfoMessage({
          title: 'Delete from Disk',
          message: [result.error ?? 'Could not delete the game files.', '', ...result.steps].join('\n')
        })
      } else {
        // Only worth a dialog when it had to do something drastic - stopping
        // a running game or taking ownership should never happen silently.
        if (result.killedProcesses.length > 0 || result.tookOwnership) {
          setInfoMessage({
            title: 'Deleted, but it needed a hand',
            message: result.steps.join('\n')
          })
        }
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    } finally {
      setDeletingDisk(false)
      setConfirmDeleteDiskId(null)
    }
  }

  async function handleConfirmBulkUninstall(): Promise<void> {
    setBulkUninstalling(true)
    try {
      const targets = games.filter((g) => selectedIds.has(g.id) && PLATFORM_SOURCES.has(g.source))
      const errors: string[] = []
      for (const g of targets) {
        const result = await window.api.uninstall(g.id)
        if (!result.ok) errors.push(`${g.name}: ${result.error ?? 'failed'}`)
      }
      if (errors.length > 0) setInfoMessage({ title: 'Uninstall', message: errors.join('\n') })
    } finally {
      setBulkUninstalling(false)
      setConfirmBulkUninstall(false)
    }
  }

  async function handleConfirmBulkDeleteDisk(): Promise<void> {
    setBulkDeletingDisk(true)
    try {
      const targets = games.filter(
        (g) => selectedIds.has(g.id) && (g.source === 'manual' || g.source === 'folder-scan')
      )
      const errors: string[] = []
      for (const g of targets) {
        const result = await window.api.deleteFromDisk(g.id)
        if (!result.ok) errors.push(`${g.name}: ${result.error ?? 'failed'}`)
        else if (result.killedProcesses.length > 0)
          errors.push(`${g.name}: deleted after stopping ${result.killedProcesses.join(', ')}`)
      }
      if (errors.length > 0) setInfoMessage({ title: 'Delete from Disk', message: errors.join('\n') })
      setSelectedIds(new Set())
    } finally {
      setBulkDeletingDisk(false)
      setConfirmBulkDeleteDisk(false)
    }
  }

  const editingGame = games.find((g) => g.id === editingId) ?? null

  // Returned before the desktop layout rather than layered over it: nothing
  // underneath should keep listening for keys or repainting a 544-tile grid
  // while you are three metres away with a controller.
  if (bigPicture) {
    return (
      <BigPictureView
        games={browsableGames}
        runningIds={runningIds}
        onLaunch={handleLaunch}
        onExit={() => setBigPicture(false)}
      />
    )
  }

  return (
    <div
      className={`app ${selectedGame || selectedIds.size > 1 ? 'has-details' : ''}`}
      // Drives the shared glass recipe in index.css. On the app root rather
      // than <html> so the dialogs, which render inside this tree, pick it up
      // along with the colour variables below.
      data-glass={uiPrefs.glassStyle}
      style={
        {
          '--topbar-alpha': String(uiPrefs.topBarOpacity),
          '--topbar-blur': `${uiPrefs.topBarBlur}px`,
          '--details-alpha': String(uiPrefs.detailsBarOpacity),
          '--details-blur': `${uiPrefs.detailsBarBlur}px`,
          '--tile-highlight-alpha': String(uiPrefs.tileHighlightOpacity),
          '--tile-highlight-blur': `${uiPrefs.tileHighlightBlur}px`,
          '--settings-alpha': String(uiPrefs.settingsOpacity),
          '--settings-blur': `${uiPrefs.settingsBlur}px`,
          '--accent': uiPrefs.accentColor,
          '--accent-dim': mixHex(uiPrefs.accentColor, '#10131a', 0.45),
          '--accent-light': mixHex(uiPrefs.accentColor, '#ffffff', 0.22),
          '--accent-lighter': mixHex(uiPrefs.accentColor, '#ffffff', 0.38),
          '--accent-rgb': hexToRgbString(uiPrefs.accentColor),
          '--sidebar-bg': uiPrefs.sidebarColor
        } as React.CSSProperties
      }
    >
      <Backdrop
        coverPaths={backdropCoverPaths}
        enabled={uiPrefs.backdropEnabled}
        intervalSec={uiPrefs.backdropIntervalSec}
        brightness={uiPrefs.backdropBrightness}
        blurPx={uiPrefs.backdropBlur}
      />
      <TopBar
        search={search}
        onSearchChange={setSearch}
        searchRef={searchRef}
        sortKey={sortKey}
        onSortChange={setSortKey}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onAddGame={handleAddGame}
        onScanFolder={handleScanFolder}
        onRescanFolders={handleRescanFolders}
        onImportSteam={handleImportSteam}
        onImportEpic={handleImportEpic}
        onImportGog={handleImportGog}
        onImportUbisoft={handleImportUbisoft}
        onFetchCovers={handleFetchCovers}
        onCleanNames={handleCleanNames}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenBigPicture={() => setBigPicture(true)}
        detailsPanelOpen={detailsPanelOpen}
        onToggleDetailsPanel={() => setDetailsPanelOpen((v) => !v)}
        tileWidth={tileWidth}
        onTileWidthChange={setTileWidth}
        genres={availableGenres}
        genreFilter={genreFilter}
        onGenreFilterChange={setGenreFilter}
        tags={availableTags}
        tagFilter={tagFilter}
        onTagFilterChange={setTagFilter}
        busy={busy}
      />
      <div className="body">
        <Sidebar
          filter={filter}
          onFilterChange={setFilter}
          totalCount={browsableGames.length}
          favoriteCount={browsableGames.filter((g) => g.favorite).length}
          neverPlayedCount={browsableGames.filter((g) => g.playtimeSeconds === 0).length}
          hasTrainerCount={browsableGames.filter((g) => g.trainerPath).length}
          noCoverCount={browsableGames.filter((g) => !g.coverPath).length}
          steamCount={browsableGames.filter((g) => g.source === 'steam').length}
          epicCount={browsableGames.filter((g) => g.source === 'epic').length}
          gogCount={browsableGames.filter((g) => g.source === 'gog').length}
          ubisoftCount={browsableGames.filter((g) => g.source === 'ubisoft').length}
          categories={categories}
          categoryCounts={Object.fromEntries(
            categories.map((c) => [c.id, browsableGames.filter((g) => g.categoryIds.includes(c.id)).length])
          )}
          completionCounts={completionCounts}
          totalPlaytimeSeconds={totalPlaytimeSeconds}
          playtimeEntries={playtimeEntries}
          selectedIds={selectedIds}
          onSelectGame={(id) => {
            setSelectedIds(new Set([id]))
            setAnchorId(id)
          }}
          onOpenAbout={() => setAboutOpen(true)}
          onOpenDashboard={() => setDashboardOpen(true)}
          onOpenWhatToPlay={() => setWhatToPlayOpen(true)}
          recentSource={uiPrefs.recentSource}
          onRecentSourceChange={(recentSource) => setUiPrefs((p) => ({ ...p, recentSource }))}
          playtimeSource={uiPrefs.playtimeSource}
          onPlaytimeSourceChange={(playtimeSource) => setUiPrefs((p) => ({ ...p, playtimeSource }))}
          hasAnyPlaytime={countedForPlaytime.some((g) => g.playtimeSeconds > 0 || g.playtimeSecondsHere > 0)}
        />
        <main className="main">
          <GameGrid
            games={visibleGames}
            viewMode={viewMode}
            tileWidth={tileWidth}
            selectedIds={selectedIds}
            runningIds={runningIds}
            onItemClick={handleItemClick}
            onItemContextMenu={handleItemContextMenu}
            onBackgroundClick={handleBackgroundClick}
            onLaunch={handleLaunch}
            activeId={anchorId}
            onColumnsChange={handleColumnsChange}
          />
        </main>
        {detailsPanelMounted && (
          <DetailsPanel
            game={lastPanelGame}
            open={detailsPanelOpen}
            onClose={() => setDetailsPanelOpen(false)}
            onLightboxOpenChange={setScreenshotLightboxOpen}
          />
        )}
      </div>

      {lastSelectedGame && (
        <GameDetails
          game={selectedGame ?? lastSelectedGame}
          visible={detailsBarVisible}
          running={runningIds.has(lastSelectedGame.id)}
          onLaunch={handleLaunch}
          onLaunchAction={handleLaunchAction}
          onLaunchTrainer={handleLaunchTrainer}
          onLaunchWithTrainer={handleLaunchWithTrainer}
          onFindTrainer={handleFindTrainer}
          onOpenFolder={handleOpenGameFolder}
          onToggleFavorite={handleToggleFavorite}
          onRate={handleRateGame}
          onEdit={handleEdit}
          onSetCover={handleSetCover}
          onRemove={handleRemove}
          onUninstall={setConfirmUninstallId}
          onDeleteFromDisk={setConfirmDeleteDiskId}
          onToggleHidden={handleToggleHidden}
        />
      )}

      {selectedIds.size > 1 &&
        (() => {
          const selectedGames = games.filter((g) => selectedIds.has(g.id))
          return (
            <BulkActionsBar
              count={selectedIds.size}
              categories={categories}
              canUninstall={selectedGames.some((g) => PLATFORM_SOURCES.has(g.source))}
              canDeleteFromDisk={selectedGames.some((g) => g.source === 'manual' || g.source === 'folder-scan')}
              onClear={() => setSelectedIds(new Set())}
              onDelete={() => setConfirmBulkDelete(true)}
              onAddToCategory={handleBulkAddToCategory}
              onSetCompletion={handleBulkSetCompletion}
              onRate={handleBulkRate}
              onHide={() => void handleBulkHide()}
              onUninstall={() => setConfirmBulkUninstall(true)}
              onDeleteFromDisk={() => setConfirmBulkDeleteDisk(true)}
            />
          )
        })()}

      {contextMenu &&
        (() => {
          const game = games.find((g) => g.id === contextMenu.gameId)
          if (!game) return null
          return (
            <ContextMenu
              game={game}
              x={contextMenu.x}
              y={contextMenu.y}
              running={runningIds.has(game.id)}
              onClose={() => setContextMenu(null)}
              onLaunch={handleLaunch}
              onSetCompletion={handleSetCompletion}
              onOpenSaves={setSavesGameId}
              onToggleFavorite={handleToggleFavorite}
              onTogglePlaytimeIgnored={handleTogglePlaytimeIgnored}
              onToggleHidden={handleToggleHidden}
              onEdit={handleEdit}
              onSetCover={handleSetCover}
              onRemove={handleRemove}
              onUninstall={setConfirmUninstallId}
              onDeleteFromDisk={setConfirmDeleteDiskId}
            />
          )
        })()}

      {scanProgress && <ScanProgressOverlay progress={scanProgress} />}
      {coverFetchProgress && <ScanProgressOverlay progress={coverFetchProgress} title="Fetching Covers…" />}
      {infoMessage && (
        <InfoDialog title={infoMessage.title} message={infoMessage.message} onClose={() => setInfoMessage(null)} />
      )}
      <SyncToasts
        toasts={syncToasts}
        onDismiss={(id) => setSyncToasts((prev) => prev.filter((t) => t.id !== id))}
      />
      {settingsOpen && (
        <SettingsDialog
          initial={settings}
          saving={savingSettings}
          onCancel={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
          uiPrefs={uiPrefs}
          onUiPrefsChange={setUiPrefs}
          onPickBackupFolder={handlePickBackupFolder}
          onSaveBackupPrefs={handleSaveBackupPrefs}
          onBackupNow={handleBackupNow}
          onRestoreBackup={handleRestoreBackup}
          onRestoreFromPath={handleRestoreFromPath}
          backupBusy={busy}
          backupProgress={backupProgress}
          onSweepScreenshotsNow={handleSweepScreenshotsNow}
          sweepingScreenshots={sweepingScreenshots}
          onSyncSteamPlaytime={handleSyncSteamPlaytime}
          syncingPlaytime={syncingPlaytime}
          onSweepMetadataNow={handleSweepMetadataNow}
          sweepingMetadata={sweepingMetadata}
          onMeasureDiskSizes={handleMeasureDiskSizes}
          measuringSizes={measuringSizes}
          diskSizeProgress={diskSizeProgress}
          onPickTrainerFolder={handlePickTrainerFolder}
          onPickTrainerMirrorFolder={handlePickTrainerMirrorFolder}
          onScanTrainers={handleScanTrainers}
          onPickSaveBackupFolder={async () => {
            const picked = await window.api.pickSaveBackupFolder()
            // Main persists it immediately, so mirror it here rather than
            // waiting for Save - the path is shown in this same dialog.
            if (picked) setSettings((s) => ({ ...s, saveBackupFolder: picked }))
            return picked
          }}
          scanningTrainers={scanningTrainers}
          hiddenGames={hiddenGames}
          onUnhide={(id) => void window.api.update(id, { hidden: false })}
          onUnhideAll={() => {
            for (const g of hiddenGames) void window.api.update(g.id, { hidden: false })
          }}
          // Deliberately leaves Settings open: closing it would discard any
          // unsaved keys or backup settings on the other tabs.
          onLaunchHidden={handleLaunch}
          ignoredFolders={ignoredFolders}
          onUnignoreFolder={(path) => void window.api.unignoreFolder(path).then(setIgnoredFolders)}
        />
      )}
      {aboutOpen && (
        <AboutDialog
          gameCount={games.length}
          totalPlaytimeSeconds={totalPlaytimeSeconds}
          onClose={() => setAboutOpen(false)}
          onCheckForUpdate={handleCheckForUpdate}
          checkingForUpdate={checkingForUpdate}
          onViewChangelog={handleViewChangelog}
        />
      )}
      {dashboardOpen && <DashboardDialog games={games} onClose={() => setDashboardOpen(false)} />}
      {whatToPlayOpen && (
        <WhatToPlayDialog
          games={games}
          onClose={() => setWhatToPlayOpen(false)}
          onLaunch={(id) => {
            setWhatToPlayOpen(false)
            handleLaunch(id)
          }}
        />
      )}
      {updateCheck?.available && updateCheck.latestVersion && (
        <UpdateDialog
          currentVersion={updateCheck.currentVersion}
          latestVersion={updateCheck.latestVersion}
          notes={updateCheck.notes}
          downloading={updateDownloading}
          error={updateError}
          onUpdate={() => void handleDownloadUpdate()}
          onLater={() => {
            dismissedUpdateRef.current = updateCheck.latestVersion ?? null
            setUpdateCheck(null)
          }}
        />
      )}
      {whatsNew && (
        <WhatsNewDialog title={whatsNew.title} entries={whatsNew.entries} onClose={() => setWhatsNew(null)} />
      )}

      {savesGameId && games.find((g) => g.id === savesGameId) && (
        <SavesDialog
          game={games.find((g) => g.id === savesGameId) as Game}
          onClose={() => setSavesGameId(null)}
        />
      )}

      {candidates && (
        <ImportDialog
          candidates={candidates}
          importing={busy}
          onCancel={() => setCandidates(null)}
          onConfirm={handleConfirmImport}
        />
      )}

      {editingGame && (
        <EditGameDialog
          game={editingGame}
          categories={categories}
          saving={savingEdit}
          onCancel={() => setEditingId(null)}
          onSave={handleSaveEdit}
          trainerFiles={trainerFiles}
          onAssignTrainer={handleAssignTrainer}
          onChangeExePath={handleChangeExePath}
          onBrowseCover={handleBrowseCoverInEdit}
          onSearchCover={handleSearchCoverInEdit}
        />
      )}

      {confirmBulkDelete && (
        <ConfirmDialog
          title="Delete Selected Games"
          message={`Remove ${selectedIds.size} games from the library? The game files on disk are not affected.`}
          confirmLabel="Delete"
          danger
          busy={bulkDeleting}
          onCancel={() => setConfirmBulkDelete(false)}
          onConfirm={handleConfirmBulkDelete}
        />
      )}

      {confirmUninstallId &&
        (() => {
          const game = games.find((g) => g.id === confirmUninstallId)
          if (!game) return null
          return (
            <ConfirmDialog
              title="Uninstall Game"
              message={`Uninstall "${game.name}"? This hands off to its platform's own uninstaller — you'll confirm there too.`}
              confirmLabel="Uninstall"
              busy={uninstalling}
              onCancel={() => setConfirmUninstallId(null)}
              onConfirm={handleConfirmUninstall}
            />
          )
        })()}

      {confirmDeleteDiskId &&
        (() => {
          const game = games.find((g) => g.id === confirmDeleteDiskId)
          if (!game) return null
          return (
            <ConfirmDialog
              title="Delete from Disk"
              message={`Permanently delete this entire folder? This cannot be undone.\n\n${game.installDir}`}
              confirmLabel="Delete"
              danger
              busy={deletingDisk}
              onCancel={() => setConfirmDeleteDiskId(null)}
              onConfirm={handleConfirmDeleteDisk}
            />
          )
        })()}

      {confirmBulkUninstall && (
        <ConfirmDialog
          title="Uninstall Selected"
          message="Uninstall the selected Steam/Epic/GOG games? This hands off to each platform's own uninstaller — you'll confirm there too."
          confirmLabel="Uninstall"
          busy={bulkUninstalling}
          onCancel={() => setConfirmBulkUninstall(false)}
          onConfirm={handleConfirmBulkUninstall}
        />
      )}

      {confirmBulkDeleteDisk && (
        <ConfirmDialog
          title="Delete Selected from Disk"
          message="Permanently delete the selected manually-added games and all their files from disk? This cannot be undone."
          confirmLabel="Delete"
          danger
          busy={bulkDeletingDisk}
          onCancel={() => setConfirmBulkDeleteDisk(false)}
          onConfirm={handleConfirmBulkDeleteDisk}
        />
      )}
    </div>
  )
}
