import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderComponent } from './component.js';

const reference = 'docs/conventions/ms-front-kit.md';
const instructions = `<!-- ms-front-kit:conventions -->
## Optional local conventions

Before working on frontend code, check whether \`${reference}\` exists.
If it exists, read and follow its applicable conventions alongside this project's
instructions and established patterns. The file's presence is optional;
following its applicable conventions when present is required.

If the file is absent, continue normally. Do not create or fetch it.
Shared project requirements take precedence over conflicting local conventions.
<!-- /ms-front-kit:conventions -->
`;

async function existingRegularFile(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular file, not a link or directory: ${file}`);
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function git(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
}

// Remove only rules under the exact heading written by older kit versions.
// An unrelated AGENTS.md ignore rule remains the project owner's decision.
function removeLegacyRules(source) {
  if (source === null) return null;
  const lines = source.split('\n');
  const output = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].trimEnd() === '# ms-front-kit personal coding conventions') {
      let end = i + 1;
      while (end < lines.length && ['/AGENTS.md', `/${reference}`].includes(lines[end].trimEnd())) end++;
      if (end > i + 1) { i = end; continue; }
    }
    output.push(lines[i++]);
  }
  return output.join('\n');
}

export async function addConventions(root, config, safeDirectory) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const location = git(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (top.status !== 0 || location.status !== 0) {
    throw new Error('add conventions requires a Git repository to keep personal instructions local. Initialize Git first, then retry. No convention files were changed.');
  }
  const prefix = path.relative(await realpath(top.stdout.trim()), await realpath(root)).split(path.sep).join('/');
  const literalPrefix = prefix.replace(/[\\*?[\]]/g, '\\$&');
  if (/[\r\n]/.test(prefix)) throw new Error('Cannot create a Git exclusion for a project path containing a newline.');
  const pattern = `/${literalPrefix ? `${literalPrefix}/` : ''}${reference}`;
  const excludeFile = path.resolve(root, location.stdout.trim());
  const exclude = await existingRegularFile(excludeFile);
  const gitignoreFile = path.join(root, '.gitignore');
  const gitignore = await existingRegularFile(gitignoreFile);
  const cleanedIgnore = removeLegacyRules(gitignore);
  const agentsFile = path.join(root, 'AGENTS.md');
  const agents = await existingRegularFile(agentsFile);
  const directory = await safeDirectory(root, 'docs/conventions');
  const output = path.join(directory, 'ms-front-kit.md');
  const previous = await existingRegularFile(output);
  const template = await readFile(new URL('../../templates/vue/conventions.md.tpl', import.meta.url), 'utf8');
  const component = await renderComponent('Home/Hero/BackButton');
  const replacements = {
    framework: config.framework,
    componentsPath: config.paths.components,
    composablesPath: config.paths.composables,
    stylesPath: config.paths.styles,
    componentExample: component.contents.trimEnd()
  };
  const contents = template.replace(/\{\{(\w+)\}\}/g, (_, key) => replacements[key]);

  // Establish local privacy before creating any personal document.
  if (!(exclude || '').split(/\r?\n/).includes(pattern)) {
    await mkdir(path.dirname(excludeFile), { recursive: true });
    const before = exclude ? `${exclude}${exclude.endsWith('\n') ? '' : '\n'}\n` : '';
    await writeFile(excludeFile, `${before}# ms-front-kit personal coding conventions\n${pattern}\n`, { flag: exclude === null ? 'wx' : 'w' });
  }
  if (previous === null) await writeFile(output, contents, { flag: 'wx' });
  let result = previous === null ? `Created ${reference}.` : previous === contents
    ? `${reference} is already current.`
    : `Preserved ${reference}: it differs from the current template. Compare and update it manually; it was not overwritten.`;
  if (agents === null) {
    await writeFile(agentsFile, `# Project instructions\n\n${instructions}`, { flag: 'wx' });
    result += ' Created AGENTS.md with an optional local-conventions reference; keep AGENTS.md tracked.';
  }

  result += ' Personal conventions are excluded locally through Git info/exclude; AGENTS.md is not excluded by the kit.';
  if (cleanedIgnore !== gitignore) {
    await writeFile(gitignoreFile, cleanedIgnore);
    result += ' Removed legacy kit-managed .gitignore rules; unrelated rules were preserved.';
  }
  if (git(root, ['ls-files', '--error-unmatch', '--', reference]).status === 0) {
    result += ` Warning: ${reference} is already tracked by Git. Local exclusions do not untrack it; no tracked files were removed.`;
  }
  if (git(root, ['check-ignore', '--no-index', '--', 'AGENTS.md']).status === 0) {
    result += ' Warning: an existing Git ignore rule still matches AGENTS.md. Review it manually if this file should be shared.';
  }
  if (agents === null) return result;
  if (agents.includes(instructions)) return `${result} AGENTS.md already has the optional reference; no duplicate added.`;
  // Existing instructions always remain intact, including older mandatory links.
  return `${result} Existing AGENTS.md was preserved. ${agents.includes(reference) ? 'Review its old reference and replace it manually with this optional block:' : 'Add this reference manually:'}\n\n${instructions}`;
}
