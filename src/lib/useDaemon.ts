import { useCallback, useEffect, useRef, useState } from 'react'
import { daemon, type DaemonState } from './api'

const POLL_MS = 500

/**
 * The daemon's state, kept fresh. Polls while the window is visible (cheap: one small socket
 * round trip) so holding Hyper or a reconnect shows up here within half a second.
 */
export function useDaemon() {
  const [state, setState] = useState<DaemonState | null>(null)
  const [offline, setOffline] = useState(false)
  const busy = useRef(false)
  /** Set while a paint stroke is in progress, so a poll can't undo strokes not yet sent. */
  const paused = useRef(false)
  /** Changes made here since the last poll; a poll that started before them is stale. */
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    if (busy.current || paused.current) return
    busy.current = true
    const started = generation.current
    try {
      const next = await daemon<DaemonState>({ op: 'state' })
      if (generation.current === started) setState(next)
      setOffline(false)
    } catch (e) {
      if (String(e).includes('daemon-offline') || String(e).includes('ECONNREFUSED') || String(e).includes('ENOENT')) setOffline(true)
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(() => document.visibilityState === 'visible' && refresh(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  /** Send a change; `local` updates the screen right away instead of waiting for the reply. */
  const send = useCallback(
    async (msg: Record<string, unknown>, local?: (s: DaemonState) => DaemonState) => {
      generation.current++
      if (local) setState((s) => (s ? local(s) : s))
      try {
        await daemon(msg)
      } finally {
        generation.current++
        busy.current = false
        refresh()
      }
    },
    [refresh],
  )

  const pause = useCallback((on: boolean) => {
    paused.current = on
  }, [])

  return { state, offline, send, refresh, pause }
}

/**
 * Calls `fn` at most every `ms`, always ending with the latest arguments, for sliders and paint
 * strokes that change many times a second.
 */
export function useThrottle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const last = useRef(0)
  const pending = useRef<A | null>(null)
  const timer = useRef<number | null>(null)
  const latest = useRef(fn)
  latest.current = fn
  return useCallback(
    (...args: A) => {
      const now = Date.now()
      const wait = last.current + ms - now
      if (wait <= 0 && timer.current === null) {
        last.current = now
        latest.current(...args)
        return
      }
      pending.current = args
      if (timer.current === null) {
        timer.current = window.setTimeout(() => {
          timer.current = null
          last.current = Date.now()
          if (pending.current) latest.current(...pending.current)
          pending.current = null
        }, Math.max(wait, 0))
      }
    },
    [ms],
  )
}
