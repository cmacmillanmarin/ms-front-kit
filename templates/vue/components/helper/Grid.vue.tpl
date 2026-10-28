<script setup lang="ts">
import { onMounted, ref, watch } from "vue";

const STORAGE_KEY = "helper-grid-visible";
const isVisible = ref(false);

onMounted(() => {
  try {
    isVisible.value = localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Storage may be disabled; the toggle still works for this session.
  }
});

watch(isVisible, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Persistence is optional.
  }
});

function toggle() {
  isVisible.value = !isVisible.value;
}
</script>

<template>
  <div class="helper__grid" :class="{ 'helper__grid--active': isVisible }">
    <div v-if="isVisible" class="helper__grid__overlay" aria-hidden="true">
      <div class="helper__grid__container">
        <span v-for="n in 12" :key="n" class="helper__grid__column" />
      </div>
    </div>

    <button
      type="button"
      class="helper__grid__toggle"
      :aria-pressed="isVisible"
      :aria-label="isVisible ? 'Hide grid overlay' : 'Show grid overlay'"
      :title="isVisible ? 'Hide grid overlay' : 'Show grid overlay'"
      @click="toggle"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1"
        aria-hidden="true"
      >
        <rect x="1.5" y="1.5" width="13" height="13" rx="1" />
        <line x1="5.83" y1="1.5" x2="5.83" y2="14.5" />
        <line x1="10.17" y1="1.5" x2="10.17" y2="14.5" />
      </svg>
    </button>
  </div>
</template>

<style lang="scss">
@use "abstracts" as *;

.helper__grid {
  &__overlay {
    position: fixed;
    inset: 0;
    z-index: 9998;
    pointer-events: none;
    overflow: hidden;
  }

  // Extra columns wrap outside the clipped overlay on the four-column layout.
  &__container {
    @include grid();
    height: 100%;
    align-content: flex-start;
  }

  &__column {
    @include columns(1);
    height: 100%;
    background: rgba(255, 0, 100, 0.15);
  }

  &__toggle {
    position: fixed;
    inset-inline-end: var(--layout-margin);
    bottom: var(--layout-margin);
    z-index: 9999;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: rem(8px);
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: rem(4px);
    cursor: pointer;
    backdrop-filter: blur(4px);

    svg {
      width: rem(16px);
      height: rem(16px);
    }

    &:hover {
      background: rgba(0, 0, 0, 0.8);
    }
  }

  &--active &__toggle {
    background: rgb(255, 0, 100);
    border-color: rgb(255, 0, 100);
  }
}
</style>
