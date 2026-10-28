import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from '../src/cli/index.js';
import { excludeLocalConfig } from '../src/cli/local-config.js';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const excludePath = root => path.resolve(root, git(root, 'rev-parse', '--git-path', 'info/exclude'));
const ignored = (root, file) => git(root, 'check-ignore', '--', file);
async function project(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-init-ignore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  return root;
}

test('init locally excludes personal configuration and preserves shared ignore rules', async t => {
  const root = await project(t);
  await writeFile(path.join(root, '.gitignore'), '# Shared\nnode_modules/\n');
  await writeFile(excludePath(root), '# Personal\nother-file');
  const result = await run(['init', '--framework', 'vue'], root);
  assert.match(result, /excluded locally/);
  assert.equal(ignored(root, 'ms-front-kit.json'), 'ms-front-kit.json');
  assert.equal(await readFile(path.join(root, '.gitignore'), 'utf8'), '# Shared\nnode_modules/\n');
  const before = await readFile(excludePath(root), 'utf8');
  assert.ok(before.startsWith('# Personal\nother-file\n'));
  await excludeLocalConfig(root);
  assert.equal(await readFile(excludePath(root), 'utf8'), before);
  await assert.rejects(run(['init', '--framework', 'vue'], root), { code: 'EEXIST' });
  assert.equal(await readFile(excludePath(root), 'utf8'), before);
});

test('nested project exclusion escapes patterns and is scoped to the project', async t => {
  const root = await project(t);
  const nested = path.join(root, 'apps', 'site[one]');
  await mkdir(nested, { recursive: true });
  await run(['init', '--framework', 'vue'], nested);
  assert.equal(ignored(root, 'apps/site[one]/ms-front-kit.json'), 'apps/site[one]/ms-front-kit.json');
  assert.throws(() => ignored(root, 'ms-front-kit.json'));
  assert.throws(() => ignored(root, 'apps/siteo/ms-front-kit.json'));
});

test('init uses the Git-resolved exclude file in a linked worktree', async t => {
  const root = await project(t);
  await writeFile(path.join(root, 'README.md'), 'Fixture');
  git(root, 'add', 'README.md');
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture');
  const linked = `${root}-linked`;
  t.after(() => rm(linked, { recursive: true, force: true }));
  git(root, 'worktree', 'add', '--detach', linked);
  await run(['init', '--framework', 'vue'], linked);
  assert.equal(ignored(linked, 'ms-front-kit.json'), 'ms-front-kit.json');
  assert.match(await readFile(excludePath(linked), 'utf8'), /^\/ms-front-kit.json$/m);
});

test('linked exclude files are refused before config creation', async t => {
  const root = await project(t);
  const target = path.join(root, 'keep');
  await writeFile(target, '# Preserve');
  await rm(excludePath(root));
  await symlink(target, excludePath(root));
  await assert.rejects(run(['init', '--framework', 'vue'], root), /regular file/);
  assert.equal(await readFile(target, 'utf8'), '# Preserve');
  await assert.rejects(readFile(path.join(root, 'ms-front-kit.json')), { code: 'ENOENT' });
});

test('already tracked configuration is reported without untracking it', async t => {
  const root = await project(t);
  await writeFile(path.join(root, 'ms-front-kit.json'), '{}');
  git(root, 'add', 'ms-front-kit.json');
  assert.match(await excludeLocalConfig(root), /already tracked/);
  assert.equal(git(root, 'ls-files', '--', 'ms-front-kit.json'), 'ms-front-kit.json');
});

test('init without Git still creates configuration with a privacy warning', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-init-no-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.match(await run(['init', '--framework', 'vue'], root), /no Git repository found/);
  assert.ok(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  await assert.rejects(readFile(path.join(root, '.gitignore')), { code: 'ENOENT' });
});
