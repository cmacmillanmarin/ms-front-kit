import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { run } from '../src/cli/index.js';

test('kit styles are isolated from existing project files and loaded first', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-isolation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await run(['init', '--framework', 'nuxt', '--no-install'], root);
  await mkdir(path.join(root, 'app/assets/scss/base'), { recursive: true });
  await writeFile(path.join(root, 'app/assets/scss/main.scss'), '/* project styles */');
  await writeFile(path.join(root, 'app/assets/scss/base/_reset.scss'), '/* project reset */');
  await writeFile(path.join(root, 'nuxt.config.ts'), 'export default defineNuxtConfig({css: ["./app/assets/scss/main.scss"]});');
  await run(['add', 'styles'], root);
  const config = await readFile(path.join(root, 'nuxt.config.ts'), 'utf8');
  assert.match(config, /css: \["@\/assets\/scss\/ms-front-kit\/main.scss", "\.\/app\/assets\/scss\/main.scss"\]/);
  assert.equal(await readFile(path.join(root, 'app/assets/scss/main.scss'), 'utf8'), '/* project styles */');
  assert.equal(await readFile(path.join(root, 'app/assets/scss/base/_reset.scss'), 'utf8'), '/* project reset */');
  await run(['add', 'styles'], root);
  assert.equal(await readFile(path.join(root, 'nuxt.config.ts'), 'utf8'), config);
});
