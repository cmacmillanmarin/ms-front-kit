#!/usr/bin/env node
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addConventions } from './conventions.js';
import { renderComponent } from './component.js';
import { addStyles } from './styles.js';
import { initialize } from './init.js';
import { addComposable } from './composables.js';

const help = `ms-front-kit — Macmillan Studio

Run from the project root:
  ms-front-kit init --framework nuxt|vue [--no-install]
  ms-front-kit add component ProductCard
  ms-front-kit add component Home/Hero/BackButton
  ms-front-kit add conventions
  ms-front-kit add styles
  ms-front-kit add composable useResize|useDevice|useRaf|useScroll [--no-install]

Creates project-owned files; preserves customized files.
add composable useScroll also creates the Pinia scroll store and Scroll
component, mounts it in the app shell, and installs Pinia with npm.
add styles also registers global CSS, configures the abstracts alias,
and installs a development-only Helper/Grid.vue overlay in the app shell.
React and Astro are not implemented yet.`;

async function loadConfig(root) {
  const config = JSON.parse(await readFile(path.join(root, 'ms-front-kit.json'), 'utf8'));
  if (config.version !== 1 || !['vue', 'nuxt'].includes(config.framework)) {
    throw new Error('Expected configuration version 1 and framework vue or nuxt.');
  }
  if (config.components?.naming !== 'PascalCase' || config.components?.style !== 'scss' || config.components?.bem !== true) {
    throw new Error('This first version supports PascalCase components, SCSS, and BEM only.');
  }
  if (typeof config.styles?.grid !== 'boolean') {
    throw new Error('styles.grid must be a boolean. add styles enables the grid foundation.');
  }
  // Configurations created before stores were supported keep them beside composables.
  if (config.paths && config.paths.store === undefined && typeof config.paths.composables === 'string') {
    config.paths.store = path.posix.join(path.posix.dirname(config.paths.composables), 'store');
  }
  for (const key of ['components', 'composables', 'store', 'styles']) {
    const value = config.paths?.[key];
    if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
      throw new Error(`paths.${key} must be a relative path inside the project.`);
    }
  }
  return config;
}

// Resolve existing ancestors before creating directories: a symlink must not
// turn a project-relative output path into a write outside the project.
async function safeDirectory(root, relative) {
  const canonicalRoot = await realpath(root);
  let current = canonicalRoot;
  for (const part of relative.split(/[\\/]/).filter(Boolean)) {
    current = path.join(current, part);
    try { await mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    current = await realpath(current);
    const fromRoot = path.relative(canonicalRoot, current);
    if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
      throw new Error('Output directory resolves outside the project.');
    }
  }
  return current;
}

export async function run(args, root = process.cwd()) {
  if (!args.length || ['--help', '-h'].includes(args[0])) return help;
  if (args[0] === 'init') {
    if (![3, 4].includes(args.length) || args[1] !== '--framework' || !['nuxt', 'vue'].includes(args[2]) || (args.length === 4 && args[3] !== '--no-install')) {
      throw new Error('Usage: ms-front-kit init --framework nuxt|vue [--no-install]');
    }
    return initialize(root, args[2], safeDirectory, { install: !args.includes('--no-install') });
  }
  if ([3, 4].includes(args.length) && args[0] === 'add' && args[1] === 'composable') {
    if (args.length === 4 && args[3] !== '--no-install') throw new Error('Usage: ms-front-kit add composable useScroll [--no-install]');
    return addComposable(root, await loadConfig(root), args[2], safeDirectory, { install: args.length === 3 });
  }
  if (args.length === 2 && args[0] === 'add' && args[1] === 'styles') {
    return addStyles(root, await loadConfig(root), safeDirectory);
  }
  if (args.length === 2 && args[0] === 'add' && args[1] === 'conventions') {
    return addConventions(root, await loadConfig(root), safeDirectory);
  }
  if (args.length !== 3 || args[0] !== 'add' || args[1] !== 'component') {
    throw new Error('Usage: ms-front-kit add component ProductCard');
  }
  const { name, directories, contents } = await renderComponent(args[2]);
  const config = await loadConfig(root);
  const outputDirectory = [config.paths.components, ...directories].join('/');
  const directory = await safeDirectory(root, outputDirectory);
  await writeFile(path.join(directory, `${name}.vue`), contents, { flag: 'wx' });
  return `Created ${outputDirectory}/${name}.vue`;
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(console.log).catch(error => {
    console.error(`ms-front-kit: ${error.code === 'EEXIST' ? 'File already exists; nothing was overwritten.' : error.message}`);
    process.exitCode = 1;
  });
}
