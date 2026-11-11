import { invoke } from '@tauri-apps/api/core'
import type { RGB } from './color'

/** True inside the Mac app, false in a browser via `pnpm dev` (which proxies to the same daemon). */
export const isNative = '__TAURI_INTERNALS__' in window

export type Base = {
  name: 'solid' | 'gradient' | 'rainbow' | 'stripes' | 'effect' | 'shape' | 'off'
  /** Solid colour, gradient start, effect colour, or the firmware shape's colour. */
  color?: RGB
  /** Gradient end, or the firmware shape's background. */
  color2?: RGB
  colors?: RGB[]
  level?: number
  /** Effects: the keyboard's own animation (light-state main mode 1-20). */
  mode?: number
  /** As the keyboard takes it: 0 fastest .. 4 slowest. */
  speed?: number
  direction?: number
  rgb?: boolean
  /** Firmware shape 0-7. */
  shape?: number
}

export type Sleep = { enabled: boolean; minutes: number; deep_minutes: number }

export type Layer = { name: string; visible: boolean; leds: Record<string, RGB> }

export type Side = { mode: number; brightness: number; speed: number; color: RGB }

/** The keyboard plugged in, or the last one seen (src-tauri/src/engine.rs `connect`). */
export type Device = {
  /** USB product string. */
  name?: string
  firmware?: string | null
  link?: 'cable' | 'dongle'
  /** Board id (src/lib/boards.gen.json). `layout` is the same, for older code. */
  board?: string
  layout?: string
  /** "Air65 V3 ISO". */
  board_name?: string
  model?: string
  variant?: string
  status?: 'supported' | 'experimental'
  /** USB product ID, as "0x102b". */
  pid?: string
  os?: 'mac' | 'windows'
  sleep?: Sleep
  /** Experimental boards only, as read at connect: 0xD1 LED count, 0xA0 matrix [rows, cols, extra], 0xD5 light state. */
  lights?: number | null
  matrix?: [number, number, number] | null
  light_state?: number[] | null
}

export type DaemonState = {
  connected: boolean
  /** False when the keyboard's firmware has no built-in shapes (all but the ANSI Air75 V3); Keylight draws the heart itself. */
  firmware_shapes?: boolean
  device: Device
  /** Why it isn't connected: "dongle", "unplugged", "unsupported: <name>", or a message. */
  error: string | null
  /** The board id everything is drawn and mapped for: the override, else the board plugged in, else the last one seen. */
  layout?: string
  /** Set on the Device page when detection is wrong; null = follow the keyboard. */
  layout_override?: string | null
  /** Why Keylight only reads the board plugged in (experimental boards), or null if it writes lighting. */
  read_only?: string | null
  /** Experimental lighting is on for the board plugged in. */
  experimental?: boolean
  /** Why the experimental board plugged in didn't answer as expected; while set, it stays read-only. */
  check_problem?: string | null
  os_mode: number
  hyper: boolean
  hyper_keys: string[]
  /** Hyper key -> the Tinycast action it runs. */
  hyper_map: Record<string, string>
  /** Keys the user marked as Hyper keys themselves. */
  extra_hyper: string[]
  hyper_style: { bound: RGB; key: RGB }
  base: Base
  layers: Layer[]
  side: Side
  /** What the keyboard is showing (or would be, once connected): one colour per key LED. */
  frame: RGB[]
  preview: boolean
  writes: number
}

/**
 * An experimental board that's plugged in but not connected: either the user hasn't clicked Connect
 * yet ("waiting"), or it failed and Keylight won't reopen it by itself ("disconnected").
 */
export function pendingBoard(state: DaemonState): { id: string; why: 'waiting' | 'disconnected' } | null {
  const m = !state.connected && state.error?.match(/^(waiting|disconnected): (.+)$/)
  return m ? { why: m[1] as 'waiting' | 'disconnected', id: m[2] } : null
}

export type Rule = { description: string; enabled: boolean }

export type Rules = {
  profile: string | null
  rules: Rule[]
  /** karabiner.json exists (Karabiner-Elements has been set up). */
  installed: boolean
  /** Keylight's rules that this profile doesn't have yet. */
  missing: string[]
  /** Some Keylight rules call an older helper instead of this app. */
  outdated: boolean
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', body: JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(text)
  return text ? JSON.parse(text) : (null as T)
}

/** One message to the engine (the ops are in `Engine::handle`, src-tauri/src/engine.rs). */
export function daemon<T = null>(msg: Record<string, unknown>): Promise<T> {
  return isNative ? invoke<T>('daemon', { msg }) : post<T>('/api/daemon', msg)
}

export function karabinerRules(): Promise<Rules> {
  return isNative ? invoke('karabiner_rules') : post('/api/karabiner', {})
}

export function installKarabinerRules(): Promise<string[]> {
  return isNative ? invoke('karabiner_install') : Promise.resolve([])
}

export function autostart(on?: boolean): Promise<boolean> {
  return isNative ? invoke('autostart', { on }) : Promise.resolve(false)
}

export function setKarabinerRule(description: string, enabled: boolean): Promise<void> {
  return isNative ? invoke('karabiner_set', { description, enabled }) : post('/api/karabiner', { description, enabled })
}

export function openKarabiner(): Promise<void> {
  return isNative ? invoke('open_karabiner') : Promise.resolve()
}

let backupPath: Promise<string> | null = null

/**
 * Saves all keymap layers and both macro areas to a file, once per run of the app, before the first
 * keymap or macro write. Resolves to the file's path. A failed backup is retried next time.
 */
export function backupOnce(): Promise<string> {
  backupPath ??= daemon<{ path: string }>({ op: 'backup' }).then(
    (b) => b.path,
    (e) => {
      backupPath = null
      throw e
    },
  )
  return backupPath
}

/** The running version, and a newer one if the last check found it (see src-tauri/src/update.rs). */
export type UpdateStatus = { version: string; available: string | null }

export function updateStatus(): Promise<UpdateStatus> {
  return invoke('update_status')
}

export function checkForUpdate(): Promise<UpdateStatus> {
  return invoke('update_check')
}

/** Downloads the new version, swaps it in and relaunches. Only settles if that fails. */
export function installUpdate(): Promise<void> {
  return invoke('update_install')
}
