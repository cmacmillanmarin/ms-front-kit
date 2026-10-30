import { readFile, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execute = promisify(execFile);

export async function readPackage(root) {
  try { return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function missingPackages(pkg, names) {
  return names.filter(name => !pkg?.dependencies?.[name] && !pkg?.devDependencies?.[name]);
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
