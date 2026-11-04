import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { run } from '../src/cli/index.js';
import { addComposable } from '../src/cli/composables.js';
import { initialize } from '../src/cli/init.js';
import { packageRanges } from '../src/cli/packages.js';

const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
const execute = promisify(execFile);
const scroll = ['add', 'composable', 'useScroll', '--no-install'];

async function project(t, framework, pkg) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-no-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (pkg !== undefined) await writeFile(path.join(root, 'package.json'), pkg);
  if (framework === 'nuxt') await writeFile(path.join(root, 'nuxt.config.ts'), 'export default defineNuxtConfig({});\n');
  if (framework === 'vue') {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/main.ts'), 'export {};\n');
  }
  return root;
}

const readPkg = async root => readFile(path.join(root, 'package.json'), 'utf8');
const present = async file => { try { await lstat(file); return true; } catch { return false; } };
const safe = async (base, relative) => {
  const directory = path.join(base, relative);
  await mkdir(directory, { recursive: true });
  return directory;
};
const config = framework => ({ framework, paths: { components: 'app/components', composables: 'app/composables', store: 'app/store', types: 'app/types', styles: 'app/assets/scss' }, components: {}, styles: { grid: false } });

test('every package the kit can install has one declared range, matching what its tests use', async () => {
  const composables = JSON.parse(await readFile(new URL('../templates/vue/composables/catalog.json', import.meta.url), 'utf8'));
  const stores = JSON.parse(await readFile(new URL('../templates/vue/stores/catalog.json', import.meta.url), 'utf8'));
  const names = new Set(['gsap']); // Nuxt init.
  for (const entry of [...Object.values(composables), ...Object.values(stores)]) {
    for (const list of Object.values(entry.packages || {})) for (const name of list) names.add(name);
  }
  assert.deepEqual(Object.keys(packageRanges).sort(), [...names].sort());
  for (const range of Object.values(packageRanges)) assert.match(range, /^\^\d+\.\d+\.\d+$/);
  const kit = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['gsap', 'pinia']) assert.equal(packageRanges[name], kit.devDependencies[name]);
});

for (const [framework, added, list] of [
  ['nuxt', { '@pinia/nuxt': packageRanges['@pinia/nuxt'], gsap: packageRanges.gsap, pinia: packageRanges.pinia }, /Added @pinia\/nuxt@\S+, pinia@\S+ to package\.json/],
  ['vue', { gsap: packageRanges.gsap, pinia: packageRanges.pinia }, /Added gsap@\S+, pinia@\S+ to package\.json/]
]) {
  test(`${framework}: init and useScroll declare every package and repeat runs change nothing`, async t => {
    const root = await project(t, framework, '{\n  "name": "site",\n  "private": true\n}\n');
    await run(['init', '--framework', framework, '--no-install'], root);
    assert.deepEqual(JSON.parse(await readPkg(root)).dependencies ?? {}, framework === 'nuxt' ? { gsap: packageRanges.gsap } : {});
    const message = await run(scroll, root);
    assert.match(message, list);
    assert.match(message, /nothing was installed\. Run a plain install with your package manager\./);
    const pkg = await readPkg(root);
    assert.deepEqual(JSON.parse(pkg).dependencies, added);
    assert.deepEqual(Object.keys(JSON.parse(pkg).dependencies), Object.keys(added).sort((a, b) => a.localeCompare(b, 'en')));
    assert.equal(await present(path.join(root, 'node_modules')), false);
    assert.doesNotMatch(await run(scroll, root), /Added /);
    assert.equal(await readPkg(root), pkg);
  });
}

test('runs with no package manager on PATH, in a project that uses another one', async t => {
  const root = await project(t, 'nuxt', '{"packageManager":"pnpm@10.0.0"}\n');
  await writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const empty = await mkdtemp(path.join(os.tmpdir(), 'ms-empty-path-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  const env = { PATH: empty };
  await execute(process.execPath, [cli, 'init', '--framework', 'nuxt', '--no-install'], { cwd: root, env });
  await execute(process.execPath, [cli, ...scroll], { cwd: root, env });
  assert.deepEqual(Object.keys(JSON.parse(await readPkg(root)).dependencies), ['@pinia/nuxt', 'gsap', 'pinia']);
  assert.equal(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'), 'lockfileVersion: 9\n');
});

test('existing entries are never changed, including devDependencies and empty ranges', async t => {
  const root = await project(t, 'nuxt', JSON.stringify({ devDependencies: { pinia: 'workspace:*' }, dependencies: { zod: '1.0.0', gsap: '', 'Abc': '2.0.0' } }, null, 2));
  await run(['init', '--framework', 'nuxt', '--no-install'], root);
  const message = await run(scroll, root);
  assert.match(message, /Added @pinia\/nuxt@/);
  assert.doesNotMatch(message, /gsap@|pinia@\^/);
  const pkg = JSON.parse(await readPkg(root));
  assert.deepEqual(pkg.devDependencies, { pinia: 'workspace:*' });
  assert.equal(pkg.dependencies.gsap, '');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@pinia/nuxt', 'Abc', 'gsap', 'zod']);
  assert.deepEqual(Object.keys(pkg), ['devDependencies', 'dependencies']);
  assert.equal(pkg.devDependencies['@pinia/nuxt'], undefined);
});

for (const source of ['{"dependencies":{"gsap":""}}\n', '{"devDependencies":{"gsap":""}}\n']) {
  test(`installing and declaring both treat an empty range as declared: ${source.trim()}`, async t => {
    for (const options of [{ installDependencies: () => assert.fail('gsap is already declared') }, { install: false }]) {
      const root = await project(t, 'nuxt', source);
      assert.doesNotMatch(await addComposable(root, config('nuxt'), 'useRaf', safe, options), /Installed |Added /);
      assert.equal(await readPkg(root), source);
    }
  });
}

test('init reports gsap that is already declared and leaves the file alone', async t => {
  const source = '{"devDependencies":{"gsap":"3.0.0"}}';
  const root = await project(t, 'nuxt', source);
  assert.match(await run(['init', '--framework', 'nuxt', '--no-install'], root), /gsap is already in package\.json/);
  assert.equal(await readPkg(root), source);
});

for (const [label, source, expected] of [
  ['two spaces', '{\n  "a": 1\n}\n', '{\n  "a": 1,\n  "dependencies": {\n    "gsap": "R"\n  }\n}\n'],
  ['four spaces, no trailing newline', '{\n    "a": 1\n}', '{\n    "a": 1,\n    "dependencies": {\n        "gsap": "R"\n    }\n}'],
  ['tabs and two trailing newlines', '{\n\t"a": 1\n}\n\n', '{\n\t"a": 1,\n\t"dependencies": {\n\t\t"gsap": "R"\n\t}\n}\n\n'],
  ['CRLF', '{\r\n  "a": 1\r\n}\r\n', '{\r\n  "a": 1,\r\n  "dependencies": {\r\n    "gsap": "R"\r\n  }\r\n}\r\n'],
  ['one line', '{"a":1}', '{"a":1,"dependencies":{"gsap":"R"}}'],
  ['empty object', '{}\n', '{\n  "dependencies": {\n    "gsap": "R"\n  }\n}\n']
]) {
  test(`package.json formatting is preserved: ${label}`, async t => {
    const root = await project(t, 'nuxt', source);
    await run(['init', '--framework', 'nuxt', '--no-install'], root);
    assert.equal(await readPkg(root), expected.replace('R', packageRanges.gsap));
  });
}

test('without package.json nothing is created and the ranges are printed', async t => {
  for (const [framework, args] of [['nuxt', ['init', '--framework', 'nuxt', '--no-install']], ['nuxt', scroll]]) {
    const root = await project(t, framework);
    if (args === scroll) await run(['init', '--framework', 'nuxt', '--no-install'], root);
    const message = await run(args, root);
    assert.match(message, /No package\.json found, so none was created/);
    assert.ok(message.includes(`"gsap": "${packageRanges.gsap}"`));
    assert.equal(await present(path.join(root, 'package.json')), false);
  }
});

for (const source of ['{ not json', 'null', '[]', '{"dependencies":[]}', '{"devDependencies":"gsap"}']) {
  test(`unusable package.json is refused before any file is written: ${source}`, async t => {
    const root = await project(t, 'nuxt', source);
    await assert.rejects(run(['init', '--framework', 'nuxt', '--no-install'], root), /package\.json .*nothing was changed/);
    assert.equal(await present(path.join(root, 'ms-front-kit.json')), false);
    assert.equal(await readPkg(root), source);

    await writeFile(path.join(root, 'package.json'), '{}');
    await run(['init', '--framework', 'nuxt', '--no-install'], root);
    await writeFile(path.join(root, 'package.json'), source);
    await assert.rejects(run(scroll, root), /package\.json .*nothing was changed/);
    assert.equal(await present(path.join(root, 'app/composables/useScroll.ts')), false);
    assert.equal(await readPkg(root), source);
  });
}

test('a linked package.json is refused before any file is written', async t => {
  const root = await project(t, 'nuxt', undefined);
  await writeFile(path.join(root, 'shared.json'), '{}\n');
  await symlink(path.join(root, 'shared.json'), path.join(root, 'package.json'));
  await assert.rejects(run(['init', '--framework', 'nuxt', '--no-install'], root), /linked/);
  assert.equal(await present(path.join(root, 'ms-front-kit.json')), false);
  assert.equal(await readFile(path.join(root, 'shared.json'), 'utf8'), '{}\n');
});

test('package.json is edited after the files, and left alone if it changed meanwhile', async t => {
  const root = await project(t, 'nuxt', '{}\n');
  const changing = async (base, relative) => {
    await writeFile(path.join(base, 'package.json'), '{"changed":true}\n');
    return safe(base, relative);
  };
  await assert.rejects(addComposable(root, config('nuxt'), 'useRaf', changing, { install: false }), error => {
    assert.match(error.message, /Created app\/composables\/useRaf\.ts/);
    assert.match(error.message, /package\.json changed during installation, so it was not edited/);
    assert.ok(error.message.includes(`"gsap": "${packageRanges.gsap}"`));
    return true;
  });
  assert.equal(await readPkg(root), '{"changed":true}\n');
  assert.ok((await readdir(path.join(root, 'app/composables'))).includes('useRaf.ts'));

  const other = await project(t, 'nuxt', '{}\n');
  await assert.rejects(initialize(other, 'nuxt', changing, { install: false }), /Created configuration and plugin, but gsap was not declared\. package\.json changed/);
  assert.equal(await readPkg(other), '{"changed":true}\n');
  assert.equal(await present(path.join(other, 'app/plugins/ms-front-kit.client.ts')), true);

  // A package.json that appears while the command runs is not overwritten either.
  const absent = await project(t, 'nuxt');
  await assert.rejects(addComposable(absent, config('nuxt'), 'useRaf', changing, { install: false }), /changed during installation/);
  assert.equal(await readPkg(absent), '{"changed":true}\n');
});

test('composables without packages leave package.json alone', async t => {
  const root = await project(t, 'nuxt', '{}\n');
  await run(['init', '--framework', 'nuxt', '--no-install'], root);
  const before = await readPkg(root);
  const message = await run(['add', 'composable', 'useResize', '--no-install'], root);
  assert.doesNotMatch(message, /package\.json/);
  assert.equal(await readPkg(root), before);
});

test('the default path still installs instead of declaring', async t => {
  const root = await project(t, 'nuxt', '{}\n');
  const calls = [];
  await initialize(root, 'nuxt', safe, { installDependencies: async () => { calls.push('gsap'); } });
  assert.deepEqual(calls, ['gsap']);
  assert.equal(await readPkg(root), '{}\n');
});
