import { storeToRefs } from 'pinia'
import useScrollStore, { type ActiveScrollMode, type Data } from '{{storeDirectory}}/useScrollStore'

export default function useScroll() {
  // Without a router (plain Vue), route syncing is skipped.
  const route = useRoute() as ReturnType<typeof useRoute> | undefined
  const { touch } = useDevice()
  const { onResize } = useResize()
  const lock = useScrollLock()
  const virtualScroll = useScrollVirtual()
  const nativeScroll = useScrollNative()

  const store = useScrollStore()
  const { mode, disabled, activeMode } = storeToRefs(store)

  let el: HTMLElement | undefined
  let unregister: (() => void) | undefined
  let observer: ResizeObserver | undefined
  let frame: number | undefined

  function engine() {
    return activeMode.value === 'virtual' ? virtualScroll : nativeScroll
  }

  function start(): void {
    if (!el) return
    const next: ActiveScrollMode = mode.value === 'virtual' || (mode.value === 'auto' && !touch.value) ? 'virtual' : 'native'
    if (activeMode.value === next) return
    const position = store.data.current
    virtualScroll.destroy()
    nativeScroll.destroy()
    store.setActiveMode(next)
    el.dataset.scrollMode = next
    if (next === 'virtual') {
      virtualScroll.create({ el, update: onScroll, position })
      virtualScroll.disable(disabled.value)
    } else {
      nativeScroll.create({ el, update: onScroll, position })
    }
  }

  function onScroll(data: Data): void {
    store.setData(data)
  }

  function update(): void {
    engine().update()
  }

  function reset(): void {
    engine().reset()
  }

  // Coalesce bursts of size changes (images, fonts, lazy content) into one measurement.
  function requestUpdate(): void {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      update()
    })
  }

  function init(params: { el: HTMLElement }): void {
    destroy()
    el = params.el
    unregister = store.register({
      to: (target, options) => engine().to(target, options),
      update,
      reset,
    })
    start()
    if (disabled.value) lock.create()
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(requestUpdate)
      observer.observe(el)
    }
    if (route?.hash) store.scrollTo(route.hash, { immediate: true })
  }

  function destroy(): void {
    observer?.disconnect()
    observer = undefined
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    unregister?.()
    unregister = undefined
    virtualScroll.destroy()
    nativeScroll.destroy()
    lock.destroy()
    if (el) delete el.dataset.scrollMode
    el = undefined
    store.setActiveMode(undefined)
  }

  watch([mode, touch], start)

  watch(disabled, value => {
    if (!el) return
    virtualScroll.disable(value)
    if (value) lock.create()
    else lock.destroy()
  })

  watch(onResize, async () => {
    await nextTick()
    if (el) update()
  })

  // New pages start at the top. With page transitions, call the store's
  // reset() or update() once the new page has entered.
  watch(() => route?.path, async () => {
    await nextTick()
    if (el) reset()
  })

  // The window never scrolls, so the router's scrollBehavior cannot handle anchors.
  watch(() => route?.hash, async hash => {
    await nextTick()
    if (el && hash) store.scrollTo(hash)
  })

  onBeforeUnmount(destroy)

  return { init, update, reset, destroy }
}
