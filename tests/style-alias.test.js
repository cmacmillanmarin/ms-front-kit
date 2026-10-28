import test from 'node:test';
import assert from 'node:assert/strict';
import { updateNuxtCss } from '../src/cli/styles.js';

test('Nuxt reuses its source alias and honors a literal srcDir', () => {
  const result = updateNuxtCss('export default defineNuxtConfig({srcDir: "src/"})', 'src/styles/ms-front-kit');
  assert.match(result, /"@\/styles\/ms-front-kit\/main.scss"/);
  assert.doesNotMatch(result, /alias:/);
});

test('Nuxt uses its root alias when styles are outside srcDir', () => {
  const result = updateNuxtCss('export default defineNuxtConfig({})', 'styles/ms-front-kit');
  assert.match(result, /"@@\/styles\/ms-front-kit\/main.scss"/);
});

test('existing relative CSS entries are preserved rather than duplicated', () => {
  const source = 'export default defineNuxtConfig({css: ["./app/assets/scss/ms-front-kit/main.scss"]})';
  assert.equal(updateNuxtCss(source, 'app/assets/scss/ms-front-kit'), source);
});

test('dynamic srcDir requires manual configuration', () => {
  assert.throws(() => updateNuxtCss('export default defineNuxtConfig({srcDir: getDir()})', 'app/assets/scss/ms-front-kit'), /srcDir must be a literal/);
});
