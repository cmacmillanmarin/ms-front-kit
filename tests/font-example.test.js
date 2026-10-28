import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('bundled WOFF2 asset and registered font example agree', async () => {
  const font = await readFile(new URL('../templates/shared/fonts/HelveticaNowDisplayMedium.woff2', import.meta.url));
  assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2');
  const template = await readFile(new URL('../templates/shared/scss/base/_fonts.scss', import.meta.url), 'utf8');
  assert.match(template, /^@font-face/m);
  assert.match(template, /  font-weight: 500;/);
  assert.match(template, /  font-display: swap;/);
  assert.match(template, /\/assets\/font\/HelveticaNowDisplayMedium.woff2/);
  const conventions = await readFile(new URL('../templates/vue/conventions.md.tpl', import.meta.url), 'utf8');
  assert.match(conventions, /public\/assets\/font\/HelveticaNowDisplayMedium.woff2/);
  assert.match(conventions, /automatically copies/);
  assert.match(conventions, /Confirm your license/);
});
