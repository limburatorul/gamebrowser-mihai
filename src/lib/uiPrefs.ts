import { isValidHex } from './color'

/**
 * How every translucent surface is treated. Only changes the shared glass
 * recipe in index.css - each surface keeps its own tint and its own blur
 * slider, which the style scales rather than overrides.
 */
export type GlassStyle = 'glass' | 'acrylic' | 'frosted'

export const GLASS_STYLES: GlassStyle[] = ['glass', 'acrylic', 'frosted']

/**
 * Whether a "played" figure counts everything, or only what this app measured
 * itself. Used by two independent settings: which games appear under Recently
 * Played, and which numbers the sidebar's playtime list shows.
 *
 * `everywhere` reads `lastPlayed` / `playtimeSeconds`, both of which merge our
 * own tracking with whatever Steam reports. `here` reads `lastLaunchedHere` /
 * `playtimeSecondsHere`, which only this app ever writes.
 */
export type PlayedSource = 'everywhere' | 'here'

export const PLAYED_SOURCES: PlayedSource[] = ['everywhere', 'here']

export interface UiPrefs {
  glassStyle: GlassStyle
  recentSource: PlayedSource
  playtimeSource: PlayedSource
  topBarOpacity: number
  topBarBlur: number
  detailsBarOpacity: number
  detailsBarBlur: number
  // Glass treatment for the highlight behind a hovered/selected game card.
  tileHighlightOpacity: number
  tileHighlightBlur: number
  // The Settings dialog's own glass.
  settingsOpacity: number
  settingsBlur: number
  backdropEnabled: boolean
  backdropIntervalSec: number
  backdropBrightness: number
  backdropBlur: number
  accentColor: string
  sidebarColor: string
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  glassStyle: 'glass',
  recentSource: 'everywhere',
  playtimeSource: 'everywhere',
  topBarOpacity: 0.55,
  topBarBlur: 16,
  detailsBarOpacity: 0.55,
  detailsBarBlur: 16,
  tileHighlightOpacity: 0.55,
  tileHighlightBlur: 16,
  // Higher than the bars: this one sits over the whole library and has to
  // stay readable, so it defaults to mostly opaque.
  settingsOpacity: 0.86,
  settingsBlur: 20,
  backdropEnabled: true,
  backdropIntervalSec: 8,
  backdropBrightness: 0.4,
  backdropBlur: 20,
  accentColor: '#4c8bf5',
  sidebarColor: '#17181b'
}

const STORAGE_KEY = 'uiPrefs'

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

function clampHex(value: unknown, fallback: string): string {
  return typeof value === 'string' && isValidHex(value) ? value : fallback
}

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_UI_PREFS
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    return {
      glassStyle: GLASS_STYLES.includes(parsed.glassStyle as GlassStyle)
        ? (parsed.glassStyle as GlassStyle)
        : DEFAULT_UI_PREFS.glassStyle,
      recentSource: PLAYED_SOURCES.includes(parsed.recentSource as PlayedSource)
        ? (parsed.recentSource as PlayedSource)
        : DEFAULT_UI_PREFS.recentSource,
      playtimeSource: PLAYED_SOURCES.includes(parsed.playtimeSource as PlayedSource)
        ? (parsed.playtimeSource as PlayedSource)
        : DEFAULT_UI_PREFS.playtimeSource,
      topBarOpacity: clamp(Number(parsed.topBarOpacity), 0, 1, DEFAULT_UI_PREFS.topBarOpacity),
      topBarBlur: clamp(Number(parsed.topBarBlur), 0, 30, DEFAULT_UI_PREFS.topBarBlur),
      detailsBarOpacity: clamp(Number(parsed.detailsBarOpacity), 0, 1, DEFAULT_UI_PREFS.detailsBarOpacity),
      detailsBarBlur: clamp(Number(parsed.detailsBarBlur), 0, 30, DEFAULT_UI_PREFS.detailsBarBlur),
      tileHighlightOpacity: clamp(
        Number(parsed.tileHighlightOpacity),
        0,
        1,
        DEFAULT_UI_PREFS.tileHighlightOpacity
      ),
      tileHighlightBlur: clamp(Number(parsed.tileHighlightBlur), 0, 30, DEFAULT_UI_PREFS.tileHighlightBlur),
      settingsOpacity: clamp(Number(parsed.settingsOpacity), 0.3, 1, DEFAULT_UI_PREFS.settingsOpacity),
      settingsBlur: clamp(Number(parsed.settingsBlur), 0, 40, DEFAULT_UI_PREFS.settingsBlur),
      backdropEnabled:
        typeof parsed.backdropEnabled === 'boolean' ? parsed.backdropEnabled : DEFAULT_UI_PREFS.backdropEnabled,
      backdropIntervalSec: clamp(
        Number(parsed.backdropIntervalSec),
        3,
        60,
        DEFAULT_UI_PREFS.backdropIntervalSec
      ),
      backdropBrightness: clamp(Number(parsed.backdropBrightness), 0, 1, DEFAULT_UI_PREFS.backdropBrightness),
      backdropBlur: clamp(Number(parsed.backdropBlur), 0, 60, DEFAULT_UI_PREFS.backdropBlur),
      accentColor: clampHex(parsed.accentColor, DEFAULT_UI_PREFS.accentColor),
      sidebarColor: clampHex(parsed.sidebarColor, DEFAULT_UI_PREFS.sidebarColor)
    }
  } catch {
    return DEFAULT_UI_PREFS
  }
}

export function saveUiPrefs(prefs: UiPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}
