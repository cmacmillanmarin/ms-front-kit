import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
import { run } from '../src/cli/index.js';

async function project(t, framework = 'nuxt') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-composables-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await run(['init', '--framework', framework, '--no-install'], root);
  return root;
}

test('Nuxt composable output preserves template logic exactly', async t => {
  const root = await project(t);
  await run(['add', 'composable', 'useResize'], root);
  const output = await readFile(path.join(root, 'app/composables/useResize.ts'), 'utf8');
  const template = await readFile(new URL('../templates/vue/composables/useResize.ts.tpl', import.meta.url), 'utf8');
  assert.equal(output, template);
});

test('useDevice installs useResize dependency and repeat runs skip both', async t => {
  const root = await project(t);
  const result = await run(['add', 'composable', 'useDevice'], root);
  assert.match(result, /Created app\/composables\/useResize.ts/);
  assert.match(result, /Created app\/composables\/useDevice.ts/);
  assert.match(result, /base\/_device.scss/);
  assert.match(result, /--layout-max-width/);
  const resize = path.join(root, 'app/composables/useResize.ts');
  const device = path.join(root, 'app/composables/useDevice.ts');
  await writeFile(resize, '// customized resize');
  await writeFile(device, '// customized device');
  const second = await run(['add', 'composable', 'useDevice'], root);
  assert.equal((second.match(/Skipped/g) || []).length, 2);
  assert.equal(await readFile(resize, 'utf8'), '// customized resize');
  assert.equal(await readFile(device, 'utf8'), '// customized device');
});

test('Vue output adds explicit imports and respects custom output paths', async t => {
  const root = await project(t, 'vue');
  const configPath = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.paths.composables = 'src/shared/composables';
  await writeFile(configPath, JSON.stringify(config));
  await run(['add', 'composable', 'useDevice'], root);
  const resize = await readFile(path.join(root, 'src/shared/composables/useResize.ts'), 'utf8');
  const device = await readFile(path.join(root, 'src/shared/composables/useDevice.ts'), 'utf8');
  assert.match(resize, /^import \{ ref, onMounted, onUnmounted \} from 'vue';/);
  assert.match(device, /import useResize from '.\/useResize';/);
  const template = await readFile(new URL('../templates/vue/composables/useDevice.ts.tpl', import.meta.url), 'utf8');
  assert.ok(device.endsWith(template));
});

test('unknown composables and traversal are rejected', async t => {
  const root = await project(t);
  for (const name of ['useUnknown', '../useDevice', 'useDevice.ts']) {
    await assert.rejects(run(['add', 'composable', name], root), /Available: useResize, useDevice/);
  }
});

test('an existing linked composable is skipped, not followed or replaced', async t => {
  const root = await project(t);
  await run(['add', 'composable', 'useResize'], root);
  const file = path.join(root, 'app/composables/useResize.ts');
  await rm(file);
  const target = path.join(root, 'custom.ts');
  await writeFile(target, 'custom code');
  await symlink(target, file);
  assert.match(await run(['add', 'composable', 'useResize'], root), /Skipped/);
  assert.equal(await readFile(target, 'utf8'), 'custom code');
});

test('device CSS retains JS labels, hidden pseudo-element and pointer flag', () => {
  const css = sass.compileString('@use "main";', {
    loadPaths: [fileURLToPath(new URL('../templates/shared/scss/', import.meta.url))]
  }).css;
  assert.match(css, /body::after \{\s*display: none;\s*content: "mobile";/);
  for (const label of ['tablet', 'tablet--landscape', 'desktop', 'desktop--medium', 'desktop--large', 'desktop--x-large']) {
    assert.ok(css.includes(`content: "${label}"`));
  }
  assert.match(css, /min-width: 35.0625rem/);
  assert.match(css, /pointer: coarse/);
  assert.match(css, /--touch: 1/);
  assert.doesNotMatch(css, /--touch: 0/);
});
