export type Direction = 'up' | 'down'
export type ScrollMode = 'auto' | 'virtual' | 'native'
export type ActiveScrollMode = Exclude<ScrollMode, 'auto'>
export type ScrollTarget = number | string | HTMLElement

export interface Data {
  current: number
  currentVertical: number
  speed: number
  direction: Direction
  bounding: number
  inTarget: boolean
}

export interface ScrollTargetOptions {
  // Jump without easing.
  immediate?: boolean
  // Element targets align to the viewport start by default.
  align?: 'start' | 'center'
}

export interface ScrollController {
  to(target: ScrollTarget, options?: ScrollTargetOptions): void
  update(): void
  reset(): void
}
