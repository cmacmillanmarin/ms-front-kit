<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from "vue";
import type { ScrollMode } from "{{typesDirectory}}/store/useScrollStore";
import useScroll from "{{composablesDirectory}}/useScroll";
import useScrollBar from "{{composablesDirectory}}/useScrollBar";
import useScrollStore from "{{storeDirectory}}/useScrollStore";

// auto: native scroll on touch devices with a mobile layout, virtual otherwise.
// scrollbar: overlay scrollbar in virtual mode; native mode keeps the browser's.
// scrollbarLabel: accessible name of the overlay scrollbar.
// contentLabel: accessible name of the scroll region in native mode.
const {
  mode = "auto",
  scrollbar = true,
  scrollbarLabel = "Page scroll",
  contentLabel = "Page content",
} = defineProps<{ mode?: ScrollMode; scrollbar?: boolean; scrollbarLabel?: string; contentLabel?: string }>();

const contentId = useId();
const content = ref<HTMLElement>();
const track = ref<HTMLElement>();
const thumb = ref<HTMLElement>();
const store = useScrollStore();
const scroll = useScroll();
const bar = useScrollBar();

// In native mode the root is the scroll container, so it must be reachable
// by keyboard in browsers that don't focus scroll containers (Safari).
// Virtual mode handles scroll keys globally and needs no tab stop.
const isNative = computed<boolean>(() => store.activeMode === "native");

watch(() => mode, value => store.setMode(value), { immediate: true });

watch([track, thumb], ([trackEl, thumbEl]) => {
  if (trackEl && thumbEl) bar.create({ track: trackEl, thumb: thumbEl });
  else bar.destroy();
}, { flush: "post" });

onMounted(() => {
  if (content.value) scroll.init({ el: content.value });
});
</script>

<template>
  <div
    class="scroll"
    :tabindex="isNative ? 0 : undefined"
    :role="isNative ? 'region' : undefined"
    :aria-label="isNative ? contentLabel : undefined"
  >
    <div :id="contentId" ref="content" class="scroll__content">
      <slot />
    </div>
    <!-- Focusable for keyboard users: the global scroll keys move it, and
    useScrollBar keeps aria-valuenow in sync as a percentage. -->
    <div
      v-if="scrollbar && store.isVirtual && !store.disabled"
      ref="track"
      class="scroll__bar"
      role="scrollbar"
      tabindex="0"
      aria-orientation="vertical"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-controls="contentId"
      :aria-label="scrollbarLabel"
    >
      <div ref="thumb" class="scroll__thumb" />
    </div>
  </div>
</template>

<style lang="scss">
// The root is the only scroll container: with a fixed viewport height the
// document never scrolls, so mobile browser toolbars stay put. Virtual mode
// replaces the overflow with clip while it runs. --vh comes from the kit's
// base/_tokens.scss (add styles); 100svh is the fallback without it.
.scroll {
  position: relative;
  width: 100%;
  height: var(--vh, 100svh);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;

  // Virtual mode scrolls the root natively during find in page; its native
  // bar stays hidden so nothing changes visually.
  &[data-scroll-find] {
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  // Native mode focus target. It fills the viewport, so the ring is inset to
  // stay visible. The tokens come from the kit's base/_tokens.scss (add styles);
  // the fallbacks keep the ring working without them.
  &:focus-visible {
    outline: var(--focus-size, 2px) solid var(--color-focus, currentcolor);
    outline-offset: calc(var(--focus-size, 2px) * -1);
  }
}

// macOS-style overlay bar: hidden at rest, shown while scrolling, wider with a
// track while hovered or held. Sizes stay in px like native bars. It draws over
// the content and is removed while scrolling is disabled (modals).
// Colors: useScrollBar sets data-background from the background behind the
// thumb (light thumb over dark ones). When it cannot be read (images, video,
// non-sRGB colors), light-dark() follows the page's color-scheme, and the
// thumb's contrasting edge keeps it visible on any content.
.scroll__bar {
  --scroll-thumb: rgb(0 0 0 / 50%);
  --scroll-thumb-edge: rgb(255 255 255 / 50%);
  --scroll-track: rgb(250 250 250 / 90%);
  --scroll-track-border: rgb(0 0 0 / 8%);

  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
  box-sizing: border-box;
  width: 16px;
  padding: 2px;
  border-left: 1px solid transparent;
  opacity: 0;
  touch-action: none;
  user-select: none;
  transition: opacity 0.3s, background-color 0.15s, border-color 0.15s;

  @supports (color: light-dark(#000, #fff)) {
    &:not([data-background]) {
      --scroll-thumb: light-dark(rgb(0 0 0 / 50%), rgb(255 255 255 / 50%));
      --scroll-thumb-edge: light-dark(rgb(255 255 255 / 50%), rgb(0 0 0 / 30%));
      --scroll-track: light-dark(rgb(250 250 250 / 90%), rgb(40 40 40 / 90%));
      --scroll-track-border: light-dark(rgb(0 0 0 / 8%), rgb(255 255 255 / 10%));
    }
  }

  &[data-background="dark"] {
    --scroll-thumb: rgb(255 255 255 / 50%);
    --scroll-thumb-edge: rgb(0 0 0 / 30%);
    --scroll-track: rgb(40 40 40 / 90%);
    --scroll-track-border: rgb(255 255 255 / 10%);
  }

  &[data-overflow="false"] {
    display: none;
  }

  &[data-visible],
  &[data-active],
  &:hover,
  &:focus-visible {
    opacity: 1;
    transition-duration: 0.1s;
  }

  &[data-active],
  &:hover,
  &:focus-visible {
    border-color: var(--scroll-track-border);
    background-color: var(--scroll-track);
  }

  // Inset: the bar touches the Scroll's clipped edges, so an outer offset would
  // only show on the left.
  &:focus-visible {
    outline: var(--focus-size, 2px) solid var(--color-focus, currentcolor);
    outline-offset: calc(var(--focus-size, 2px) * -1);
  }
}

.scroll__thumb {
  // Moved every scroll frame; translate3d alone is not promoted in Chrome.
  will-change: transform;
  flex-shrink: 0;
  width: 7px;
  border-radius: 6px;
  background-color: var(--scroll-thumb);
  box-shadow: 0 0 0 1px var(--scroll-thumb-edge);
  transition: width 0.15s, background-color 0.15s, box-shadow 0.15s;

  .scroll__bar[data-active] &,
  .scroll__bar:hover &,
  .scroll__bar:focus-visible & {
    width: 11px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .scroll__bar,
  .scroll__thumb {
    transition: none;
  }
}
</style>
