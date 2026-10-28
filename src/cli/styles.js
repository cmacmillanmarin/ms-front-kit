import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { planGridHelper } from './grid-helper.js';

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function checkPath(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Expected a project-relative path.');
  let current = root;
  for (const part of relative.split(/[\\/]/)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing to modify a linked path: ${relative}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function parse(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) throw new Error(`Cannot parse ${file}; no styles were installed.`);
  return ast;
}

function propertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : null;
}

function isStylesheet(value, stylesPath, framework, sourceDirectory = 'app') {
  if (value === `./${stylesPath}/main.scss` || value === `${stylesPath}/main.scss`) return true;
  if (framework !== 'nuxt') return false;
  const sourcePath = path.posix.relative(sourceDirectory, stylesPath);
  return [`~/${sourcePath}/main.scss`, `@/${sourcePath}/main.scss`, `~~/${stylesPath}/main.scss`, `@@/${stylesPath}/main.scss`].includes(value);
}

export function updateNuxtCss(source, stylesPath) {
  const ast = parse('nuxt.config.ts', source);
  const exports = ast.statements.filter(ts.isExportAssignment);
  const call = exports.length === 1 ? exports[0].expression : null;
  if (!call || !ts.isCallExpression(call) || call.expression.getText(ast) !== 'defineNuxtConfig' || call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0])) {
    throw new Error('Automatic setup requires export default defineNuxtConfig({ ... }). Add the stylesheet manually for this configuration.');
  }
  const object = call.arguments[0];
  if (object.properties.some(p => ts.isSpreadAssignment(p) || (p.name && propertyName(p.name) === null))) {
    throw new Error('Nuxt config uses spread or computed properties. Add the stylesheet manually to avoid overriding dynamic CSS configuration.');
  }
  const properties = object.properties.filter(p => propertyName(p.name) === 'css');
  const srcDir = object.properties.find(p => propertyName(p.name) === 'srcDir');
  if (srcDir && (!ts.isPropertyAssignment(srcDir) || !ts.isStringLiteral(srcDir.initializer))) {
    throw new Error('Nuxt srcDir must be a literal string for automatic alias setup. Add the stylesheet manually.');
  }
  const sourceDirectory = srcDir ? srcDir.initializer.text : 'app';
  if (path.posix.isAbsolute(sourceDirectory) || sourceDirectory.split('/').includes('..')) {
    throw new Error('Automatic alias setup requires a project-relative Nuxt srcDir.');
  }
  const sourcePath = path.posix.relative(sourceDirectory, stylesPath);
  const aliasPath = sourcePath === '..' || sourcePath.startsWith('../')
    ? `@@/${stylesPath}/main.scss`
    : `@/${sourcePath}/main.scss`;
  const entry = JSON.stringify(aliasPath);
  if (properties.length > 1) throw new Error('Duplicate css properties in Nuxt config; resolve them before installing styles.');
  if (!properties.length) {
    const at = object.getStart(ast) + 1;
    return source.slice(0, at) + `\n  css: [${entry}],` + source.slice(at);
  }
  const property = properties[0];
  if (!ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) {
    throw new Error('Nuxt css must be a literal array for automatic setup. Add the stylesheet manually to the existing expression.');
  }
  const array = property.initializer;
  // Unknown array expressions could already contain this entry. Do not guess.
  if (!array.elements.every(ts.isStringLiteral)) throw new Error('Nuxt css contains dynamic entries. Add the stylesheet manually to avoid duplicates.');
  if (array.elements.some(element => isStylesheet(element.text, stylesPath, 'nuxt', sourceDirectory))) return source;
  const at = array.getStart(ast) + 1;
  return source.slice(0, at) + entry + (array.elements.length ? ', ' : '') + source.slice(at);
}

// Patch only literal objects, preserving all unrelated source and comments.
export function updateAbstractsAlias(source, stylesPath, framework = 'vue') {
  const ast = parse('Vite configuration', source);
  const exports = ast.statements.filter(ts.isExportAssignment);
  let object = exports.length === 1 ? exports[0].expression : null;
  if (object && ts.isCallExpression(object) &&
      ['defineConfig', 'defineNuxtConfig'].includes(object.expression.getText(ast)) && object.arguments.length === 1) {
    object = object.arguments[0];
  }
  const fail = () => { throw new Error('Automatic abstracts alias setup requires literal config, resolve, and alias objects without spreads or computed properties. Configure the Vite abstracts alias manually; no files were changed.'); };
  const keys = framework === 'nuxt' ? ['vite', 'resolve', 'alias', 'abstracts'] : ['resolve', 'alias', 'abstracts'];
  const target = JSON.stringify(`./${stylesPath}/abstracts`);
  const value = `msFrontKitFileURLToPath(new URL(${target}, import.meta.url))`;
  for (let i = 0; i < keys.length; i++) {
    if (!object || !ts.isObjectLiteralExpression(object) || object.properties.some(p => ts.isSpreadAssignment(p) || (p.name && propertyName(p.name) === null))) fail();
    const matches = object.properties.filter(p => propertyName(p.name) === keys[i]);
    if (matches.length > 1) fail();
    if (!matches.length) {
      if (/\bmsFrontKitFileURLToPath\b/.test(source)) fail();
      let entry = value;
      for (let j = keys.length - 1; j > i; j--) entry = `{ ${keys[j]}: ${entry} }`;
      const at = object.getStart(ast) + 1;
      const updated = source.slice(0, at) + `\n  ${keys[i]}: ${entry},` + source.slice(at);
      const importAt = updated.startsWith('#!') ? updated.indexOf('\n') + 1 : 0;
      return updated.slice(0, importAt) + 'import { fileURLToPath as msFrontKitFileURLToPath } from "node:url";\n' + updated.slice(importAt);
    }
    const property = matches[0];
    if (!ts.isPropertyAssignment(property)) fail();
    if (i === keys.length - 1) {
      const hasImport = ast.statements.some(s => ts.isImportDeclaration(s) &&
        ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === 'node:url' &&
        s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) &&
        s.importClause.namedBindings.elements.some(e => e.name.text === 'msFrontKitFileURLToPath' && e.propertyName?.text === 'fileURLToPath'));
      if (property.initializer.getText(ast) === value && hasImport) return source;
      throw new Error('An abstracts alias already exists. Preserve it and configure the kit alias manually; no files were changed.');
    }
    object = property.initializer;
  }
}

async function integration(root, config) {
  if (config.framework === 'nuxt') {
    const available = [];
    for (const file of ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']) {
      await checkPath(root, file);
      const source = await readOptional(path.join(root, file));
      if (source !== null) available.push({ file, source });
    }
    if (available.length !== 1) throw new Error('Expected exactly one nuxt.config.ts, .js, or .mjs in the project root.');
    const { file, source } = available[0];
    return [{ file, source, updated: updateAbstractsAlias(updateNuxtCss(source, config.paths.styles), config.paths.styles, 'nuxt') }];
  }
  const available = [];
  for (const file of ['src/main.ts', 'src/main.js']) {
    await checkPath(root, file);
    const source = await readOptional(path.join(root, file));
    if (source !== null) available.push({ file, source });
  }
  if (available.length !== 1) throw new Error('Vue automatic setup requires exactly one src/main.ts or src/main.js. Use manual setup for another entry layout.');
  const { file, source } = available[0];
  let relative = path.posix.relative('src', `${config.paths.styles}/main.scss`);
  if (!relative.startsWith('.')) relative = `./${relative}`;
  const ast = parse(file, source);
  const imported = ast.statements.some(statement => ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && (
    statement.moduleSpecifier.text === relative || statement.moduleSpecifier.text === `@/${config.paths.styles.replace(/^src\//, '')}/main.scss`
  ));
  const at = source.startsWith('#!') ? source.indexOf('\n') + 1 : 0;
  const entries = [{ file, source, updated: imported ? source : source.slice(0, at) + `import ${JSON.stringify(relative)};\n` + source.slice(at) }];
  const vite = [];
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs', 'vite.config.cts', 'vite.config.cjs']) {
    await checkPath(root, name);
    const contents = await readOptional(path.join(root, name));
    if (contents !== null) vite.push({ file: name, source: contents });
  }
  if (vite.length > 1) throw new Error('Expected at most one Vite configuration in the project root. Configure the abstracts alias manually.');
  if (vite.some(entry => /\.c[jt]s$/.test(entry.file))) throw new Error('CommonJS Vite configuration requires manual abstracts alias setup.');
  const entry = vite[0] || { file: 'vite.config.ts', source: null };
  entries.push({ ...entry, updated: updateAbstractsAlias(entry.source ?? 'export default {};\n', config.paths.styles) });
  return entries;
}

async function templates(directory, prefix = '') {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) results.push(...await templates(path.join(directory, entry.name), relative));
    else if (entry.isFile() && entry.name.endsWith('.scss')) results.push({ relative, contents: await readFile(path.join(directory, entry.name), 'utf8') });
  }
  return results;
}

export async function addStyles(root, config, safeDirectory) {
  // Preflight integration and every target before copying or editing files.
  await checkPath(root, 'ms-front-kit.json');
  const configFile = path.join(root, 'ms-front-kit.json');
  const originalConfig = await readFile(configFile, 'utf8');
  const stylesPath = `${config.paths.styles}/ms-front-kit`;
  const edits = await integration(root, { ...config, paths: { ...config.paths, styles: stylesPath } });
  const grid = await planGridHelper(root, config, checkPath, readOptional);
  edits.push(...grid.edits);
  const files = await templates(fileURLToPath(new URL('../../templates/shared/scss/', import.meta.url)));
  const pending = [];
  for (const file of files) {
    const relative = `${stylesPath}/${file.relative}`;
    await checkPath(root, relative);
    const existing = await readOptional(path.join(root, relative));
    if (existing !== null && existing !== file.contents) throw new Error(`${relative} already exists and differs. Preserve your custom styles and merge manually; no files were changed.`);
    if (existing === null) pending.push({ ...file, relative });
  }
  const fontPath = 'public/assets/font/HelveticaNowDisplayMedium.woff2';
  await checkPath(root, fontPath);
  const font = await readFile(new URL('../../templates/shared/fonts/HelveticaNowDisplayMedium.woff2', import.meta.url));
  let existingFont = null;
  try { existingFont = await readFile(path.join(root, fontPath)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existingFont !== null && !existingFont.equals(font)) {
    throw new Error(`${fontPath} already exists and differs. No files were changed.`);
  }
  const packageSource = await readOptional(path.join(root, 'package.json'));
  const pkg = packageSource ? JSON.parse(packageSource) : {};
  for (const file of pending) {
    const directory = await safeDirectory(root, path.dirname(file.relative));
    await writeFile(path.join(directory, path.basename(file.relative)), file.contents, { flag: 'wx' });
  }
  if (existingFont === null) {
    const directory = await safeDirectory(root, path.dirname(fontPath));
    await writeFile(path.join(directory, path.basename(fontPath)), font, { flag: 'wx' });
  }
  for (const edit of edits) {
    if (await readOptional(path.join(root, edit.file)) !== edit.source) throw new Error('The application configuration changed during installation. Styles were copied, but setup was not edited; retry after reviewing the change.');
  }
  for (const edit of edits) {
    if (edit.updated !== edit.source) {
      await safeDirectory(root, path.dirname(edit.file));
      await writeFile(path.join(root, edit.file), edit.updated, { flag: edit.source === null ? 'wx' : 'w' });
    }
  }
  if (!config.styles.grid) {
    if (await readFile(configFile, 'utf8') !== originalConfig) throw new Error('Styles were installed, but ms-front-kit.json changed during installation. Set styles.grid to true after reviewing it.');
    const updatedConfig = JSON.parse(originalConfig);
    updatedConfig.styles.grid = true;
    await writeFile(configFile, `${JSON.stringify(updatedConfig, null, 2)}\n`);
  }
  const sass = pkg.dependencies?.sass || pkg.devDependencies?.sass || pkg.dependencies?.['sass-embedded'] || pkg.devDependencies?.['sass-embedded'];
  return `${pending.length ? `Copied ${pending.length} SCSS files` : 'SCSS files are already installed'}. ${existingFont === null ? 'Copied example font' : 'Example font already installed'}. ${edits.every(edit => edit.updated === edit.source) ? 'Stylesheet entry and abstracts alias already exist' : `Updated ${edits.filter(edit => edit.updated !== edit.source).map(edit => edit.file).join(', ')}`}.\n${grid.message}${sass ? '' : '\nInstall the compiler: npm install --save-dev sass'}`;
}
