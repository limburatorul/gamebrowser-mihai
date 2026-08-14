import { useEffect, useMemo, useState } from 'react'
import type {
  BackupPrefs,
  Category,
  Game,
  GameCandidate,
  LibrarySyncEvent,
  ScanProgress,
  Settings,
  SortKey,
  UpdateCheckResult,
  ViewMode
} from '@shared/types'
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
import AboutDialog from './components/AboutDialog'
import DashboardDialog from './components/DashboardDialog'
import UpdateDialog from './components/UpdateDialog'
import WhatsNewDialog from './components/WhatsNewDialog'
import Backdrop from './components/Backdrop'
import SyncToasts, { type SyncToast } from './components/SyncToasts'
import { loadUiPrefs, saveUiPrefs, type UiPrefs } from './lib/uiPrefs'
import { mixHex, hexToRgbString } from './lib/color'
import { CHANGELOG, getChangesSince, type ChangelogEntry } from './lib/changelog'

const LAST_SEEN_VERSION_KEY = 'gb_lastSeenVersion'

export default function App(): JSX.Element {
  const [games, setGames] = useState<Game[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [genreFilter, setGenreFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [busy, setBusy] = useState(false)
  const [candidates, setCandidates] = useState<GameCandidate[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [coverFetchProgress, setCoverFetchProgress] = useState<ScanProgress | null>(null)
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
    lastBackupAt: null,
    librarySyncEnabled: true
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [tileWidth, setTileWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('tileWidth'))
    return saved >= 110 && saved <= 260 ? saved : 180
  })
  const [uiPrefs, setUiPrefs] = useState<UiPrefs>(loadUiPrefs)
  const [contextMenu, setContextMenu] = useState<{ gameId: string; x: number; y: number } | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null)
  const [checkingForUpdate, setCheckingForUpdate] = useState(false)
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [whatsNew, setWhatsNew] = useState<{ title: string; entries: ChangelogEntry[] } | null>(null)

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
    return () => {
      offLibrary()
      offLibrarySynced()
      offCategories()
      offRunning()
      offScanProgress()
      offCoverFetchProgress()
    }
  }, [])

  useEffect(() => {
    // Silent on startup - only surface the dialog if an update actually is
    // available, never a "you're up to date" or error toast for a check the
    // user didn't ask for.
    const timer = setTimeout(() => {
      window.api.checkForUpdate().then((result) => {
        if (result.available) setUpdateCheck(result)
      })
    }, 3000)
    return () => clearTimeout(timer)
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
    infoMessage !== null ||
    aboutOpen ||
    dashboardOpen ||
    updateCheck !== null ||
    whatsNew !== null

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      if (contextMenu) {
        setContextMenu(null)
        return
      }
      if (!anyModalOpen) {
        setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [contextMenu, anyModalOpen])

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

  const totalPlaytimeSeconds = useMemo(() => games.reduce((sum, g) => sum + g.playtimeSeconds, 0), [games])

  const backdropCoverPaths = useMemo(
    () => games.map((g) => g.coverPath).filter((p): p is string => Boolean(p)),
    [games]
  )

  const playtimeEntries = useMemo(
    () =>
      games
        .filter((g) => g.playtimeSeconds >= 60)
        .sort((a, b) => b.playtimeSeconds - a.playtimeSeconds)
        .map((g) => ({ id: g.id, name: g.name, playtimeSeconds: g.playtimeSeconds })),
    [games]
  )

  const visibleGames = useMemo(() => {
    let list = games
    if (filter === 'favorites') list = list.filter((g) => g.favorite)
    if (filter === 'recent') list = list.filter((g) => g.lastPlayed)
    if (filter === 'no-cover') list = list.filter((g) => !g.coverPath)
    if (filter === 'steam') list = list.filter((g) => g.source === 'steam')
    if (filter === 'epic') list = list.filter((g) => g.source === 'epic')
    if (filter === 'gog') list = list.filter((g) => g.source === 'gog')
    if (filter.startsWith('category:')) {
      const categoryId = filter.slice('category:'.length)
      list = list.filter((g) => g.categoryIds.includes(categoryId))
    }
    if (genreFilter) list = list.filter((g) => g.genres.includes(genreFilter))
    if (tagFilter) list = list.filter((g) => g.tags.includes(tagFilter))
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
        case 'lastPlayed':
          return (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? '')
        case 'playtime':
          return b.playtimeSeconds - a.playtimeSeconds
        case 'rating':
          return (b.rating ?? -1) - (a.rating ?? -1)
        default:
          return 0
      }
    })
    return sorted
  }, [games, filter, genreFilter, tagFilter, search, sortKey])

  const selectedGame = useMemo(() => {
    if (selectedIds.size !== 1) return null
    const [id] = selectedIds
    return games.find((g) => g.id === id) ?? null
  }, [games, selectedIds])

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

  async function handleScanFolder(): Promise<void> {
    setBusy(true)
    try {
      const found = await window.api.scanFolder()
      setCandidates(found)
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

  async function handleCheckForUpdate(): Promise<void> {
    setCheckingForUpdate(true)
    try {
      const result = await window.api.checkForUpdate()
      if (result.available) {
        setUpdateCheck(result)
        setAboutOpen(false)
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

  async function handleConfirmImport(selected: GameCandidate[]): Promise<void> {
    setBusy(true)
    try {
      const created = await window.api.importCandidates(selected)
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

  function handleToggleFavorite(id: string): void {
    const game = games.find((g) => g.id === id)
    if (!game) return
    void window.api.update(id, { favorite: !game.favorite })
  }

  function handleRateGame(id: string, rating: number | null): void {
    void window.api.update(id, { rating })
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

  const editingGame = games.find((g) => g.id === editingId) ?? null

  return (
    <div
      className={`app ${selectedGame || selectedIds.size > 1 ? 'has-details' : ''}`}
      style={
        {
          '--topbar-alpha': String(uiPrefs.topBarOpacity),
          '--topbar-blur': `${uiPrefs.topBarBlur}px`,
          '--details-alpha': String(uiPrefs.detailsBarOpacity),
          '--details-blur': `${uiPrefs.detailsBarBlur}px`,
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
        sortKey={sortKey}
        onSortChange={setSortKey}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onAddGame={handleAddGame}
        onScanFolder={handleScanFolder}
        onImportSteam={handleImportSteam}
        onImportEpic={handleImportEpic}
        onImportGog={handleImportGog}
        onFetchCovers={handleFetchCovers}
        onCleanNames={handleCleanNames}
        onOpenSettings={() => setSettingsOpen(true)}
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
          totalCount={games.length}
          favoriteCount={games.filter((g) => g.favorite).length}
          noCoverCount={games.filter((g) => !g.coverPath).length}
          steamCount={games.filter((g) => g.source === 'steam').length}
          epicCount={games.filter((g) => g.source === 'epic').length}
          gogCount={games.filter((g) => g.source === 'gog').length}
          categories={categories}
          categoryCounts={Object.fromEntries(
            categories.map((c) => [c.id, games.filter((g) => g.categoryIds.includes(c.id)).length])
          )}
          totalPlaytimeSeconds={totalPlaytimeSeconds}
          playtimeEntries={playtimeEntries}
          selectedIds={selectedIds}
          onSelectGame={(id) => {
            setSelectedIds(new Set([id]))
            setAnchorId(id)
          }}
          onOpenAbout={() => setAboutOpen(true)}
          onOpenDashboard={() => setDashboardOpen(true)}
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
          />
        </main>
      </div>

      {selectedGame && (
        <GameDetails
          game={selectedGame}
          running={runningIds.has(selectedGame.id)}
          onLaunch={handleLaunch}
          onToggleFavorite={handleToggleFavorite}
          onRate={handleRateGame}
          onEdit={handleEdit}
          onSetCover={handleSetCover}
          onRemove={handleRemove}
        />
      )}

      {selectedIds.size > 1 && (
        <BulkActionsBar
          count={selectedIds.size}
          onClear={() => setSelectedIds(new Set())}
          onDelete={() => setConfirmBulkDelete(true)}
        />
      )}

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
              onToggleFavorite={handleToggleFavorite}
              onEdit={handleEdit}
              onSetCover={handleSetCover}
              onRemove={handleRemove}
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
      {updateCheck?.available && updateCheck.latestVersion && (
        <UpdateDialog
          currentVersion={updateCheck.currentVersion}
          latestVersion={updateCheck.latestVersion}
          notes={updateCheck.notes}
          downloading={updateDownloading}
          error={updateError}
          onUpdate={() => void handleDownloadUpdate()}
          onLater={() => setUpdateCheck(null)}
        />
      )}
      {whatsNew && (
        <WhatsNewDialog title={whatsNew.title} entries={whatsNew.entries} onClose={() => setWhatsNew(null)} />
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
    </div>
  )
}
