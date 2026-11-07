import { createContext, useContext } from 'react'
import type { DaemonState } from './api'
import { BOARDS, isLayout, type Board } from './layout'

/**
 * Which layout to draw: the engine's pick (a manual override, the connected board, or the last one
 * seen, saved across restarts), else what the device reports, else ANSI.
 */
export function boardFor(state: DaemonState): Board {
  const id = isLayout(state.layout) ? state.layout : isLayout(state.device.layout) ? state.device.layout : 'ansi'
  return BOARDS[id]
}

export const LayoutContext = createContext<Board>(BOARDS.ansi)

/** The board the pages draw and map keys on. App provides it from the daemon state. */
export function useLayout(): Board {
  return useContext(LayoutContext)
}
