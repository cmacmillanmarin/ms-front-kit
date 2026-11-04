import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertNpm, declarePackages, missingPackages, npmInstall, npmInstallCommand, planPackages, readPackage } from './packages.js';

export function componentDetails(input) {
  const segments = input.split('/');
  if (!segments.every(segment => /^[A-Z][A-Za-z0-9]*$/.test(segment))) {
    throw new Error('Use PascalCase path segments, for example Home/Hero/BackButton (no extension).');
  }
  const bemSegments = segments.length > 1 && segments.at(-1) === 'Index'
    ? segments.slice(0, -1)
    : segments;
  const bemBlock = bemSegments.map(segment => segment
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()).join('__');
  return { directories: segments.slice(0, -1), name: segments.at(-1), bemBlock };
}

export async function renderComponent(input) {
  const details = componentDetails(input);
  const template = await readFile(new URL('../../templates/vue/components/basic/component.vue.tpl', import.meta.url), 'utf8');
  return { ...details, contents: template.replaceAll('{{bemBlock}}', details.bemBlock).replaceAll('{{componentName}}', details.name) };
}

export async function addComponent(root, config, input, safeDirectory, { install = true, installDependencies = npmInstall } = {}) {
  const { name, directories, contents } = await renderComponent(input);
  const packages = config.components.style === 'scss' ? ['sass'] : [];
  // Settle the packages first: a refusal must leave the project untouched.
  const declaration = install ? null : await planPackages(root, packages);
  const missing = install ? missingPackages(await readPackage(root), packages) : [];
  if (missing.length) await assertNpm(root);
  const outputDirectory = [config.paths.components, ...directories].join('/');
  const directory = await safeDirectory(root, outputDirectory);
  await writeFile(path.join(directory, `${name}.vue`), contents, { flag: 'wx' });
  const summary = `Created ${outputDirectory}/${name}.vue`;
  if (missing.length) {
    try { await installDependencies(root, missing); }
    catch (error) {
      throw new Error(`${summary}\nThe component was created, but installing sass failed. Review package.json and the lockfile, then run ${npmInstallCommand(missing)}. ${error.stderr || error.message}`);
    }
    return `${summary}\nInstalled sass with npm.`;
  }
  if (!declaration?.add.length) return summary;
  try { return `${summary}\n${await declarePackages(root, declaration)}`; }
  catch (error) { throw new Error(`${summary}\nThe component was created, but sass was not declared. ${error.message}`); }
}
