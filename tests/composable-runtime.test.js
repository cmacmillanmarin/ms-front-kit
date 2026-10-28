import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as Vue from 'vue';
import { renderToString } from '@vue/server-renderer';

async function load(name, dependencies = {}) {
  const source = await readFile(new URL(`../templates/vue/composables/${name}.ts.tpl`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const scope = { ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted, ...dependencies };
  new Function('exports', ...Object.keys(scope), compiled)(exports, ...Object.values(scope));
  return exports.default;
}

function global(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

const mountedApps = new Set();
function browser(t) {
  t.after(() => { for (const unmount of [...mountedApps]) unmount(); });
  const win = new EventTarget();
  win.innerWidth = 1200;
  win.innerHeight = 800;
  win.devicePixelRatio = 1;
  win.visualViewport = new EventTarget();
  const env = { maximum: '', label: '"desktop"', probeWidth: 960, probes: 0 };
  const navigator = { userAgent: 'Mozilla Safari/605.1', vendor: 'Apple Computer, Inc.', platform: 'MacIntel', maxTouchPoints: 0 };
  const media = new Map();
  win.matchMedia = query => {
    if (!media.has(query)) {
      const value = new EventTarget();
      value.matches = false;
      value.media = query;
      value.listenerCount = listenerCount(value);
      media.set(query, value);
    }
    return media.get(query);
  };
  win.CSS = { supports: (_property, value) => /rem|calc/.test(value) };
  win.getComputedStyle = (_element, pseudo) => ({ getPropertyValue: property => {
    if (pseudo && property === 'content') return env.label;
    return property === '--layout-max-width' ? env.maximum : '';
  } });
  const doc = {
    body: {}, onwheel: null,
    documentElement: { appendChild: () => { env.probes++; } },
    createElement: () => ({ style: {}, getBoundingClientRect: () => ({ width: env.probeWidth }), remove: () => { env.probes--; } })
  };
  global(t, 'window', win);
  global(t, 'document', doc);
  global(t, 'navigator', navigator);
  return { win, env, navigator, media };
}

const renderer = Vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {},
  parentNode: () => null, nextSibling: () => null,
});
function mount(composable) {
  let value;
  const app = renderer.createApp({ setup() { value = composable(); return () => Vue.h('div'); } });
  app.mount({});
  const unmount = () => {
    if (!mountedApps.delete(unmount)) return;
    app.unmount();
  };
  mountedApps.add(unmount);
  return { value, unmount };
}

function listenerCount(target) {
  const counts = new Map();
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (event, callback, options) => { counts.set(event, (counts.get(event) || 0) + 1); add(event, callback, options); };
  target.removeEventListener = (event, callback, options) => { counts.set(event, (counts.get(event) || 0) - 1); remove(event, callback, options); };
  return event => counts.get(event) || 0;
}

test('resize consumers share state/listeners and only final unmount clears debounce', async t => {
  const { win } = browser(t);
  const listeners = listenerCount(win);
  const viewportListeners = listenerCount(win.visualViewport);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const useResize = await load('useResize');
  const first = mount(useResize);
  const second = mount(useResize);
  assert.equal(first.value.vw, second.value.vw);
  assert.equal(listeners('resize'), 1);
  assert.equal(viewportListeners('resize'), 1);
  assert.equal(first.value.lvw.value, 1200);
  win.innerWidth = 1000;
  win.dispatchEvent(new Event('resize'));
  assert.equal(first.value.vw.value, 1000);
  first.unmount();
  assert.equal(listeners('resize'), 1);
  t.mock.timers.tick(200);
  assert.equal(second.value.onResize.value, true);
  win.innerWidth = 900;
  win.dispatchEvent(new Event('resize'));
  second.unmount();
  assert.equal(listeners('resize'), 0);
  assert.equal(viewportListeners('resize'), 0);
  t.mock.timers.tick(200);
  assert.equal(second.value.onResize.value, true);
});

test('layout maximum supports pixels, browser-resolved lengths, and safe fallback', async t => {
  const { env, win } = browser(t);
  const instance = mount(await load('useResize'));
  t.after(instance.unmount);
  for (const [raw, expected] of [['800px', 800], ['60rem', 960], ['calc(100vw - 240px)', 960], ['', 1200], ['garbage', 1200], ['0px', 1200], ['-1px', 1200]]) {
    env.maximum = raw;
    win.dispatchEvent(new Event('resize'));
    assert.equal(instance.value.lvw.value, expected, raw);
    assert.equal(env.probes, 0);
  }
  win.innerHeight = 0;
  win.dispatchEvent(new Event('resize'));
  assert.equal(instance.value.vr.value, 0);
});

test('device tracks pointer/hover and DPR changes without a resize, then cleans up', async t => {
  const { win, env, navigator, media } = browser(t);
  const useResize = await load('useResize');
  const useDevice = await load('useDevice', { useResize });
  const instance = mount(useDevice);
  const device = instance.value;
  assert.equal(device.breakpoint.value, 'desktop');
  assert.equal(device.isDesktop.value, true);
  assert.equal(device.touch.value, false);
  const coarse = media.get('(pointer: coarse)');
  coarse.matches = true;
  coarse.dispatchEvent(new Event('change'));
  assert.equal(device.coarsePointer.value, true);
  assert.equal(device.touch.value, false); // Coarse does not prove touch support.
  navigator.maxTouchPoints = 5;
  win.dispatchEvent(new Event('focus'));
  assert.equal(device.touch.value, true);
  assert.equal(device.isPhoneOrTablet.value, true); // iPad desktop-style UA hint.
  const hover = media.get('(hover: hover)');
  hover.matches = true;
  hover.dispatchEvent(new Event('change'));
  assert.equal(device.canHover.value, true);
  win.devicePixelRatio = 2;
  media.get('(resolution: 1dppx)').dispatchEvent(new Event('change'));
  assert.equal(device.dpr.value, 2);
  assert.ok(media.has('(resolution: 2dppx)'));
  env.label = '"tablet--landscape"';
  win.dispatchEvent(new Event('focus'));
  assert.equal(device.isTabletLandscape.value, true);
  assert.equal(device.isDesktop.value, false);
  instance.unmount();
  for (const query of media.values()) assert.equal(query.listenerCount('change'), 0);
  coarse.matches = false;
  coarse.dispatchEvent(new Event('change'));
  assert.equal(device.coarsePointer.value, true);
});

test('SSR state is isolated and image helpers are safe without browser globals', async t => {
  global(t, 'window', undefined);
  global(t, 'document', undefined);
  const useResize = await load('useResize');
  const useDevice = await load('useDevice', { useResize });
  const values = [];
  for (let i = 0; i < 2; i++) {
    await renderToString(Vue.createSSRApp({ setup() { values.push(useResize()); return () => Vue.h('div'); } }));
  }
  assert.notEqual(values[0].vw, values[1].vw);
  let device;
  await renderToString(Vue.createSSRApp({ setup() { device = useDevice(); return () => Vue.h('div'); } }));
  assert.equal(await device.webpSupport(), false);
  assert.equal(await device.avifSupport(), false);
});

test('image support checks resolve load/error/timeout and clear their handlers', async t => {
  browser(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const images = [];
  global(t, 'Image', class {
    width = 1;
    constructor() { images.push(this); }
    set src(value) { this.source = value; }
  });
  const useResize = await load('useResize');
  const instance = mount(await load('useDevice', { useResize }));
  t.after(instance.unmount);
  const loaded = instance.value.webpSupport();
  images.at(-1).onload();
  assert.equal(await loaded, true);
  assert.equal(images.at(-1).onload, null);
  const failed = instance.value.avifSupport();
  images.at(-1).onerror();
  assert.equal(await failed, false);
  const timedOut = instance.value.webpSupport();
  t.mock.timers.tick(3000);
  assert.equal(await timedOut, false);
  assert.equal(images.at(-1).onerror, null);
});
