import { readFile } from 'node:fs/promises';

export function componentDetails(input) {
  const segments = input.split('/');
  if (!segments.every(segment => /^[A-Z][A-Za-z0-9]*$/.test(segment))) {
    throw new Error('Use PascalCase path segments, for example Home/Hero/BackButton (no extension).');
  }
  const bemSegments = segments.length > 1 && segments.at(-1) === 'Index'
    ? segments.slice(0, -1)
    : segments;
  const bemBlock = bemSegments.map(segment => segment
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()).join('__');
  return { directories: segments.slice(0, -1), name: segments.at(-1), bemBlock };
}

export async function renderComponent(input) {
  const details = componentDetails(input);
  const template = await readFile(new URL('../../templates/vue/components/basic/component.vue.tpl', import.meta.url), 'utf8');
  return { ...details, contents: template.replaceAll('{{bemBlock}}', details.bemBlock).replaceAll('{{componentName}}', details.name) };
}
