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

test('an existing plugin is preserved without creating configuration', async t => {
  const root = await project(t);
  await directory(root, 'app/plugins');
  const file = path.join(root, 'app/plugins/ms-front-kit.client.ts');
  await writeFile(file, 'custom plugin');
  await assert.rejects(run(['init', '--framework', 'nuxt', '--no-install'], root), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), 'custom plugin');
  await assert.rejects(readFile(path.join(root, 'ms-front-kit.json')), { code: 'ENOENT' });
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
