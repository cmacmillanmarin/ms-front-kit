import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from '../src/cli/index.js';
import { updateAbstractsAlias } from '../src/cli/styles.js';

async function project(t, framework = 'vue') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-vite-alias-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await run(['init', '--framework', framework, '--no-install'], root);
  if (framework === 'vue') {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/main.ts'), '// app entry\n');
  } else await writeFile(path.join(root, 'nuxt.config.ts'), 'export default defineNuxtConfig({ vite: { resolve: { alias: { old: "/keep" } } } });\n');
  return root;
}

test('alias merge preserves plugins, comments, and other aliases and is repeatable', () => {
  const source = '// header\nexport default defineConfig({ plugins: [vue()], resolve: { /* keep */ alias: { "@": "/src" } }, css: { preprocessorOptions: { scss: { additionalData: "// keep" } } } });';
  const updated = updateAbstractsAlias(source, 'src/custom styles/ms-front-kit');
  assert.match(updated, /plugins: \[vue\(\)\]/);
  assert.match(updated, /\/\* keep \*\//);
  assert.match(updated, /"@": "\/src"/);
  assert.match(updated, /additionalData: "\/\/ keep"/);
  assert.match(updated, /new URL\("\.\/src\/custom styles\/ms-front-kit\/abstracts", import.meta.url\)/);
  assert.equal(updateAbstractsAlias(updated, 'src/custom styles/ms-front-kit'), updated);
});

test('Vue installation configures custom paths and a portable executable alias', async t => {
  const root = await project(t);
  const configFile = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  config.paths.styles = 'src/custom styles';
  await writeFile(configFile, JSON.stringify(config));
  const file = path.join(root, 'vite.config.mjs');
  await writeFile(file, 'export default { resolve: { alias: { existing: "/keep" } } };\n');
  await run(['add', 'styles'], root);
  const first = await readFile(file, 'utf8');
  const installed = (await import(pathToFileURL(file).href)).default;
  assert.equal(installed.resolve.alias.abstracts, await realpath(path.join(root, 'src/custom styles/ms-front-kit/abstracts')));
  assert.equal(installed.resolve.alias.existing, '/keep');
  await run(['add', 'styles'], root);
  assert.equal(await readFile(file, 'utf8'), first);
});

test('Nuxt installation merges its Vite alias and preserves existing aliases', async t => {
  const root = await project(t, 'nuxt');
  await run(['add', 'styles'], root);
  const file = path.join(root, 'nuxt.config.ts');
  const first = await readFile(file, 'utf8');
  assert.match(first, /old: "\/keep"/);
  assert.match(first, /new URL\("\.\/app\/assets\/scss\/ms-front-kit\/abstracts"/);
  await run(['add', 'styles'], root);
  assert.equal(await readFile(file, 'utf8'), first);
});

test('Vue creates a Vite configuration when absent', async t => {
  const root = await project(t);
  await run(['add', 'styles'], root);
  const file = path.join(root, 'vite.config.ts');
  const first = await readFile(file, 'utf8');
  assert.match(first, /abstracts:/);
  await run(['add', 'styles'], root);
  assert.equal(await readFile(file, 'utf8'), first);
});

test('unsafe Vite configurations stop before entry edits, copying, or config changes', async t => {
  for (const source of [
    'export default defineConfig(() => ({}));',
    'export default { ...other };',
    'export default { resolve: shared };',
    'export default { resolve: { alias: [] } };',
    'export default { resolve: { alias: { abstracts: "/custom" } } };',
    'export default { resolve: { alias: { ...other } } };',
    'export default { resolve: { [key]: {} } };',
    'export default { resolve: {}, resolve: {} };',
  ]) {
    const root = await project(t);
    const file = path.join(root, 'vite.config.ts');
    await writeFile(file, source);
    const config = await readFile(path.join(root, 'ms-front-kit.json'), 'utf8');
    await assert.rejects(run(['add', 'styles'], root), /alias/);
    assert.equal(await readFile(file, 'utf8'), source);
    assert.equal(await readFile(path.join(root, 'src/main.ts'), 'utf8'), '// app entry\n');
    assert.equal(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'), config);
    await assert.rejects(readFile(path.join(root, 'src/assets/scss/ms-front-kit/main.scss')), { code: 'ENOENT' });
  }
});

test('linked Vite configurations are refused', async t => {
  const root = await project(t);
  const target = path.join(root, 'target.ts');
  await writeFile(target, 'export default {};');
  await symlink(target, path.join(root, 'vite.config.ts'));
  await assert.rejects(run(['add', 'styles'], root), /linked/);
  assert.equal(await readFile(target, 'utf8'), 'export default {};');
});
