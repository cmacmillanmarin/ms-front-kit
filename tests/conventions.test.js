import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { run } from '../src/cli/index.js';

async function project(t, framework = 'nuxt') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-conventions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['-C', root, 'init', '-q']);
  await run(['init', '--framework', framework, '--no-install'], root);
  return root;
}
const conventions = root => path.join(root, 'docs/conventions/ms-front-kit.md');

test('creates conventions whose example matches real generated code, and an agent reference', async t => {
  const root = await project(t);
  await run(['add', 'conventions'], root);
  await run(['add', 'component', 'Home/Hero/BackButton'], root);
  const doc = await readFile(conventions(root), 'utf8');
  const component = await readFile(path.join(root, 'app/components/Home/Hero/BackButton.vue'), 'utf8');
  assert.equal(doc.match(/```vue\n([\s\S]*?)\n```/)[1], component.trimEnd());
  assert.match(doc, /\*\*nuxt\*\*/);
  assert.match(doc, /app\/components/);
  assert.match(doc, /home__hero__back-button/);
  assert.match(doc, /unscoped/);
  assert.match(doc, /Always use a wrapper/);
  assert.match(doc, /Manual Nuxt installation/);
  assert.match(doc, /Manual Vue installation/);
  assert.match(doc, /@\/assets\/scss\/ms-front-kit\/main.scss/);
  assert.match(doc, /does not install styles/);
  assert.match(doc, /browser's root font size/);
  assert.match(doc, /app\/components\/Helper\/Grid.vue/);
  assert.match(doc, /Development grid overlay/);
  assert.match(doc, /import.meta.dev/);
  assert.match(doc, /import.meta.env.DEV/);
  assert.match(doc, /AI-generated components must reuse the installed SCSS mixins and functions/);
  assert.match(doc, /Always use `rem\(\)`/);
  assert.match(doc, /margins, gaps, or dimensions around text/);
  assert.match(doc, /@use "abstracts" as \*;/);
  assert.match(doc, /padding-inline: rem\(32px\)/);
  assert.match(doc, /add styles` configures the Vite alias/);
  assert.match(doc, /abstracts: fileURLToPath\(new URL\("\.\/app\/assets\/scss\/ms-front-kit\/abstracts"/);
  assert.doesNotMatch(doc, /@include ms\.|ms\.rem\(/);
  assert.doesNotMatch(doc, /\{\{/);
  assert.match(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), /docs\/conventions\/ms-front-kit.md/);
});

test('preserves an existing AGENTS.md and prints a manual reference', async t => {
  const root = await project(t);
  const file = path.join(root, 'AGENTS.md');
  const original = '# My project\n\nKeep these decisions.\n';
  await writeFile(file, original);
  const message = await run(['add', 'conventions'], root);
  assert.equal(await readFile(file, 'utf8'), original);
  assert.match(message, /Add this reference manually/);
  assert.match(message, /docs\/conventions\/ms-front-kit.md/);
});

test('repeat runs do not duplicate instructions or change current conventions', async t => {
  const root = await project(t);
  await run(['add', 'conventions'], root);
  const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  const doc = await readFile(conventions(root), 'utf8');
  const message = await run(['add', 'conventions'], root);
  assert.match(message, /no duplicate/);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), agents);
  assert.equal(await readFile(conventions(root), 'utf8'), doc);
});

test('customized documents are never overwritten', async t => {
  const root = await project(t);
  await run(['add', 'conventions'], root);
  await writeFile(conventions(root), 'My customized conventions');
  const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(await run(['add', 'conventions'], root), /update it manually/);
  assert.equal(await readFile(conventions(root), 'utf8'), 'My customized conventions');
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), agents);
});

test('uses Vue configuration and customized paths', async t => {
  const root = await project(t, 'vue');
  const file = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(file, 'utf8'));
  config.paths.components = 'src/ui';
  await writeFile(file, JSON.stringify(config));
  await run(['add', 'conventions'], root);
  const doc = await readFile(conventions(root), 'utf8');
  assert.match(doc, /\*\*vue\*\*/);
  assert.match(doc, /src\/ui/);
  assert.match(doc, /src\/ui\/Helper\/Grid.vue/);
  assert.match(doc, /src\/composables/);
  await run(['add', 'component', 'Home/Hero/BackButton'], root);
  const component = await readFile(path.join(root, 'src/ui/Home/Hero/BackButton.vue'), 'utf8');
  assert.equal(doc.match(/```vue\n([\s\S]*?)\n```/)[1], component.trimEnd());
  assert.match(component, /\/\/ @use "abstracts" as \*;/);
});

test('refuses linked instruction files without changing their target', async t => {
  const root = await project(t);
  const target = path.join(root, 'personal-instructions.md');
  await writeFile(target, 'untouched');
  await symlink(target, path.join(root, 'AGENTS.md'));
  await assert.rejects(run(['add', 'conventions'], root), /regular file/);
  assert.equal(await readFile(target, 'utf8'), 'untouched');
  await assert.rejects(readFile(conventions(root)), { code: 'ENOENT' });
});
