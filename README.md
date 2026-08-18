# Game Browser

A standalone game library manager for Windows. It gathers everything you have installed — Steam, Epic, GOG, Ubisoft Connect, and anything you point it at by hand — into one library you can browse, organise and launch from.

No launcher required, no account, no background service. It keeps its data in a plain folder on your machine.

![version](https://img.shields.io/github/v/release/limburatorul/gamebrowser-mihai)

## Install

Grab `Game.Browser.Setup.<version>.exe` from the [latest release](https://github.com/limburatorul/gamebrowser-mihai/releases/latest) and run it. It installs for the current user only, so it never asks for administrator rights, and you can choose the folder.

The app updates itself: it checks for a newer release on startup and every half hour after that, and from the About dialog. Accepting an update downloads the installer, runs it quietly in the background, and starts the app again when it is done.

> **Coming from the old portable build?** The first update hands you the installer window rather than doing it silently, so you can pick where it goes — there is no previous install for it to reuse. Afterwards you can delete the old `Game Browser <version>.exe`; nothing needs it any more.

## What it does

**Finds your games**

- Imports installed games from **Steam**, **Epic Games**, **GOG Galaxy** and **Ubisoft Connect** — read straight from each launcher's own manifests, registry keys or local database, no logins involved.
- Rechecks all four on every launch, so games you install or uninstall elsewhere show up (or disappear) on their own.
- Scans any folder for games it doesn't know about, picking the real executable out of each subfolder instead of the first `.exe` it finds.
- Or just add a game by hand.

**Makes the library look like something**

- Fetches cover art and genres automatically from IGDB, Steam and RAWG, filling in only what's missing from each.
- Pulls the Steam store description, screenshots, release date, developer, publisher and Metacritic score into a details panel — cached locally, so it works offline after the first look.
- Rotating blurred cover art as a backdrop, adjustable accent and sidebar colours, and glass-style transparency and blur on the toolbar, details bar and card highlights.
- Grid or list view, with an adjustable cover size.

**Keeps it organised**

- Favourites, personal 1–5 star ratings, free-form tags, and custom categories you define yourself.
- Filter by source, genre, tag or category; sort by name, date added, last played, playtime or rating.
- Search, multi-select, and bulk actions across a whole selection at once.
- Playtime tracking, with a most-played list — and an **Ignore Playtime** toggle for games whose hours you would rather not count.
- A dashboard summarising your library by source, genre, playtime and coverage.

**Stays yours**

- Launches games directly, and shows which ones are running.
- Uninstalls through the owning launcher, or deletes a manually-added game's folder outright (with the exact path shown first).
- Full backup and restore to a single `.zip`, manually or on a schedule.

## Where your data lives

`%APPDATA%\game-browser` — `library.json`, `settings.json`, plus `covers\`, `icons\` and `screenshots\`. Open it from Settings → About → Open Data Folder.

It is all plain JSON and ordinary image files. Nothing is stored anywhere else, and nothing is sent anywhere except the cover/metadata lookups you trigger.

## Optional API keys

Cover and genre lookups work out of the box through Steam, which needs no credentials. Two optional sources improve the hit rate, and go in Settings → Automation:

| Source | What you need | Where |
| --- | --- | --- |
| IGDB | A Twitch application's Client ID and Secret | [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) |
| RAWG | A free API key | [rawg.io/apidocs](https://rawg.io/apidocs) |

## Building from source

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Development build with hot reload for the UI |
| `npm run typecheck` | Type-checks the main, preload and renderer projects |
| `npm run build` | Production build into `out/` |
| `npm run dist` | NSIS installer into `dist/` |

Releases are built by GitHub Actions on any `vX.Y.Z` tag push — see [`.github/workflows/release.yml`](.github/workflows/release.yml).

## How it's put together

Electron 31, React 18 and TypeScript, bundled with `electron-vite` and packaged with `electron-builder`.

```
electron/main/      backend: library storage, all IPC, imports, launching, updates
electron/preload/   the contextBridge API surface
shared/types.ts     shared types - the source of truth for Game, Settings and the IPC API
src/                React renderer
```

The library is a flat `Game[]` written to `library.json` — deliberately no database, at this scale it isn't worth the packaging risk of a native module. The one exception is reading GOG Galaxy's own SQLite database, which uses a WebAssembly build of SQLite rather than a native one.
