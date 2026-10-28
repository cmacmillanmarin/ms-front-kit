export default function useDevice() {
  const { onResize } = useResize()
  const dpr = ref<number>(1)
  const touch = ref<boolean>(false)
  const coarsePointer = ref<boolean>(false)
  const canHover = ref<boolean>(false)
  const safari = ref<boolean>(false)
  const breakpoint = ref<string>('')
  const isDesktop = ref<boolean>(false)
  const isTablet = ref<boolean>(false)
  const isTabletPortrait = ref<boolean>(false)
  const isTabletLandscape = ref<boolean>(false)
  const isMobile = ref<boolean>(false)
  const isMobileLayout = computed<boolean>(() => isMobile.value || isTabletPortrait.value)
  const inAppBrowser = ref<boolean>(false)
  const isPhoneOrTablet = ref<boolean>(false)
  const hasWheelEvent = ref<boolean>(false)

  let mounted = false
  let resolution: MediaQueryList | undefined
  const cleanups: Array<() => void> = []

  function update(): void {
    if (!mounted || typeof window === 'undefined') return
    const userAgent = navigator.userAgent
    const vendor = navigator.vendor || ''
    // Compatibility hints only; use capability checks for feature decisions.
    safari.value = /Apple/i.test(vendor) && /Safari/i.test(userAgent) &&
      !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/i.test(userAgent)
    inAppBrowser.value = /FBAN|FBAV|Instagram|LinkedInApp|Messenger|TikTok|Twitter/i.test(userAgent)
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
    isPhoneOrTablet.value = uaData?.mobile === true ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    hasWheelEvent.value = 'onwheel' in document

    const style = window.getComputedStyle(document.body, '::after')
    breakpoint.value = style.getPropertyValue('content').trim().replace(/^["']|["']$/g, '')
    const label = breakpoint.value
    isMobile.value = label === 'mobile'
    isTabletPortrait.value = label === 'tablet'
    isTabletLandscape.value = label === 'tablet--landscape'
    isTablet.value = isTabletPortrait.value || isTabletLandscape.value
    isDesktop.value = /^desktop(?:--(?:medium|large|x-large))?$/.test(label)

    coarsePointer.value = window.matchMedia('(pointer: coarse)').matches
    canHover.value = window.matchMedia('(hover: hover)').matches
    // Touch is a capability hint, not a device category. A coarse pointer alone
    // is not proof of a touchscreen; prefer maxTouchPoints when available.
    touch.value = navigator.maxTouchPoints > 0 || 'ontouchstart' in window
    const ratio = window.devicePixelRatio
    dpr.value = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  }

  function watchResolution(): void {
    resolution?.removeEventListener('change', onResolutionChange)
    resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    resolution.addEventListener('change', onResolutionChange)
  }

  function onResolutionChange(): void {
    update()
    if (mounted) watchResolution()
  }

  const stopResizeWatch = watch(onResize, update)

  onMounted(() => {
    if (typeof window === 'undefined') return
    mounted = true
    update()
    for (const query of ['(pointer: coarse)', '(any-pointer: coarse)', '(hover: hover)', '(any-hover: hover)']) {
      const media = window.matchMedia(query)
      media.addEventListener('change', update)
      cleanups.push(() => media.removeEventListener('change', update))
    }
    // Also refresh touch/DPR hints on focus and display changes without resizing.
    window.addEventListener('focus', update)
    cleanups.push(() => window.removeEventListener('focus', update))
    watchResolution()
  })

  onUnmounted(() => {
    mounted = false
    stopResizeWatch()
    resolution?.removeEventListener('change', onResolutionChange)
    resolution = undefined
    for (const cleanup of cleanups.splice(0)) cleanup()
  })

  function imageSupport(source: string): Promise<boolean> {
    if (typeof window === 'undefined' || typeof Image === 'undefined') return Promise.resolve(false)
    return new Promise(resolve => {
      const image = new Image()
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (supported: boolean) => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        image.onload = null
        image.onerror = null
        resolve(supported)
      }
      image.onload = () => finish(image.width === 1)
      image.onerror = () => finish(false)
      timer = setTimeout(() => finish(false), 3000)
      image.src = source
    })
  }

  function webpSupport(): Promise<boolean> {
    return imageSupport('data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=')
  }

  function avifSupport(): Promise<boolean> {
    return imageSupport('data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZgAAAPBtZXRhAAAAAAAAAChoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAbGliYXZpZgAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAEUAAAAFQAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABoaXBycAAAAElpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAOcGl4aQAAAAABCAAAAAxhdjFDgQAcAAAAABNjb2xybmNseAABAAEAAQAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAAB1tZGF0EgAKBxgADlgICAkyCB/xgAAghQm0')
  }

  return {
    touch,
    coarsePointer,
    canHover,
    safari,
    hasWheelEvent,
    inAppBrowser,
    isPhoneOrTablet,
    isMobile,
    isDesktop,
    isTablet,
    isTabletPortrait,
    isTabletLandscape,
    isMobileLayout,
    breakpoint,
    dpr,
    webpSupport,
    avifSupport,
  }
}
