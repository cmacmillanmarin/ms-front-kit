import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import { nuxtLayout } from './nuxt-layout.js';

const componentNames = new Set(['HelperGrid', 'helper-grid', 'MsFrontKitGrid', 'ms-front-kit-grid']);

function hasGrid(node, names) {
  return (node.type === 1 && names.has(node.tag)) ||
    (node.children || []).some(child => hasGrid(child, names));
}

function gridNames(descriptor, importPath) {
  const names = new Set(componentNames);
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
  return names;
}

export function mountGrid(source, importPath, framework) {
  const manual = reason => ({ updated: source, note: `Grid helper: ${reason}. Mount it manually with the dev-only snippet below.` });
  const { descriptor, errors } = parse(source);
  if (errors.length || !descriptor.template || descriptor.template.src || descriptor.template.lang) return manual('app template could not be safely edited');
  const template = descriptor.template;
  if (hasGrid(template.ast, gridNames(descriptor, importPath))) return { updated: source, note: 'Existing grid helper mount preserved; keep its development-only guard.' };
  if ([descriptor.script, descriptor.scriptSetup].some(block => block && (block.src || (block.lang && !['ts', 'js'].includes(block.lang))))) return manual('app script requires custom integration');
  if (/\b(?:MsFrontKitGrid|msFrontKitDev)\b/.test([descriptor.script?.content, descriptor.scriptSetup?.content].join('\n'))) return manual('app already uses the grid integration binding names');
  const script = `import MsFrontKitGrid from ${JSON.stringify(importPath)};\nconst msFrontKitDev = ${framework === 'nuxt' ? 'import.meta.dev' : 'import.meta.env.DEV'};\n`;
  const edits = [];
  if (descriptor.scriptSetup) {
    edits.push({ at: descriptor.scriptSetup.loc.start.offset, text: `\n${script}` });
  } else {
    const lang = descriptor.script?.lang === 'js' || (descriptor.script && !descriptor.script.lang) ? '' : ' lang="ts"';
    edits.push({ at: 0, text: `<script setup${lang}>\n${script}</script>\n\n` });
  }
  // Keep a native/Html root intact. Component roots (NuxtLayout, RouterView,
  // etc.) receive a sibling so the helper does not depend on their slots.
  const roots = template.ast.children.filter(node => node.type !== 3 && !(node.type === 2 && !node.content.trim()));
  const root = roots.length === 1 ? roots[0] : null;
  let at = template.loc.end.offset;
  if (root?.type === 1 && !root.isSelfClosing && (root.tagType === 0 || root.tag === 'Html')) {
    at = root.loc.end.offset - root.loc.source.match(/<\/[^>]+>\s*$/)[0].length;
  }
  edits.push({ at, text: '\n  <MsFrontKitGrid v-if="msFrontKitDev" />\n' });
  let updated = source;
  for (const edit of edits.sort((a, b) => b.at - a.at)) updated = updated.slice(0, edit.at) + edit.text + updated.slice(edit.at);
  // Validate the combined SFC too, including interaction with an Options script.
  try {
    const result = parse(updated);
    if (result.errors.length) return manual('app integration would produce an invalid component');
    compileScript(result.descriptor, { id: 'ms-front-kit-grid' });
  } catch {
    return manual('app script could not be safely merged');
  }
  return { updated, note: 'Mounted grid helper in development mode only.' };
}

export async function planGridHelper(root, config, checkPath, readOptional) {
  const helperFile = `${config.paths.components}/Helper/Grid.vue`;
  await checkPath(root, helperFile);
  const helperSource = await readOptional(path.join(root, helperFile));
  const helperTemplate = await readFile(new URL('../../templates/vue/components/helper/Grid.vue.tpl', import.meta.url), 'utf8');
  const edits = helperSource === null ? [{ file: helperFile, source: null, updated: helperTemplate }] : [];
  const notes = [helperSource === null ? `Created ${helperFile}.` : `Preserved existing ${helperFile}.`];
  let appFile = 'src/App.vue';
  if (config.framework === 'nuxt') {
    try { appFile = path.posix.join((await nuxtLayout(root)).sourceDirectory, 'app.vue'); }
    catch {
      notes.push(`Nuxt source layout requires manual setup. Import ${helperFile} in your app and mount it only when import.meta.dev is true.`);
      return { edits, message: notes.join(' ') };
    }
  }
  await checkPath(root, appFile);
  const source = await readOptional(path.join(root, appFile));
  let relative = path.posix.relative(path.posix.dirname(appFile), helperFile);
  if (!relative.startsWith('.')) relative = `./${relative}`;
  const initial = source ?? (config.framework === 'nuxt'
    ? '<template>\n  <NuxtLayout>\n    <NuxtPage />\n  </NuxtLayout>\n</template>\n'
    : '<template>\n  <div class="app"></div>\n</template>\n');
  const result = mountGrid(initial, relative, config.framework);
  if (result.updated !== initial) edits.push({ file: appFile, source, updated: result.updated });
  notes.push(result.note);
  if (result.updated === initial && /manually/.test(result.note)) {
    notes.push(`\n<script setup>\nimport MsFrontKitGrid from ${JSON.stringify(relative)};\nconst msFrontKitDev = ${config.framework === 'nuxt' ? 'import.meta.dev' : 'import.meta.env.DEV'};\n</script>\n<!-- Add inside the existing template: -->\n<MsFrontKitGrid v-if="msFrontKitDev" />`);
  }
  return { edits, message: notes.join(' ') };
}
