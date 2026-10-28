import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
const styles = fileURLToPath(new URL('../templates/shared/scss/', import.meta.url));
const compile = source => sass.compileString(source, { loadPaths: [styles] }).css;

test('px font mixin and rem function share the default 16px reference', () => {
  const css = compile('@use "abstracts" as ms; .example { @include ms.font-size(24px); padding: ms.rem(32px); }');
  assert.match(css, /font-size: 1.5rem/);
  assert.match(css, /padding: 2rem/);
});

test('h1, h2 and body examples emit rem font sizes', () => {
  const css = compile('@use "main";');
  assert.match(css, /h1 \{[^}]*font-size: 3rem/s);
  assert.match(css, /h2 \{[^}]*font-size: 2rem/s);
  assert.match(css, /body \{[^}]*font-size: 1rem/s);
  assert.doesNotMatch(css, /html\s*\{/);
});

test('every default min-width breakpoint is converted to rem', () => {
  for (const [name, width] of Object.entries({ tablet: 561, 'tablet-landscape': 769, desktop: 1024, 'desktop-medium': 1280, 'desktop-large': 1441, 'desktop-x-large': 1800 })) {
    const css = compile(`@use "abstracts" as ms; .example { @include ms.from(${name}) { display: block; } }`);
    assert.ok(css.includes(`min-width: ${width / 16}rem`), css);
  }
});

test('type converts px line heights but preserves unitless ratios', () => {
  const css = compile('@use "abstracts" as ms with ($type-styles: (example: (font-size: 24px, line-height: 32px, letter-spacing: 1px))); .example { @include ms.type(example); }');
  assert.match(css, /font-size: 1.5rem/);
  assert.match(css, /line-height: 2rem/);
  assert.match(css, /letter-spacing: 0.0625rem/);
  assert.match(compile('@use "abstracts" as ms; .example { @include ms.type(h1); }'), /line-height: 1.2/);
});

test('one design-root setting controls font sizes, breakpoints, and body baseline', () => {
  const css = compile('@use "abstracts" as ms with ($design-root-size: 20px); .example { @include ms.font-size(24px); @include ms.type(body); @include ms.from(desktop) { display: block; } }');
  assert.match(css, /font-size: 1.2rem/);
  assert.match(css, /font-size: 1rem/);
  assert.match(css, /min-width: 51.2rem/);
});

test('rem rejects non-px input and invalid conversion references', () => {
  for (const value of ['24', '2rem', '"24px"']) {
    assert.throws(() => compile(`@use "abstracts" as ms; .example { padding: ms.rem(${value}); }`), /expects a px length/);
  }
  assert.throws(() => compile('@use "abstracts" as ms with ($design-root-size: 0px); .example { padding: ms.rem(24px); }'), /positive px length/);
});
