import { readFile, writeFile, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { checkPath, readOptional } from './styles.js';

const execute = promisify(execFile);

// What --no-install declares for a later plain install. Each package the kit can
// install needs a range here; these match the versions the kit is tested against.
export const packageRanges = {
  '@pinia/nuxt': '^1.0.3',
  gsap: '^3.15.1',
  pinia: '^4.1.0'
};

const byName = (a, b) => a.localeCompare(b, 'en'); // The order npm writes dependencies in.
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

export async function readPackage(root) {
  try { return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function missingPackages(pkg, names) {
  return names.filter(name => !dependencySections.some(section => Object.hasOwn(pkg?.[section] ?? {}, name)));
}

// Automatic installation is npm-only; other package managers must install manually.
export async function assertNpm(root) {
  const pkg = await readPackage(root);
  if (pkg === null) throw new Error('package.json not found. Run from the project root, or use --no-install.');
  if (pkg.packageManager && !pkg.packageManager.startsWith('npm@')) throw new Error('Automatic installation currently uses npm. Use --no-install and your project package manager instead.');
  for (const name of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
    try { await lstat(path.join(root, name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('A non-npm lockfile exists. Use --no-install and your project package manager instead.');
  }
}

export async function npmInstall(root, names) {
  await execute('npm', ['install', ...names], { cwd: root, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
}

// Reads and validates package.json before anything is written, for --no-install.
export async function planPackages(root, names) {
  const source = await readOptional(path.join(root, 'package.json'));
  let pkg = {};
  if (source !== null) {
    try { pkg = JSON.parse(source); }
    catch { throw new Error('package.json is not valid JSON; nothing was changed. Fix it and retry.'); }
    if (!isObject(pkg) || ['dependencies', 'devDependencies'].some(key => key in pkg && !isObject(pkg[key]))) {
      throw new Error('package.json must be an object whose dependencies and devDependencies are objects; nothing was changed. Fix it and retry.');
    }
  }
  const add = missingPackages(pkg, names).sort(byName);
  for (const name of add) if (!packageRanges[name]) throw new Error(`No version range is recorded for ${name}.`);
  if (add.length) await checkPath(root, 'package.json');
  return { source, add };
}

function serialize(source, pkg) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  // An empty object shows no style to keep; a one-line file stays on one line.
  const indent = /^\s*\{\s*\}\s*$/.test(source) ? '  ' : source.match(/^\s*\{\r?\n([ \t]*)/)?.[1] ?? '';
  return JSON.stringify(pkg, null, indent).replaceAll('\n', eol) + source.match(/\s*$/)[0];
}

// Adds the planned packages to dependencies and returns a message for the user.
export async function declarePackages(root, { source, add }) {
  const file = path.join(root, 'package.json');
  const entries = add.map(name => `"${name}": "${packageRanges[name]}"`).join(', ');
  if (await readOptional(file) !== source) throw new Error(`package.json changed during installation, so it was not edited. Review it, then add to dependencies: ${entries}`);
  if (source === null) return `No package.json found, so none was created and nothing was installed. Add to dependencies, then run your package manager's install: ${entries}`;
  const pkg = JSON.parse(source);
  const dependencies = { ...pkg.dependencies };
  for (const name of add) dependencies[name] = packageRanges[name];
  pkg.dependencies = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => byName(a, b)));
  await writeFile(file, serialize(source, pkg));
  return `Added ${add.map(name => `${name}@${packageRanges[name]}`).join(', ')} to package.json dependencies; nothing was installed. Run a plain install with your package manager.`;
}
