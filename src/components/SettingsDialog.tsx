import { useEffect, useState } from 'react'
import type { BackupEntry, BackupPrefs, Settings } from '@shared/types'
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
}

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
  backupBusy
}: Props): JSX.Element {
  const [clientId, setClientId] = useState(initial.igdbClientId)
  const [clientSecret, setClientSecret] = useState(initial.igdbClientSecret)
  const [rawgApiKey, setRawgApiKey] = useState(initial.rawgApiKey)
  const [backupFolder, setBackupFolder] = useState(initial.backupFolder)
  const [backupEnabled, setBackupEnabled] = useState(initial.backupEnabled)
  const [backupIntervalHours, setBackupIntervalHours] = useState(initial.backupIntervalHours)
  const [librarySyncEnabled, setLibrarySyncEnabled] = useState(initial.librarySyncEnabled)
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
    const next: BackupPrefs = { backupFolder, backupEnabled, backupIntervalHours, ...patch }
    setBackupFolder(next.backupFolder)
    setBackupEnabled(next.backupEnabled)
    setBackupIntervalHours(next.backupIntervalHours)
    void onSaveBackupPrefs(next)
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Settings</h2>

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

        <h3 className="settings-section">Appearance</h3>

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
          Cycles through your library&apos;s cover art as a blurred background. Needs at least 2 games with covers.
        </p>

        <h3 className="settings-section">Library Sync</h3>

        <div className="settings-slider-row">
          <span className="settings-slider-label">Sync Steam/Epic/GOG on startup</span>
          <input
            type="checkbox"
            checked={librarySyncEnabled}
            onChange={(e) => setLibrarySyncEnabled(e.target.checked)}
          />
        </div>

        <p className="settings-note">
          On launch, checks Steam, Epic, and GOG for games installed or uninstalled since last time and updates your
          library automatically, without needing the manual Import buttons.
        </p>

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

        <p className="settings-note">
          Saved as a single .zip archive (max compression) containing your library, settings, covers, and icons.
          Last backup: {formatLastBackup(initial.lastBackupAt)}. If the app wasn&apos;t running when a backup was
          due, it runs on the next startup instead.
        </p>

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

        <h3 className="settings-section">Auto Covers (IGDB)</h3>
        <p className="modal-sub">
          To download covers from IGDB automatically, you need a free Twitch/IGDB application:
        </p>
        <ol className="settings-steps">
          <li>
            Open <span className="settings-link">dev.twitch.tv/console/apps/create</span> and sign in (free Twitch
            account).
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
          The keys are stored only locally, on this computer. Without them, the app falls back to Steam (no account
          needed) or the game&apos;s icon.
        </p>

        <h3 className="settings-section">Extra Covers (RAWG)</h3>
        <p className="modal-sub">
          Used only as a last resort, for games IGDB and Steam can&apos;t find (older, niche, or emulator titles).
          Free, no card required.
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
