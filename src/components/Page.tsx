import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { DaemonState } from '../lib/api'
import { useLayout } from '../lib/useLayout'

/**
 * A page: its title, the keyboard, and its controls. The keyboard doesn't animate between pages
 * (it's the same board), only the controls under it slide in.
 */
export function Page({ title, meta, board, state, children, actions }: { title: string; meta: ReactNode; board: ReactNode; state: DaemonState; children: ReactNode; actions?: ReactNode }) {
  const { title: name } = useLayout()
  const unsupported = !state.connected && state.error?.startsWith('unsupported: ') ? state.error.slice('unsupported: '.length) : null
  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title">
          <h1>{title}</h1>
          {actions}
        </div>
        <p className="page-meta">{meta}</p>
      </header>
      <div className="board">{board}</div>
      {!state.connected && unsupported && (
        <p className="board-note">Keylight found a {unsupported}, which runs NuPhy’s QMK firmware. Keylight doesn’t support QMK boards yet, so it leaves it alone.</p>
      )}
      {!state.connected && !unsupported && (
        <p className="board-note">
          Plug the keyboard into this Mac with its USB cable to apply changes; the 2.4G dongle and Bluetooth can’t carry settings. Changes here are saved until then, and the
          keyboard keeps them after you unplug.
        </p>
      )}
      {state.connected && state.read_only && (
        <p className="board-note experimental">
          {name} detected. Support is experimental, so Keylight only reads it for now: changes here are saved but not sent. Turn on experimental lighting on the Device page to
          try them.
        </p>
      )}
      <motion.section className="panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
        {children}
      </motion.section>
    </div>
  )
}

export function Tip({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <>
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </>
  )
}
