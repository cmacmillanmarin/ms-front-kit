import type { Data, Direction, ScrollTarget, ScrollTargetOptions } from '{{storeDirectory}}/useScrollStore'

interface Child {
  el: HTMLElement
  scrollable: boolean
  continuous: boolean
  sticky: boolean
  setProgress: boolean
  setPosition: boolean
  fixedFrom: number | undefined
  fixedTo: number | undefined
  // Inside another moved child, so its transform is relative to that one.
  nested: boolean
  ownsWillChange: boolean
  top: number
  height: number
  inView: boolean
  stickyLimitTop: number
  stickyLimitBottom: number
  stickyState: boolean | undefined
  y: number
  progress: string
  scrollCurrent: string
}

const selector = '[data-scroll], [data-scroll-sticky], [data-scroll-set-progress], [data-scroll-set-position]'

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

// Shortcuts that open or step through the browser's find in page.
function isFindShortcut(e: KeyboardEvent): boolean {
  if (e.code === 'F3') return true
  return (e.code === 'KeyF' || e.code === 'KeyG') && (e.metaKey || e.ctrlKey) && !e.altKey
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : undefined
}

export default function useScrollVirtual() {
  const { addTicker, killTicker } = useRaf()
  const ease = 0.1
  const keyStep = 100
  const inViewMargin = 100

  let el: HTMLElement | undefined
  let parent: HTMLElement | undefined
  let active = false
  let running = false
  let disabled = false
  // Find in page: the browser only reaches a match by scrolling a real scroll
  // container (not clip, and not hidden either), so while searching the root
  // gets overflow-y: auto with a hidden bar, and transforms keep only the
  // effects on top of that native scroll.
  let native = false
  let baseOverflow = 'hidden'
  let target = 0
  let current = 0
  let previous = 0
  let direction: Direction = 'down'
  let bounding = 0
  // Scroll root size and position, measured with the children.
  let rootHeight = 0
  let origin = 0
  let children: Child[] = []
  let onUpdate: (data: Data) => void = () => {}
  let reducedMotion: MediaQueryList | undefined
  let touchY = 0
  let touchTime = 0
  let touchVelocity = 0

  function viewport(): number {
    return rootHeight || window.innerHeight
  }

  function clamp(value: number): number {
    return Math.max(0, Math.min(bounding, value))
  }

  function create(params: { el: HTMLElement; update: (data: Data) => void; position: number }): void {
    destroy()
    if (!params.el.parentElement) return
    el = params.el
    parent = params.el.parentElement
    onUpdate = params.update
    active = true
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    window.scrollTo({ top: 0, behavior: 'instant' })
    baseOverflow = window.CSS?.supports('overflow', 'clip') ? 'clip' : 'hidden'
    parent.style.overflow = baseOverflow
    measure()
    target = current = previous = clamp(params.position)
    render(true)
    addEventListeners()
  }

  function collect(): void {
    if (!el) return
    const known = new Map(children.map(child => [child.el, child]))
    const elements = Array.from(el.querySelectorAll<HTMLElement>(selector))
    // Without marked children, the whole content moves as one block.
    const fallback = elements.length === 0
    if (fallback) elements.push(el)
    children = elements.map(element => {
      const existing = known.get(element)
      known.delete(element)
      const child = existing ?? {
        el: element,
        scrollable: fallback || element.dataset.scroll !== undefined,
        continuous: fallback || element.dataset.scrollContinuous !== undefined,
        sticky: element.dataset.scrollSticky !== undefined,
        setProgress: element.dataset.scrollSetProgress !== undefined,
        setPosition: element.dataset.scrollSetPosition !== undefined,
        fixedFrom: undefined,
        fixedTo: undefined,
        nested: false,
        ownsWillChange: false,
        top: 0,
        height: 0,
        inView: false,
        stickyLimitTop: 0,
        stickyLimitBottom: 0,
        stickyState: undefined,
        y: Number.NaN,
        progress: '',
        scrollCurrent: '',
      }
      child.fixedFrom = optionalNumber(element.dataset.scrollFixedFrom)
      child.fixedTo = optionalNumber(element.dataset.scrollFixedTo)
      return child
    })
    for (const child of children) {
      child.nested = children.some(other => other !== child && moves(other) && other.el.contains(child.el))
    }
    // Elements that left the tree or lost their attributes are released.
    for (const child of known.values()) release(child)
  }

  function moves(child: Child): boolean {
    return child.scrollable || child.sticky || (child.fixedFrom !== undefined && child.fixedTo !== undefined)
  }

  // Only transforms written by this composable are cleared.
  function clearTransforms(): void {
    for (const child of children) if (moves(child)) child.el.style.removeProperty('transform')
  }

  function release(child: Child): void {
    if (moves(child)) child.el.style.removeProperty('transform')
    if (child.ownsWillChange) child.el.style.removeProperty('will-change')
  }

  function measure(): void {
    if (!el || !parent) return
    collect()
    // Write phase: drop our transforms so layout reflects untransformed positions.
    clearTransforms()
    // Read phase: one forced layout for every rect and computed style below.
    // The root keeps its CSS height (100svh); positions are relative to it.
    rootHeight = parent.clientHeight
    // Rects are relative to the root's own scroll, non-zero only while searching.
    origin = parent.getBoundingClientRect().top - parent.scrollTop
    bounding = Math.max(0, Math.floor(el.getBoundingClientRect().height - viewport()))
    const positions: Array<DOMRect | undefined> = []
    for (const child of children) {
      const rect = child.el.getBoundingClientRect()
      child.top = rect.top - origin
      child.height = rect.height
      positions.push(child.setPosition ? rect : undefined)
      const style = moves(child) ? window.getComputedStyle(child.el) : undefined
      if (style && style.willChange === 'auto') child.ownsWillChange = true
      if (child.sticky && style && child.el.parentElement) {
        const parentRect = child.el.parentElement.getBoundingClientRect()
        const stickyTop = Number.parseFloat(style.top) || 0
        const stickyBottom = optionalNumber(child.el.dataset.scrollStickyBottom) ?? 0
        const topGap = Math.ceil(child.top - (parentRect.top - origin))
        child.stickyLimitTop = Math.ceil(child.top - stickyTop)
        child.stickyLimitBottom = Math.ceil(Math.max(0, parentRect.height - child.height - stickyBottom - topGap))
      }
    }
    // Write phase: attributes and layer hints after all reads.
    children.forEach((child, i) => {
      if (child.ownsWillChange) child.el.style.willChange = 'transform'
      const rect = positions[i]
      if (rect) {
        child.el.dataset.positionTop = String(rect.top - origin)
        child.el.dataset.positionLeft = String(rect.left)
        child.el.dataset.positionRight = String(rect.right)
        child.el.dataset.positionBottom = String(rect.bottom - origin)
      }
      if (child.sticky) {
        child.el.dataset.scrollStickyLimitTop = String(child.stickyLimitTop)
        child.el.dataset.scrollStickyLimitBottom = String(child.stickyLimitBottom)
      }
    })
  }

  function render(force: boolean): void {
    if (current !== previous) direction = current < previous ? 'up' : 'down'
    const height = viewport()
    const position = round(current)
    let stickyOffset = 0
    for (const child of children) {
      const { top } = child
      child.inView = position + height + inViewMargin > Math.floor(top) &&
        position - inViewMargin < Math.ceil(top + child.height)
      let y = 0
      if (child.sticky) {
        y = Math.min(Math.max(0, position - child.stickyLimitTop), child.stickyLimitBottom)
        const stuck = y > 0
        if (stuck) stickyOffset += y
        if (force || child.stickyState !== stuck) {
          child.stickyState = stuck
          child.el.dataset.scrollStickyState = String(stuck)
        }
      } else if (child.fixedFrom !== undefined && child.fixedTo !== undefined) {
        y = fixedPosition(position, child.fixedFrom, child.fixedTo)
      } else if ((child.scrollable && (child.inView || native)) || child.continuous) {
        // While searching everything stays in place so any match is reachable.
        y = -position
      } else if (child.scrollable && position > top) {
        // Park off-screen content above the viewport; it is not rewritten until it returns.
        y = -Math.ceil(top + child.height)
      }
      // The native scroll already moves top-level children by the position.
      if (native && !child.nested) y += position
      if (moves(child) && (force || y !== child.y)) {
        child.y = y
        child.el.style.transform = `translate3d(0, ${y}px, 0)`
      }
      if (child.setProgress) {
        const progress = Math.max(0, Math.min((position - top + height) / (child.height + height), 1)).toFixed(2)
        const scrollCurrent = String(Math.max(0, round(position - top + height)))
        if (force || progress !== child.progress) child.el.dataset.scrollProgress = child.progress = progress
        if (force || scrollCurrent !== child.scrollCurrent) child.el.dataset.scrollCurrent = child.scrollCurrent = scrollCurrent
      }
    }
    previous = current
    onUpdate({
      current: position,
      currentVertical: round(position - stickyOffset),
      speed: round(Math.abs(target - current)),
      direction,
      bounding,
      inTarget: Math.abs(target - current) < 0.1,
    })
  }

  function fixedPosition(position: number, from: number, to: number): number {
    if (position <= from) return -position
    if (position <= to) return -from
    return -(from + position - to)
  }

  function tick(_time: number, delta: number): void {
    const factor = reducedMotion?.matches ? 1 : 1 - Math.pow(1 - ease, delta / (1000 / 60))
    current += (target - current) * factor
    const inTarget = Math.abs(target - current) < 0.1
    if (inTarget) current = target
    render(false)
    // Stop the frame loop at rest; input or scrollTo wakes it again.
    if (inTarget) {
      sleep()
      // Scrolled with the find bar still focused: be ready for its next match.
      if (!document.hasFocus()) startNative()
    }
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

  // Hand the current position to the root's native scroll for find in page.
  function startNative(): void {
    if (native || disabled || !parent) return
    sleep()
    target = current = Math.round(current)
    native = true
    render(true)
    // Scrollable before setting scrollTop: a clip box ignores it.
    parent.style.overflow = 'hidden auto'
    parent.dataset.scrollFind = ''
    parent.scrollTop = current
  }

  // Back to transforms from wherever the browser left the root.
  function stopNative(): void {
    if (!native || !parent) return
    native = false
    target = current = clamp(parent.scrollTop)
    parent.scrollTop = 0
    parent.style.overflow = baseOverflow
    delete parent.dataset.scrollFind
    render(true)
  }

  // The find bar takes focus from the page, also when opened from the menu
  // or already open. Looks the same as virtual mode, so other blurs are fine.
  function onWindowBlur(): void {
    if (!running) startNative()
  }

  function onRootScroll(): void {
    if (!parent) return
    if (!native) {
      // Focus, scrollIntoView or a text selection drag moved the root: undo it.
      if (parent.scrollTop !== 0) parent.scrollTop = 0
      return
    }
    const position = clamp(parent.scrollTop)
    if (position === current) return
    target = current = position
    render(false)
  }

  function update(): void {
    if (!active) return
    measure()
    target = clamp(target)
    current = clamp(current)
    render(true)
  }

  function reset(): void {
    if (!active) return
    stopNative()
    target = current = previous = 0
    sleep()
    measure()
    render(true)
  }

  function disable(value: boolean): void {
    if (value) stopNative()
    disabled = value
  }

  function resolve(value: ScrollTarget, options?: ScrollTargetOptions): number | undefined {
    if (typeof value === 'number') return value
    const element = typeof value === 'string'
      ? document.getElementById(decodeURIComponent(value.replace(/^#/, '')))
      : value
    if (!element) return undefined
    // Measure without our transforms, then restore them.
    clearTransforms()
    const rect = element.getBoundingClientRect()
    const top = parent ? parent.getBoundingClientRect().top - parent.scrollTop : origin
    render(true)
    const offset = Number.parseFloat(element.dataset.scrollTargetOffset || '0') || 0
    const align = options?.align === 'center' ? (viewport() - rect.height) / 2 : 0
    return rect.top - top - align - offset
  }

  function to(value: ScrollTarget, options?: ScrollTargetOptions): void {
    if (!active) return
    stopNative()
    const position = resolve(value, options)
    if (position === undefined) return
    target = clamp(position)
    if (options?.immediate || reducedMotion?.matches) {
      current = target
      render(true)
    }
    wake()
  }

  function onWheel(e: WheelEvent): void {
    // Ctrl + wheel is pinch-zoom on trackpads.
    if (disabled || e.ctrlKey) return
    e.preventDefault()
    stopNative()
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport() : 1
    target = clamp(target + e.deltaY * scale)
    wake()
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Not prevented: the browser still opens its find bar.
    if (isFindShortcut(e)) {
      startNative()
      return
    }
    if (disabled || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
    // A key reaching the page means the find bar is no longer in use.
    stopNative()
    const page = viewport() * 0.9
    switch (e.code) {
      case 'ArrowDown': target = clamp(target + keyStep); break
      case 'ArrowUp': target = clamp(target - keyStep); break
      case 'PageDown': target = clamp(target + page); break
      case 'PageUp': target = clamp(target - page); break
      case 'Home': target = 0; break
      case 'End': target = bounding; break
      case 'Space':
        // Space activates focused buttons and links.
        if (e.target instanceof HTMLElement && /^(?:BUTTON|A|SUMMARY)$/.test(e.target.tagName)) return
        target = clamp(target + page * (e.shiftKey ? -1 : 1))
        break
      default: return
    }
    e.preventDefault()
    wake()
  }

  function onFocusIn(e: FocusEvent): void {
    // Leaving find in page; overflow: hidden (Safari < 16) also lets focus
    // scroll the clipped parent.
    stopNative()
    if (parent) parent.scrollTop = 0
    const element = e.target
    if (disabled || !(element instanceof HTMLElement) || element.dataset.tabFixed !== undefined) return
    if (!element.matches(':focus-visible')) return
    const rect = element.getBoundingClientRect()
    if (rect.top - origin >= 0 && rect.bottom - origin <= viewport()) return
    to(element, { align: 'center' })
  }

  function onTouchStart(e: TouchEvent): void {
    stopNative()
    touchY = e.touches[0]?.clientY ?? 0
    touchTime = e.timeStamp
    touchVelocity = 0
  }

  function onTouchMove(e: TouchEvent): void {
    if (disabled || e.touches.length > 1) return
    e.preventDefault()
    const y = e.touches[0]?.clientY ?? touchY
    const delta = touchY - y
    touchVelocity = delta / Math.max(1, e.timeStamp - touchTime)
    touchY = y
    touchTime = e.timeStamp
    target = clamp(target + delta)
    wake()
  }

  function onTouchEnd(): void {
    if (disabled) return
    // Release momentum: project the last finger velocity forward.
    target = clamp(target + touchVelocity * 250)
    touchVelocity = 0
    wake()
  }

  function addEventListeners(): void {
    if (!el || !parent) return
    // Wheel on the root also covers overlays beside the content, like the scrollbar.
    parent.addEventListener('wheel', onWheel, { passive: false })
    parent.addEventListener('scroll', onRootScroll, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('focusin', onFocusIn)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onWindowBlur)
  }

  function removeEventListeners(): void {
    if (!el || !parent) return
    parent.removeEventListener('wheel', onWheel)
    parent.removeEventListener('scroll', onRootScroll)
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('focusin', onFocusIn)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('blur', onWindowBlur)
  }

  function destroy(): void {
    if (!active) return
    sleep()
    removeEventListeners()
    for (const child of children) release(child)
    native = false
    if (parent) {
      parent.scrollTop = 0
      delete parent.dataset.scrollFind
    }
    parent?.style.removeProperty('overflow')
    children = []
    target = current = previous = 0
    active = false
    el = parent = undefined
  }

  onBeforeUnmount(destroy)

  return { create, update, reset, destroy, disable, to }
}
