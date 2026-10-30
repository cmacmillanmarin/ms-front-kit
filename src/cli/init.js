import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { nuxtLayout } from './nuxt-layout.js';
import { excludeLocalConfig } from './local-config.js';
import { assertNpm, npmInstall as installPackages } from './packages.js';

async function npmInstall(root) {
  try {
    await installPackages(root, ['gsap']);
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
    paths: { components: `${base}/components`, composables: `${base}/composables`, store: `${base}/store`, styles: `${base}/assets/scss` },
    components: { naming: 'PascalCase', style: 'scss', bem: true },
    styles: { grid: false }
  };
  const configFile = path.join(root, 'ms-front-kit.json');
  await assertAbsent(configFile);
  let pluginDirectory;
  let plugin;
  let pluginPath;
  if (framework === 'nuxt') {
    const layout = await nuxtLayout(root);
    config.paths = layout.paths;
    pluginPath = layout.pluginPath;
    if (install) await assertNpm(root);
    await assertAbsent(path.join(root, pluginPath));
    plugin = await readFile(new URL('../../templates/nuxt/plugins/ms-front-kit.client.ts.tpl', import.meta.url), 'utf8');
  }
  const exclusion = await excludeLocalConfig(root);
  if (plugin) pluginDirectory = await safeDirectory(root, path.posix.dirname(pluginPath));
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  if (plugin) {
    await writeFile(path.join(pluginDirectory, 'ms-front-kit.client.ts'), plugin, { flag: 'wx' });
    if (install) await installDependencies(root);
  }
  return `Created ms-front-kit.json.${plugin ? ` Created ${pluginPath}. ${install ? 'Installed GSAP with npm.' : 'Dependency installation skipped; install gsap with your project package manager.'}` : ''} Review paths before generating files. Styles and conventions are separate commands.${exclusion}`;
}
