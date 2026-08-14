import { isValidHex } from './color'

export interface UiPrefs {
  topBarOpacity: number
  topBarBlur: number
  detailsBarOpacity: number
  detailsBarBlur: number
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
