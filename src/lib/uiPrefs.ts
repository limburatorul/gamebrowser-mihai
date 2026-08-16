import { isValidHex } from './color'

export interface UiPrefs {
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
