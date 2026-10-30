import type { Data, Direction, ScrollTarget, ScrollTargetOptions } from '{{storeDirectory}}/useScrollStore'

interface Child {
  el: HTMLElement
  top: number
  height: number
  setProgress: boolean
  progress: string
  scrollCurrent: string
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export default function useScrollNative() {
  const { addTicker, killTicker } = useRaf()
  const ease = 0.175

  let el: HTMLElement | undefined
  // The Scroll root is the scroll container; the window never scrolls.
  let scroller: HTMLElement | undefined
  let active = false
  let running = false
  let target = 0
  let current = 0
  let direction: Direction = 'down'
  let bounding = 0
  let viewport = 0
  let children: Child[] = []
  let onUpdate: (data: Data) => void = () => {}
  let reducedMotion: MediaQueryList | undefined

  function create(params: { el: HTMLElement; update: (data: Data) => void; position: number }): void {
    destroy()
    if (!params.el.parentElement) return
    el = params.el
    scroller = params.el.parentElement
    onUpdate = params.update
    active = true
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    scroller.scrollTo({ top: params.position, behavior: 'instant' })
    target = current = scroller.scrollTop
    update()
    scroller.addEventListener('scroll', onScroll, { passive: true })
  }

  function update(): void {
    if (!active || !el || !scroller) return
    // Read every rect first, then write, so measuring forces a single layout.
    viewport = scroller.clientHeight
    bounding = Math.max(0, scroller.scrollHeight - viewport)
    // Positions are relative to the top of the scrolled content.
    const scrollY = scroller.scrollTop - scroller.getBoundingClientRect().top
    const elements = Array.from(el.querySelectorAll<HTMLElement>('[data-scroll-set-progress], [data-scroll-set-position]'))
    const rects = elements.map(element => element.getBoundingClientRect())
    children = elements.map((element, i) => {
      const { top, left, right, bottom, height } = rects[i]
      if (element.dataset.scrollSetPosition !== undefined) {
        element.dataset.positionTop = String(top + scrollY)
        element.dataset.positionLeft = String(left)
        element.dataset.positionRight = String(right)
        element.dataset.positionBottom = String(bottom + scrollY)
      }
      return {
        el: element,
        top: top + scrollY,
        height,
        setProgress: element.dataset.scrollSetProgress !== undefined,
        progress: '',
        scrollCurrent: '',
      }
    })
    render(true)
  }

  function onScroll(): void {
    if (!scroller) return
    const next = scroller.scrollTop
    if (next !== target) direction = next < target ? 'up' : 'down'
    target = next
    wake()
  }

  function tick(_time: number, delta: number): void {
    const factor = reducedMotion?.matches ? 1 : 1 - Math.pow(1 - ease, delta / (1000 / 60))
    current += (target - current) * factor
    const inTarget = Math.abs(target - current) < 0.1
    if (inTarget) current = target
    render(false)
    if (inTarget) sleep()
  }

  function render(force: boolean): void {
    const position = round(current)
    for (const child of children) {
      if (!child.setProgress) continue
      const progress = Math.max(0, Math.min((position - child.top + viewport) / (child.height + viewport), 1)).toFixed(2)
      const scrollCurrent = String(Math.max(0, round(position - child.top + viewport)))
      // Attribute writes can restyle the page; only write values that changed.
      if (force || progress !== child.progress) child.el.dataset.scrollProgress = child.progress = progress
      if (force || scrollCurrent !== child.scrollCurrent) child.el.dataset.scrollCurrent = child.scrollCurrent = scrollCurrent
    }
    onUpdate({
      current: position,
      currentVertical: position,
      speed: round(Math.abs(target - current)),
      direction,
      bounding,
      inTarget: Math.abs(target - current) < 0.1,
    })
  }

  function wake(): void {
    if (running || !active) return
    running = true
    addTicker(tick)
  }

  function sleep(): void {
    if (!running) return
    running = false
    killTicker(tick)
  }

  function resolve(value: ScrollTarget, options?: ScrollTargetOptions): number | undefined {
    if (typeof value === 'number') return value
    const element = typeof value === 'string'
      ? document.getElementById(decodeURIComponent(value.replace(/^#/, '')))
      : value
    if (!element || !scroller) return undefined
    const rect = element.getBoundingClientRect()
    const offset = Number.parseFloat(element.dataset.scrollTargetOffset || '0') || 0
    const align = options?.align === 'center' ? (scroller.clientHeight - rect.height) / 2 : 0
    return rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop - align - offset
  }

  function to(value: ScrollTarget, options?: ScrollTargetOptions): void {
    if (!active) return
    const top = resolve(value, options)
    if (top === undefined) return
    const immediate = options?.immediate || reducedMotion?.matches
    scroller?.scrollTo({ top: Math.max(0, Math.min(top, bounding)), behavior: immediate ? 'instant' : 'smooth' })
  }

  function reset(): void {
    if (!active) return
    scroller?.scrollTo({ top: 0, behavior: 'instant' })
    target = current = 0
    update()
  }

  function destroy(): void {
    if (!active) return
    sleep()
    scroller?.removeEventListener('scroll', onScroll)
    children = []
    active = false
    el = scroller = undefined
  }

  onBeforeUnmount(destroy)

  return { create, update, to, reset, destroy }
}
