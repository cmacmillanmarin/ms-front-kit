<script setup lang="ts">
// import { onBeforeMount, onMounted, onBeforeUnmount } from "vue";

// const { label = "" } = defineProps<{ label?: string }>();

// const emit = defineEmits<{
//   close: [];
//   change: [value: string];
//   select: [id: number, label: string];
// }>();
// emit("close");
// emit("change", "example");
// emit("select", 1, "example");

// onBeforeMount(() => {
//   // Before the component is mounted (client only).
// });

// onMounted(() => {
//   // The component has mounted (client only).
// });

// onBeforeUnmount(() => {
//   // Clean up listeners, timers, or other resources before unmounting.
// });
</script>

<template>
  <div class="{{bemBlock}}">
    <p class="{{bemBlock}}__name">{{componentName}}</p>
  </div>
</template>

<style lang="scss">
// @use "abstracts" as *; // Requires running `ms-front-kit add styles` first.

.{{bemBlock}} {
  display: block;
}
</style>
