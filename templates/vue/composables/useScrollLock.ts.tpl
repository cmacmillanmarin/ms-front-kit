const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Space'])

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName)
}

// Containers marked data-scroll-lock-allow (modals, menus) keep scrolling until
// they reach an edge; the gesture never chains to the locked page.
function canScrollInside(target: EventTarget | null, deltaY: number): boolean {
  if (!(target instanceof Element)) return false
  const container = target.closest<HTMLElement>('[data-scroll-lock-allow]')
  if (!container) return false
  const { scrollTop, scrollHeight, clientHeight } = container
  if (deltaY < 0) return scrollTop > 0
  if (deltaY > 0) return scrollTop + clientHeight < scrollHeight - 1
  return true
}

export default function useScrollLock() {
  let locked = false
  let touchY = 0

  function onWheel(e: WheelEvent): void {
    if (!canScrollInside(e.target, e.deltaY)) e.preventDefault()
  }

  function onTouchStart(e: TouchEvent): void {
    touchY = e.touches[0]?.clientY ?? 0
  }

  function onTouchMove(e: TouchEvent): void {
    // Leave pinch zoom alone.
    if (e.touches.length > 1) return
    const y = e.touches[0]?.clientY ?? touchY
    if (!canScrollInside(e.target, touchY - y)) e.preventDefault()
    touchY = y
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!scrollKeys.has(e.code) || e.metaKey || e.ctrlKey || e.altKey) return
    if (isEditable(e.target) || canScrollInside(e.target, 0)) return
    e.preventDefault()
  }

  function create(): void {
    if (locked || typeof window === 'undefined') return
    locked = true
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('keydown', onKeyDown)
  }

  function destroy(): void {
    if (!locked) return
    locked = false
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('touchstart', onTouchStart)
    window.removeEventListener('touchmove', onTouchMove)
    window.removeEventListener('keydown', onKeyDown)
  }

  onUnmounted(destroy)

  return { create, destroy }
}
