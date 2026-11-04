import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { run } from '../src/cli/index.js';
import { addComponent } from '../src/cli/component.js';
import { packageRanges } from '../src/cli/packages.js';

const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
const execute = promisify(execFile);
const offline = ['add', 'component', 'ProductCard', '--no-install'];
const generated = 'app/components/ProductCard.vue';

async function project(t, pkg) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-component-sass-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'ms-front-kit.json'), JSON.stringify({
    version: 1, framework: 'nuxt',
    paths: { components: 'app/components', composables: 'app/composables', store: 'app/store', types: 'app/types', styles: 'app/assets/scss' },
    components: { naming: 'PascalCase', style: 'scss', bem: true },
    styles: { grid: false }
  }));
  if (pkg !== undefined) await writeFile(path.join(root, 'package.json'), pkg);
  return root;
}

const readPkg = root => readFile(path.join(root, 'package.json'), 'utf8');
const present = async file => { try { await lstat(file); return true; } catch { return false; } };
const safe = async (base, relative) => {
  const directory = path.join(base, relative);
  await mkdir(directory, { recursive: true });
  return directory;
};

async function fakeNpm(t, status = 0) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ms-fake-npm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = path.join(directory, 'calls.log');
  await writeFile(path.join(directory, 'npm'), `#!/bin/sh\necho "$*" >> "${log}"\nexit ${status}\n`);
  await chmod(path.join(directory, 'npm'), 0o755);
  return {
    env: { PATH: `${directory}${path.delimiter}/bin${path.delimiter}/usr/bin` },
    calls: async () => { try { return (await readFile(log, 'utf8')).trim().split('\n'); } catch { return []; } }
  };
}

test('--no-install declares sass as a dev dependency, once, keeping the file style', async t => {
  const root = await project(t, '{\n    "name": "site"\n}\n');
  const message = await run(offline, root);
  assert.match(message, /Created app\/components\/ProductCard\.vue/);
  assert.match(message, /Added sass@\S+ to package\.json devDependencies; nothing was installed\./);
  const pkg = await readPkg(root);
  assert.deepEqual(JSON.parse(pkg).devDependencies, { sass: packageRanges.sass });
  assert.match(pkg, /^\{\n {4}"name"/);
  assert.equal(await present(path.join(root, 'node_modules')), false);
  assert.doesNotMatch(await run(['add', 'component', 'OtherCard', '--no-install'], root), /Added /);
  assert.equal(await readPkg(root), pkg);
});

test('--no-install without package.json creates none and prints the section', async t => {
  const root = await project(t);
  const message = await run(offline, root);
  assert.match(message, /No package\.json found/);
  assert.match(message, /devDependencies: "sass": "\^/);
  assert.ok(await present(path.join(root, generated)));
  assert.equal(await present(path.join(root, 'package.json')), false);
});

test('--no-install refuses an invalid package.json before creating the component', async t => {
  const root = await project(t, '{ nope');
  await assert.rejects(run(offline, root), /not valid JSON/);
  assert.equal(await present(path.join(root, 'app')), false);
});

test('the default path installs sass through npm --save-dev, after the component', async t => {
  const root = await project(t, '{}\n');
  const npm = await fakeNpm(t);
  const { stdout } = await execute(process.execPath, [cli, 'add', 'component', 'ProductCard'], { cwd: root, env: npm.env });
  assert.match(stdout, /Created app\/components\/ProductCard\.vue\nInstalled sass with npm\./);
  assert.deepEqual(await npm.calls(), ['install --save-dev sass']);
  assert.equal(await readPkg(root), '{}\n');

  const seen = [];
  const config = JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  await addComponent(root, config, 'OtherCard', safe, { installDependencies: async (directory, names) => {
    seen.push(names);
    assert.ok(await present(path.join(directory, 'app/components/OtherCard.vue')));
  } });
  assert.deepEqual(seen, [['sass']]);
});

for (const compiler of ['sass', 'sass-embedded']) {
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    test(`${compiler} in ${section} runs nothing and changes nothing, with or without the flag`, async t => {
      const source = `${JSON.stringify({ packageManager: 'pnpm@10.0.0', [section]: { [compiler]: '*' } }, null, 2)}\n`;
      const root = await project(t, source);
      await writeFile(path.join(root, 'pnpm-lock.yaml'), '');
      const npm = await fakeNpm(t);
      const { stdout } = await execute(process.execPath, [cli, 'add', 'component', 'ProductCard'], { cwd: root, env: npm.env });
      assert.equal(stdout.trim(), `Created ${generated}`);
      assert.equal(await run(['add', 'component', 'OtherCard', '--no-install'], root), 'Created app/components/OtherCard.vue');
      assert.deepEqual(await npm.calls(), []);
      assert.equal(await readPkg(root), source);
    });
  }
}

for (const [name, pkg, lockfile, error] of [
  ['packageManager', '{"packageManager":"pnpm@10.0.0"}\n', null, /Use --no-install/],
  ['a non-npm lockfile', '{}\n', 'pnpm-lock.yaml', /Use --no-install/],
  ['no package.json', undefined, null, /--no-install/]
]) {
  test(`with sass missing, ${name} refuses before writing and names --no-install`, async t => {
    const root = await project(t, pkg);
    if (lockfile) await writeFile(path.join(root, lockfile), '');
    const npm = await fakeNpm(t);
    await assert.rejects(execute(process.execPath, [cli, 'add', 'component', 'ProductCard'], { cwd: root, env: npm.env }), error);
    assert.deepEqual(await npm.calls(), []);
    assert.equal(await present(path.join(root, 'app')), false);
    if (pkg !== undefined) assert.equal(await readPkg(root), pkg);
  });
}

test('a pnpm project uses --no-install with no package manager on PATH', async t => {
  const root = await project(t, '{"packageManager":"pnpm@10.0.0"}\n');
  await writeFile(path.join(root, 'pnpm-lock.yaml'), '');
  await execute(process.execPath, [cli, ...offline], { cwd: root, env: { PATH: '/nonexistent' } });
  assert.equal(JSON.parse(await readPkg(root)).devDependencies.sass, packageRanges.sass);
});

test('an existing component is refused and installs or declares nothing', async t => {
  const root = await project(t, '{"devDependencies":{"sass":"*"}}\n');
  await run(offline, root);
  await writeFile(path.join(root, 'package.json'), '{}\n');
  await assert.rejects(run(offline, root), { code: 'EEXIST' });
  assert.equal(await readPkg(root), '{}\n');
  const seen = [];
  const config = JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  await assert.rejects(addComponent(root, config, 'ProductCard', safe, { installDependencies: async () => seen.push('install') }), { code: 'EEXIST' });
  assert.deepEqual(seen, []);
});

test('a failed install keeps the component and names the command', async t => {
  const root = await project(t, '{}\n');
  const npm = await fakeNpm(t, 1);
  await assert.rejects(execute(process.execPath, [cli, 'add', 'component', 'ProductCard'], { cwd: root, env: npm.env }), /Created app\/components\/ProductCard\.vue[\s\S]*npm install --save-dev sass/);
  assert.ok(await present(path.join(root, generated)));
});

test('add component rejects other arguments', async t => {
  const root = await project(t, '{}\n');
  await assert.rejects(run(['add', 'component', 'ProductCard', '--force'], root), /Usage: ms-front-kit add component ProductCard \[--no-install\]/);
  await assert.rejects(run(['add', 'component', 'ProductCard', '--no-install', 'x'], root), /Usage/);
  assert.equal(await present(path.join(root, 'app')), false);
});

test('help and the rendered conventions describe it', async t => {
  assert.match(await run(['--help']), /add component ProductCard \[--no-install\]/);
  const root = await project(t, '{}\n');
  await execute('git', ['init', '--quiet'], { cwd: root });
  await run(['add', 'conventions'], root);
  const doc = await readFile(path.join(root, 'docs/conventions/ms-front-kit.md'), 'utf8');
  assert.match(doc, /add styles` and `add component` run\s+`npm install --save-dev sass`/);
});
