import useScrollStore, { type Data } from '{{storeDirectory}}/useScrollStore'

// Overlay scrollbar for virtual mode, modeled on macOS: the thumb tracks the
// viewport, can be dragged, track clicks page toward the pointer (held clicks
// repeat until the thumb reaches it), and Option/Alt-click jumps to the spot.
const minThumb = 32
const idleDelay = 1000
const repeatDelay = 300
const repeatInterval = 60
// Same page step as the virtual keyboard handling.
const pageRatio = 0.9
const sampleInterval = 200

// Tone of the first mostly opaque sRGB background from the element up. Other
// color formats and fully transparent trees are unknown, leaving CSS defaults.
function backgroundTone(element: Element | null): 'dark' | 'light' | undefined {
  for (; element; element = element.parentElement) {
    const match = /^rgba?\(([^)]+)\)$/.exec(window.getComputedStyle(element).backgroundColor)
    if (!match?.[1]) return undefined
    const [r = 0, g = 0, b = 0, a = 1] = match[1].split(/[\s,/]+/).map(Number)
    if (a < 0.5) continue
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5 ? 'dark' : 'light'
  }
  return undefined
}

export default function useScrollBar() {
  const store = useScrollStore()

  let track: HTMLElement | undefined
  let thumb: HTMLElement | undefined
  let removeRender: (() => void) | undefined
  let observer: ResizeObserver | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let repeatTimer: ReturnType<typeof setTimeout> | undefined
  let viewport = 0
  let insetTop = 0
  let size = 0
  let travel = 0
  let bounding = 0
  let current = 0
  // Latest page target while easing toward it, so repeated pages accumulate.
  let goal: number | undefined
  // Pointer distance from the thumb start while dragging.
  let grab: number | undefined
  let pointerY = 0
  let sampled = 0

  function clamp(value: number): number {
    return Math.max(0, Math.min(bounding, value))
  }

  function measure(): void {
    if (!track) return
    const style = window.getComputedStyle(track)
    viewport = track.clientHeight
    insetTop = Number.parseFloat(style.paddingTop) || 0
    const length = Math.max(0, viewport - insetTop - (Number.parseFloat(style.paddingBottom) || 0))
    size = bounding > 0 ? Math.min(length, Math.max(minThumb, length * viewport / (viewport + bounding))) : 0
    travel = length - size
    track.dataset.overflow = String(bounding > 0)
    if (thumb) thumb.style.height = `${size}px`
    position()
  }

  function position(): void {
    if (!thumb) return
    const y = bounding > 0 ? current / bounding * travel : 0
    thumb.style.transform = `translate3d(0, ${y}px, 0)`
  }

  function onRender(data: Data): void {
    const moved = data.current !== current
    current = data.current
    if (data.inTarget) goal = undefined
    if (data.bounding !== bounding) {
      bounding = data.bounding
      measure()
    } else if (moved) {
      position()
    }
    if (moved) show()
  }

  // Like macOS, use a light thumb over dark backgrounds. Sampled behind the
  // thumb when the bar appears and throttled while scrolling, never per frame.
  function sample(force = false): void {
    if (!track || !thumb || typeof document === 'undefined' || !document.elementsFromPoint) return
    const now = performance.now()
    if (!force && now - sampled < sampleInterval) return
    sampled = now
    const rect = thumb.getBoundingClientRect()
    const owner = track
    const behind = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      .find(element => !owner.contains(element))
    const tone = backgroundTone(behind ?? null)
    if (tone) track.dataset.background = tone
    else delete track.dataset.background
  }

  // Visible while scrolling, then fades after a short idle; CSS keeps it
  // visible while hovered or held.
  function show(): void {
    if (!track) return
    sample(track.dataset.visible === undefined)
    track.dataset.visible = ''
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      hideTimer = undefined
      if (track) delete track.dataset.visible
    }, idleDelay)
  }

  // Pointer position along the thumb's travel, in px.
  function local(clientY: number): number {
    return track ? clientY - track.getBoundingClientRect().top - insetTop : 0
  }

  function drag(clientY: number): void {
    if (grab === undefined || travel <= 0) return
    const y = Math.max(0, Math.min(travel, local(clientY) - grab))
    store.scrollTo(y / travel * bounding, { immediate: true })
  }

  function page(): boolean {
    const base = goal ?? current
    const start = base / bounding * travel
    const y = local(pointerY)
    // Stop once the thumb (at its eased destination) reaches the pointer.
    if (y >= start && y <= start + size) return false
    goal = clamp(base + (y < start ? -1 : 1) * viewport * pageRatio)
    store.scrollTo(goal)
    return goal !== base
  }

  function repeat(): void {
    repeatTimer = page() ? setTimeout(repeat, repeatInterval) : undefined
  }

  function onPointerDown(e: PointerEvent): void {
    if (!track || !thumb || e.button !== 0 || bounding <= 0) return
    // No text selection or focus change, as with native bars.
    e.preventDefault()
    track.setPointerCapture(e.pointerId)
    track.dataset.active = ''
    pointerY = e.clientY
    goal = undefined
    if (e.target instanceof Node && thumb.contains(e.target)) {
      grab = local(e.clientY) - current / bounding * travel
    } else if (e.altKey) {
      grab = size / 2
      drag(e.clientY)
    } else if (page()) {
      repeatTimer = setTimeout(repeat, repeatDelay)
    }
    show()
  }

  function onPointerMove(e: PointerEvent): void {
    pointerY = e.clientY
    drag(e.clientY)
  }

  function onPointerUp(): void {
    grab = undefined
    clearTimeout(repeatTimer)
    repeatTimer = undefined
    if (track) delete track.dataset.active
    show()
  }

  function onPointerEnter(): void {
    sample(true)
  }

  function create(params: { track: HTMLElement; thumb: HTMLElement }): void {
    destroy()
    track = params.track
    thumb = params.thumb
    current = store.data.current
    bounding = store.data.bounding
    measure()
    removeRender = store.addRenderCallback(onRender)
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      observer.observe(track)
    }
    track.addEventListener('pointerdown', onPointerDown)
    track.addEventListener('pointermove', onPointerMove)
    track.addEventListener('pointerup', onPointerUp)
    track.addEventListener('pointercancel', onPointerUp)
    // Leaving the bar keeps it visible for the idle delay before fading.
    track.addEventListener('pointerleave', show)
    track.addEventListener('pointerenter', onPointerEnter)
  }

  function destroy(): void {
    if (!track) return
    removeRender?.()
    removeRender = undefined
    observer?.disconnect()
    observer = undefined
    clearTimeout(hideTimer)
    clearTimeout(repeatTimer)
    hideTimer = repeatTimer = goal = grab = undefined
    track.removeEventListener('pointerdown', onPointerDown)
    track.removeEventListener('pointermove', onPointerMove)
    track.removeEventListener('pointerup', onPointerUp)
    track.removeEventListener('pointercancel', onPointerUp)
    track.removeEventListener('pointerleave', show)
    track.removeEventListener('pointerenter', onPointerEnter)
    track = thumb = undefined
  }

  onBeforeUnmount(destroy)

  return { create, destroy }
}
