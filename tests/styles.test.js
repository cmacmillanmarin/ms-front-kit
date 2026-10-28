import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';

const styles = fileURLToPath(new URL('../templates/shared/scss/', import.meta.url));
const compile = source => sass.compileString(source, { loadPaths: [styles] }).css;

test('main compiles the global foundation without intrusive reset rules', () => {
  const css = compile('@use "main";');
  assert.match(css, /\*::before/);
  assert.match(css, /box-sizing: border-box/);
  assert.match(css, /font-size: 1rem/);
  assert.match(css, /line-height: 1.5/);
  assert.match(css, /--color-primary:/);
  assert.match(css, /--color-secondary:/);
  assert.match(css, /--layout-max-width: 120rem/);
  assert.doesNotMatch(css, /--font-family|--line-height/);
  assert.doesNotMatch(css, /outline:|scroll-behavior:|10px/i);
  assert.equal((css.match(/@font-face/g) || []).length, 1);
  assert.match(css, /font-weight: 500/);
  assert.doesNotMatch(css, /body \*/);
});

test('abstracts alone emit no CSS or font declarations', () => {
  assert.equal(compile('@use "abstracts" as ms;').trim(), '');
});

test('type and responsive mixins emit only requested component CSS', () => {
  const css = compile('@use "abstracts" as ms; .demo { @include ms.type(body); @include ms.from(tablet) { padding: 1rem; } }');
  assert.match(css, /\.demo/);
  assert.match(css, /font-size: 1rem/);
  assert.match(css, /font-family: "Helvetica Now Display", sans-serif/);
  assert.match(css, /line-height: 1.5/);
  assert.match(css, /min-width: 35.0625rem/);
  assert.doesNotMatch(css, /:root|@font-face|box-sizing/);
});

test('each typography token emits an explicit font family', () => {
  for (const token of ['h1', 'h2', 'body', 'small']) {
    const css = compile(`@use "abstracts" as ms; .example { @include ms.type(${token}); }`);
    assert.match(css, /font-family: "Helvetica Now Display", sans-serif/);
  }
});

test('invalid mixin tokens produce actionable compilation errors', () => {
  assert.throws(() => compile('@use "abstracts" as ms; .demo { @include ms.type(missing); }'), /Unknown typography token/);
  assert.throws(() => compile('@use "abstracts" as ms; .demo { @include ms.from(missing); }'), /Unknown breakpoint/);
});

test('build-time variables can be configured before loading main', () => {
  const css = compile('@use "abstracts" with ($type-styles: (body: (font-size: 16px, line-height: 1.7), h1: (font-size: 48px), h2: (font-size: 32px))); @use "main";');
  assert.match(css, /line-height: 1.7/);
});
