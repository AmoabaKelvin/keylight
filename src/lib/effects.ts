/**
 * The animations the keyboard runs by itself (light-state main mode), as NuPhy IO names them,
 * with which settings each one takes. `look` picks how the on-screen board hints at it.
 */
export type Effect = {
  mode: number
  name: string
  color: boolean
  speed: boolean
  /** Labels for direction 0 and 1, when it has one. */
  direction?: [string, string]
  look: 'wave' | 'rise' | 'breathe' | 'twinkle'
}

export const EFFECTS: Effect[] = [
  { mode: 6, name: 'Wave', color: true, speed: true, direction: ['→', '←'], look: 'wave' },
  { mode: 4, name: 'Breath', color: true, speed: true, look: 'breathe' },
  { mode: 1, name: 'Ray', color: true, speed: true, look: 'wave' },
  { mode: 7, name: 'Rise', color: true, speed: true, direction: ['↓', '↑'], look: 'rise' },
  { mode: 8, name: 'Spout', color: true, speed: true, direction: ['→', '←'], look: 'wave' },
  { mode: 10, name: 'Rotation', color: true, speed: true, direction: ['↓', '↑'], look: 'rise' },
  { mode: 11, name: 'Ripple', color: true, speed: true, look: 'twinkle' },
  { mode: 9, name: 'Galaxy', color: true, speed: true, look: 'twinkle' },
  { mode: 5, name: 'Flower', color: true, speed: true, look: 'twinkle' },
  { mode: 15, name: 'Rain', color: true, speed: true, look: 'rise' },
  { mode: 12, name: 'Point', color: true, speed: true, look: 'twinkle' },
  { mode: 13, name: 'Grid', color: true, speed: true, look: 'twinkle' },
  { mode: 14, name: 'Flow', color: true, speed: true, look: 'wave' },
  { mode: 2, name: 'Stair', color: true, speed: false, look: 'wave' },
  { mode: 16, name: 'Ribbon', color: false, speed: true, look: 'wave' },
  { mode: 20, name: 'Diagonal', color: false, speed: true, look: 'wave' },
  { mode: 17, name: 'Gaming', color: false, speed: true, look: 'twinkle' },
  { mode: 18, name: 'Identify', color: false, speed: true, look: 'twinkle' },
  { mode: 19, name: 'Windmill', color: false, speed: true, look: 'rise' },
]

export function effect(mode?: number) {
  return EFFECTS.find((e) => e.mode === mode) ?? EFFECTS[0]
}

/** The shapes the keyboard can draw itself (main mode 22), by index. */
export const FIRMWARE_SHAPES = ['Heart', 'Smiley', 'Crying face', 'Butterfly', 'Crescent moon', 'Right arrow', 'Left arrow', 'Four-leaf clover']
