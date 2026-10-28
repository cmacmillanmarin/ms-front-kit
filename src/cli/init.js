import { readFile, writeFile, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execute = promisify(execFile);
async function npmInstall(root) {
  try {
    await execute('npm', ['install', 'gsap'], { cwd: root, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`Created configuration and plugin, but GSAP installation failed. Review package.json and the lockfile, then run npm install gsap. ${error.stderr || error.message}`);
  }
}

async function assertAbsent(file) {
  try { await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const error = new Error(`File already exists: ${file}`);
  error.code = 'EEXIST';
  throw error;
}

export async function initialize(root, framework, safeDirectory, { install = true, installDependencies = npmInstall } = {}) {
  const base = framework === 'nuxt' ? 'app' : 'src';
  const config = {
    version: 1,
    framework,
    paths: { components: `${base}/components`, composables: `${base}/composables`, styles: `${base}/assets/scss` },
    components: { naming: 'PascalCase', style: 'scss', bem: true },
    styles: { grid: false }
  };
  const configFile = path.join(root, 'ms-front-kit.json');
  await assertAbsent(configFile);
  let pluginDirectory;
  let plugin;
  if (framework === 'nuxt') {
    // Initial setup targets Nuxt 4's default app/ layout. Do not put a plugin in
    // a directory Nuxt will not scan when the project uses a custom source root.
    for (const name of ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']) {
      let source;
      try { source = await readFile(path.join(root, name), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (/\bsrcDir\s*:|\bdir\s*:/.test(source)) {
        throw new Error('Nuxt init currently supports the default app/ layout. Configure a custom source/plugin directory manually.');
      }
    }
    if (install) {
      const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
      if (pkg.packageManager && !pkg.packageManager.startsWith('npm@')) throw new Error('Automatic installation currently uses npm. Use --no-install and your project package manager instead.');
      for (const name of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
        try { await lstat(path.join(root, name)); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        throw new Error('A non-npm lockfile exists. Use --no-install and your project package manager instead.');
      }
    }
    await assertAbsent(path.join(root, 'app/plugins/ms-front-kit.client.ts'));
    plugin = await readFile(new URL('../../templates/nuxt/plugins/ms-front-kit.client.ts.tpl', import.meta.url), 'utf8');
    pluginDirectory = await safeDirectory(root, 'app/plugins');
  }
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  if (plugin) {
    await writeFile(path.join(pluginDirectory, 'ms-front-kit.client.ts'), plugin, { flag: 'wx' });
    if (install) await installDependencies(root);
  }
  return `Created ms-front-kit.json.${plugin ? ` Created app/plugins/ms-front-kit.client.ts. ${install ? 'Installed GSAP with npm.' : 'Dependency installation skipped; install gsap with your project package manager.'}` : ''} Review paths before generating files. Styles and conventions are separate commands.`;
}
