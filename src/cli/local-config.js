import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Git resolves the exclude location for both ordinary repos and linked worktrees.
export async function excludeLocalConfig(root) {
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const top = git(['rev-parse', '--show-toplevel']);
  const location = git(['rev-parse', '--git-path', 'info/exclude']);
  if (top.status !== 0 || location.status !== 0) {
    return ' Warning: no Git repository found; ms-front-kit.json was not excluded. Add it to Git info/exclude after initializing Git.';
  }
  const prefix = path.relative(await realpath(top.stdout.trim()), await realpath(root)).split(path.sep).join('/');
  if (/[\r\n]/.test(prefix)) throw new Error('Cannot create a Git exclusion for a project path containing a newline.');
  const escaped = prefix.replace(/[\\*?[\]]/g, '\\$&');
  const pattern = `/${escaped ? `${escaped}/` : ''}ms-front-kit.json`;
  const file = path.resolve(root, location.stdout.trim());
  let source = null;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular file, not a link or directory: ${file}`);
    source = await readFile(file, 'utf8');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!(source || '').split(/\r?\n/).includes(pattern)) {
    await mkdir(path.dirname(file), { recursive: true });
    const before = source ? `${source}${source.endsWith('\n') ? '' : '\n'}\n` : '';
    await writeFile(file, `${before}# ms-front-kit personal configuration\n${pattern}\n`, { flag: source === null ? 'wx' : 'w' });
  }
  let result = ' ms-front-kit.json is excluded locally through Git info/exclude; shared .gitignore was not changed.';
  if (git(['ls-files', '--error-unmatch', '--', 'ms-front-kit.json']).status === 0) {
    result += ' Warning: ms-front-kit.json is already tracked; local exclusions do not untrack it. No tracked files were removed.';
  }
  return result;
}
