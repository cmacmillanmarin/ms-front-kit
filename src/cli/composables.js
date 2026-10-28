import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';

export async function addComposable(root, config, name, safeDirectory) {
  const catalog = JSON.parse(await readFile(new URL('../../templates/vue/composables/catalog.json', import.meta.url), 'utf8'));
  if (!/^use[A-Z][A-Za-z0-9]*$/.test(name) || !Object.hasOwn(catalog, name)) {
    throw new Error(`Unknown composable. Available: ${Object.keys(catalog).join(', ')}`);
  }
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(item) {
    if (visiting.has(item)) throw new Error('Composable catalog has a dependency cycle.');
    if (visited.has(item)) return;
    const entry = catalog[item];
    if (!entry) throw new Error(`Missing catalog dependency: ${item}`);
    visiting.add(item);
    for (const dependency of entry.dependencies) visit(dependency);
    visiting.delete(item);
    visited.add(item);
    ordered.push(item);
  }
  visit(name);
  const directory = await safeDirectory(root, config.paths.composables);
  const messages = [];
  for (const item of ordered) {
    const output = path.join(directory, `${item}.ts`);
    try {
      await lstat(output);
      messages.push(`Skipped ${config.paths.composables}/${item}.ts: already exists; existing code was preserved.`);
      continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const entry = catalog[item];
    if (!/^[A-Za-z0-9]+\.ts\.tpl$/.test(entry.template)) throw new Error('Invalid composable template filename.');
    const template = await readFile(new URL(`../../templates/vue/composables/${entry.template}`, import.meta.url), 'utf8');
    const contents = (config.framework === 'vue' ? `${entry.vueImports}\n` : '') + template;
    try {
      await writeFile(output, contents, { flag: 'wx' });
      messages.push(`Created ${config.paths.composables}/${item}.ts`);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      messages.push(`Skipped ${config.paths.composables}/${item}.ts: already exists; existing code was preserved.`);
    }
  }
  messages.push('useResize uses optional root --layout-max-width; missing or invalid values fall back to viewport width.');
  if (name === 'useDevice') messages.push('useDevice requires the installed kit styles, including base/_device.scss and its body::after breakpoint labels.');
  return messages.join('\n');
}
