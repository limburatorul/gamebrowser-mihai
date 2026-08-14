export interface ChangelogEntry {
  version: string
  changes: string[]
}

// Newest first. Add a new entry here with every version bump.
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.11.0',
    changes: [
      'New: Game Details panel (toggle button in the top bar) — shows the Steam store description, screenshots, release date, developer/publisher, and genres for the selected game.',
      'New: Uninstall for Steam/Epic/GOG games, and Delete from Disk for manually added games — available individually (details bar, right-click) and for multiple selected games at once.',
      'Rating is now visible directly on grid tiles and list rows, not just in Edit.',
      'Polish: bigger, more legible stars and text in the details bar; bigger, more legible title and playtime on grid tiles.'
    ]
  },
  {
    version: '1.10.0',
    changes: [
      'New: personal 1-5 star rating on every game, set from the details bar or the Edit dialog — click the same star again to clear it. Also sortable by rating.',
      'New: custom categories in the sidebar — create, rename, and delete your own categories, and assign games to them from the Edit dialog.'
    ]
  },
  {
    version: '1.9.0',
    changes: [
      'New: Steam/Epic/GOG libraries now sync automatically on startup — newly installed games get added and uninstalled ones get removed, no need to press the manual Import buttons (toggle in Settings → Library Sync).',
      'New: a subtle notification in the bottom-right corner shows when games were added or removed by that sync.',
      'New: the Steam/Epic/GOG sidebar filters now show each platform\'s real logo instead of a placeholder emoji.'
    ]
  },
  {
    version: '1.7.0',
    changes: [
      'New: a "What\'s New" dialog now shows automatically after an update, summarizing what changed — also viewable anytime from About → View Changelog.'
    ]
  },
  {
    version: '1.6.0',
    changes: [
      'New: automatic update check against GitHub Releases, with one-click "Update & Restart" — no installer, just downloads next to the current .exe and swaps over.',
      'New: "Check for Updates" button in the About dialog.'
    ]
  },
  {
    version: '1.5.1',
    changes: ['Fix: window now opens at 1920×1080 with a 1750px minimum width, so the toolbar never gets cut off.']
  },
  {
    version: '1.5.0',
    changes: [
      'New: Epic Games import — detects installed titles from the Epic Games Launcher, with a dedicated "Epic" sidebar filter.'
    ]
  },
  {
    version: '1.4.0',
    changes: [
      'New: Steam import — detects installed Steam games automatically, with a dedicated "Steam" sidebar filter.',
      'New: custom tags on games, separate from auto-fetched genres, with a filter dropdown.',
      'New: Dashboard — totals and breakdowns by source and genre.',
      'New: browsable list of past backups in Settings, with one-click restore.'
    ]
  },
  {
    version: '1.3.2',
    changes: ['Fix: simplified how covers are loaded internally for more reliable image loading.']
  },
  {
    version: '1.3.1',
    changes: [
      'Fix: covers no longer get stuck on a placeholder after a one-off loading hiccup (most noticeable right after a backup restore).'
    ]
  },
  {
    version: '1.3.0',
    changes: [
      "New: rotating background that cycles through your library's cover art (adjustable speed, brightness, blur).",
      'New: customizable accent and sidebar colors, with presets and a full color picker.',
      'New: backup & restore — save your library, settings, covers, and icons to a single .zip, with optional scheduled backups.'
    ]
  },
  {
    version: '1.0.0',
    changes: [
      'Initial release: manual add, folder scan import, cover/genre auto-fetch from IGDB/Steam/RAWG, playtime tracking, favorites, clean names, grid/list views.'
    ]
  }
]

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// Entries strictly newer than `sinceVersion`, up to and including `currentVersion`.
export function getChangesSince(sinceVersion: string, currentVersion: string): ChangelogEntry[] {
  return CHANGELOG.filter(
    (e) => compareVersions(e.version, sinceVersion) > 0 && compareVersions(e.version, currentVersion) <= 0
  )
}
