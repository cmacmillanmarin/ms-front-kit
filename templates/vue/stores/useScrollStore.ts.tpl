import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { ActiveScrollMode, Data, ScrollController, ScrollMode, ScrollTarget, ScrollTargetOptions } from '{{typesDirectory}}/store/useScrollStore'

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
    data.value = value
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
    register,
    scrollTo,
    update,
    reset,
  }
})
