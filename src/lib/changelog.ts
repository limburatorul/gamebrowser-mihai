export interface ChangelogEntry {
  version: string
  changes: string[]
}

// Newest first. Add a new entry here with every version bump.
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.30.0',
    changes: [
      'Covers that are not the shape of the tile — the wide artwork Steam uses for newer games, or the game icon when no cover was found — are no longer cropped down to a sliver or blown up blurry. They now sit whole against a blurred copy of themselves, so the grid looks even.',
      'The rotating backdrop no longer washes the whole window in whatever colour the current cover happens to be, and the edges are darkened so the library sits on something calmer. Most noticeable in list view, where nothing covers it.',
      'List view now shows genres, size on disk and when you last played, instead of leaving the middle of every row empty. The columns drop away on their own on a narrower window.',
      'Covers fade in as they load instead of snapping in, tiles lift slightly under the cursor, and the grid settles in when you search or change a filter.',
      'The sort and filter dropdowns are no longer the plain Windows ones and now match the rest of the window.'
    ]
  },
  {
    version: '1.29.1',
    changes: [
      'Fixed: games uninstalled from Steam, Epic, GOG or Ubisoft were only noticed when the app started. If you left it open — which is the normal way to use it — the list went stale; sixteen games sat in the library for over a day after being uninstalled. It now re-checks every fifteen minutes.',
      'Fixed: a game is no longer removed when the drive its platform library sits on cannot be read. Previously a Steam library on a network drive that was not connected made every game on it look uninstalled, which would have cleared them out of the library along with their covers.',
      'Fixed: a Steam game whose store ID had gone missing could never be cleaned up automatically.'
    ]
  },
  {
    version: '1.29.0',
    changes: [
      'New: the Dashboard breaks storage down per drive — how many games sit on each one, how much room they take, how much of that is games you have never played, and how much space is left on the drive itself.',
      'New: "Missing Files" in the Dashboard checks that every game\'s executable is still on disk, and offers to clear out the entries left behind by games deleted outside this app. Drives that are not connected are skipped rather than reported as missing.',
      'Fixed: drive capacities above 4 TB were reported as exactly 4 TB. Large drives now show their real size.'
    ]
  },
  {
    version: '1.28.0',
    changes: [
      'New: the Dashboard lists games installed in more than one place, with the full path and size of each copy, and how much space dropping the smaller ones would free. Nothing is deleted for you — the point is to let you decide which copy to keep.',
      'New: launch options per game in the Edit dialog — command-line arguments and a run-as-administrator switch. Playtime is not measured for elevated launches, since the game then runs outside this app\'s reach.',
      'New: a trainer can be picked by hand in the Edit dialog when automatic matching missed it or chose the wrong file.',
      'New: matched trainers can also be copied to a second folder of your choosing, alongside the app\'s own copy.'
    ]
  },
  {
    version: '1.27.0',
    changes: [
      'Scanning a folder now skips the games it has already imported from it, instead of digging through every subfolder again to find the few new ones. On a folder holding 536 games it went from working through all of them to looking at 28 and finishing in under three seconds.',
      'New: "Rescan Folders" in the Import menu re-checks every folder you have scanned before, without asking you to pick one again — the folders are remembered.',
      'When a scan turns up nothing new, it now says so, along with how many folders it looked at and how many it skipped.'
    ]
  },
  {
    version: '1.26.0',
    changes: [
      'New: the bar at the bottom now shows where the game is installed, so when you have the same game twice — your own copy and the Steam one, or in two different places — you can tell which entry is which before deciding what to keep.',
      'Clicking that path opens the folder in Explorer with the game\'s own executable highlighted. Long paths are shortened from the left, keeping the end visible, since that is the part that tells the copies apart.'
    ]
  },
  {
    version: '1.25.1',
    changes: [
      'Fix: newer Steam games could end up with screenshots but no cover and no genres. Steam has moved its artwork to addresses that cannot be guessed, so the old approach came back empty-handed even though the game was found — covers for those now come from the store page itself.',
      "Fix: a game with no artwork available at all no longer loses its genres and its Steam link as well. The Steam ID is remembered from the first successful match, so later lookups don't have to search by name again."
    ]
  },
  {
    version: '1.25.0',
    changes: [
      'The window now remembers its size, position and whether it was maximised, and comes back the same way. It used to open at 1920×1080 in the default spot every single time. A position on a monitor that is no longer connected is ignored, so unplugging a screen cannot leave the window somewhere you cannot reach it.',
      'New: "Play + Trainer" starts the trainer and then the game in one click, for games that have one.',
      'New: a ⚡ mark on the cover of games with a trainer, and a "Has Trainer" filter in the sidebar.'
    ]
  },
  {
    version: '1.24.1',
    changes: [
      'Trainers now file themselves. Your trainers folder and, if you leave it enabled, your Downloads folder are watched — a trainer that appears there is matched and copied in within a few seconds, with no rescan and nothing to do by hand.',
      'Anything that landed while the app was closed is picked up on the next start.'
    ]
  },
  {
    version: '1.24.0',
    changes: [
      'New: trainers are part of the library. Point Settings → Automation at the folder where you keep them and matching ones are copied into the app\'s own data folder, so they stay with the library and are included in backups.',
      'New: a Trainer button next to Play launches the matching trainer. Games without one show Find Trainer instead, which opens the trainer site for that game in your browser.',
      'Matching is deliberately strict about sequels — "Far Cry" will not be handed the Far Cry 5 trainer, and Watch Dogs will not get the Watch Dogs 2 one. Where several versions of the same trainer are kept, the newest file wins.'
    ]
  },
  {
    version: '1.23.0',
    changes: [
      'New: how much space each game takes is now shown in the corner of its cover, and you can sort the library by it. The Dashboard adds the total on disk and — the useful part — the biggest games you have never played.',
      'New: a "Never Played" filter in the sidebar.',
      'New: keyboard navigation in the grid — arrow keys move between games, Enter launches, Home and End jump to the ends. Typing in the search box is left alone.',
      "Fix: Steam games that are not actually installed no longer appear in your library. Steam keeps a record for anything it knows about locally, and that was being read as \"installed\" — which is why things you never installed showed up with playtime.",
      'Fix: games that share an install folder no longer produce a separate entry each. Half-Life 2, Lost Coast and both episodes all live in the same folder and were appearing four times, every one of them pointing at the same file.'
    ]
  },
  {
    version: '1.22.3',
    changes: [
      "Fix: the game list's scrollbar ran the full height of the window, starting behind the top bar and ending behind the bar at the bottom, so parts of it were neither visible nor grabbable. It now spans exactly the visible area and shortens by itself when the details bar appears.",
      'As a side effect the game grid no longer scrolls underneath the top bar — covers now stop cleanly at its edge instead of sliding behind the blur.'
    ]
  },
  {
    version: '1.22.2',
    changes: [
      'Fix: some games launched an installer instead of the game — pressing Play could start the PhysX or DirectX setup, a Uplay/Ubisoft Connect installer, or an anti-cheat bootstrapper. On a 566-game library this affected 23 entries, and they were stuck that way: those filenames were not recognised as wrong, so the startup self-repair never re-checked them. They are now detected and repaired automatically the next time you start the app.',
      'Games are also matched to their executable more reliably: punctuation and spacing are ignored when comparing (folder "Watch_Dogs2" holds WatchDogs2.exe), so the right file wins instead of whichever happens to be largest — which used to pick things like the benchmark tool for Far Cry 2.'
    ]
  },
  {
    version: '1.22.1',
    changes: [
      'Fix: the most-played list in the sidebar ran underneath the bar at the bottom of the window, hiding its last entries and the total. It only started happening once importing Steam playtime made that list long enough to reach the bottom. Same fix the details panel got.'
    ]
  },
  {
    version: '1.22.0',
    changes: [
      'Fix: covers and genres were only ever fetched once, at the moment a game was imported — if that attempt failed, the game stayed blank forever unless you noticed and pressed "Fetch Covers" yourself. Anything still missing is now retried automatically on startup and every 15 minutes. On a 566-game library this filled in 40 covers and 38 genre lists on the first run.',
      'New: Settings → Automation → Covers & Genres has a "Check Now" button that reports exactly what is still missing and what could not be matched anywhere.',
      'New: a small × in the search box clears it, and Escape does the same while typing there.'
    ]
  },
  {
    version: '1.21.0',
    changes: [
      'New: your real Steam playtime is now part of the library. Steam keeps its own record of how long you have played each game, and that is merged in on launch for anything with a Steam ID — so the most-played list, the dashboard and sorting by playtime finally reflect all of your hours instead of only the sessions started from here. Nothing is double-counted: Steam already counts games launched from this app, so the larger of the two figures wins rather than the two being added together.',
      'Last-played dates come across from Steam too, which fills in the Recently Played filter.',
      'Settings → Automation has a "Sync Playtime Now" button if you want to pull it in without restarting.'
    ]
  },
  {
    version: '1.20.0',
    changes: [
      'New: backups are now limited to the newest few archives, set in Settings → Backup & Restore (default 5, or "all" to keep everything). Nothing deleted old backups before, so with periodic backup on, the folder grew forever — and now that a backup includes cached screenshots, that is several GB per run.',
      'Backup Now shows progress while it works instead of just going quiet.',
      'Leftover part-files from an interrupted backup are cleaned up automatically.'
    ]
  },
  {
    version: '1.19.3',
    changes: [
      'Fix: backups failed with "Array buffer allocation failed" once the cached screenshots pushed the data folder past a couple of gigabytes — the whole archive was being assembled in memory before anything was written to disk. It is now written out as it goes, so the size of your library no longer matters. A 2.8 GB backup here now takes about 12 seconds and around 140 MB of memory.',
      'Backups can now exceed 4 GB, which the old archive format could not represent at all.',
      'Backups are noticeably faster: already-compressed files (your covers and screenshots) are no longer put through compression that could not shrink them anyway.',
      'A backup that fails part-way now cleans up after itself instead of leaving a half-written file that looks like a usable backup.'
    ]
  },
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
