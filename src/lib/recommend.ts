import type { Game } from '@shared/types'

/** How much of your time a single genre accounts for. */
export interface GenreAffinity {
  genre: string
  seconds: number
  /** Fraction of all attributed playtime, 0..1. */
  share: number
}

export interface Recommendation {
  game: Game
  /** Sum of the shares of the genres that earned it its place, 0..1. */
  score: number
  /** The genres it was matched on, strongest first - this is what the dialog
      shows as the reason, so the pick never looks arbitrary. */
  matchedGenres: string[]
}

export interface RecommendationResult {
  /** Your taste profile, strongest genre first. */
  affinities: GenreAffinity[]
  /** Never-played games, best match first. */
  ranked: Recommendation[]
  /** True when there was nothing to learn from - no playtime, or no genres on
      anything you've played - so `ranked` is unscored and picking is random. */
  blind: boolean
}

/**
 * Only the strongest few of a game's genres count towards its score.
 *
 * Without a cap, a game tagged with six genres outscores one tagged with the
 * single genre you play most, purely by having more tags. Three is enough to
 * reward a genuine multi-genre match without turning tag count into the
 * ranking.
 */
const MAX_GENRES_COUNTED = 3

/**
 * How much of your playing time each genre accounts for.
 *
 * A game's time is *split* across its genres rather than credited in full to
 * each: a 100h game tagged Action/RPG/Indie says 33h about each of them, not
 * 100h about all three. Crediting in full would let heavily-tagged games
 * dominate the profile and would make the shares sum to far more than the
 * time actually played.
 *
 * Games excluded from playtime are left out, since that flag exists precisely
 * to say "this isn't really me playing" - a launcher or a wallpaper tool
 * shouldn't shape what gets recommended. Hidden games are left out too.
 */
export function genreAffinities(games: Game[]): GenreAffinity[] {
  const seconds = new Map<string, number>()
  let total = 0

  for (const game of games) {
    if (game.hidden || game.excludeFromPlaytime) continue
    if (game.playtimeSeconds <= 0 || game.genres.length === 0) continue
    const perGenre = game.playtimeSeconds / game.genres.length
    for (const genre of game.genres) {
      seconds.set(genre, (seconds.get(genre) ?? 0) + perGenre)
      total += perGenre
    }
  }

  if (total <= 0) return []
  return [...seconds.entries()]
    .map(([genre, secs]) => ({ genre, seconds: secs, share: secs / total }))
    .sort((a, b) => b.seconds - a.seconds)
}

/**
 * Ranks the games you have never played by how well they match what you
 * actually play.
 *
 * Recomputed from the library every time, so it follows your playtime around
 * on its own: a Steam sync, or an evening on something new, shifts the
 * profile and therefore the recommendations, with nothing to refresh by hand.
 */
export function recommend(games: Game[]): RecommendationResult {
  const affinities = genreAffinities(games)
  const shareOf = new Map(affinities.map((a) => [a.genre, a.share]))

  const candidates = games.filter((g) => !g.hidden && g.playtimeSeconds === 0)

  const ranked: Recommendation[] = candidates.map((game) => {
    const matched = game.genres
      .map((genre) => ({ genre, share: shareOf.get(genre) ?? 0 }))
      .filter((m) => m.share > 0)
      .sort((a, b) => b.share - a.share)
      .slice(0, MAX_GENRES_COUNTED)

    return {
      game,
      score: matched.reduce((sum, m) => sum + m.share, 0),
      matchedGenres: matched.map((m) => m.genre)
    }
  })

  // Nothing to learn from: no playtime at all, or none of the unplayed games
  // share a genre with anything played. Say so rather than dressing a random
  // pick up as a recommendation.
  const blind = affinities.length === 0 || ranked.every((r) => r.score === 0)

  ranked.sort((a, b) => b.score - a.score || a.game.name.localeCompare(b.game.name))
  return { affinities, ranked, blind }
}

/** How many of the top matches a pick is drawn from. */
export const PICK_POOL_SIZE = 20

/**
 * Picks one game, weighted towards the better matches.
 *
 * Deliberately not "always the top score": pressing the button twice should
 * offer something different, and with 500 unplayed games there is no single
 * right answer. Weighting by score keeps the suggestion relevant while
 * leaving it a surprise.
 *
 * `recent` holds the last few picks, not just the current one. Excluding only
 * the current one lets a game reappear two presses later, which looks like
 * the button is broken - observed in testing with a pool of 20.
 */
export function pickOne(ranked: Recommendation[], recent: string[] = []): Recommendation | null {
  const skip = new Set(recent)
  let pool = ranked.slice(0, PICK_POOL_SIZE).filter((r) => !skip.has(r.game.id))
  // Everything in the pool was shown recently - a small library, so allow
  // repeats rather than returning nothing.
  if (pool.length === 0) pool = ranked.slice(0, PICK_POOL_SIZE)
  if (pool.length === 0) return null

  const total = pool.reduce((sum, r) => sum + r.score, 0)
  // All zeroes (the blind case) - fall back to a flat draw.
  if (total <= 0) return pool[Math.floor(Math.random() * pool.length)]

  let roll = Math.random() * total
  for (const entry of pool) {
    roll -= entry.score
    if (roll <= 0) return entry
  }
  return pool[pool.length - 1]
}
