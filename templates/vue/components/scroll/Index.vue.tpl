<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import useScroll from "{{composablesDirectory}}/useScroll";
import useScrollBar from "{{composablesDirectory}}/useScrollBar";
import useScrollStore, { type ScrollMode } from "{{storeDirectory}}/useScrollStore";

// auto: virtual scroll without touch support, native scroll with it.
// scrollbar: overlay scrollbar in virtual mode; native mode keeps the browser's.
const { mode = "auto", scrollbar = true } = defineProps<{ mode?: ScrollMode; scrollbar?: boolean }>();

const content = ref<HTMLElement>();
const track = ref<HTMLElement>();
const thumb = ref<HTMLElement>();
const store = useScrollStore();
const scroll = useScroll();
const bar = useScrollBar();

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
  <div class="scroll">
    <div ref="content" class="scroll__content">
      <slot />
    </div>
    <div v-if="scrollbar && store.isVirtual && !store.disabled" ref="track" class="scroll__bar" aria-hidden="true">
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
  &:hover {
    opacity: 1;
    transition-duration: 0.1s;
  }

  &[data-active],
  &:hover {
    border-color: var(--scroll-track-border);
    background-color: var(--scroll-track);
  }
}

.scroll__thumb {
  flex-shrink: 0;
  width: 7px;
  border-radius: 6px;
  background-color: var(--scroll-thumb);
  box-shadow: 0 0 0 1px var(--scroll-thumb-edge);
  transition: width 0.15s, background-color 0.15s, box-shadow 0.15s;

  .scroll__bar[data-active] &,
  .scroll__bar:hover & {
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
