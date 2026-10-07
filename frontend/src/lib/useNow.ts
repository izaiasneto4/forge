import { useSyncExternalStore } from 'react'

function createClock(intervalMs: number) {
  let now = Date.now()
  let timer: number | null = null
  const listeners = new Set<() => void>()

  return {
    subscribe(onChange: () => void) {
      listeners.add(onChange)
      if (timer === null) {
        now = Date.now()
        timer = window.setInterval(() => {
          now = Date.now()
          listeners.forEach((listener) => listener())
        }, intervalMs)
      }

      return () => {
        listeners.delete(onChange)
        if (listeners.size === 0 && timer !== null) {
          window.clearInterval(timer)
          timer = null
        }
      }
    },
    getSnapshot() {
      return now
    },
  }
}

const clocks = new Map<number, ReturnType<typeof createClock>>()

function clockFor(intervalMs: number) {
  const existing = clocks.get(intervalMs)
  if (existing) return existing
  const clock = createClock(intervalMs)
  clocks.set(intervalMs, clock)
  return clock
}

export function useNow(intervalMs = 1000) {
  const clock = clockFor(intervalMs)
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot)
}
