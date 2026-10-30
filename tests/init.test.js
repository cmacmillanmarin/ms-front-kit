import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initialize } from '../src/cli/init.js';
import { run } from '../src/cli/index.js';
import ts from 'typescript';

async function project(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-init-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), '{"private":true}');
  return root;
}
async function directory(root, relative) {
  const target = path.join(root, relative);
  await mkdir(target, { recursive: true });
  return target;
}

test('Nuxt init creates the plugin and requests GSAP installation', async t => {
  const root = await project(t);
  let calls = 0;
  const result = await initialize(root, 'nuxt', directory, { installDependencies: async cwd => { assert.equal(cwd, root); calls++; } });
  assert.equal(calls, 1);
  assert.match(result, /Installed GSAP/);
  const plugin = await readFile(path.join(root, 'app/plugins/ms-front-kit.client.ts'), 'utf8');
  assert.match(plugin, /Developed by https:\/\/macmillan.studio/);
  assert.match(plugin, /gsap.registerPlugin\(CustomEase\)/);
  assert.match(plugin, /CustomEase.create\("ms-ease"/);
  assert.match(plugin, /\/\/.*document.fonts.load/);
  assert.match(plugin, /\/\/.*faces.length === 0/);
  assert.match(plugin, /\/\/.*clearTimeout/);
  assert.doesNotMatch(plugin, /useStore|ScrollToPlugin/);
  const ast = ts.createSourceFile('plugin.ts', plugin, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(ast.parseDiagnostics.length, 0);
});

test('no-install creates a plugin without changing package.json', async t => {
  const root = await project(t);
  const before = await readFile(path.join(root, 'package.json'), 'utf8');
  const result = await run(['init', '--framework', 'nuxt', '--no-install'], root);
  assert.match(result, /installation skipped/);
  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), before);
  await assert.rejects(run(['init', '--framework', 'nuxt', '--no-install'], root), { code: 'EEXIST' });
});

test('an existing plugin is preserved while recreating missing configuration', async t => {
  const root = await project(t);
  await directory(root, 'app/plugins');
  const file = path.join(root, 'app/plugins/ms-front-kit.client.ts');
  await writeFile(file, 'custom plugin');
  const before = await readFile(path.join(root, 'package.json'), 'utf8');
  let calls = 0;
  const result = await initialize(root, 'nuxt', directory, { installDependencies: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.match(result, /Kept existing app\/plugins\/ms-front-kit.client.ts/);
  assert.equal(await readFile(file, 'utf8'), 'custom plugin');
  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), before);
  const config = JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  assert.equal(config.framework, 'nuxt');
  assert.equal(config.styles.grid, false);
  await assert.rejects(run(['init', '--framework', 'nuxt', '--no-install'], root), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), 'custom plugin');
});

test('recreated configuration records styles installed on another machine', async t => {
  const root = await project(t);
  await directory(root, 'app/assets/scss/ms-front-kit/abstracts');
  await writeFile(path.join(root, 'app/assets/scss/ms-front-kit/abstracts/_grid.scss'), '// customized');
  const result = await run(['init', '--framework', 'nuxt', '--no-install'], root);
  assert.match(result, /Found installed styles/);
  const config = JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  assert.equal(config.styles.grid, true);
  assert.match(await run(['add', 'component', 'Home/Hero'], root), /app\/components\/Home\/Hero.vue/);
});

test('missing configuration explains how to recreate it', async t => {
  const root = await project(t);
  await assert.rejects(run(['add', 'component', 'Card'], root), /No ms-front-kit.json.*init --framework/);
});

for (const [label, source, base, assets, plugins] of [
  ['explicit default', 'export default defineNuxtConfig({ srcDir: "app" })', 'app', 'assets', 'plugins'],
  ['custom source', 'export default defineNuxtConfig({ srcDir: "./src/" })', 'src', 'assets', 'plugins'],
  ['root source', 'export default defineNuxtConfig({ srcDir: "." })', '', 'assets', 'plugins'],
  ['custom directories', 'export default defineNuxtConfig({ srcDir: "frontend", dir: { assets: "static-assets", plugins: "integrations", pages: "views" } })', 'frontend', 'static-assets', 'integrations'],
  ['irrelevant nested keys', '// srcDir: dynamic\nexport default defineNuxtConfig({ runtimeConfig: { public: { dir: "anything" } } })', 'app', 'assets', 'plugins']
]) {
  test(`Nuxt init adapts to ${label}`, async t => {
    const root = await project(t);
    await writeFile(path.join(root, 'nuxt.config.ts'), source);
    const result = await run(['init', '--framework', 'nuxt', '--no-install'], root);
    const plugin = path.posix.join(base, plugins, 'ms-front-kit.client.ts');
    assert.ok((await readFile(path.join(root, plugin), 'utf8')).includes('gsap'));
    assert.ok(result.includes(plugin));
    const config = JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
    assert.deepEqual(config.paths, {
      components: path.posix.join(base, 'components'),
      composables: path.posix.join(base, 'composables'),
      store: path.posix.join(base, 'store'),
      styles: path.posix.join(base, assets, 'scss')
    });
    assert.equal(await readFile(path.join(root, 'nuxt.config.ts'), 'utf8'), source);
    await assert.rejects(run(['init', '--framework', 'nuxt', '--no-install'], root), { code: 'EEXIST' });
  });
}

for (const source of [
  'export default defineNuxtConfig({ srcDir: getDir() })',
  'export default defineNuxtConfig({ srcDir: "../outside" })',
  'export default defineNuxtConfig({ srcDir: "/outside" })',
  'export default defineNuxtConfig({ dir: { plugins: "../outside" } })',
  'export default defineNuxtConfig({ dir: { plugins: false } })',
  'export default defineNuxtConfig({ dir: getDirectories() })',
  'export default defineNuxtConfig({ ...shared })',
  'export default defineNuxtConfig({ extends: ["./base"] })',
  'export default defineNuxtConfig({ srcDir: "src", srcDir: "app" })',
  'export default defineNuxtConfig({ [key]: "src" })',
  'export default defineNuxtConfig({',
  'export default configuration'
]) {
  test(`unsupported layout fails before writes: ${source}`, async t => {
    const root = await project(t);
    await writeFile(path.join(root, 'nuxt.config.ts'), source);
    await assert.rejects(run(['init', '--framework', 'nuxt', '--no-install'], root));
    await assert.rejects(readFile(path.join(root, 'ms-front-kit.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(root, 'app/plugins/ms-front-kit.client.ts')), { code: 'ENOENT' });
  });
}

test('custom plugin location is preserved while creating configuration', async t => {
  const root = await project(t);
  await writeFile(path.join(root, 'nuxt.config.js'), 'export default defineNuxtConfig({ srcDir: "src", dir: { plugins: "integrations" } })');
  await directory(root, 'src/integrations');
  const file = path.join(root, 'src/integrations/ms-front-kit.client.ts');
  await writeFile(file, 'custom plugin');
  assert.match(await run(['init', '--framework', 'nuxt', '--no-install'], root), /Kept existing src\/integrations/);
  assert.equal(await readFile(file, 'utf8'), 'custom plugin');
  const config = JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  assert.equal(config.paths.components, 'src/components');
});

test('Vue init stays config-only', async t => {
  const root = await project(t);
  await run(['init', '--framework', 'vue'], root);
  await assert.rejects(readFile(path.join(root, 'app/plugins/ms-front-kit.client.ts')), { code: 'ENOENT' });
});

test('non-npm package manager refuses installation before creating files', async t => {
  const root = await project(t);
  await writeFile(path.join(root, 'package.json'), '{"packageManager":"pnpm@10.0.0"}');
  await assert.rejects(run(['init', '--framework', 'nuxt'], root), /--no-install/);
  await assert.rejects(readFile(path.join(root, 'ms-front-kit.json')), { code: 'ENOENT' });
});
