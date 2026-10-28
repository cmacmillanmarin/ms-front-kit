import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderComponent } from './component.js';

const reference = 'docs/conventions/ms-front-kit.md';
const marker = '<!-- ms-front-kit:conventions -->';
const instructions = `${marker}
## Frontend conventions

Before creating or modifying frontend components, composables, or styles, read
[the frontend conventions](${reference}) and the project configuration in
\`ms-front-kit.json\`. Follow more-specific project instructions; report conflicts.
Use ms-front-kit to scaffold components when available, otherwise follow the
conventions manually.
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

export async function addConventions(root, config, safeDirectory) {
  const directory = await safeDirectory(root, 'docs/conventions');
  const output = path.join(directory, 'ms-front-kit.md');
  const agentsFile = path.join(root, 'AGENTS.md');
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
  const previous = await existingRegularFile(output);
  const agents = await existingRegularFile(agentsFile);
  if (previous !== null && previous !== contents) {
    throw new Error(`${reference} already exists and differs. Compare it with the toolkit templates and update it manually; no existing files were changed.`);
  }
  if (previous === null) await writeFile(output, contents, { flag: 'wx' });
  let result = previous === null ? `Created ${reference}.` : `${reference} is already current.`;
  if (agents === null) {
    await writeFile(agentsFile, `# Project instructions\n\n${instructions}`, { flag: 'wx' });
    return `${result} Created AGENTS.md with a conventions reference.`;
  }
  if (agents.includes(reference)) return `${result} AGENTS.md already references it; no duplicate added.`;
  // Never edit an existing instruction document without an explicit separate
  // action by its owner. Print the exact reference instead of guessing placement.
  return `${result} Existing AGENTS.md was preserved. Add this reference manually:\n\n${instructions}`;
}
