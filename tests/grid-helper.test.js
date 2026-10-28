import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';
import { renderToString } from '@vue/server-renderer';
import * as sass from 'sass';
import { run } from '../src/cli/index.js';
import { mountGrid } from '../src/cli/grid-helper.js';

const templateFile = new URL('../templates/vue/components/helper/Grid.vue.tpl', import.meta.url);
async function project(t, framework = 'nuxt', custom = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-grid-helper-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (framework === 'nuxt') await writeFile(path.join(root, 'nuxt.config.ts'), `export default defineNuxtConfig({${custom ? 'srcDir: "frontend/",' : ''}});\n`);
  await run(['init', '--framework', framework, '--no-install'], root);
  const configFile = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  if (custom) {
    config.paths.components = 'ui';
    await writeFile(configFile, JSON.stringify(config));
  }
  const app = framework === 'nuxt' ? `${custom ? 'frontend' : 'app'}/app.vue` : 'src/App.vue';
  await mkdir(path.join(root, path.dirname(app)), { recursive: true });
  if (framework === 'vue') await writeFile(path.join(root, 'src/main.ts'), 'import App from "./App.vue";\n');
  return { root, app, config };
}

for (const framework of ['nuxt', 'vue']) {
  test(`${framework} styles install creates the helper and dev-only app mount, preserving code and repeat runs`, async t => {
    const { root, app, config } = await project(t, framework, true);
    const source = '<script setup lang="ts">\n// keep project logic\nconst title = "Hello";\n</script>\n<template><div class="project"><h1>{{ title }}</h1></div></template>\n<style>.project { color: red; }</style>\n';
    await writeFile(path.join(root, app), source);
    const message = await run(['add', 'styles'], root);
    const helper = path.join(root, config.paths.components, 'Helper/Grid.vue');
    assert.equal(await readFile(helper, 'utf8'), await readFile(templateFile, 'utf8'));
    const updated = await readFile(path.join(root, app), 'utf8');
    assert.match(updated, /const title = "Hello"/);
    assert.match(updated, /keep project logic/);
    assert.match(updated, /<h1>\{\{ title \}\}<\/h1>/);
    assert.match(updated, /<style>\.project \{ color: red; \}<\/style>/);
    assert.match(updated, /import MsFrontKitGrid from "\.\.\/ui\/Helper\/Grid.vue"/);
    assert.ok(updated.includes(framework === 'nuxt' ? 'import.meta.dev' : 'import.meta.env.DEV'));
    assert.match(updated, /<MsFrontKitGrid v-if="msFrontKitDev" \/>/);
    assert.match(message, /development mode only/);
    assert.deepEqual(parse(updated).errors, []);
    await run(['add', 'styles'], root);
    assert.equal(await readFile(path.join(root, app), 'utf8'), updated);
    await writeFile(helper, 'customized helper');
    await run(['add', 'styles'], root);
    assert.equal(await readFile(helper, 'utf8'), 'customized helper');
  });
}

test('existing HelperGrid and guarded mount, including Html root, are preserved', async t => {
  const { root, app, config } = await project(t);
  const helper = path.join(root, config.paths.components, 'Helper/Grid.vue');
  await mkdir(path.dirname(helper), { recursive: true });
  await writeFile(helper, 'project-owned grid');
  const source = '<script setup lang="ts">const isDev = import.meta.dev;</script>\n<template><Html><NuxtLayout><NuxtPage /></NuxtLayout><HelperGrid v-if="isDev" /></Html></template>';
  await writeFile(path.join(root, app), source);
  await run(['add', 'styles'], root);
  assert.equal(await readFile(helper, 'utf8'), 'project-owned grid');
  assert.equal(await readFile(path.join(root, app), 'utf8'), source);
});

test('existing mounts using a custom import name are not duplicated', () => {
  const source = '<script setup lang="ts">import DebugGrid from "./components/Helper/Grid.vue"; const isDev = import.meta.env.DEV;</script>\n<template><main><debug-grid v-if="isDev" /></main></template>';
  assert.equal(mountGrid(source, './components/Helper/Grid.vue', 'vue').updated, source);
});

test('Html roots get the overlay inside Html, not in layout slots', () => {
  const source = '<script setup lang="ts">const head = useLocaleHead();</script>\n<template><Html :lang="head.htmlAttrs.lang"><NuxtLayout><NuxtPage /></NuxtLayout></Html></template>';
  const { updated } = mountGrid(source, './components/Helper/Grid.vue', 'nuxt');
  assert.match(updated, /<\/NuxtLayout>\s*<MsFrontKitGrid v-if="msFrontKitDev" \/>\s*<\/Html>/);
  assert.match(updated, /const head = useLocaleHead\(\)/);
});

test('missing app is created without depending on Nuxt auto-import scanning', async t => {
  const { root, app } = await project(t);
  await run(['add', 'styles'], root);
  const source = await readFile(path.join(root, app), 'utf8');
  assert.match(source, /import MsFrontKitGrid from ".\/components\/Helper\/Grid.vue"/);
  assert.match(source, /<NuxtPage \/>/);
  assert.match(source, /<MsFrontKitGrid v-if="msFrontKitDev" \/>/);
});

test('unsupported app templates are preserved with manual integration instructions', async t => {
  const { root, app } = await project(t);
  const source = '<template src="./external.html"></template>';
  await writeFile(path.join(root, app), source);
  const message = await run(['add', 'styles'], root);
  assert.equal(await readFile(path.join(root, app), 'utf8'), source);
  assert.match(message, /Mount it manually/);
  assert.match(message, /import.meta.dev/);
  assert.match(await readFile(path.join(root, 'app/components/Helper/Grid.vue'), 'utf8'), /helper__grid/);
});

test('linked helper or app paths stop before styles or config edits', async t => {
  for (const targetKind of ['app', 'helper']) {
    const { root, app, config } = await project(t);
    const file = targetKind === 'app' ? app : `${config.paths.components}/Helper/Grid.vue`;
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, 'target.vue'), '<template><div /></template>');
    await symlink(path.join(root, 'target.vue'), path.join(root, file));
    const before = await readFile(path.join(root, 'nuxt.config.ts'), 'utf8');
    await assert.rejects(run(['add', 'styles'], root), /linked/);
    assert.equal(await readFile(path.join(root, 'nuxt.config.ts'), 'utf8'), before);
    await assert.rejects(readFile(path.join(root, config.paths.styles, 'ms-front-kit/main.scss')), { code: 'ENOENT' });
  }
});

function component(source, dependencies = {}) {
  const { descriptor } = parse(source);
  const compiled = compileScript(descriptor, { id: 'grid-test', inlineTemplate: true }).content;
  const code = ts.transpileModule(compiled, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => name === 'vue' ? Vue : dependencies[name], exports);
  return exports.default;
}

test('generated mounts render the helper in development but not production', async () => {
  const helper = component(await readFile(templateFile, 'utf8'));
  for (const framework of ['nuxt', 'vue']) {
    const { updated } = mountGrid('<template><div /></template>', './Grid.vue', framework);
    for (const dev of [true, false]) {
      const source = updated.replace(/import\.meta\.(?:env\.DEV|dev)/g, String(dev));
      const app = component(source, { './Grid.vue': { default: helper } });
      const html = await renderToString(Vue.createSSRApp(app));
      assert.equal(html.includes('helper__grid__toggle'), dev);
      assert.doesNotMatch(html, /helper__grid__overlay/);
    }
  }
});

test('helper SCSS uses installed grid tools without requiring useResize', async () => {
  const source = await readFile(templateFile, 'utf8');
  const { descriptor } = parse(source);
  const css = sass.compileString(descriptor.styles[0].content, {
    loadPaths: [fileURLToPath(new URL('../templates/shared/scss/', import.meta.url))]
  }).css;
  assert.match(css, /max-width: var\(--layout-max-width\)/);
  assert.match(css, /padding: 0.5rem/);
  assert.match(css, /pointer-events: none/);
  assert.doesNotMatch(css, /var\(--vh\)/);
});

test('helper toggles and persists visibility, tolerating blocked storage', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  let stored = 'true';
  let blocked = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { assert.equal(key, 'helper-grid-visible'); if (blocked) throw Error('blocked'); return stored; },
    setItem(key, value) { assert.equal(key, 'helper-grid-visible'); if (blocked) throw Error('blocked'); stored = value; }
  } });
  const renderer = Vue.createRenderer({
    createElement: tag => ({ tag, props: {}, children: [] }),
    createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {},
    patchProp(node, key, _old, value) { node.props[key] = value; },
    insert(node, parent) { node.parent = parent; parent.children.push(node); },
    remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); },
    parentNode: node => node.parent, nextSibling: () => null,
  });
  const helper = component(await readFile(templateFile, 'utf8'));
  for (const denied of [false, true]) {
    blocked = denied;
    const root = { children: [] };
    const app = renderer.createApp(helper);
    try {
      app.mount(root);
      await Vue.nextTick();
      const button = root.children[0].children.find(node => node.tag === 'button');
      assert.equal(button.props['aria-pressed'], !denied);
      button.props.onClick();
      await Vue.nextTick();
      assert.equal(button.props['aria-pressed'], denied);
      if (!denied) assert.equal(stored, 'false');
    } finally { app.unmount(); }
  }
});
