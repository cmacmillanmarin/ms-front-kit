import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli/index.js';

async function project(t, initializeGit = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-private-conventions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (initializeGit) git(root, 'init', '-q');
  await run(['init', '--framework', 'vue'], root);
  return root;
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}
const doc = 'docs/conventions/ms-front-kit.md';
const excludePath = root => path.resolve(root, git(root, 'rev-parse', '--git-path', 'info/exclude').trim());
const ignored = (root, file) => spawnSync('git', ['-C', root, 'check-ignore', '--', file]).status === 0;

test('only personal conventions are locally excluded, without changing gitignore or duplicating entries', async t => {
  const root = await project(t);
  const original = '# Existing rules\nnode_modules/\n';
  await writeFile(path.join(root, '.gitignore'), original);
  await run(['add', 'conventions'], root);
  const first = await readFile(excludePath(root), 'utf8');
  assert.match(first, /^\/docs\/conventions\/ms-front-kit.md$/m);
  assert.doesNotMatch(first, /AGENTS.md/);
  assert.ok(ignored(root, doc));
  assert.equal(ignored(root, 'AGENTS.md'), false);
  assert.equal(await readFile(path.join(root, '.gitignore'), 'utf8'), original);
  await run(['add', 'conventions'], root);
  assert.equal(await readFile(excludePath(root), 'utf8'), first);
  const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /check whether `docs\/conventions\/ms-front-kit.md` exists/);
  assert.match(agents, /read and follow/);
  assert.match(agents, /when present is required/);
  assert.match(agents, /If the file is absent, continue normally. Do not create or fetch it/);
  assert.match(agents, /Shared project requirements take precedence/);
  assert.doesNotMatch(agents, /\]\(docs\/conventions/);
  git(root, 'add', '--', 'AGENTS.md');
  assert.match(git(root, 'ls-files'), /AGENTS.md/);
});

test('existing project instructions are not changed and no gitignore is created', async t => {
  const root = await project(t);
  await writeFile(path.join(root, 'AGENTS.md'), '# Shared project instructions\n');
  const result = await run(['add', 'conventions'], root);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), '# Shared project instructions\n');
  assert.match(result, /Add this reference manually/);
  assert.match(result, /read and follow/);
  await assert.rejects(readFile(path.join(root, '.gitignore')), { code: 'ENOENT' });
});

test('already tracked personal document produces a warning and stays tracked', async t => {
  const root = await project(t);
  await run(['add', 'conventions'], root);
  await writeFile(excludePath(root), '');
  git(root, 'add', '--', 'AGENTS.md', doc);
  const result = await run(['add', 'conventions'], root);
  assert.match(result, /already tracked by Git/);
  assert.match(result, /no tracked files were removed/);
  assert.match(git(root, 'ls-files'), /docs\/conventions\/ms-front-kit.md/);
  assert.match(git(root, 'ls-files'), /AGENTS.md/);
});

test('legacy kit ignore rules migrate even with customized conventions, preserving unrelated rules and AGENTS', async t => {
  const root = await project(t);
  await run(['add', 'conventions'], root);
  const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  await writeFile(path.join(root, doc), 'My personal edits\n');
  await writeFile(path.join(root, '.gitignore'), '# Existing rules\nnode_modules/\n\n# ms-front-kit personal coding conventions\n/docs/conventions/ms-front-kit.md\n/AGENTS.md\n.env\n');
  const result = await run(['add', 'conventions'], root);
  assert.match(result, /Removed legacy kit-managed/);
  assert.match(result, /Compare and update it manually/);
  assert.equal(await readFile(path.join(root, doc), 'utf8'), 'My personal edits\n');
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), agents);
  assert.equal(await readFile(path.join(root, '.gitignore'), 'utf8'), '# Existing rules\nnode_modules/\n\n.env\n');
  assert.equal(ignored(root, 'AGENTS.md'), false);
  assert.ok(ignored(root, doc));
});

test('unrelated AGENTS ignore rules are preserved and reported for manual review', async t => {
  const root = await project(t);
  await writeFile(path.join(root, '.gitignore'), '# Project owner rule\n/AGENTS.md\n');
  const result = await run(['add', 'conventions'], root);
  assert.match(result, /existing Git ignore rule still matches AGENTS.md/);
  assert.equal(await readFile(path.join(root, '.gitignore'), 'utf8'), '# Project owner rule\n/AGENTS.md\n');
});

test('older mandatory references are preserved with a suggested optional replacement', async t => {
  const root = await project(t);
  const old = `# Existing instructions\nRead [conventions](${doc}) before working.\n`;
  await writeFile(path.join(root, 'AGENTS.md'), old);
  const result = await run(['add', 'conventions'], root);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), old);
  assert.match(result, /Review its old reference and replace it manually/);
  assert.match(result, /If the file is absent, continue normally/);
});

test('local exclusions are scoped to a nested project, including literal pattern characters', async t => {
  const root = await project(t);
  const nested = path.join(root, 'apps', 'site[one]');
  await mkdir(nested, { recursive: true });
  await run(['init', '--framework', 'vue'], nested);
  await run(['add', 'conventions'], nested);
  assert.ok(ignored(root, `apps/site[one]/${doc}`));
  assert.equal(ignored(root, doc), false);
  assert.equal(ignored(root, `apps/siteo/${doc}`), false);
});

test('linked worktrees use the Git-resolved local exclude location', async t => {
  const root = await project(t);
  git(root, 'add', '--', 'ms-front-kit.json');
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Test fixture');
  const linked = `${root}-linked`;
  t.after(() => rm(linked, { recursive: true, force: true }));
  git(root, 'worktree', 'add', '--detach', linked);
  await run(['add', 'conventions'], linked);
  assert.ok(ignored(linked, doc));
  assert.equal(ignored(linked, 'AGENTS.md'), false);
  assert.match(await readFile(excludePath(linked), 'utf8'), /^\/docs\/conventions\/ms-front-kit.md$/m);
});

test('a linked exclude file is refused before creating convention files', async t => {
  const root = await project(t);
  const target = path.join(root, 'other-exclude');
  await writeFile(target, '# Keep untouched\n');
  await rm(excludePath(root));
  await symlink(target, excludePath(root));
  await assert.rejects(run(['add', 'conventions'], root), /regular file/);
  assert.equal(await readFile(target, 'utf8'), '# Keep untouched\n');
  await assert.rejects(readFile(path.join(root, doc)), { code: 'ENOENT' });
});

test('a linked gitignore is refused before creating convention files', async t => {
  const root = await project(t);
  const target = path.join(root, 'other-ignore');
  await writeFile(target, '# Keep untouched\n');
  await symlink(target, path.join(root, '.gitignore'));
  await assert.rejects(run(['add', 'conventions'], root), /regular file/);
  assert.equal(await readFile(target, 'utf8'), '# Keep untouched\n');
  await assert.rejects(readFile(path.join(root, doc)), { code: 'ENOENT' });
});

test('without Git the installer stops before generating personal files', async t => {
  const root = await project(t, false);
  await assert.rejects(run(['add', 'conventions'], root), /requires a Git repository/);
  await assert.rejects(readFile(path.join(root, doc)), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(root, 'AGENTS.md')), { code: 'ENOENT' });
});
