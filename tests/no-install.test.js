import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { run } from '../src/cli/index.js';
import { addComposable } from '../src/cli/composables.js';
import { initialize } from '../src/cli/init.js';
import { addStyles } from '../src/cli/styles.js';
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
  for (const name of ['gsap', 'pinia', 'sass']) assert.equal(packageRanges[name], kit.devDependencies[name]);
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
    assert.deepEqual(JSON.parse(pkg).devDependencies, { sass: packageRanges.sass });
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
  assert.deepEqual(pkg.devDependencies, { pinia: 'workspace:*', sass: packageRanges.sass });
  assert.equal(pkg.dependencies.gsap, '');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@pinia/nuxt', 'Abc', 'gsap', 'zod']);
  assert.deepEqual(Object.keys(pkg), ['devDependencies', 'dependencies']);
  assert.equal(pkg.devDependencies['@pinia/nuxt'], undefined);
});

for (const source of ['{"dependencies":{"gsap":""}}\n', '{"devDependencies":{"gsap":""}}\n', '{"peerDependencies":{"gsap":""}}\n', '{"optionalDependencies":{"gsap":""}}\n']) {
  test(`installing and declaring both treat an empty range as declared: ${source.trim()}`, async t => {
    for (const options of [{ installDependencies: () => assert.fail('gsap is already declared') }, { install: false }]) {
      const root = await project(t, 'nuxt', source);
      assert.doesNotMatch(await addComposable(root, config('nuxt'), 'useRaf', safe, options), /Installed |Added /);
      assert.equal(await readPkg(root), source);
    }
  });
}

for (const section of ['devDependencies', 'peerDependencies', 'optionalDependencies']) {
  test(`init reports gsap already declared in ${section} and leaves the file alone`, async t => {
    const source = JSON.stringify({ [section]: { gsap: '3.0.0' } });
    const root = await project(t, 'nuxt', source);
    assert.match(await run(['init', '--framework', 'nuxt', '--no-install'], root), /gsap is already in package\.json/);
    assert.equal(await readPkg(root), source);
  });
}

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

const styles = ['add', 'styles', '--no-install'];
const initialized = async (t, framework, source) => {
  const root = await project(t, framework, source);
  await run(['init', '--framework', framework, '--no-install'], root);
  return root;
};
// A stand-in npm on PATH that records each call and exits with the given status.
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

for (const framework of ['nuxt', 'vue']) {
  test(`${framework}: add styles --no-install declares sass as a dev dependency and repeat runs change nothing`, async t => {
    const root = await initialized(t, framework, '{\n  "name": "site"\n}\n');
    const before = framework === 'nuxt' ? { gsap: packageRanges.gsap } : undefined;
    const message = await run(styles, root);
    assert.match(message, /Added sass@\S+ to package\.json devDependencies; nothing was installed\./);
    const pkg = await readPkg(root);
    assert.deepEqual(JSON.parse(pkg).devDependencies, { sass: packageRanges.sass });
    assert.deepEqual(JSON.parse(pkg).dependencies, before);
    assert.equal(await present(path.join(root, 'node_modules')), false);
    assert.doesNotMatch(await run(styles, root), /Added |Installed /);
    assert.equal(await readPkg(root), pkg);
  });
}

test('devDependencies is sorted like npm, and dependencies is left alone when only sass is added', async t => {
  const root = await initialized(t, 'vue', '{"devDependencies":{"zod":"1.0.0","eslint":"9.0.0"}}');
  await run(styles, root);
  const pkg = JSON.parse(await readPkg(root));
  assert.deepEqual(Object.keys(pkg), ['devDependencies']);
  assert.deepEqual(Object.keys(pkg.devDependencies), ['eslint', 'sass', 'zod']);
});

for (const source of ['{"devDependencies":{"sass":"1.0.0"}}', '{"dependencies":{"sass":""}}', '{"devDependencies":{"sass-embedded":"1.0.0"}}', '{"dependencies":{"sass-embedded":"1.0.0"}}', '{"peerDependencies":{"sass":"1.0.0"}}', '{"optionalDependencies":{"sass-embedded":"1.0.0"}}']) {
  test(`a declared compiler needs nothing in any mode: ${source}`, async t => {
    const vue = await initialized(t, 'vue', source);
    assert.doesNotMatch(await run(styles, vue), /sass@|Installed /);
    assert.equal(await readPkg(vue), source);
    assert.doesNotMatch(await run(scroll, vue), /sass@/);
    assert.equal(JSON.parse(await readPkg(vue)).devDependencies?.sass, JSON.parse(source).devDependencies?.sass);

    // Declared, so the default path needs no npm, even in a project that uses another manager.
    const other = await initialized(t, 'vue', source);
    await writeFile(path.join(other, 'pnpm-lock.yaml'), '');
    const config = JSON.parse(await readFile(path.join(other, 'ms-front-kit.json'), 'utf8'));
    assert.doesNotMatch(await addStyles(other, config, safe, { installDependencies: () => assert.fail('sass is already declared') }), /Installed /);
    assert.equal(await readPkg(other), source);
  });
}

test('add styles installs sass through npm --save-dev, after the files', async t => {
  const root = await initialized(t, 'nuxt', '{}\n');
  const npm = await fakeNpm(t);
  const { stdout } = await execute(process.execPath, [cli, 'add', 'styles'], { cwd: root, env: npm.env });
  assert.match(stdout, /Installed sass with npm\./);
  assert.deepEqual(await npm.calls(), ['install --save-dev sass']);

  const config = JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  const seen = [];
  await addStyles(root, config, safe, { installDependencies: async (directory, names) => {
    seen.push(names);
    assert.ok(await present(path.join(directory, 'app/assets/scss/ms-front-kit/main.scss')));
  } });
  assert.deepEqual(seen, [['sass']]);
});

test('useScroll installs runtime packages and sass in separate npm calls', async t => {
  const root = await initialized(t, 'vue', '{}\n');
  const npm = await fakeNpm(t);
  const { stdout } = await execute(process.execPath, [cli, 'add', 'composable', 'useScroll'], { cwd: root, env: npm.env });
  assert.match(stdout, /Installed pinia, gsap, sass with npm\./);
  assert.deepEqual(await npm.calls(), ['install pinia gsap', 'install --save-dev sass']);
});

test('a failed install names the dev dependency command', async t => {
  const root = await initialized(t, 'vue', '{}\n');
  const npm = await fakeNpm(t, 1);
  await assert.rejects(execute(process.execPath, [cli, 'add', 'styles'], { cwd: root, env: npm.env }), error => {
    assert.match(error.stderr, /Styles were installed, but installing sass failed\./);
    assert.match(error.stderr, /then run npm install --save-dev sass\./);
    return true;
  });
  assert.ok(await present(path.join(root, 'src/assets/scss/ms-front-kit/main.scss')));
  await assert.rejects(execute(process.execPath, [cli, 'add', 'composable', 'useScroll'], { cwd: root, env: npm.env }), /then run npm install pinia gsap && npm install --save-dev sass\./);
});

for (const [label, source, file] of [
  ['a pnpm lockfile', '{}\n', 'pnpm-lock.yaml'],
  ['a yarn lockfile', '{}\n', 'yarn.lock'],
  ['a packageManager field', '{"packageManager":"pnpm@10.0.0"}\n'],
  ['no package.json']
]) {
  test(`add styles without --no-install refuses before writing anything: ${label}`, async t => {
    const root = await initialized(t, 'nuxt', source);
    if (file) await writeFile(path.join(root, file), '');
    const before = await readFile(path.join(root, 'nuxt.config.ts'), 'utf8');
    const config = await readFile(path.join(root, 'ms-front-kit.json'), 'utf8');
    await assert.rejects(run(['add', 'styles'], root), /--no-install/);
    assert.equal(await present(path.join(root, 'app/assets')), false);
    assert.equal(await present(path.join(root, 'public')), false);
    assert.equal(await readFile(path.join(root, 'nuxt.config.ts'), 'utf8'), before);
    assert.equal(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'), config);
    await run(styles, root);
    assert.ok(await present(path.join(root, 'app/assets/scss/ms-front-kit/main.scss')));
  });
}

test('add styles --no-install runs with no package manager on PATH, in a project that uses another one', async t => {
  const root = await initialized(t, 'nuxt', '{"packageManager":"pnpm@10.0.0"}\n');
  await writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const empty = await mkdtemp(path.join(os.tmpdir(), 'ms-empty-path-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  await execute(process.execPath, [cli, ...styles], { cwd: root, env: { PATH: empty } });
  assert.deepEqual(JSON.parse(await readPkg(root)).devDependencies, { sass: packageRanges.sass });
  assert.equal(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'), 'lockfileVersion: 9\n');
});

test('add styles --no-install without package.json creates none and prints the section', async t => {
  const root = await initialized(t, 'vue');
  const message = await run(styles, root);
  assert.match(message, /No package\.json found, so none was created/);
  assert.ok(message.includes(`devDependencies: "sass": "${packageRanges.sass}"`));
  assert.equal(await present(path.join(root, 'package.json')), false);
});

for (const source of ['{ not json', 'null', '[]', '{"devDependencies":"sass"}']) {
  test(`add styles --no-install refuses an unusable package.json before any file is written: ${source}`, async t => {
    const root = await initialized(t, 'nuxt', '{}');
    await writeFile(path.join(root, 'package.json'), source);
    await assert.rejects(run(styles, root), /package\.json .*nothing was changed/);
    assert.equal(await present(path.join(root, 'app/assets')), false);
    assert.equal(await readPkg(root), source);
  });
}

test('a package.json that changes during add styles is left alone and the section is named', async t => {
  const root = await initialized(t, 'nuxt', '{}\n');
  const config = JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  const changing = async (base, relative) => {
    await writeFile(path.join(base, 'package.json'), '{"changed":true}\n');
    return safe(base, relative);
  };
  await assert.rejects(addStyles(root, config, changing, { install: false }), error => {
    assert.match(error.message, /Copied 12 SCSS files/);
    assert.match(error.message, /sass was not declared\. package\.json changed during installation/);
    assert.ok(error.message.includes(`add to devDependencies: "sass": "${packageRanges.sass}"`));
    return true;
  });
  assert.equal(await readPkg(root), '{"changed":true}\n');
});

test('add styles rejects other arguments', async t => {
  const root = await initialized(t, 'nuxt', '{}\n');
  await assert.rejects(run(['add', 'styles', '--force'], root), /Usage: ms-front-kit add styles \[--no-install\]/);
  await assert.rejects(run(['add', 'styles', '--no-install', 'x'], root), /Usage/);
  assert.equal(await present(path.join(root, 'app/assets')), false);
});

test('help and the rendered conventions describe the sass declaration', async t => {
  assert.match(await run(['--help']), /add styles \[--no-install\]/);
  const root = await initialized(t, 'nuxt', '{}\n');
  await execute('git', ['init', '--quiet'], { cwd: root });
  await run(['add', 'conventions'], root);
  const doc = await readFile(path.join(root, 'docs/conventions/ms-front-kit.md'), 'utf8');
  assert.match(doc, /runs\s+`npm install --save-dev sass`/);
  assert.match(doc, /`--no-install` runs no package manager and adds\s+`sass` to package\.json `devDependencies`/);
  assert.doesNotMatch(doc, /does not install dependencies/);
});
