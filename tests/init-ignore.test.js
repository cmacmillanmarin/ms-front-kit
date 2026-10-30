import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { run } from '../src/cli/index.js';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const excludePath = root => path.resolve(root, git(root, 'rev-parse', '--git-path', 'info/exclude'));
const ignored = (root, file) => spawnSync('git', ['check-ignore', '-q', '--', file], { cwd: root }).status === 0;
async function project(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-init-ignore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  return root;
}

test('init leaves configuration shareable without changing ignore rules', async t => {
  const root = await project(t);
  await writeFile(path.join(root, '.gitignore'), '# Shared\nnode_modules/\n');
  await writeFile(excludePath(root), '# Personal\nother-file');
  const result = await run(['init', '--framework', 'vue'], root);
  assert.match(result, /Commit ms-front-kit.json/);
  assert.equal(ignored(root, 'ms-front-kit.json'), false);
  assert.equal(await readFile(path.join(root, '.gitignore'), 'utf8'), '# Shared\nnode_modules/\n');
  assert.equal(await readFile(excludePath(root), 'utf8'), '# Personal\nother-file');
});

test('an exclusion from older kit versions is preserved for manual review', async t => {
  const root = await project(t);
  const legacy = '# ms-front-kit personal configuration\n/ms-front-kit.json\n';
  await writeFile(excludePath(root), legacy);
  await run(['init', '--framework', 'vue'], root);
  assert.equal(await readFile(excludePath(root), 'utf8'), legacy);
});

test('init without Git still creates configuration', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-init-no-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.match(await run(['init', '--framework', 'vue'], root), /Created ms-front-kit.json/);
  assert.ok(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  await assert.rejects(readFile(path.join(root, '.gitignore')), { code: 'ENOENT' });
});
