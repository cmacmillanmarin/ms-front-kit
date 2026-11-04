// GSAP's signature: time in seconds, delta in ms. Long gaps are smoothed by
// GSAP's lagSmoothing (over 500ms counts as 33ms).
export type Ticker = (time: number, delta: number, frame: number) => void

export interface TickerOptions {
  // Run before every other ticker and GSAP's own tweens. The scroll uses it so
  // anything after it in the frame reads the fresh position.
  priority?: boolean
}
