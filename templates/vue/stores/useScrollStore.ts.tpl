import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'

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

export type RenderCallback = (data: Data) => void

export default defineStore('scroll', () => {
  const mode = ref<ScrollMode>('auto')
  const activeMode = ref<ActiveScrollMode>()
  const disabled = ref<boolean>(false)
  // Replaced once per animated frame; shallow to avoid deep reactive conversion.
  const data = shallowRef<Data>({
    current: 0,
    currentVertical: 0,
    speed: 0,
    direction: 'down',
    bounding: 0,
    inTarget: true,
  })
  const isVirtual = computed<boolean>(() => activeMode.value === 'virtual')

  // Not state: never serialized, proxied, or exposed reactively.
  let controller: ScrollController | undefined
  const renderCallbacks = new Set<RenderCallback>()

  function setMode(value: ScrollMode): void {
    mode.value = value
  }

  function setActiveMode(value: ActiveScrollMode | undefined): void {
    activeMode.value = value
  }

  function disable(value: boolean = true): void {
    disabled.value = value
  }

  function setData(value: Data): void {
    // Per-frame work (WebGL, DOM writes) runs before reactive consumers.
    for (const callback of renderCallbacks) callback(value)
    data.value = value
  }

  function addRenderCallback(callback: RenderCallback): () => void {
    renderCallbacks.add(callback)
    return () => removeRenderCallback(callback)
  }

  function removeRenderCallback(callback: RenderCallback): void {
    renderCallbacks.delete(callback)
  }

  function register(value: ScrollController): () => void {
    controller = value
    return () => {
      if (controller === value) controller = undefined
    }
  }

  function scrollTo(target: ScrollTarget, options?: ScrollTargetOptions): void {
    controller?.to(target, options)
  }

  function update(): void {
    controller?.update()
  }

  function reset(): void {
    controller?.reset()
  }

  return {
    mode,
    activeMode,
    disabled,
    data,
    isVirtual,
    setMode,
    setActiveMode,
    disable,
    setData,
    addRenderCallback,
    removeRenderCallback,
    register,
    scrollTo,
    update,
    reset,
  }
})
