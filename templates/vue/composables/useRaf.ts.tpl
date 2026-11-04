import type { Ticker, TickerOptions } from '{{typesDirectory}}/composables/useRaf'
import { gsap } from 'gsap'

// GSAP's ticker is the one requestAnimationFrame loop shared by every consumer
// and by GSAP tweens, so the site never runs two loops. It sleeps on its own
// while nothing is registered.
export default function useRaf() {
  const owned = new Set<Ticker>()

  function addTicker(ticker: Ticker, options?: TickerOptions): void {
    // Server renders have no frames, and the ticker is shared across requests.
    if (typeof window === 'undefined') return
    owned.add(ticker)
    if (!options?.priority) {
      gsap.ticker.add(ticker)
      return
    }
    // Prioritizing unshifts the listener, which would make GSAP's loop run the
    // current listener twice if added mid-frame (e.g. scrollTo from a tween).
    // Deferred until the frame's listeners are done; skipped if killed meanwhile.
    queueMicrotask(() => {
      if (owned.has(ticker)) gsap.ticker.add(ticker, false, true)
    })
  }

  function killTicker(ticker: Ticker): void {
    owned.delete(ticker)
    gsap.ticker.remove(ticker)
  }

  onUnmounted(() => {
    for (const ticker of owned) gsap.ticker.remove(ticker)
    owned.clear()
  })

  return { addTicker, killTicker }
}
