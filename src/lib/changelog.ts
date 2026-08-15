export interface ChangelogEntry {
  version: string
  changes: string[]
}

// Newest first. Add a new entry here with every version bump.
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.19.2',
    changes: [
      'Fix: the game details panel on the right ran underneath the bar at the bottom of the window, so the last screenshots were partly hidden behind it with no way to scroll them clear. The panel now ends where the bar begins.',
      'Scrollbars are slimmer and no longer almost the same colour as the panels they sit on.'
    ]
  },
  {
    version: '1.19.1',
    changes: [
      'The app has a new icon — a rocket, with a properly transparent background so it sits cleanly on any taskbar or desktop.',
      'Removed the app icon picker added in 1.19.0. It could only repaint the window icon, not the one Windows actually shows in the taskbar and Explorer, so it never did what it looked like it did. The new icon is simply the icon now.'
    ]
  },
  {
    version: '1.19.0',
    changes: [
      'New: "Ignore Playtime" in the right-click menu on a game — leaves it out of the most-played list in the sidebar, the total playtime, and the dashboard, for games whose hours you would rather not count. Playtime keeps being recorded, so switching it back off restores the number untouched.',
      'The window title now shows the version number after the app name.',
      'The highlight behind a hovered or selected game card is now translucent and blurred like the top and details bars, slightly wider on the left and right, and both its transparency and blur are adjustable in Settings → Appearance.',
      'Fix: the genre and tag filter dropdowns used to stretch to fit the longest genre or tag name, which could push the toolbar wider than the window could go and cut off the buttons on the right. They now have a fixed maximum width (the full names are still shown when the dropdown is open).'
    ]
  },
  {
    version: '1.18.0',
    changes: [
      "The background screenshot cache now covers every game in your library, not just ones imported from Steam — manually added games get matched to a Steam store page by name (same matching already used for covers), and that match is remembered so it doesn't need to search again next time. Wrong match? Correct or clear it any time via the Steam ID field in the Edit dialog."
    ]
  },
  {
    version: '1.17.0',
    changes: [
      'New: "Check Now" button in Settings → Automation for the screenshot cache — shows exactly what\'s happening (how many are already cached, how many were checked just now, how many downloaded, and whether Steam is currently rate-limiting requests) instead of it being a silent background process with no visibility.'
    ]
  },
  {
    version: '1.16.3',
    changes: [
      "Fix: the automatic background screenshot download only ever ran once at startup — if that one attempt hit Steam's rate limit and backed off, nothing brought it back for the rest of the session even long after the block had actually lifted (opening the Game Details panel manually still worked fine in the meantime, which was the tell). It now automatically retries every 15 minutes."
    ]
  },
  {
    version: '1.16.2',
    changes: [
      'Fix: the screenshot download backoff now stops the whole run on the first Steam rate-limit response instead of grinding through the rest of the list with a wait on every single one, and waits longer each time it happens again instead of retrying the same minute-long window against a block that likely lasts longer.',
      'Fix: the Settings window now has a fixed size instead of resizing itself every time you switch tabs.'
    ]
  },
  {
    version: '1.16.1',
    changes: [
      "Fix: Delete from Disk could fail with \"directory not empty\" on Windows if a file inside was still briefly held open (AV scan, Explorer) — now retries automatically instead of failing on the first attempt.",
      'Fix: the background screenshot download now detects being rate-limited by Steam and backs off for a minute instead of silently failing game after game — also dialed back concurrency/pacing since running 4 at once likely triggered the rate limit in the first place.',
      "Fix: the backup list section could show absolutely nothing in some states — now always shows something (a folder prompt, an error, \"no backups yet\", or the list)."
    ]
  },
  {
    version: '1.16.0',
    changes: [
      'The background screenshot download now runs 4 games at a time instead of one at a time, so it catches up several times faster.',
      "New: Steam ID field in the Edit dialog — set it to pull the cover and genres from that exact Steam store page, overriding whatever the automatic name match picked (also accepts a pasted store.steampowered.com/app/… URL).",
      'Settings is now split into Appearance, Backup & Restore, and Automation tabs instead of one long scrolling page.',
      'Backup list in Settings now also refreshes right after you change the backup folder, not just after Backup Now.'
    ]
  },
  {
    version: '1.15.2',
    changes: [
      'Fix: the background screenshot download could get permanently stuck on a single slow/stalled connection and silently stop making progress for the rest of the library — every network request in the app now times out instead of potentially hanging forever.'
    ]
  },
  {
    version: '1.15.1',
    changes: [
      "Fix: checking for updates from About and finding you're already up to date showed that message behind the About window instead of in front of it."
    ]
  },
  {
    version: '1.15.0',
    changes: [
      'The four separate "Import Steam/Epic/GOG/Ubisoft" buttons are now one "Import ▾" dropdown, freeing up a lot of top bar width — the window fits on 1080p monitors again.',
      "Fix: the game title in the Game Details panel was rendering underneath the top bar."
    ]
  },
  {
    version: '1.14.2',
    changes: [
      "Fix: the enlarged screenshot view was still visually confined to the Game Details panel's area even without a CSS transform trapping it - now portaled directly to the window root, so it and its nav/close buttons always center over the whole app."
    ]
  },
  {
    version: '1.14.1',
    changes: [
      'Fix: the old exe is now retried a couple more times shortly after an update instead of only at the next full restart, for when it was still locked by the just-replaced process.',
      "Fix: Settings' Save/Cancel buttons no longer sit glued to the field above them.",
      'Fix: the Game Details panel now shrinks the game grid instead of covering part of it, and the enlarged screenshot view is centered over the whole window again (with working nav buttons) instead of being trapped inside the panel.'
    ]
  },
  {
    version: '1.14.0',
    changes: [
      'New: Ubisoft Connect import — detects installed titles, with a dedicated "Ubisoft" sidebar filter, sync, and uninstall support, just like Steam/Epic/GOG.',
      'New: screenshots for your Steam-tagged games are now fetched and cached gradually in the background (on startup and after importing), so the Game Details panel loads instantly once it catches up instead of fetching on first open.',
      'Fix: the selection border on grid tiles now fits the bigger title/playtime text from the last update — before, the next row could overlap it.'
    ]
  },
  {
    version: '1.13.0',
    changes: [
      'New: left/right buttons (and arrow keys) to step through screenshots in the enlarged view.',
      'New: the details bar at the bottom now slides out of the way while a screenshot is enlarged, and back in when it closes.',
      'Polish: the details bar and the Game Details panel now slide in/out (instead of appearing/disappearing instantly) when selecting or deselecting a game, and when opening/closing the panel.'
    ]
  },
  {
    version: '1.12.0',
    changes: [
      'Steam screenshots and banner images are now saved locally (in a screenshots folder) instead of loaded from the internet each time, so they load instantly and are included in your backups.',
      'New: click a screenshot in the Game Details panel to view it enlarged, centered over the whole window — click outside it or the ✕ button (or press Escape) to close.'
    ]
  },
  {
    version: '1.11.1',
    changes: [
      'Fix: the main Settings save button was silently dropping the library-sync toggle instead of persisting it.',
      'Fix: the backup list in Settings now shows why it\'s empty (no backups yet, or a read error) instead of just staying blank.',
      'Game Details panel: screenshots moved below the description/info, laid out in a grid instead of a horizontal strip, plus a store banner image and card-styled info.'
    ]
  },
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
