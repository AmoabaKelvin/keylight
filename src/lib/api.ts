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

export type DaemonState = {
  connected: boolean
  device: { name?: string; firmware?: string | null; link?: 'cable' | 'dongle'; layout?: 'ansi' | 'iso' | 'jis' | 'unknown'; os?: 'mac' | 'windows'; sleep?: Sleep }
  /** Why it isn't connected: "bluetooth", "unplugged", or a message. */
  error: string | null
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
