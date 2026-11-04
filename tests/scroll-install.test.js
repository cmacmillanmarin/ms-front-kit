import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import { renderToString } from '@vue/server-renderer';
import * as sass from 'sass';
import ts from 'typescript';
import * as Vue from 'vue';
import { run } from '../src/cli/index.js';

const catalog = JSON.parse(await readFile(new URL('../templates/vue/composables/catalog.json', import.meta.url), 'utf8'));
const composableNames = ['useResize', 'useDevice', 'useRaf', 'useScrollLock', 'useScrollNative', 'useScrollVirtual', 'useScrollBar', 'useScroll'];
const typeNames = ['composables/useRaf', 'composables/useScrollNative', 'composables/useScrollVirtual', 'store/useScrollStore'];

const layouts = [
  { label: 'Nuxt defaults', framework: 'nuxt', paths: { components: 'app/components', composables: 'app/composables', store: 'app/store', types: 'app/types' } },
  { label: 'Vue defaults', framework: 'vue', paths: { components: 'src/components', composables: 'src/composables', store: 'src/store', types: 'src/types' } },
  { label: 'Nuxt custom paths', framework: 'nuxt', custom: true, paths: { components: 'app/ui', composables: 'app/shared/composables', store: 'state', types: 'shared/deep/types' } },
  { label: 'Vue custom paths', framework: 'vue', custom: true, paths: { components: 'src/ui/kit', composables: 'src/hooks', store: 'src/state', types: 'types' } }
];

async function freshProject(t, { framework, paths, custom }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ms-scroll-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), '{"private":true}');
  if (framework === 'nuxt') await writeFile(path.join(root, 'nuxt.config.ts'), 'export default defineNuxtConfig({});\n');
  await run(['init', '--framework', framework, '--no-install'], root);
  const configFile = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  if (custom) {
    Object.assign(config.paths, paths);
    await writeFile(configFile, JSON.stringify(config));
  } else {
    for (const key of Object.keys(paths)) assert.equal(config.paths[key], paths[key]);
  }
  return root;
}

function moduleSpecifiers(source) {
  const ast = ts.createSourceFile('file.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return ast.statements.filter(ts.isImportDeclaration).map(statement => statement.moduleSpecifier.text);
}

function installedFiles({ paths }) {
  return [
    ...composableNames.map(name => `${paths.composables}/${name}.ts`),
    `${paths.store}/useScrollStore.ts`,
    ...typeNames.map(name => `${paths.types}/${name}.ts`)
  ];
}

// Writes the SFC script beside the component so its imports resolve as written.
async function extractScroll(root, { paths }) {
  const { descriptor } = parse(await readFile(path.join(root, paths.components, 'Scroll/Index.vue'), 'utf8'));
  const file = path.join(root, paths.components, 'Scroll/Index.script.ts');
  await writeFile(file, descriptor.scriptSetup.content);
  return file;
}

for (const layout of layouts) {
  test(`fresh project (${layout.label}) receives the scroll files and types, with every relative import resolving`, async t => {
    const root = await freshProject(t, layout);
    const message = await run(['add', 'composable', 'useScroll', '--no-install'], root);
    const files = installedFiles(layout);
    for (const file of files) assert.match(message, new RegExp(`Created ${file.replaceAll('/', '\\/')}`));
    assert.match(message, /Added .*pinia@\S+.* to package\.json dependencies/);

    const componentFile = `${layout.paths.components}/Scroll/Index.vue`;
    const component = await readFile(path.join(root, componentFile), 'utf8');
    const { descriptor } = parse(component);
    const sources = [...files, componentFile].map(file => ({ file }));
    for (const entry of sources) {
      const contents = await readFile(path.join(root, entry.file), 'utf8');
      assert.doesNotMatch(contents, /\{\{\w+\}\}/, entry.file);
      entry.script = entry.file.endsWith('.vue') ? descriptor.scriptSetup.content : contents;
    }
    let resolved = 0;
    for (const { file, script } of sources) {
      for (const specifier of moduleSpecifiers(script).filter(name => name.startsWith('.'))) {
        await access(path.join(root, path.dirname(file), `${specifier}.ts`));
        resolved++;
      }
    }
    assert.ok(resolved >= 10, `expected the generated files to import each other, saw ${resolved}`);

    // Repeat runs preserve everything and duplicate nothing.
    await writeFile(path.join(root, layout.paths.types, 'store/useScrollStore.ts'), '// customized types\n');
    const second = await run(['add', 'composable', 'useScroll', '--no-install'], root);
    assert.doesNotMatch(second, /Created /);
    assert.equal(await readFile(path.join(root, layout.paths.types, 'store/useScrollStore.ts'), 'utf8'), '// customized types\n');
  });

  test(`generated scroll output type-checks in strict mode (${layout.label})`, async t => {
    const root = await freshProject(t, layout);
    await run(['add', 'composable', 'useScroll', '--no-install'], root);
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'));
    const files = installedFiles(layout).map(file => path.join(root, file));
    if (layout.framework === 'nuxt') {
      // What Nuxt's auto-imports declare for the default layout. Custom composable
      // paths import explicitly, which the type-check then proves as well.
      const lines = new Set();
      for (const entry of Object.values(catalog)) {
        for (const name of entry.imports?.vue || []) lines.add(`const ${name}: typeof import('vue')['${name}'];`);
        for (const name of entry.imports?.router || []) lines.add(`const ${name}: typeof import('vue-router')['${name}'];`);
      }
      if (!layout.custom) {
        for (const name of composableNames) lines.add(`const ${name}: typeof import('./${layout.paths.composables}/${name}')['default'];`);
      }
      const shim = path.join(root, 'auto-imports.d.ts');
      await writeFile(shim, `export {};\ndeclare global {\n  ${[...lines].join('\n  ')}\n}\n`);
      files.push(shim);
    }
    const options = {
      strict: true, noEmit: true, skipLibCheck: true, noUncheckedIndexedAccess: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts']
    };
    const check = (names, extra = {}) => ts.getPreEmitDiagnostics(ts.createProgram(names, { ...options, ...extra })).map(d => `${d.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    assert.deepEqual(check(files, { noUnusedLocals: true, noUnusedParameters: true }), []);
    // Template-only bindings look unused in the extracted script.
    assert.deepEqual(check([...files, await extractScroll(root, layout)]), []);
  });
}

test('a project with custom composables and no paths.types gets types beside composables', async t => {
  const layout = { framework: 'vue', custom: true, paths: { composables: 'src/shared/composables' } };
  const root = await freshProject(t, layout);
  const configFile = path.join(root, 'ms-front-kit.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  delete config.paths.types;
  await writeFile(configFile, JSON.stringify(config));
  await run(['add', 'composable', 'useRaf', '--no-install'], root);
  await access(path.join(root, 'src/shared/types/composables/useRaf.ts'));
  assert.ok(moduleSpecifiers(await readFile(path.join(root, 'src/shared/composables/useRaf.ts'), 'utf8')).includes('../types/composables/useRaf'));
  await assert.rejects(access(path.join(root, 'src/shared/types/store/useScrollStore.ts')), { code: 'ENOENT' });
});

async function renderedScroll(root, { paths }, state, props) {
  const { descriptor } = parse(await readFile(path.join(root, paths.components, 'Scroll/Index.vue'), 'utf8'));
  const compiled = compileScript(descriptor, { id: 'scroll', inlineTemplate: true });
  const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const store = Vue.reactive({ setMode() {}, disabled: false, ...state });
  const modules = {
    vue: Vue,
    [path.posix.relative(`${paths.components}/Scroll`, `${paths.composables}/useScroll`)]: { default: () => ({ init() {} }) },
    [path.posix.relative(`${paths.components}/Scroll`, `${paths.composables}/useScrollBar`)]: { default: () => ({ create() {}, destroy() {} }) },
    [path.posix.relative(`${paths.components}/Scroll`, `${paths.store}/useScrollStore`)]: { default: () => store }
  };
  const exports = {};
  new Function('exports', 'require', code)(exports, name => {
    if (modules[name]) return modules[name];
    throw new Error(`Unexpected import ${name}`);
  });
  return renderToString(Vue.createSSRApp({ render: () => Vue.h(exports.default, props, { default: () => 'content' }) }));
}

test('Scroll exposes a labelled scrollbar in virtual mode and a labelled focusable region in native mode', async t => {
  const layout = layouts[1];
  const root = await freshProject(t, layout);
  await run(['add', 'composable', 'useScroll', '--no-install'], root);

  const virtual = await renderedScroll(root, layout, { activeMode: 'virtual', isVirtual: true });
  assert.match(virtual, /role="scrollbar"/);
  assert.match(virtual, /aria-orientation="vertical"/);
  assert.match(virtual, /aria-valuemin="0"/);
  assert.match(virtual, /aria-valuemax="100"/);
  assert.match(virtual, /aria-label="Page scroll"/);
  assert.doesNotMatch(virtual, /role="region"/);
  const contentId = virtual.match(/<div id="([^"]+)" class="scroll__content"/)?.[1];
  assert.ok(contentId);
  assert.match(virtual, new RegExp(`aria-controls="${contentId}"`));
  const bar = virtual.match(/<div[^>]*class="scroll__bar"[^>]*>/)[0];
  assert.match(bar, /tabindex="0"/);
  assert.doesNotMatch(virtual.match(/<div[^>]*class="scroll"[^>]*>/)[0], /tabindex/); // No extra tab stop on the root.

  const named = await renderedScroll(root, layout, { activeMode: 'virtual', isVirtual: true }, { scrollbarLabel: 'Desplazamiento' });
  assert.match(named, /aria-label="Desplazamiento"/);
  const hidden = await renderedScroll(root, layout, { activeMode: 'virtual', isVirtual: true }, { scrollbar: false });
  assert.doesNotMatch(hidden, /role="scrollbar"/);

  const native = await renderedScroll(root, layout, { activeMode: 'native', isVirtual: false });
  const scrollRoot = native.match(/<div[^>]*class="scroll"[^>]*>/)[0];
  assert.match(scrollRoot, /tabindex="0"/);
  assert.match(scrollRoot, /role="region"/);
  assert.match(scrollRoot, /aria-label="Page content"/);
  assert.doesNotMatch(native, /role="scrollbar"/);
  const translated = await renderedScroll(root, layout, { activeMode: 'native', isVirtual: false }, { contentLabel: 'Contenido' });
  assert.match(translated, /aria-label="Contenido"/);
});

const compileScrollStyles = source => sass.compileString(parse(source).descriptor.styles[0].content).css;

for (const framework of ['nuxt', 'vue']) {
  test(`${framework}: Scroll draws working focus rings without kit styles, then the styles add the tokens and site-wide ring`, async t => {
    const layout = layouts.find(item => item.framework === framework && !item.custom);
    const root = await freshProject(t, layout);
    if (framework === 'vue') {
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(path.join(root, 'src/main.ts'), 'export {};\n');
    }
    await run(['add', 'composable', 'useScroll', '--no-install'], root);
    const css = compileScrollStyles(await readFile(path.join(root, layout.paths.components, 'Scroll/Index.vue'), 'utf8'));
    const rings = css.match(/outline: var\(--focus-size, 2px\) solid var\(--color-focus, currentcolor\);\s*outline-offset: calc\(var\(--focus-size, 2px\) \* -1\);/g) || [];
    assert.equal(rings.length, 2); // The native root and the overlay scrollbar.
    assert.doesNotMatch(css.replaceAll(/var\(--[\w-]+, [^)]+\)/g, ''), /var\(--focus|var\(--color-focus/); // Every token has a fallback.
    assert.match(css, /\.scroll__bar:focus-visible/);

    await run(['add', 'styles', '--no-install'], root);
    const main = sass.compile(path.join(root, layout.paths.styles ?? `${framework === 'nuxt' ? 'app' : 'src'}/assets/scss`, 'ms-front-kit/main.scss')).css;
    assert.match(main, /--focus-size: 2px/);
    assert.match(main, /--color-focus: currentcolor/);
    assert.match(main, /:focus-visible \{\s*outline: var\(--focus-size\) solid var\(--color-focus\);/);
    // Scroll keeps its own files, and running it again adds nothing to the current tokens.
    const second = await run(['add', 'composable', 'useScroll', '--no-install'], root);
    assert.doesNotMatch(second, /Focus tokens:/);
    await run(['add', 'styles', '--no-install'], root); // Tokens still match the template, so this stays repeatable.
  });
}

test('existing styles keep their tokens file, and the focus tokens they lack are only suggested', async t => {
  const layout = layouts[0];
  const root = await freshProject(t, layout);
  await run(['add', 'styles', '--no-install'], root);
  const base = path.join(root, 'app/assets/scss/ms-front-kit/base');
  const file = path.join(base, '_tokens.scss');
  const template = await readFile(new URL('../templates/shared/scss/base/_tokens.scss', import.meta.url), 'utf8');
  // Styles installed before the focus tokens.
  const legacy = template.replace(/^ *\/\/ Keyboard focus ring.*\n(?: *--[\w-]*focus[\w-]*: .*\n)+\n/m, '');
  assert.doesNotMatch(legacy, /focus/);
  await writeFile(file, legacy);
  await rm(path.join(base, '_focus.scss'));
  const message = await run(['add', 'composable', 'useScroll', '--no-install'], root);
  assert.match(message, /add --focus-size: 2px; --focus-offset: 2px; --color-focus: currentcolor; to :root/);
  assert.equal(await readFile(file, 'utf8'), legacy);
  await assert.rejects(access(path.join(base, '_focus.scss')), { code: 'ENOENT' });

  // Only what is missing is suggested, and customized values stay.
  const custom = ':root {\n  --vh: 100dvh;\n  --focus-size: 3px;\n  --color-focus: red;\n}\n';
  await writeFile(file, custom);
  const partial = await run(['add', 'composable', 'useScroll', '--no-install'], root);
  assert.match(partial, /fallback for any of --focus-size and --color-focus that are not defined\. Unless defined elsewhere, you can add --focus-offset: 2px; to :root/);
  assert.equal(await readFile(file, 'utf8'), custom);
});
