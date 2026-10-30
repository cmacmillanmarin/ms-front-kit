export type Ticker = (time: number, delta: number) => void

function createRafState() {
  const tickers = new Set<Ticker>()
  let frame: number | undefined
  let last = 0

  function loop(time: number): void {
    // Clamp long gaps (background tabs, breakpoints) so time-based easing doesn't jump.
    const delta = last ? Math.min(time - last, 100) : 1000 / 60
    last = time
    // Set iteration tolerates tickers removing themselves during the frame.
    for (const ticker of tickers) ticker(time, delta)
    if (tickers.size) frame = requestAnimationFrame(loop)
    else {
      frame = undefined
      last = 0
    }
  }

  function add(ticker: Ticker): void {
    tickers.add(ticker)
    if (frame === undefined && typeof window !== 'undefined') frame = requestAnimationFrame(loop)
  }

  function remove(ticker: Ticker): void {
    tickers.delete(ticker)
    if (tickers.size || frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
    last = 0
  }

  return { add, remove }
}

// One requestAnimationFrame loop for every consumer; it stops while nothing is registered.
let clientRafState: ReturnType<typeof createRafState> | undefined

export default function useRaf() {
  const state = typeof window === 'undefined'
    ? createRafState()
    : (clientRafState ??= createRafState())
  const owned = new Set<Ticker>()

  function addTicker(ticker: Ticker): void {
    owned.add(ticker)
    state.add(ticker)
  }

  function killTicker(ticker: Ticker): void {
    owned.delete(ticker)
    state.remove(ticker)
  }

  onUnmounted(() => {
    for (const ticker of owned) state.remove(ticker)
    owned.clear()
  })

  return { addTicker, killTicker }
}
