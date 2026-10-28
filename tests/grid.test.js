import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
const styles = fileURLToPath(new URL('../templates/shared/scss/', import.meta.url));
const compile = source => sass.compileString(source, { loadPaths: [styles] }).css;

test('global layout tokens use rem sizes and switch from 4 to 12 columns', () => {
  const css = compile('@use "main";');
  assert.match(css, /--layout-columns: 4/);
  assert.match(css, /--layout-gutter: 0.5rem/);
  assert.match(css, /--layout-margin: 1rem/);
  assert.match(css, /--layout-max-width: 120rem/);
  assert.match(css, /min-width: 64rem[^]*--layout-columns: 12/);
  assert.match(css, /--layout-column-width: calc\(var\(--layout-width\) \/ var\(--layout-columns\)\)/);
});

test('public grid and column mixins emit flex layout with logical spacing', () => {
  const css = compile('@use "abstracts" as ms; .grid { @include ms.grid(); } .item { @include ms.columns(2); }');
  assert.match(css, /display: flex/);
  assert.match(css, /flex-wrap: wrap/);
  assert.match(css, /max-width: var\(--layout-max-width\)/);
  assert.match(css, /column-gap: var\(--layout-gutter\)/);
  assert.match(css, /padding-inline: var\(--layout-margin\)/);
  assert.match(css, /margin-inline: auto/);
  assert.match(css, /--columns: 2/);
  assert.match(css, /1 - var\(--columns\) \/ var\(--layout-columns\)/);
  assert.match(css, /width: calc\(var\(--columns-width\) - var\(--columns-gap-width\)\)/);
  assert.doesNotMatch(css, /:root|@font-face|margin-left|margin-right|padding-left|padding-right/);
});

test('offset mixin supports logical sides and backwards-compatible aliases', () => {
  for (const side of ['start', 'left']) {
    const css = compile(`@use "abstracts" as ms; .item { @include ms.gap(1, "${side}"); }`);
    assert.match(css, /margin-inline-start: var\(--gap-value\)/);
    assert.doesNotMatch(css, /margin-inline-end:/);
  }
  for (const side of ['end', 'right']) {
    const css = compile(`@use "abstracts" as ms; .item { @include ms.gap(2, "${side}"); }`);
    assert.match(css, /margin-inline-end: var\(--gap-value\)/);
    assert.doesNotMatch(css, /margin-inline-start:/);
  }
  for (const args of ['1', '1, "both"', '1, ""']) {
    assert.match(compile(`@use "abstracts" as ms; .item { @include ms.gap(${args}); }`), /margin-inline: var\(--gap-value\)/);
  }
});

test('zero offsets are supported without dividing by the requested count', () => {
  const css = compile('@use "abstracts" as ms; .item { @include ms.gap(0, "start"); }');
  assert.match(css, /--gap: 0/);
  assert.doesNotMatch(css, /\/ var\(--gap\)/);
  assert.match(css, /var\(--layout-gutter\) \* var\(--gap\) \/ var\(--layout-columns\)/);
});

test('invalid column/offset counts and side names produce clear Sass errors', () => {
  for (const value of ['0', '-1', '1.5', '2px', '"2"']) {
    assert.throws(() => compile(`@use "abstracts" as ms; .item { @include ms.columns(${value}); }`), /columns\(\) expects a unitless integer/);
  }
  for (const value of ['-1', '1.5', '2px', '"2"']) {
    assert.throws(() => compile(`@use "abstracts" as ms; .item { @include ms.gap(${value}); }`), /gap\(\) expects a unitless integer/);
  }
  assert.throws(() => compile('@use "abstracts" as ms; .item { @include ms.gap(1, "strat"); }'), /gap\(\) side must be/);
});

test('simplified width and offset formulas retain positive-count results', () => {
  for (const total of [4, 12]) {
    for (let count = 1; count <= total; count++) {
      const gutter = 8;
      const width = 1000;
      const originalSpan = width * count / total - gutter * (1 - 1 / (total / count));
      const simplifiedSpan = width * count / total - gutter * (1 - count / total);
      const originalOffset = width * count / total - gutter * (count - 1 / (total / count)) + count * gutter;
      const simplifiedOffset = width * count / total + gutter * count / total;
      assert.ok(Math.abs(originalSpan - simplifiedSpan) < 1e-9);
      assert.ok(Math.abs(originalOffset - simplifiedOffset) < 1e-9);
    }
  }
});

test('grid tools alone emit no global CSS', () => {
  assert.equal(compile('@use "abstracts" as ms;').trim(), '');
});
