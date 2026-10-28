import test from 'node:test';
import assert from 'node:assert/strict';
import { renderComponent } from '../src/cli/component.js';

test('optional props, emits, imports and lifecycle examples are all commented', async () => {
  const { contents } = await renderComponent('Home/Hero/BackButton');
  const script = contents.match(/<script setup lang="ts">\n([\s\S]*?)\n<\/script>/)[1];
  for (const line of script.split('\n')) {
    assert.ok(!line.trim() || line.trim().startsWith('//'), `Unexpected active script: ${line}`);
  }
  for (const token of ['const { label = "" } = defineProps<{ label?: string }>();', 'defineEmits', 'close: []', 'change: [value: string]', 'select: [id: number, label: string]', 'emit("close")', 'emit("change", "example")', 'emit("select", 1, "example")', 'onBeforeMount(() =>', 'onMounted(() =>', 'onBeforeUnmount(() =>']) {
    assert.ok(script.includes(token), `Missing example: ${token}`);
  }
  assert.match(script, /\/\/ import \{ onBeforeMount, onMounted, onBeforeUnmount \} from "vue";/);
  assert.doesNotMatch(script, /onBeforeDestroy/);
});
