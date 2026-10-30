import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import { run } from '../src/cli/index.js';
import { addComposable } from '../src/cli/composables.js';
import { addViewportToken, mountScroll, updateNuxtModules } from '../src/cli/scroll-setup.js';

const scrollFiles = ['useResize', 'useDevice', 'useRaf', 'useScrollLock', 'useScrollNative', 'useScrollVirtual', 'useScrollBar', 'useScroll'];

async function project(t, framework = 'nuxt', { app, nuxtConfig = 'export default defineNuxtConfig({});\n', pkg = '{"private":true}' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-scroll-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), pkg);
  if (framework === 'nuxt') await writeFile(path.join(root, 'nuxt.config.ts'), nuxtConfig);
  await run(['init', '--framework', framework, '--no-install'], root);
  if (app !== undefined) {
    const file = framework === 'nuxt' ? 'app/app.vue' : 'src/App.vue';
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), app);
  }
  return root;
}

test('useScroll installs composables, store, component, Pinia module and app mount; repeat runs preserve everything', async t => {
  const app = '<script setup lang="ts">\n// keep\nconst title = "Hi";\n</script>\n\n<template>\n  <NuxtLayout>\n    <NuxtPage />\n  </NuxtLayout>\n</template>\n';
  const root = await project(t, 'nuxt', { app });
  const message = await run(['add', 'composable', 'useScroll', '--no-install'], root);
  for (const name of scrollFiles) {
    assert.match(message, new RegExp(`Created app/composables/${name}.ts`));
    const output = await readFile(path.join(root, `app/composables/${name}.ts`), 'utf8');
    assert.doesNotMatch(output, /\{\{\w+\}\}/);
    assert.doesNotMatch(output, /from 'vue'/); // Nuxt keeps auto-imports.
  }
  assert.match(await readFile(path.join(root, 'app/composables/useScroll.ts'), 'utf8'), /from '\.\.\/store\/useScrollStore'/);
  assert.match(await readFile(path.join(root, 'app/store/useScrollStore.ts'), 'utf8'), /defineStore\('scroll'/);
  const component = await readFile(path.join(root, 'app/components/Scroll/Index.vue'), 'utf8');
  assert.match(component, /import useScroll from "\.\.\/\.\.\/composables\/useScroll"/);
  assert.match(component, /import useScrollStore, \{ type ScrollMode \} from "\.\.\/\.\.\/store\/useScrollStore"/);
  assert.match(component, /import useScrollBar from "\.\.\/\.\.\/composables\/useScrollBar"/);
  assert.match(component, /scrollbar = true/); // The overlay scrollbar is on by default.
  assert.match(component, /v-if="scrollbar && store.isVirtual && !store.disabled"/);
  assert.match(component, /height: var\(--vh, 100svh\);\s*overflow-x: hidden;\s*overflow-y: auto;/); // The root scrolls, not the window.
  assert.doesNotMatch(message, /--vh/); // Without add styles there is no tokens file to update.
  assert.deepEqual(parse(component).errors, []);
  compileScript(parse(component).descriptor, { id: 'scroll' });
  assert.match(await readFile(path.join(root, 'nuxt.config.ts'), 'utf8'), /modules: \["@pinia\/nuxt"\]/);
  const updated = await readFile(path.join(root, 'app/app.vue'), 'utf8');
  assert.match(updated, /import Scroll from "\.\/components\/Scroll\/Index.vue"/);
  assert.match(updated, /\/\/ keep\nconst title = "Hi";/);
  assert.match(updated, /<Scroll>\s*<NuxtLayout>\s*<NuxtPage \/>\s*<\/NuxtLayout>\s*<\/Scroll>/);
  assert.match(message, /install pinia @pinia\/nuxt/);
  assert.match(message, /Created app\/components\/Scroll\/Index.vue[\s\S]*Created app\/components\/Scroll\/README.md/);
  const docs = await readFile(path.join(root, 'app/components/Scroll/README.md'), 'utf8');
  assert.doesNotMatch(docs, /\{\{\w+\}\}/);
  assert.match(docs, /`app\/components\/Scroll\/Index.vue`/);
  assert.match(docs, /`app\/store\/useScrollStore.ts`/);
  // Every attribute the engines read is documented.
  const engines = await Promise.all(['useScrollVirtual', 'useScrollNative', 'useScrollLock', 'useScroll', 'useScrollBar']
    .map(name => readFile(new URL(`../templates/vue/composables/${name}.ts.tpl`, import.meta.url), 'utf8')));
  const attributes = new Set();
  for (const source of engines) {
    for (const [, key] of source.matchAll(/dataset\.(\w+)/g)) attributes.add(`data-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`);
    for (const [, name] of source.matchAll(/\[(data-[\w-]+)\]/g)) attributes.add(name);
  }
  for (const attribute of attributes) assert.ok(docs.includes(attribute), attribute);

  await writeFile(path.join(root, 'app/composables/useScrollVirtual.ts'), '// customized');
  await writeFile(path.join(root, 'app/store/useScrollStore.ts'), '// customized store');
  await writeFile(path.join(root, 'app/components/Scroll/README.md'), '# Our scroll notes\n');
  const config = await readFile(path.join(root, 'nuxt.config.ts'), 'utf8');
  const second = await run(['add', 'composable', 'useScroll', '--no-install'], root);
  assert.equal((second.match(/Skipped/g) || []).length, scrollFiles.length + 3);
  assert.match(second, /already registered/);
  assert.match(second, /Existing Scroll mount preserved/);
  assert.equal(await readFile(path.join(root, 'app/composables/useScrollVirtual.ts'), 'utf8'), '// customized');
  assert.equal(await readFile(path.join(root, 'app/store/useScrollStore.ts'), 'utf8'), '// customized store');
  assert.equal(await readFile(path.join(root, 'app/components/Scroll/README.md'), 'utf8'), '# Our scroll notes\n');
  assert.equal(await readFile(path.join(root, 'nuxt.config.ts'), 'utf8'), config);
  assert.equal(await readFile(path.join(root, 'app/app.vue'), 'utf8'), updated);
});

test('installed styles get the --vh token once, and customized tokens are preserved', async t => {
  const root = await project(t);
  await run(['add', 'styles'], root);
  const { paths } = JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  const file = path.join(root, paths.styles, 'ms-front-kit/base/_tokens.scss');
  const template = await readFile(new URL('../templates/shared/scss/base/_tokens.scss', import.meta.url), 'utf8');
  assert.match(template, /^  --vh: 100svh;$/m);
  // A project styled before --vh existed.
  const legacy = template.replace(/^ *\/\/ Stable viewport height.*\n *--vh: 100svh;\n\n/m, '');
  assert.doesNotMatch(legacy, /--vh/);
  await writeFile(file, legacy);
  const message = await run(['add', 'composable', 'useScroll', '--no-install'], root);
  assert.match(message, /Added --vh: 100svh/);
  assert.equal(await readFile(file, 'utf8'), template);
  const second = await run(['add', 'composable', 'useScroll', '--no-install'], root);
  assert.match(second, /--vh token already defined/);
  assert.equal(await readFile(file, 'utf8'), template);

  const custom = ':root {\n  --vh: 100dvh;\n}\n';
  assert.equal(addViewportToken(custom).updated, custom);
  const nested = '.a {\n  :root {\n    --x: 1;\n  }\n}\n:root {\n}\n';
  assert.match(addViewportToken(nested).note, /manually/);
  assert.equal(addViewportToken(nested).updated, nested);
});

test('an existing Scroll.vue from earlier installs is kept without adding Scroll/Index.vue', async t => {
  const app = '<script setup lang="ts">\nimport Scroll from "./components/Scroll.vue";\n</script>\n\n<template>\n  <Scroll>\n    <NuxtPage />\n  </Scroll>\n</template>\n';
  const root = await project(t, 'nuxt', { app });
  await mkdir(path.join(root, 'app/components'), { recursive: true });
  await writeFile(path.join(root, 'app/components/Scroll.vue'), '<template><div class="scroll" /></template>\n');
  const message = await run(['add', 'composable', 'useScroll', '--no-install'], root);
  assert.match(message, /Existing app\/components\/Scroll.vue preserved/);
  assert.match(message, /Existing Scroll mount preserved/);
  await assert.rejects(readdir(path.join(root, 'app/components/Scroll')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(root, 'app/components/Scroll.vue'), 'utf8'), '<template><div class="scroll" /></template>\n');
  assert.equal(await readFile(path.join(root, 'app/app.vue'), 'utf8'), app);
});

test('a missing Nuxt app shell is created with the scroll mount', async t => {
  const root = await project(t);
  await run(['add', 'composable', 'useScroll', '--no-install'], root);
  const source = await readFile(path.join(root, 'app/app.vue'), 'utf8');
  assert.match(source, /<Scroll>\s*<NuxtLayout>\s*<NuxtPage \/>/);
  assert.deepEqual(parse(source).errors, []);
});

test('Vue output uses explicit imports and configured component, composable and store paths', async t => {
  const root = await project(t, 'vue', { app: '<template>\n  <main>\n    <RouterView />\n  </main>\n</template>\n' });
  const configFile = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  config.paths.components = 'src/ui';
  config.paths.composables = 'src/shared/composables';
  config.paths.store = 'src/state';
  await writeFile(configFile, JSON.stringify(config));
  const message = await run(['add', 'composable', 'useScroll', '--no-install'], root);
  const scroll = await readFile(path.join(root, 'src/shared/composables/useScroll.ts'), 'utf8');
  assert.match(scroll, /^import \{ nextTick, onBeforeUnmount, watch \} from 'vue';/);
  assert.match(scroll, /import \{ useRoute \} from 'vue-router';/);
  assert.match(scroll, /from '\.\.\/\.\.\/state\/useScrollStore'/);
  const component = await readFile(path.join(root, 'src/ui/Scroll/Index.vue'), 'utf8');
  assert.match(component, /from "\.\.\/\.\.\/shared\/composables\/useScroll"/);
  assert.match(component, /from "\.\.\/\.\.\/state\/useScrollStore"/);
  const docs = await readFile(path.join(root, 'src/ui/Scroll/README.md'), 'utf8');
  assert.match(docs, /`src\/ui\/Scroll\/Index.vue`/);
  assert.match(docs, /`src\/state\/useScrollStore.ts`/);
  assert.match(await readFile(path.join(root, 'src/App.vue'), 'utf8'), /<Scroll>\s*<RouterView \/>\s*<\/Scroll>/);
  assert.match(message, /createPinia/);
  assert.match(message, /vue-router/);
  assert.match(message, /install pinia with/);
});

test('configurations without paths.store default to a sibling store directory and are not rewritten', async t => {
  const root = await project(t);
  const configFile = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  delete config.paths.store;
  const legacy = JSON.stringify(config);
  await writeFile(configFile, legacy);
  await run(['add', 'composable', 'useScroll', '--no-install'], root);
  assert.ok(await readFile(path.join(root, 'app/store/useScrollStore.ts'), 'utf8'));
  assert.equal(await readFile(configFile, 'utf8'), legacy);
});

test('store paths outside the project are rejected', async t => {
  const root = await project(t);
  const configFile = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  config.paths.store = '../outside';
  await writeFile(configFile, JSON.stringify(config));
  await assert.rejects(run(['add', 'composable', 'useScroll', '--no-install'], root), /paths.store/);
});

test('installation adds only missing packages, after files, and checks npm first', async t => {
  const root = await project(t, 'nuxt', { pkg: '{"dependencies":{"pinia":"^3.0.0"}}' });
  const config = JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  config.paths.store = 'app/store';
  const installs = [];
  const safe = async (base, relative) => {
    const directory = path.join(base, relative);
    await mkdir(directory, { recursive: true });
    return directory;
  };
  const message = await addComposable(root, config, 'useScroll', safe, {
    installDependencies: async (directory, names) => {
      installs.push(names);
      assert.ok(await readFile(path.join(directory, 'app/components/Scroll/Index.vue'), 'utf8'));
    }
  });
  assert.deepEqual(installs, [['@pinia/nuxt']]);
  assert.match(message, /Installed @pinia\/nuxt with npm/);
  // Composables without packages never install.
  await addComposable(root, config, 'useRaf', safe, { installDependencies: () => assert.fail('no packages needed') });

  const other = await project(t);
  await writeFile(path.join(other, 'yarn.lock'), '');
  await assert.rejects(run(['add', 'composable', 'useScroll'], other), /non-npm lockfile/);
  await assert.rejects(readFile(path.join(other, 'app/composables/useScroll.ts')), { code: 'ENOENT' });
  await assert.rejects(run(['add', 'composable', 'useScroll', '--yes'], other), /Usage/);
});

test('linked app shells stop before any file is written', async t => {
  const root = await project(t);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'target.vue'), '<template><div /></template>');
  await symlink(path.join(root, 'target.vue'), path.join(root, 'app/app.vue'));
  await assert.rejects(run(['add', 'composable', 'useScroll', '--no-install'], root), /linked/);
  await assert.rejects(readdir(path.join(root, 'app/composables')), { code: 'ENOENT' });
});

test('mountScroll wraps the outermost routed element and preserves existing mounts', () => {
  const html = mountScroll('<template><Html><NuxtLayout><NuxtPage /></NuxtLayout></Html></template>', './components/Scroll.vue', 'nuxt');
  assert.match(html.updated, /<Html><Scroll>\s*<NuxtLayout><NuxtPage \/><\/NuxtLayout>\s*<\/Scroll><\/Html>/);
  const page = mountScroll('<script setup>const a = 1;</script>\n<template>\n  <main>\n    <NuxtPage />\n  </main>\n</template>', './components/Scroll.vue', 'nuxt');
  assert.match(page.updated, /<script setup>\nimport Scroll from ".\/components\/Scroll.vue";\nconst a = 1;/);
  assert.match(page.updated, /    <Scroll>\n      <NuxtPage \/>\n    <\/Scroll>/);
  for (const source of [
    '<template><scroll><NuxtPage /></scroll></template>',
    '<script setup>import Smooth from "./components/Scroll.vue";</script><template><Smooth><NuxtPage /></Smooth></template>'
  ]) {
    const result = mountScroll(source, './components/Scroll.vue', 'nuxt');
    assert.equal(result.updated, source);
    assert.match(result.note, /preserved/);
  }
  for (const [source, framework] of [
    ['<template><NuxtPage /><NuxtPage name="aside" /></template>', 'nuxt'],
    ['<template><div /></template>', 'vue'],
    ['<template src="./app.html"></template>', 'nuxt'],
    ['<script setup>const Scroll = 1;</script><template><NuxtPage /></template>', 'nuxt']
  ]) {
    const result = mountScroll(source, './Scroll.vue', framework);
    assert.equal(result.updated, source);
    assert.match(result.note, /manually/);
  }
});

test('updateNuxtModules appends once to literal module arrays only', () => {
  assert.match(updateNuxtModules('export default defineNuxtConfig({ modules: ["@nuxt/image"] })', '@pinia/nuxt').updated, /modules: \["@pinia\/nuxt", "@nuxt\/image"\]/);
  for (const source of [
    'export default defineNuxtConfig({ modules: ["@pinia/nuxt"] })',
    'export default defineNuxtConfig({ modules: [["@pinia/nuxt", {}]] })'
  ]) assert.equal(updateNuxtModules(source, '@pinia/nuxt').updated, source);
  for (const source of [
    'export default defineNuxtConfig({ modules: getModules() })',
    'export default defineNuxtConfig({ modules: [pinia] })',
    'export default defineNuxtConfig({ ...base })',
    'export default {}'
  ]) {
    const result = updateNuxtModules(source, '@pinia/nuxt');
    assert.equal(result.updated, source);
    assert.match(result.note, /manually/);
  }
});

test('generated Vue scroll output type-checks in strict mode', async t => {
  const root = await project(t, 'vue');
  await run(['add', 'composable', 'useScroll', '--no-install'], root);
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'));
  const files = [
    ...scrollFiles.map(name => path.join(root, `src/composables/${name}.ts`)),
    path.join(root, 'src/store/useScrollStore.ts')
  ];
  const program = ts.createProgram(files, {
    strict: true, noEmit: true, noUnusedLocals: true, noUnusedParameters: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts']
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  assert.deepEqual(diagnostics, []);
});
