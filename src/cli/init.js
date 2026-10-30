import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { nuxtLayout } from './nuxt-layout.js';
import { assertNpm, npmInstall as installPackages } from './packages.js';

async function npmInstall(root) {
  try {
    await installPackages(root, ['gsap']);
  } catch (error) {
    throw new Error(`Created configuration and plugin, but GSAP installation failed. Review package.json and the lockfile, then run npm install gsap. ${error.stderr || error.message}`);
  }
}

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
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
  let existingPlugin = false;
  if (framework === 'nuxt') {
    const layout = await nuxtLayout(root);
    config.paths = layout.paths;
    pluginPath = layout.pluginPath;
    // Projects set up before the config was shared, or with it left uncommitted,
    // have the plugin but no config. Keep the plugin and its dependency.
    existingPlugin = await exists(path.join(root, pluginPath));
    if (install && !existingPlugin) await assertNpm(root);
    if (!existingPlugin) plugin = await readFile(new URL('../../templates/nuxt/plugins/ms-front-kit.client.ts.tpl', import.meta.url), 'utf8');
  }
  // Record styles already installed elsewhere; add styles sets this marker after installing them.
  config.styles.grid = await exists(path.join(root, config.paths.styles, 'ms-front-kit/abstracts/_grid.scss'));
  if (plugin) pluginDirectory = await safeDirectory(root, path.posix.dirname(pluginPath));
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  if (plugin) {
    await writeFile(path.join(pluginDirectory, 'ms-front-kit.client.ts'), plugin, { flag: 'wx' });
    if (install) await installDependencies(root);
  }
  const pluginResult = plugin
    ? ` Created ${pluginPath}. ${install ? 'Installed GSAP with npm.' : 'Dependency installation skipped; install gsap with your project package manager.'}`
    : existingPlugin ? ` Kept existing ${pluginPath}; dependency installation skipped.` : '';
  const stylesResult = config.styles.grid ? ' Found installed styles; set styles.grid to true.' : '';
  return `Created ms-front-kit.json.${pluginResult}${stylesResult} Review paths before generating files. Commit ms-front-kit.json with the project. Styles and conventions are separate commands.`;
}
