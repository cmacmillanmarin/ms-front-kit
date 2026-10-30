import path from 'node:path';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import { nuxtLayout } from './nuxt-layout.js';

const scrollNames = new Set(['Scroll', 'scroll']);
// Wrap the outermost routed element: layouts and pages then live inside the scroll root.
const wrapTargets = {
  nuxt: [['NuxtLayout', 'nuxt-layout'], ['NuxtPage', 'nuxt-page']],
  vue: [['RouterView', 'router-view']]
};

function find(node, names, found = []) {
  if (node.type === 1 && names.includes(node.tag)) found.push(node);
  for (const child of node.children || []) find(child, names, found);
  return found;
}

function importedNames(descriptor, importPath) {
  const names = new Set(scrollNames);
  for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
    const ast = ts.createSourceFile('app.ts', block.content, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          statement.moduleSpecifier.text !== importPath || !statement.importClause?.name) continue;
      const name = statement.importClause.name.text;
      names.add(name);
      names.add(name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase());
    }
  }
  return [...names];
}

export function mountScroll(source, importPath, framework) {
  const manual = reason => ({ updated: source, note: `Scroll component: ${reason}. Mount it manually with the snippet below.` });
  const { descriptor, errors } = parse(source);
  if (errors.length || !descriptor.template || descriptor.template.src || descriptor.template.lang) return manual('app template could not be safely edited');
  const template = descriptor.template;
  if (find(template.ast, importedNames(descriptor, importPath)).length) return { updated: source, note: 'Existing Scroll mount preserved.' };
  if ([descriptor.script, descriptor.scriptSetup].some(block => block && (block.src || (block.lang && !['ts', 'js'].includes(block.lang))))) return manual('app script requires custom integration');
  if (/\bScroll\b/.test([descriptor.script?.content, descriptor.scriptSetup?.content].join('\n'))) return manual('app already uses the Scroll binding name');
  let node;
  for (const names of wrapTargets[framework]) {
    const matches = find(template.ast, names);
    if (matches.length > 1) return manual(`app has several <${names[0]}> elements`);
    if (matches.length === 1) { node = matches[0]; break; }
  }
  if (!node) return manual(`app has no <${wrapTargets[framework].map(names => names[0]).join('> or <')}> to wrap`);
  const start = node.loc.start.offset;
  const end = node.loc.end.offset;
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const indent = /^[ \t]*$/.test(source.slice(lineStart, start)) ? source.slice(lineStart, start) : '';
  const wrapped = `<Scroll>\n${indent}  ${source.slice(start, end).replace(/\n/g, '\n  ')}\n${indent}</Scroll>`;
  const script = `import Scroll from ${JSON.stringify(importPath)};\n`;
  const edits = [{ at: start, end, text: wrapped }];
  if (descriptor.scriptSetup) {
    edits.push({ at: descriptor.scriptSetup.loc.start.offset, end: descriptor.scriptSetup.loc.start.offset, text: `\n${script}` });
  } else {
    const lang = descriptor.script?.lang === 'js' || (descriptor.script && !descriptor.script.lang) ? '' : ' lang="ts"';
    edits.push({ at: 0, end: 0, text: `<script setup${lang}>\n${script}</script>\n\n` });
  }
  let updated = source;
  for (const edit of edits.sort((a, b) => b.at - a.at)) updated = updated.slice(0, edit.at) + edit.text + updated.slice(edit.end);
  try {
    const result = parse(updated);
    if (result.errors.length) return manual('app integration would produce an invalid component');
    compileScript(result.descriptor, { id: 'ms-front-kit-scroll' });
  } catch {
    return manual('app script could not be safely merged');
  }
  return { updated, note: `Wrapped <${node.tag}> with <Scroll>.` };
}

function propertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : null;
}

// Add a module to a literal defineNuxtConfig({ modules: [...] }) without executing it.
export function updateNuxtModules(source, moduleName) {
  const manual = reason => ({ updated: source, note: `Nuxt modules: ${reason}. Add ${JSON.stringify(moduleName)} to modules manually.` });
  const ast = ts.createSourceFile('nuxt.config.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) return manual('the configuration could not be parsed');
  const exports = ast.statements.filter(ts.isExportAssignment);
  const call = exports.length === 1 ? exports[0].expression : null;
  if (!call || !ts.isCallExpression(call) || call.expression.getText(ast) !== 'defineNuxtConfig' || call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0])) {
    return manual('automatic setup requires export default defineNuxtConfig({ ... })');
  }
  const object = call.arguments[0];
  if (object.properties.some(p => ts.isSpreadAssignment(p) || (p.name && propertyName(p.name) === null))) return manual('the configuration uses spread or computed properties');
  const properties = object.properties.filter(p => propertyName(p.name) === 'modules');
  if (properties.length > 1) return manual('modules is declared more than once');
  if (!properties.length) {
    const at = object.getStart(ast) + 1;
    return { updated: source.slice(0, at) + `\n  modules: [${JSON.stringify(moduleName)}],` + source.slice(at), note: `Registered ${moduleName} in Nuxt modules.` };
  }
  const property = properties[0];
  if (!ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return manual('modules is not a literal array');
  const array = property.initializer;
  const registered = element => (ts.isStringLiteral(element) && element.text === moduleName) ||
    (ts.isArrayLiteralExpression(element) && element.elements[0] && ts.isStringLiteral(element.elements[0]) && element.elements[0].text === moduleName);
  if (array.elements.some(registered)) return { updated: source, note: `${moduleName} is already registered.` };
  // Unknown entries could already resolve to the module; do not guess.
  if (!array.elements.every(element => ts.isStringLiteral(element) || ts.isArrayLiteralExpression(element))) return manual('modules contains dynamic entries');
  const at = array.getStart(ast) + 1;
  return { updated: source.slice(0, at) + JSON.stringify(moduleName) + (array.elements.length ? ', ' : '') + source.slice(at), note: `Registered ${moduleName} in Nuxt modules.` };
}

// Adds the --vh token to an installed kit tokens file (first declaration in :root).
export function addViewportToken(source) {
  const manual = reason => ({ updated: source, note: `--vh token: ${reason}. Add --vh: 100svh; to :root in base/_tokens.scss manually; Scroll falls back to 100svh.` });
  if (/--vh\s*:/.test(source)) return { updated: source, note: '--vh token already defined; existing value preserved.' };
  const roots = [...source.matchAll(/^([ \t]*):root\s*\{[ \t]*\n/gm)];
  if (roots.length !== 1) return manual('expected exactly one :root block');
  const [match, indent] = roots[0];
  const at = roots[0].index + match.length;
  const token = `${indent}  // Stable viewport height: small viewport (browser toolbars expanded).\n${indent}  --vh: 100svh;\n\n`;
  return { updated: source.slice(0, at) + token + source.slice(at), note: 'Added --vh: 100svh to base/_tokens.scss.' };
}

function relativeImport(fromDirectory, file) {
  const relative = path.posix.relative(fromDirectory, file);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

// Plans app-shell and configuration edits; nothing is written here.
export async function planScrollSetup(root, config, componentFile, checkPath, readOptional) {
  const edits = [];
  const notes = [];
  let appFile = 'src/App.vue';
  if (config.framework === 'nuxt') {
    let layout;
    try { layout = await nuxtLayout(root); }
    catch {
      notes.push(`Nuxt source layout requires manual setup. Register @pinia/nuxt in modules and wrap <NuxtLayout> or <NuxtPage> with ${componentFile}.`);
      return { edits, notes };
    }
    appFile = path.posix.join(layout.sourceDirectory, 'app.vue');
    const configs = [];
    for (const file of ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']) {
      await checkPath(root, file);
      const source = await readOptional(path.join(root, file));
      if (source !== null) configs.push({ file, source });
    }
    if (configs.length === 1) {
      const result = updateNuxtModules(configs[0].source, '@pinia/nuxt');
      if (result.updated !== configs[0].source) edits.push({ file: configs[0].file, source: configs[0].source, updated: result.updated });
      notes.push(result.note);
    } else {
      notes.push('Nuxt modules: expected exactly one nuxt.config.ts, .js, or .mjs. Add "@pinia/nuxt" to modules manually.');
    }
  } else {
    const mains = [];
    for (const file of ['src/main.ts', 'src/main.js']) {
      await checkPath(root, file);
      const source = await readOptional(path.join(root, file));
      if (source !== null) mains.push(source);
    }
    if (!mains.some(source => /\bcreatePinia\b/.test(source))) {
      notes.push('Register Pinia in your Vue entry: import { createPinia } from "pinia"; app.use(createPinia());');
    }
  }
  // Only projects that ran add styles have the tokens file; others use the fallback.
  const tokensFile = path.posix.join(config.paths.styles, 'ms-front-kit/base/_tokens.scss');
  await checkPath(root, tokensFile);
  const tokens = await readOptional(path.join(root, tokensFile));
  if (tokens !== null) {
    const result = addViewportToken(tokens);
    if (result.updated !== tokens) edits.push({ file: tokensFile, source: tokens, updated: result.updated });
    notes.push(result.note);
  }
  await checkPath(root, appFile);
  const source = await readOptional(path.join(root, appFile));
  const importPath = relativeImport(path.posix.dirname(appFile), componentFile);
  const initial = source ?? (config.framework === 'nuxt'
    ? '<template>\n  <NuxtLayout>\n    <NuxtPage />\n  </NuxtLayout>\n</template>\n'
    : null);
  if (initial === null) {
    notes.push(`Scroll component: ${appFile} not found. Mount it manually with the snippet below.`);
  } else {
    const result = mountScroll(initial, importPath, config.framework);
    if (result.updated !== initial) edits.push({ file: appFile, source, updated: result.updated });
    notes.push(result.note);
    if (result.updated !== initial || !/manually/.test(result.note)) return { edits, notes };
  }
  const routed = config.framework === 'nuxt' ? '<NuxtLayout>\n    <NuxtPage />\n  </NuxtLayout>' : '<RouterView />';
  notes.push(`\n<script setup lang="ts">\nimport Scroll from ${JSON.stringify(importPath)};\n</script>\n\n<template>\n  <Scroll>\n    ${routed.replace(/\n/g, '\n  ')}\n  </Scroll>\n</template>`);
  return { edits, notes };
}
