import { promises as fs } from 'fs'
import { join, basename, extname } from 'path'
// These rules were worked out here and are now shared with the save-location
// matcher, which has the same "don't hand Far Cry 5's data to Far Cry" problem.
import { normalize, seriesNumber, extraIsOnlyEditionNoise } from './titleMatch'

export interface TrainerFile {
  path: string
  fileName: string
  /** Filename with the version/edition tail stripped off. */
  title: string
  key: string
  mtimeMs: number
}

/**
 * Trainer filenames are remarkably regular - "<Game> v1.0-v1.13.1 Plus 11
 * Trainer.exe" - so everything from the first version-ish token onward is
 * noise for matching purposes.
 */
const VERSION_TAIL = /\s(?:v\.?\d|v\d|update\b|plus\s*\d|trainer\b|\+\d|\d+\s*bit\b)/i

function trainerTitle(fileName: string): string {
  const stem = basename(fileName, extname(fileName))
  const cut = stem.search(VERSION_TAIL)
  return (cut > 0 ? stem.slice(0, cut) : stem).trim()
}


export async function scanTrainerFolder(dir: string): Promise<TrainerFile[]> {
  const out: TrainerFile[] = []
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 2) return
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        try {
          const stat = await fs.stat(full)
          const title = trainerTitle(entry.name)
          out.push({ path: full, fileName: entry.name, title, key: normalize(title), mtimeMs: stat.mtimeMs })
        } catch {
          // unreadable file, skip
        }
      }
    }
  }
  await walk(dir, 0)
  return out
}

/**
 * Returns the best trainer for a game name, or null. Deliberately strict: a
 * wrong trainer is worse than none, since the user would launch it against the
 * wrong game and wonder why nothing works.
 */
export function matchTrainer(gameName: string, trainers: TrainerFile[]): TrainerFile | null {
  const gameKey = normalize(gameName)
  if (!gameKey) return null
  const gameNumber = seriesNumber(gameName)

  // Several versions of the same trainer are often kept side by side; the most
  // recently downloaded one is the one to use.
  const newest = (list: TrainerFile[]): TrainerFile =>
    [...list].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

  const exact = trainers.filter((t) => t.key === gameKey)
  if (exact.length > 0) return newest(exact)

  const candidates = trainers.filter((t) => {
    if (!t.key) return false
    if (!(t.key.includes(gameKey) || gameKey.includes(t.key))) return false
    if (seriesNumber(t.title) !== gameNumber) return false
    const [longer, shorter] = t.key.length >= gameKey.length ? [t.key, gameKey] : [gameKey, t.key]
    return extraIsOnlyEditionNoise(longer, shorter)
  })
  return candidates.length > 0 ? newest(candidates) : null
}

/**
 * Search page for a game on the trainer site. Only ever opened in the user's
 * own browser - the site blocks automated requests, and its trainers are paid
 * for by people actually visiting it.
 */
export function trainerSearchUrl(gameName: string): string {
  return `https://flingtrainer.com/?s=${encodeURIComponent(gameName)}`
}
