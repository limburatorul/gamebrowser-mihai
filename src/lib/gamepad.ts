/**
 * Turning a gamepad into discrete navigation events.
 *
 * The browser Gamepad API has no events for button presses — only a snapshot
 * of current state — so this polls on an animation frame and diffs against the
 * previous snapshot. Everything here exists to make a held stick or button
 * behave like a keyboard: one action immediately, then a pause, then a repeat.
 */

export type PadAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'menu'

/** Standard mapping indices. Face buttons first, then the d-pad. */
const BUTTONS: Record<number, PadAction> = {
  0: 'confirm', // A / cross
  1: 'back', // B / circle
  9: 'menu', // start
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right'
}

/** Past this, a stick counts as pushed. Deliberately high: analogue sticks
    rest slightly off-centre, and a low threshold turns drift into scrolling. */
const STICK_THRESHOLD = 0.55

/** Wait before a held direction starts repeating, then the gap between
    repeats. Roughly what Windows uses for a held key. */
const REPEAT_DELAY_MS = 400
const REPEAT_INTERVAL_MS = 90

interface HeldState {
  since: number
  lastFired: number
}

export function createGamepadReader(onAction: (action: PadAction) => void): () => void {
  const held = new Map<PadAction, HeldState>()
  let frame = 0
  let stopped = false

  function fire(action: PadAction, now: number): void {
    const state = held.get(action)
    if (!state) {
      held.set(action, { since: now, lastFired: now })
      onAction(action)
      return
    }
    // Only directions repeat. Holding A must not launch a game over and over.
    if (action === 'confirm' || action === 'back' || action === 'menu') return
    const heldFor = now - state.since
    if (heldFor < REPEAT_DELAY_MS) return
    if (now - state.lastFired < REPEAT_INTERVAL_MS) return
    state.lastFired = now
    onAction(action)
  }

  function poll(): void {
    if (stopped) return
    const now = performance.now()
    const active = new Set<PadAction>()
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue
      for (const [index, action] of Object.entries(BUTTONS)) {
        if (pad.buttons[Number(index)]?.pressed) active.add(action)
      }
      const [x = 0, y = 0] = pad.axes
      if (y < -STICK_THRESHOLD) active.add('up')
      if (y > STICK_THRESHOLD) active.add('down')
      if (x < -STICK_THRESHOLD) active.add('left')
      if (x > STICK_THRESHOLD) active.add('right')
    }
    for (const action of active) fire(action, now)
    for (const action of [...held.keys()]) if (!active.has(action)) held.delete(action)
    frame = requestAnimationFrame(poll)
  }

  frame = requestAnimationFrame(poll)
  return () => {
    stopped = true
    cancelAnimationFrame(frame)
  }
}
