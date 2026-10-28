import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli/index.js';
import { updateNuxtCss } from '../src/cli/styles.js';

async function project(t, framework = 'nuxt', source = 'export default defineNuxtConfig({});\n') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-style-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await run(['init', '--framework', framework, '--no-install'], root);
  if (framework === 'nuxt') await writeFile(path.join(root, 'nuxt.config.ts'), source);
  else {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/main.ts'), source);
  }
  return root;
}

test('Nuxt installation copies files, registers CSS and is repeatable', async t => {
  const root = await project(t);
  const message = await run(['add', 'styles'], root);
  assert.match(message, /Copied 12 SCSS files/);
  assert.equal(JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8')).styles.grid, true);
  assert.match(await readFile(path.join(root, 'app/assets/scss/ms-front-kit/abstracts/_grid.scss'), 'utf8'), /@mixin columns/);
  assert.match(message, /Copied example font/);
  const installedFont = await readFile(path.join(root, 'public/assets/font/HelveticaNowDisplayMedium.woff2'));
  const sourceFont = await readFile(new URL('../templates/shared/fonts/HelveticaNowDisplayMedium.woff2', import.meta.url));
  assert.ok(installedFont.equals(sourceFont));
  assert.match(message, /npm install --save-dev sass/);
  assert.match(await readFile(path.join(root, 'app/assets/scss/ms-front-kit/main.scss'), 'utf8'), /base\/reset/);
  const first = await readFile(path.join(root, 'nuxt.config.ts'), 'utf8');
  assert.match(first, /css: \["@\/assets\/scss\/ms-front-kit\/main.scss"\]/);
  await run(['add', 'styles'], root);
  assert.equal(await readFile(path.join(root, 'nuxt.config.ts'), 'utf8'), first);
});

test('existing CSS entries, comments, and unrelated config are preserved', () => {
  const source = `// keep header\nexport default defineNuxtConfig({
  css: [ /* keep comment */ 'other.css', ],
  devtools: { enabled: false },
});`;
  const updated = updateNuxtCss(source, 'app/assets/scss');
  assert.match(updated, /other.css/);
  assert.match(updated, /keep comment/);
  assert.match(updated, /devtools: \{ enabled: false \}/);
  assert.equal(updated.replace('"@/assets/scss/main.scss", ', ''), source);
});

test('empty arrays and existing Nuxt alias entries are handled without duplicates', () => {
  assert.match(updateNuxtCss('export default defineNuxtConfig({css: []})', 'app/assets/scss'), /css: \["@\/assets\/scss\/main.scss"\]/);
  for (const entry of ['./app/assets/scss/main.scss', '~/assets/scss/main.scss', '@/assets/scss/main.scss', '~~/app/assets/scss/main.scss']) {
    const source = `export default defineNuxtConfig({css: ['${entry}']})`;
    assert.equal(updateNuxtCss(source, 'app/assets/scss'), source);
  }
});

test('dynamic or malformed Nuxt configurations stop before copying files', async t => {
  for (const source of [
    'export default defineNuxtConfig({css: getCss()})',
    'export default defineNuxtConfig({...other})',
    'export default defineNuxtConfig({css: [...other]})',
    'const config = {}; export default defineNuxtConfig(config)',
    'export default defineNuxtConfig({css: []',
  ]) {
    const root = await project(t, 'nuxt', source);
    await assert.rejects(run(['add', 'styles'], root));
    assert.equal(await readFile(path.join(root, 'nuxt.config.ts'), 'utf8'), source);
    await assert.rejects(readFile(path.join(root, 'app/assets/scss/ms-front-kit/main.scss')), { code: 'ENOENT' });
  }
});

test('customized styles are not overwritten and config is untouched', async t => {
  const root = await project(t);
  await mkdir(path.join(root, 'app/assets/scss/ms-front-kit/base'), { recursive: true });
  await writeFile(path.join(root, 'app/assets/scss/ms-front-kit/base/_reset.scss'), '/* mine */');
  await assert.rejects(run(['add', 'styles'], root), /already exists and differs/);
  assert.equal(await readFile(path.join(root, 'app/assets/scss/ms-front-kit/base/_reset.scss'), 'utf8'), '/* mine */');
  assert.equal(await readFile(path.join(root, 'nuxt.config.ts'), 'utf8'), 'export default defineNuxtConfig({});\n');
  await assert.rejects(readFile(path.join(root, 'app/assets/scss/ms-front-kit/main.scss')), { code: 'ENOENT' });
});

test('Vue installation uses custom paths and preserves its entry on repeat', async t => {
  const source = 'import { createApp } from "vue";\n// project code\n';
  const root = await project(t, 'vue', source);
  const configFile = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  config.paths.styles = 'src/styles';
  await writeFile(configFile, JSON.stringify(config));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { sass: '^1.0.0' } }));
  const result = await run(['add', 'styles'], root);
  assert.doesNotMatch(result, /Install the compiler/);
  const first = await readFile(path.join(root, 'src/main.ts'), 'utf8');
  assert.equal(first, 'import "./styles/ms-front-kit/main.scss";\n' + source);
  await run(['add', 'styles'], root);
  assert.equal(await readFile(path.join(root, 'src/main.ts'), 'utf8'), first);
  assert.match(await readFile(path.join(root, 'src/styles/ms-front-kit/main.scss'), 'utf8'), /base\/reset/);
});

test('a conflicting font stops before copying styles or editing config', async t => {
  const root = await project(t);
  await mkdir(path.join(root, 'public/assets/font'), { recursive: true });
  const font = path.join(root, 'public/assets/font/HelveticaNowDisplayMedium.woff2');
  await writeFile(font, 'custom asset');
  await assert.rejects(run(['add', 'styles'], root), /already exists and differs/);
  assert.equal(await readFile(font, 'utf8'), 'custom asset');
  assert.equal(await readFile(path.join(root, 'nuxt.config.ts'), 'utf8'), 'export default defineNuxtConfig({});\n');
  await assert.rejects(readFile(path.join(root, 'app/assets/scss/ms-front-kit/main.scss')), { code: 'ENOENT' });
});

test('linked config and linked destination paths are refused', async t => {
  const root = await project(t);
  const original = await readFile(path.join(root, 'nuxt.config.ts'), 'utf8');
  await writeFile(path.join(root, 'external.ts'), original);
  await rm(path.join(root, 'nuxt.config.ts'));
  await symlink(path.join(root, 'external.ts'), path.join(root, 'nuxt.config.ts'));
  await assert.rejects(run(['add', 'styles'], root), /linked path/);
  assert.equal(await readFile(path.join(root, 'external.ts'), 'utf8'), original);

  const other = await project(t);
  await mkdir(path.join(other, 'target'));
  await symlink(path.join(other, 'target'), path.join(other, 'app/assets'));
  await assert.rejects(run(['add', 'styles'], other), /linked path/);
});
