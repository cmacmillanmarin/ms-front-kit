import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli/index.js';

async function project(t, framework = 'nuxt') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-front-kit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await run(['init', '--framework', framework, '--no-install'], root);
  return root;
}

test('Nuxt component generation uses BEM, SCSS and shared Vue template', async t => {
  const root = await project(t);
  await run(['add', 'component', 'XMLViewer'], root);
  const content = await readFile(path.join(root, 'app/components/XMLViewer.vue'), 'utf8');
  assert.match(content, /class="xml-viewer"/);
  assert.match(content, /<p class="xml-viewer__name">XMLViewer<\/p>/);
  assert.match(content, /<style lang="scss">\n\/\/ @use "abstracts" as \*;/);
  assert.doesNotMatch(content, /<slot\b/);
  assert.match(content, /<script setup lang="ts">/);
  assert.match(content, /<style lang="scss">/);
  assert.doesNotMatch(content, /<style[^>]*\bscoped\b/);
  assert.doesNotMatch(content, /\{\{/);
});

test('Vue defaults and custom component paths', async t => {
  const root = await project(t, 'vue');
  const file = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(config.paths.components, 'src/components');
  config.paths.components = 'src/ui';
  await writeFile(file, JSON.stringify(config));
  await run(['add', 'component', 'ProductCard'], root);
  assert.match(await readFile(path.join(root, 'src/ui/ProductCard.vue'), 'utf8'), /product-card/);
});

test('initialization and component generation do not overwrite', async t => {
  const root = await project(t);
  await assert.rejects(run(['init', '--framework', 'vue'], root), { code: 'EEXIST' });
  await run(['add', 'component', 'ProductCard'], root);
  const file = path.join(root, 'app/components/ProductCard.vue');
  await writeFile(file, 'custom project code');
  await assert.rejects(run(['add', 'component', 'ProductCard'], root), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), 'custom project code');
});

test('nested component paths produce matching directory and namespace', async t => {
  const root = await project(t);
  const message = await run(['add', 'component', 'Home/Hero/BackButton'], root);
  const file = path.join(root, 'app/components/Home/Hero/BackButton.vue');
  const content = await readFile(file, 'utf8');
  assert.match(message, /app\/components\/Home\/Hero\/BackButton.vue/);
  assert.match(content, /<template>\s*<div class="home__hero__back-button">/);
  assert.match(content, /\.home__hero__back-button \{/);
  assert.match(content, /<script setup lang="ts">/);
  assert.match(content, /<style lang="scss">/);
  assert.doesNotMatch(content, /scoped/);
  await assert.rejects(run(['add', 'component', 'Home/Hero/BackButton'], root), { code: 'EEXIST' });
});

test('nested paths respect a custom component root', async t => {
  const root = await project(t, 'vue');
  const file = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(file, 'utf8'));
  config.paths.components = 'src/ui';
  await writeFile(file, JSON.stringify(config));
  await run(['add', 'component', 'Home/XMLViewer'], root);
  const content = await readFile(path.join(root, 'src/ui/Home/XMLViewer.vue'), 'utf8');
  assert.match(content, /class="home__xml-viewer"/);
  assert.match(content, /<style lang="scss">\n\/\/ @use "abstracts" as \*;/);
});

for (const framework of ['nuxt', 'vue']) {
  test(`${framework} Index entry points omit only the final Index from the namespace`, async t => {
    const root = await project(t, framework);
    const configFile = path.join(root, 'ms-front-kit.json');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    config.paths.components = 'custom/ui';
    await writeFile(configFile, JSON.stringify(config));
    for (const [input, namespace] of [
      ['Header/Index', 'header'],
      ['Home/Header/Index', 'home__header'],
      ['Index', 'index'],
      ['Index/BackButton', 'index__back-button'],
      ['Index/Index', 'index'],
      ['Header/IndexButton', 'header__index-button'],
      ['Footer/INDEX', 'footer__index'],
      ['Header/Navigation', 'header__navigation'],
    ]) {
      await run(['add', 'component', input], root);
      const file = path.join(root, 'custom/ui', `${input}.vue`);
      const content = await readFile(file, 'utf8');
      assert.ok(content.includes(`<div class="${namespace}">`), input);
      assert.ok(content.includes(`.${namespace} {`), input);
      assert.ok(content.includes(`<p class="${namespace}__name">${input.split('/').at(-1)}</p>`), input);
      const style = content.match(/<style lang="scss">([\s\S]*?)<\/style>/)[1];
      assert.doesNotMatch(style, /__name/);
      assert.doesNotMatch(content, /\{\{/);
      await assert.rejects(run(['add', 'component', input], root), { code: 'EEXIST' });
      assert.equal(await readFile(file, 'utf8'), content);
    }
    const file = path.join(root, 'custom/ui/Header/Index.vue');
    await writeFile(file, 'customized entry point');
    await assert.rejects(run(['add', 'component', 'Header/Index'], root), { code: 'EEXIST' });
    assert.equal(await readFile(file, 'utf8'), 'customized entry point');
  });
}

test('rejects unsafe or malformed component paths', async t => {
  const root = await project(t);
  for (const input of ['/Home/Card', 'Home//Card', 'Home/../Card', 'Home/./Card', 'Home/Card/', 'Home/card', 'Home/Card.vue', 'Home\\Card', 'Home/Back-Button']) {
    await assert.rejects(run(['add', 'component', input], root), /PascalCase/);
  }
});

test('rejects invalid names, traversal and malformed grid setting', async t => {
  const root = await project(t);
  await assert.rejects(run(['add', 'component', '../Other'], root), /PascalCase/);
  const file = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(file, 'utf8'));
  config.paths.components = '../outside';
  await writeFile(file, JSON.stringify(config));
  await assert.rejects(run(['add', 'component', 'Card'], root), /relative path/);
  config.paths.components = 'app/components';
  config.styles.grid = 'yes';
  await writeFile(file, JSON.stringify(config));
  await assert.rejects(run(['add', 'component', 'Card'], root), /must be a boolean/);
});

test('rejects output through an escaping symlink', async t => {
  const root = await project(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'ms-front-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(root, 'app/components'));
  await assert.rejects(run(['add', 'component', 'Card'], root), /outside the project/);
});
