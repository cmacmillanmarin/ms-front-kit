function createResizeState() {
  const onResize = ref<boolean>(false)
  const vr = ref<number>(0)
  const vw = ref<number>(0)
  const lvw = ref<number>(0)
  const vh = ref<number>(0)
  const svh = ref<number>(0)
  const debounceMs = 200

  let consumers = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  let visualViewport: VisualViewport | null = null

  function maxLayoutWidth(): number {
    const raw = window.getComputedStyle(document.documentElement)
      .getPropertyValue('--layout-max-width').trim()
    if (!raw) return window.innerWidth

    // Fast path for pixel values; don't misinterpret rem/calc values as pixels.
    if (/^\d*\.?\d+px$/.test(raw)) {
      const pixels = Number.parseFloat(raw)
      return pixels > 0 ? pixels : window.innerWidth
    }
    // Resolve other CSS lengths through layout, keeping the measurement hidden.
    // Percentages/auto are not absolute maximum widths and use the fallback.
    if (raw.includes('%') || !window.CSS?.supports('width', raw) || raw === 'auto') {
      return window.innerWidth
    }
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;min-width:0;max-width:none;height:0;padding:0;border:0;box-sizing:border-box;'
    probe.style.width = raw
    document.documentElement.appendChild(probe)
    try {
      const pixels = probe.getBoundingClientRect().width
      return Number.isFinite(pixels) && pixels > 0 ? pixels : window.innerWidth
    } finally {
      probe.remove()
    }
  }

  function updateSize(): boolean {
    const width = window.innerWidth
    const height = window.innerHeight
    const layoutWidth = Math.min(width, maxLayoutWidth())
    const changed = vw.value !== width || vh.value !== height || lvw.value !== layoutWidth
    if (vw.value !== width) svh.value = height
    vw.value = width
    vh.value = height
    lvw.value = layoutWidth
    vr.value = height > 0 ? width / height : 0
    return changed
  }

  function onResizeHandler(): void {
    if (!updateSize()) return
    if (timeout !== undefined) clearTimeout(timeout)
    timeout = setTimeout(() => {
      timeout = undefined
      onResize.value = !onResize.value
    }, debounceMs)
  }

  function start(): void {
    consumers += 1
    if (consumers !== 1) return
    updateSize()
    visualViewport = window.visualViewport
    window.addEventListener('resize', onResizeHandler)
    visualViewport?.addEventListener('resize', onResizeHandler)
  }

  function stop(): void {
    if (consumers === 0) return
    consumers -= 1
    if (consumers !== 0) return
    window.removeEventListener('resize', onResizeHandler)
    visualViewport?.removeEventListener('resize', onResizeHandler)
    visualViewport = null
    if (timeout !== undefined) clearTimeout(timeout)
    timeout = undefined
  }

  return { values: { vr, vw, lvw, vh, svh, onResize }, start, stop }
}

// Client-only sharing avoids cross-request mutable state during SSR.
let clientResizeState: ReturnType<typeof createResizeState> | undefined

export default function useResize() {
  const state = typeof window === 'undefined'
    ? createResizeState()
    : (clientResizeState ??= createResizeState())
  let mounted = false

  onMounted(() => {
    if (typeof window === 'undefined') return
    mounted = true
    state.start()
  })
  onUnmounted(() => {
    if (mounted) state.stop()
    mounted = false
  })

  return state.values
}
