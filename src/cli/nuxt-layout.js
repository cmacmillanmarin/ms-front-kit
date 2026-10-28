import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

function name(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : null;
}

function properties(node, label) {
  if (!ts.isObjectLiteralExpression(node) || node.properties.some(p => ts.isSpreadAssignment(p) || name(p.name) === null)) {
    throw new Error(`${label} must be a literal object without spreads or computed keys for automatic Nuxt init. Configure the layout manually.`);
  }
  const result = new Map();
  for (const property of node.properties) {
    const key = name(property.name);
    if (result.has(key)) throw new Error(`Duplicate ${label}.${key}; resolve it before Nuxt init.`);
    result.set(key, property);
  }
  return result;
}

function literal(map, key, fallback, label) {
  const property = map.get(key);
  if (!property) return fallback;
  if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer)) {
    throw new Error(`${label}.${key} must be a literal string for automatic Nuxt init.`);
  }
  return property.initializer.text;
}

function relative(value, label) {
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\') || value.split('/').includes('..')) {
    throw new Error(`${label} must be a relative path inside the project for automatic Nuxt init.`);
  }
  return value;
}

export async function nuxtLayout(root) {
  const configs = [];
  for (const file of ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']) {
    try { configs.push({ file, source: await readFile(path.join(root, file), 'utf8') }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (configs.length > 1) throw new Error('Expected at most one nuxt.config.ts, .js, or .mjs in the project root.');
  let sourceDirectory = 'app';
  let assets = 'assets';
  let plugins = 'plugins';
  if (configs.length) {
    const { file, source } = configs[0];
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (ast.parseDiagnostics.length) throw new Error(`Cannot parse ${file}; no initialization files were created.`);
    const exports = ast.statements.filter(ts.isExportAssignment);
    const call = exports.length === 1 ? exports[0].expression : null;
    if (!call || !ts.isCallExpression(call) || call.expression.getText(ast) !== 'defineNuxtConfig' || call.arguments.length !== 1) {
      throw new Error('Automatic Nuxt init requires export default defineNuxtConfig({ ... }). Configure the layout manually.');
    }
    const config = properties(call.arguments[0], 'Nuxt config');
    // These can override the effective source layout beyond this static config.
    for (const key of ['rootDir', 'extends', '$env', '$development', '$production', '$test']) {
      if (config.has(key)) throw new Error(`Nuxt ${key} requires manual layout setup; automatic init cannot determine the effective directories.`);
    }
    sourceDirectory = relative(literal(config, 'srcDir', 'app', 'Nuxt config'), 'Nuxt srcDir');
    if (config.has('dir')) {
      const property = config.get('dir');
      if (!ts.isPropertyAssignment(property)) throw new Error('Nuxt dir must be a literal object for automatic Nuxt init.');
      const directories = properties(property.initializer, 'Nuxt dir');
      assets = relative(literal(directories, 'assets', 'assets', 'Nuxt dir'), 'Nuxt dir.assets');
      plugins = relative(literal(directories, 'plugins', 'plugins', 'Nuxt dir'), 'Nuxt dir.plugins');
    }
  }
  return {
    paths: {
      components: path.posix.join(sourceDirectory, 'components'),
      composables: path.posix.join(sourceDirectory, 'composables'),
      styles: path.posix.join(sourceDirectory, assets, 'scss')
    },
    pluginPath: path.posix.join(sourceDirectory, plugins, 'ms-front-kit.client.ts')
  };
}
