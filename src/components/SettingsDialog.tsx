import { useEffect, useState } from 'react'
import type { BackupEntry, BackupPrefs, ScanProgress, Settings } from '@shared/types'
import type { UiPrefs } from '../lib/uiPrefs'
import ColorPicker from './ColorPicker'
import { ACCENT_PRESETS, SIDEBAR_PRESETS } from '../lib/color'

interface Props {
  initial: Settings
  onCancel: () => void
  onSave: (settings: Settings) => void
  saving: boolean
  uiPrefs: UiPrefs
  onUiPrefsChange: (prefs: UiPrefs) => void
  onPickBackupFolder: () => Promise<string | null>
  onSaveBackupPrefs: (prefs: BackupPrefs) => Promise<void>
  onBackupNow: () => Promise<void>
  onRestoreBackup: () => Promise<void>
  onRestoreFromPath: (path: string) => Promise<void>
  backupBusy: boolean
  backupProgress: ScanProgress | null
  onSweepScreenshotsNow: () => Promise<void>
  sweepingScreenshots: boolean
  onSyncSteamPlaytime: () => Promise<void>
  syncingPlaytime: boolean
  onSweepMetadataNow: () => Promise<void>
  sweepingMetadata: boolean
  onMeasureDiskSizes: () => Promise<void>
  measuringSizes: boolean
  diskSizeProgress: ScanProgress | null
  onPickTrainerFolder: () => Promise<string | null>
  onPickTrainerMirrorFolder: () => Promise<string | null>
  onScanTrainers: () => Promise<void>
  scanningTrainers: boolean
}

type Tab = 'appearance' | 'backup' | 'automation'

const TABS: { key: Tab; label: string }[] = [
  { key: 'appearance', label: 'Appearance' },
  { key: 'backup', label: 'Backup & Restore' },
  { key: 'automation', label: 'Automation' }
]

function formatHours(hours: number): string {
  return hours >= 24 && hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`
}

function formatLastBackup(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString()
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function SettingsDialog({
  initial,
  onCancel,
  onSave,
  saving,
  uiPrefs,
  onUiPrefsChange,
  onPickBackupFolder,
  onSaveBackupPrefs,
  onBackupNow,
  onRestoreBackup,
  onRestoreFromPath,
  backupBusy,
  backupProgress,
  onSweepScreenshotsNow,
  sweepingScreenshots,
  onSyncSteamPlaytime,
  syncingPlaytime,
  onSweepMetadataNow,
  sweepingMetadata,
  onMeasureDiskSizes,
  measuringSizes,
  diskSizeProgress,
  onPickTrainerFolder,
  onPickTrainerMirrorFolder,
  onScanTrainers,
  scanningTrainers
}: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('appearance')
  const [clientId, setClientId] = useState(initial.igdbClientId)
  const [clientSecret, setClientSecret] = useState(initial.igdbClientSecret)
  const [rawgApiKey, setRawgApiKey] = useState(initial.rawgApiKey)
  const [backupFolder, setBackupFolder] = useState(initial.backupFolder)
  const [backupEnabled, setBackupEnabled] = useState(initial.backupEnabled)
  const [backupIntervalHours, setBackupIntervalHours] = useState(initial.backupIntervalHours)
  const [backupKeepCount, setBackupKeepCount] = useState(initial.backupKeepCount)
  const [librarySyncEnabled, setLibrarySyncEnabled] = useState(initial.librarySyncEnabled)
  const [watchDownloadsForTrainers, setWatchDownloadsForTrainers] = useState(initial.watchDownloadsForTrainers)
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [backupsError, setBackupsError] = useState<string | null>(null)
  const [restoringPath, setRestoringPath] = useState<string | null>(null)

  function refreshBackups(): void {
    void window.api.listBackups().then((result) => {
      setBackups(result.entries)
      setBackupsError(result.error ?? null)
    })
  }

  useEffect(() => {
    refreshBackups()
  }, [])

  function setPref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void {
    onUiPrefsChange({ ...uiPrefs, [key]: value })
  }

  async function handleBackupNow(): Promise<void> {
    await onBackupNow()
    refreshBackups()
  }

  async function handleRestoreFromList(path: string): Promise<void> {
    setRestoringPath(path)
    try {
      await onRestoreFromPath(path)
    } finally {
      setRestoringPath(null)
    }
  }

  function persistBackupPrefs(patch: Partial<BackupPrefs>): void {
    const next: BackupPrefs = { backupFolder, backupEnabled, backupIntervalHours, backupKeepCount, ...patch }
    setBackupFolder(next.backupFolder)
    setBackupEnabled(next.backupEnabled)
    setBackupIntervalHours(next.backupIntervalHours)
    setBackupKeepCount(next.backupKeepCount)
    // Lowering the keep count prunes immediately in main, so the list has to
    // be re-read rather than assumed unchanged.
    void onSaveBackupPrefs(next).then(refreshBackups)
  }

  return (
    <div className="modal-overlay">
      <div className="modal settings-modal">
        <h2>Settings</h2>

        <div className="settings-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'active' : ''}
              type="button"
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'appearance' && (
          <>
            <h3 className="settings-section">Colors</h3>

            <ColorPicker
              label="Accent (buttons, selection)"
              value={uiPrefs.accentColor}
              presets={ACCENT_PRESETS}
              onChange={(hex) => setPref('accentColor', hex)}
            />

            <ColorPicker
              label="Sidebar background"
              value={uiPrefs.sidebarColor}
              presets={SIDEBAR_PRESETS}
              onChange={(hex) => setPref('sidebarColor', hex)}
            />

            <p className="settings-note">Pick a preset or use the wheel swatch for any custom color.</p>

            <h3 className="settings-section">Transparency &amp; Blur</h3>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Top bar — transparency</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(uiPrefs.topBarOpacity * 100)}
                onChange={(e) => setPref('topBarOpacity', Number(e.target.value) / 100)}
              />
              <span className="settings-slider-value">{Math.round(uiPrefs.topBarOpacity * 100)}%</span>
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Top bar — blur</span>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={uiPrefs.topBarBlur}
                onChange={(e) => setPref('topBarBlur', Number(e.target.value))}
              />
              <span className="settings-slider-value">{uiPrefs.topBarBlur}px</span>
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Details bar — transparency</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(uiPrefs.detailsBarOpacity * 100)}
                onChange={(e) => setPref('detailsBarOpacity', Number(e.target.value) / 100)}
              />
              <span className="settings-slider-value">{Math.round(uiPrefs.detailsBarOpacity * 100)}%</span>
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Details bar — blur</span>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={uiPrefs.detailsBarBlur}
                onChange={(e) => setPref('detailsBarBlur', Number(e.target.value))}
              />
              <span className="settings-slider-value">{uiPrefs.detailsBarBlur}px</span>
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Card highlight — transparency</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(uiPrefs.tileHighlightOpacity * 100)}
                onChange={(e) => setPref('tileHighlightOpacity', Number(e.target.value) / 100)}
              />
              <span className="settings-slider-value">{Math.round(uiPrefs.tileHighlightOpacity * 100)}%</span>
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Card highlight — blur</span>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={uiPrefs.tileHighlightBlur}
                onChange={(e) => setPref('tileHighlightBlur', Number(e.target.value))}
              />
              <span className="settings-slider-value">{uiPrefs.tileHighlightBlur}px</span>
            </div>

            <p className="settings-note">
              The card highlight is the frame behind a game card when it is hovered or selected.
            </p>

            <p className="settings-note">Appearance changes apply instantly and are saved automatically.</p>

            <h3 className="settings-section">Rotating Backdrop</h3>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Enabled</span>
              <input
                type="checkbox"
                checked={uiPrefs.backdropEnabled}
                onChange={(e) => setPref('backdropEnabled', e.target.checked)}
              />
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Change every</span>
              <input
                type="range"
                min={3}
                max={60}
                step={1}
                disabled={!uiPrefs.backdropEnabled}
                value={uiPrefs.backdropIntervalSec}
                onChange={(e) => setPref('backdropIntervalSec', Number(e.target.value))}
              />
              <span className="settings-slider-value">{uiPrefs.backdropIntervalSec}s</span>
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Brightness</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                disabled={!uiPrefs.backdropEnabled}
                value={Math.round(uiPrefs.backdropBrightness * 100)}
                onChange={(e) => setPref('backdropBrightness', Number(e.target.value) / 100)}
              />
              <span className="settings-slider-value">{Math.round(uiPrefs.backdropBrightness * 100)}%</span>
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Blur</span>
              <input
                type="range"
                min={0}
                max={60}
                step={1}
                disabled={!uiPrefs.backdropEnabled}
                value={uiPrefs.backdropBlur}
                onChange={(e) => setPref('backdropBlur', Number(e.target.value))}
              />
              <span className="settings-slider-value">{uiPrefs.backdropBlur}px</span>
            </div>

            <p className="settings-note">
              Cycles through your library&apos;s cover art as a blurred background. Needs at least 2 games with
              covers.
            </p>
          </>
        )}

        {tab === 'backup' && (
          <>
            <h3 className="settings-section">Backup &amp; Restore</h3>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Backup folder</span>
              <span className="backup-folder-path" title={backupFolder}>
                {backupFolder || 'Not set'}
              </span>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  const picked = await onPickBackupFolder()
                  if (picked) persistBackupPrefs({ backupFolder: picked })
                }}
              >
                Choose Folder…
              </button>
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Periodic backup</span>
              <input
                type="checkbox"
                checked={backupEnabled}
                onChange={(e) => persistBackupPrefs({ backupEnabled: e.target.checked })}
              />
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Every</span>
              <input
                type="range"
                min={1}
                max={168}
                step={1}
                disabled={!backupEnabled}
                value={backupIntervalHours}
                onChange={(e) => persistBackupPrefs({ backupIntervalHours: Number(e.target.value) })}
              />
              <span className="settings-slider-value">{formatHours(backupIntervalHours)}</span>
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Keep the newest</span>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={backupKeepCount}
                onChange={(e) => persistBackupPrefs({ backupKeepCount: Number(e.target.value) })}
              />
              <span className="settings-slider-value">
                {backupKeepCount === 0 ? 'all' : backupKeepCount}
              </span>
            </div>

            <p className="settings-note">
              Saved as a single .zip archive containing your library, settings, covers, icons, and cached Steam
              screenshots. Older archives beyond the number above are deleted after each backup — with screenshots
              cached these run to several GB each, so keeping every one adds up quickly. Last backup:{' '}
              {formatLastBackup(initial.lastBackupAt)}. If the app wasn&apos;t running when a backup was due, it runs
              on the next startup instead.
            </p>

            {backupProgress && (
              <p className="settings-note backup-progress">
                Backing up… {backupProgress.current.toLocaleString()} / {backupProgress.total.toLocaleString()} files
                {backupProgress.currentName ? ` — ${backupProgress.currentName}` : ''}
              </p>
            )}

            <div className="backup-actions-row">
              <button className="btn" type="button" disabled={backupBusy} onClick={() => void onRestoreBackup()}>
                Restore from File…
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={backupBusy || !backupFolder}
                onClick={() => void handleBackupNow()}
              >
                Backup Now
              </button>
            </div>

            {!backupFolder && (
              <p className="settings-note">Choose a backup folder above to start making backups.</p>
            )}

            {backupFolder && backupsError && (
              <p className="settings-note backup-list-error">Could not read the backup folder: {backupsError}</p>
            )}

            {backupFolder && !backupsError && backups.length === 0 && (
              <p className="settings-note">No backups yet — use &quot;Backup Now&quot; or enable periodic backup above.</p>
            )}

            {backups.length > 0 && (
              <ul className="backup-list">
                {backups.map((b) => (
                  <li key={b.path} className="backup-list-row">
                    <span className="backup-list-name" title={b.name}>
                      {new Date(b.createdAt).toLocaleString()}
                    </span>
                    <span className="backup-list-size">{formatSize(b.sizeBytes)}</span>
                    <button
                      className="btn"
                      type="button"
                      disabled={backupBusy || restoringPath !== null}
                      onClick={() => void handleRestoreFromList(b.path)}
                    >
                      {restoringPath === b.path ? 'Restoring…' : 'Restore'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'automation' && (
          <>
            <h3 className="settings-section">Library Sync</h3>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Sync Steam/Epic/GOG/Ubisoft on startup</span>
              <input
                type="checkbox"
                checked={librarySyncEnabled}
                onChange={(e) => setLibrarySyncEnabled(e.target.checked)}
              />
            </div>

            <p className="settings-note">
              On launch, checks each platform for games installed or uninstalled since last time and updates your
              library automatically, without needing the manual Import buttons.
            </p>

            <h3 className="settings-section">Screenshot Cache</h3>
            <p className="settings-note">
              Steam screenshots for every game — including manually added ones, matched to a Steam store page by
              name — download gradually in the background (also retried automatically every 15 minutes). If it
              seems stuck, check now to see exactly what&apos;s happening.
            </p>
            <button className="btn" type="button" disabled={sweepingScreenshots} onClick={() => void onSweepScreenshotsNow()}>
              {sweepingScreenshots ? 'Checking…' : 'Check Now'}
            </button>

            <h3 className="settings-section">Covers &amp; Genres</h3>
            <p className="settings-note">
              Anything still missing a cover or genres is retried automatically in the background, every 15 minutes
              and on startup — a fetch that failed when the game was first imported no longer leaves it blank for
              good. Check now to see exactly what is missing and what could not be matched.
            </p>
            <button className="btn" type="button" disabled={sweepingMetadata} onClick={() => void onSweepMetadataNow()}>
              {sweepingMetadata ? 'Checking…' : 'Check Now'}
            </button>

            <h3 className="settings-section">Trainers</h3>
            <div className="settings-slider-row">
              <span className="settings-slider-label">Trainers folder</span>
              <span className="backup-folder-path" title={initial.trainerFolder}>
                {initial.trainerFolder || 'Not set'}
              </span>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  const picked = await onPickTrainerFolder()
                  if (picked) void onScanTrainers()
                }}
              >
                Choose Folder…
              </button>
            </div>
            <div className="settings-slider-row">
              <span className="settings-slider-label">Also copy to</span>
              <span className="backup-folder-path" title={initial.trainerMirrorFolder}>
                {initial.trainerMirrorFolder || 'Not set'}
              </span>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  const picked = await onPickTrainerMirrorFolder()
                  if (picked) void onScanTrainers()
                }}
              >
                Choose Folder…
              </button>
            </div>

            <div className="settings-slider-row">
              <span className="settings-slider-label">Watch Downloads folder</span>
              <input
                type="checkbox"
                checked={watchDownloadsForTrainers}
                onChange={(e) => setWatchDownloadsForTrainers(e.target.checked)}
              />
            </div>

            <p className="settings-note">
              Point this at the folder where you keep your own trainer files. Matching ones are copied into the
              app&apos;s data folder, so they stay with the library and are included in backups, and a Trainer button
              appears next to Play instead of Find Trainer.
            </p>
            <p className="settings-note">
              With the Downloads folder watched, a trainer you have just downloaded is picked up and filed on its own
              within a few seconds — no rescan needed. Downloading itself is still a normal visit to the site: it
              blocks automated requests, and the trainers are free because that traffic is what pays for them.
            </p>
            <button
              className="btn"
              type="button"
              disabled={scanningTrainers || !initial.trainerFolder}
              onClick={() => void onScanTrainers()}
            >
              {scanningTrainers ? 'Scanning…' : 'Rescan Trainers'}
            </button>

            <h3 className="settings-section">Size on Disk</h3>
            <p className="settings-note">
              How much space each game takes is measured in the background and kept up to date weekly, which is what
              makes sorting by size and the Dashboard&apos;s &quot;biggest never played&quot; list work. Walking a
              game folder takes about a second, so a first pass over a large library is slow — it is paced to stay out
              of the way and only runs once per game.
            </p>
            {diskSizeProgress && (
              <p className="settings-note backup-progress">
                Measuring… {diskSizeProgress.current.toLocaleString()} / {diskSizeProgress.total.toLocaleString()}
                {diskSizeProgress.currentName ? ` — ${diskSizeProgress.currentName}` : ''}
              </p>
            )}
            <button className="btn" type="button" disabled={measuringSizes} onClick={() => void onMeasureDiskSizes()}>
              {measuringSizes ? 'Measuring…' : 'Re-measure All'}
            </button>

            <h3 className="settings-section">Steam Playtime</h3>
            <p className="settings-note">
              Steam keeps its own record of how long you have played each game. On launch, that is merged into your
              library for anything with a Steam ID, so the playtime list and dashboard reflect all of your time, not
              only the sessions started from here. Steam&apos;s figure and the locally tracked one are never added
              together — the larger of the two wins, since launching a Steam game from here is still counted by Steam.
            </p>
            <button
              className="btn"
              type="button"
              disabled={syncingPlaytime}
              onClick={() => void onSyncSteamPlaytime()}
            >
              {syncingPlaytime ? 'Syncing…' : 'Sync Playtime Now'}
            </button>

            <h3 className="settings-section">Auto Covers (IGDB)</h3>
            <p className="modal-sub">
              To download covers from IGDB automatically, you need a free Twitch/IGDB application:
            </p>
            <ol className="settings-steps">
              <li>
                Open <span className="settings-link">dev.twitch.tv/console/apps/create</span> and sign in (free
                Twitch account).
              </li>
              <li>Name: anything; OAuth Redirect URL: http://localhost; Category: Application Integration.</li>
              <li>After creating it, press &ldquo;New Secret&rdquo; to generate a Client Secret.</li>
              <li>Copy the Client ID and Client Secret below.</li>
            </ol>

            <label className="settings-label">Client ID</label>
            <input
              className="search-input"
              type="text"
              autoComplete="off"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="e.g. abc123..."
            />

            <label className="settings-label">Client Secret</label>
            <input
              className="search-input"
              type="password"
              autoComplete="off"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="e.g. xyz789..."
            />

            <p className="settings-note">
              The keys are stored only locally, on this computer. Without them, the app falls back to Steam (no
              account needed) or the game&apos;s icon.
            </p>

            <h3 className="settings-section">Extra Covers (RAWG)</h3>
            <p className="modal-sub">
              Used only as a last resort, for games IGDB and Steam can&apos;t find (older, niche, or emulator
              titles). Free, no card required.
            </p>
            <ol className="settings-steps">
              <li>
                Open <span className="settings-link">rawg.io/apidocs</span> and sign in (free account).
              </li>
              <li>Copy your API key and paste it below.</li>
            </ol>

            <label className="settings-label">RAWG API Key</label>
            <input
              className="search-input"
              type="password"
              autoComplete="off"
              value={rawgApiKey}
              onChange={(e) => setRawgApiKey(e.target.value)}
              placeholder="e.g. 0123456789abcdef..."
            />
          </>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={() =>
              onSave({
                igdbClientId: clientId.trim(),
                igdbClientSecret: clientSecret.trim(),
                rawgApiKey: rawgApiKey.trim(),
                backupFolder,
                backupEnabled,
                backupIntervalHours,
                backupKeepCount,
                scanRoots: initial.scanRoots,
                trainerFolder: initial.trainerFolder,
                trainerMirrorFolder: initial.trainerMirrorFolder,
                watchDownloadsForTrainers,
                lastBackupAt: initial.lastBackupAt,
                librarySyncEnabled
              })
            }
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
