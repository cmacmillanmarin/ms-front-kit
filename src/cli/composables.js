import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { checkPath, readOptional } from './styles.js';
import { planScrollSetup } from './scroll-setup.js';
import { nuxtLayout } from './nuxt-layout.js';
import { assertNpm, missingPackages, npmInstall, readPackage } from './packages.js';

// App integration for composables that ship a component.
const setups = { useScroll: planScrollSetup };

async function catalog(kind) {
  return JSON.parse(await readFile(new URL(`../../templates/vue/${kind}/catalog.json`, import.meta.url), 'utf8'));
}

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function relativeDirectory(from, to) {
  const relative = path.posix.relative(from, to) || '.';
  return relative.startsWith('.') ? relative : `./${relative}`;
}

// Which auto-imports generated code may rely on. Vue has none; Nuxt only scans
// its default composables directory, and its config can turn either off.
async function autoImports(root, config) {
  if (config.framework !== 'nuxt') return { apis: false, composables: false };
  try {
    const layout = await nuxtLayout(root);
    return { apis: layout.imports.apis, composables: layout.imports.scan && config.paths.composables === layout.paths.composables };
  } catch {
    return { apis: false, composables: false };
  }
}

function importLines(entry, framework, auto) {
  const { vue = [], router = [], composables = [] } = entry.imports;
  const lines = [];
  if (!auto.apis) {
    // Nuxt exposes Vue and router APIs through #imports even with auto-imports off.
    if (framework === 'nuxt' && vue.length + router.length) lines.push(`import { ${[...vue, ...router].join(', ')} } from '#imports';`);
    if (framework === 'vue' && vue.length) lines.push(`import { ${vue.join(', ')} } from 'vue';`);
    if (framework === 'vue' && router.length) lines.push(`import { ${router.join(', ')} } from 'vue-router';`);
  }
  if (!auto.composables) for (const item of composables) lines.push(`import ${item} from './${item}';`);
  return lines.length ? `${lines.join('\n')}\n\n` : '';
}

export async function addComposable(root, config, name, safeDirectory, { install = true, installDependencies = npmInstall } = {}) {
  const composables = await catalog('composables');
  if (!/^use[A-Z][A-Za-z0-9]*$/.test(name) || !Object.hasOwn(composables, name)) {
    throw new Error(`Unknown composable. Available: ${Object.keys(composables).join(', ')}`);
  }
  const stores = await catalog('stores');
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(item) {
    if (visiting.has(item)) throw new Error('Composable catalog has a dependency cycle.');
    if (visited.has(item)) return;
    const entry = composables[item];
    if (!entry) throw new Error(`Missing catalog dependency: ${item}`);
    visiting.add(item);
    for (const dependency of entry.dependencies) visit(dependency);
    visiting.delete(item);
    visited.add(item);
    ordered.push(item);
  }
  visit(name);

  // Template imports resolve relative to the directory of each generated file.
  function render(source, directory) {
    const replacements = {
      storeDirectory: relativeDirectory(directory, config.paths.store),
      composablesDirectory: relativeDirectory(directory, config.paths.composables),
      componentsPath: config.paths.components,
      storePath: config.paths.store
    };
    return source.replace(/\{\{(\w+)\}\}/g, (match, key) => replacements[key] ?? match);
  }

  // Plan every output before writing anything.
  const auto = await autoImports(root, config);
  const outputs = [];
  for (const item of ordered) {
    const entry = composables[item];
    if (!/^[A-Za-z0-9]+\.ts\.tpl$/.test(entry.template)) throw new Error('Invalid composable template filename.');
    if (!(entry.imports?.composables || []).every(dependency => entry.dependencies.includes(dependency))) throw new Error(`Composable catalog imports must be dependencies: ${item}`);
    outputs.push({
      directory: config.paths.composables,
      file: `${item}.ts`,
      template: `composables/${entry.template}`,
      prefix: importLines(entry, config.framework, auto)
    });
  }
  const storeNames = [...new Set(ordered.map(item => composables[item].store).filter(Boolean))];
  const packages = new Set();
  for (const store of storeNames) {
    const entry = stores[store];
    if (!entry || !/^[A-Za-z0-9]+\.ts\.tpl$/.test(entry.template)) throw new Error(`Invalid store catalog entry: ${store}`);
    outputs.push({ directory: config.paths.store, file: `${store}.ts`, template: `stores/${entry.template}`, prefix: '' });
    for (const item of entry.packages[config.framework]) packages.add(item);
  }
  const component = composables[name].component;
  const notes = [];
  let componentFile;
  if (component) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(component.name) || !/^[a-z]+\/[A-Za-z0-9]+\.vue\.tpl$/.test(component.template)) throw new Error('Invalid component catalog entry.');
    if (component.docs !== undefined && !/^[a-z]+\/[A-Za-z0-9]+\.md\.tpl$/.test(component.docs)) throw new Error('Invalid component catalog entry.');
    // Components ship as <Name>/Index.vue with their README.md alongside.
    const directory = `${config.paths.components}/${component.name}`;
    componentFile = `${directory}/Index.vue`;
    // Earlier installs created <Name>.vue; keep it rather than adding a duplicate.
    const legacy = `${config.paths.components}/${component.name}.vue`;
    await checkPath(root, legacy);
    if (await exists(path.join(root, legacy))) {
      componentFile = legacy;
      notes.push(`Existing ${legacy} preserved; new installs use ${directory}/Index.vue with README.md. Move it there to adopt the new layout.`);
    } else {
      outputs.push({ directory, file: 'Index.vue', template: `components/${component.template}`, prefix: '' });
      if (component.docs !== undefined) outputs.push({ directory, file: 'README.md', template: `components/${component.docs}`, prefix: '' });
    }
  }
  for (const output of outputs) {
    output.relative = `${output.directory}/${output.file}`;
    output.contents = output.prefix + render(await readFile(new URL(`../../templates/vue/${output.template}`, import.meta.url), 'utf8'), output.directory);
  }

  const setup = setups[name] && component
    ? await setups[name](root, config, componentFile, checkPath, readOptional)
    : { edits: [], notes: [] };
  const pkg = await readPackage(root);
  const missing = missingPackages(pkg, [...packages]);
  if (missing.length && install) await assertNpm(root);

  const messages = [];
  for (const output of outputs) {
    const directory = await safeDirectory(root, output.directory);
    const file = path.join(directory, output.file);
    if (await exists(file)) {
      messages.push(`Skipped ${output.relative}: already exists; existing code was preserved.`);
      continue;
    }
    try {
      await writeFile(file, output.contents, { flag: 'wx' });
      messages.push(`Created ${output.relative}`);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      messages.push(`Skipped ${output.relative}: already exists; existing code was preserved.`);
    }
  }
  for (const edit of setup.edits) {
    if (await readOptional(path.join(root, edit.file)) !== edit.source) throw new Error(`${edit.file} changed during installation. Files were created, but it was not edited; retry after reviewing the change.`);
  }
  for (const edit of setup.edits) {
    const directory = await safeDirectory(root, path.dirname(edit.file));
    await writeFile(path.join(directory, path.basename(edit.file)), edit.updated, { flag: edit.source === null ? 'wx' : 'w' });
    messages.push(`Updated ${edit.file}`);
  }
  messages.push(...notes, ...setup.notes);

  if (missing.length && install) {
    try { await installDependencies(root, missing); }
    catch (error) {
      throw new Error(`${messages.join('\n')}\nFiles were created, but installing ${missing.join(' ')} failed. Review package.json and the lockfile, then run npm install ${missing.join(' ')}. ${error.stderr || error.message}`);
    }
    messages.push(`Installed ${missing.join(', ')} with npm.`);
  } else if (missing.length) {
    messages.push(`Dependency installation skipped; install ${missing.join(' ')} with your project package manager.`);
  }

  if (config.framework === 'nuxt' && outputs.some(output => output.prefix)) {
    messages.push(auto.apis
      ? 'Nuxt does not scan this composables directory (imports.scan or a custom paths.composables); generated composables import each other explicitly.'
      : 'Nuxt auto-imports are disabled or could not be confirmed from nuxt.config; generated composables import Vue APIs from #imports and each other explicitly.');
  }
  if (ordered.includes('useResize')) messages.push('useResize uses optional root --layout-max-width; missing or invalid values fall back to viewport width.');
  if (name === 'useDevice') messages.push('useDevice requires the installed kit styles, including base/_device.scss and its body::after breakpoint labels.');
  if (name === 'useScroll') {
    if (config.framework === 'vue' && missingPackages(pkg, ['vue-router']).length) {
      messages.push('useScroll imports useRoute from vue-router for route resets and hash links; install and register vue-router.');
    }
    messages.push(`Virtual mode moves [data-scroll] sections (or the whole content when none are marked). Control it through useScrollStore: scrollTo(), disable(), update(), reset(). Usage reference: ${config.paths.components}/Scroll/README.md`);
  }
  return messages.join('\n');
}
