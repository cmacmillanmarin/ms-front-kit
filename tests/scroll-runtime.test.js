import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as Vue from 'vue';
import * as Pinia from 'pinia';

// Stands in for gsap.ticker on the fake frames: listeners in order, prioritized
// ones first, GSAP's arguments (seconds, ms), and asleep without listeners.
function createTicker() {
  const listeners = [];
  let frame;
  let last = 0;
  function loop(time) {
    const delta = last ? time - last : 1000 / 60;
    last = time;
    for (const listener of [...listeners]) listener(time / 1000, delta, 0);
    if (listeners.length) frame = requestAnimationFrame(loop);
    else { frame = undefined; last = 0; }
  }
  return {
    add(listener, _once, prioritize) {
      this.remove(listener);
      listeners[prioritize ? 'unshift' : 'push'](listener);
      if (frame === undefined) frame = requestAnimationFrame(loop);
    },
    remove(listener) {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
      if (listeners.length || frame === undefined) return;
      cancelAnimationFrame(frame);
      frame = undefined;
      last = 0;
    }
  };
}
let ticker = createTicker();

async function load(file, scope = {}, imports = {}) {
  const source = (await readFile(new URL(`../templates/vue/${file}`, import.meta.url), 'utf8')).replaceAll('{{storeDirectory}}', './store');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const modules = { vue: Vue, pinia: Pinia, gsap: { gsap: { ticker } }, ...imports };
  // Priority tickers register in a microtask; running it inline lets frames flush right away.
  const hooks = { onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted, onBeforeUnmount: Vue.onBeforeUnmount, watch: Vue.watch, nextTick: Vue.nextTick, queueMicrotask: callback => callback(), ...scope };
  new Function('exports', 'require', ...Object.keys(hooks), compiled)(exports, name => modules[name], ...Object.values(hooks));
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

function counted(target = new EventTarget()) {
  const counts = new Map();
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (event, callback, options) => { counts.set(event, (counts.get(event) || 0) + 1); add(event, callback, options); };
  target.removeEventListener = (event, callback, options) => { counts.set(event, (counts.get(event) || 0) - 1); remove(event, callback, options); };
  target.listeners = event => counts.get(event) || 0;
  return target;
}

function frames(t) {
  ticker = createTicker();
  const queue = new Map();
  let id = 0;
  global(t, 'requestAnimationFrame', callback => { queue.set(++id, callback); return id; });
  global(t, 'cancelAnimationFrame', frame => queue.delete(frame));
  let time = 0;
  return {
    pending: () => queue.size,
    flush(count = 1) {
      for (let i = 0; i < count; i++) {
        time += 1000 / 60;
        const callbacks = [...queue.values()];
        queue.clear();
        for (const callback of callbacks) callback(time);
      }
    }
  };
}

class FakeElement extends EventTarget {}
function style() {
  return {
    removeProperty(name) { delete this[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; }
  };
}
function element({ dataset = {}, top = 0, height = 0 } = {}) {
  const node = counted(new FakeElement());
  Object.assign(node, { dataset, style: style(), children: [], contains: other => other === node || node.children.some(child => child.contains(other)), getBoundingClientRect: () => ({ top, height, left: 0, right: 100, bottom: top + height }) });
  return node;
}

const mounted = new Set();
const renderer = Vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {},
  parentNode: () => null, nextSibling: () => null,
});
function mount(t, composable, setup = app => app) {
  let value;
  const app = setup(renderer.createApp({ setup() { value = composable(); return () => Vue.h('div'); } }));
  app.mount({});
  const unmount = () => { if (mounted.delete(unmount)) app.unmount(); };
  mounted.add(unmount);
  t.after(unmount);
  return { value, unmount };
}

test('useRaf shares GSAP\'s ticker, which sleeps when no ticker remains', async t => {
  global(t, 'window', {});
  const raf = frames(t);
  const useRaf = await load('composables/useRaf.ts.tpl');
  const first = mount(t, useRaf);
  const second = mount(t, useRaf);
  const calls = [];
  const a = (_time, delta) => calls.push(['a', Math.round(delta)]);
  const b = () => calls.push(['b']);
  first.value.addTicker(a);
  second.value.addTicker(b);
  assert.equal(raf.pending(), 1);
  raf.flush();
  assert.deepEqual(calls, [['a', 17], ['b']]);
  first.value.killTicker(a);
  raf.flush();
  assert.deepEqual(calls.at(-1), ['b']);
  second.unmount();
  assert.equal(raf.pending(), 0);
});

test('useRaf runs priority tickers first, deferred past the current frame, on the real GSAP ticker', async t => {
  global(t, 'window', {});
  const { gsap } = await import('gsap');
  t.after(() => gsap.ticker.sleep()); // Otherwise GSAP keeps its loop running for later tests.
  const useRaf = await load('composables/useRaf.ts.tpl', { queueMicrotask }, { gsap: { gsap } });
  const { value, unmount } = mount(t, useRaf);
  const calls = [];
  const plain = () => calls.push('plain');
  const first = (time, delta) => {
    assert.equal(typeof time, 'number');
    assert.equal(typeof delta, 'number');
    calls.push('first');
  };
  const killed = () => calls.push('killed');
  value.addTicker(plain);
  value.addTicker(first, { priority: true });
  value.addTicker(killed, { priority: true });
  value.killTicker(killed); // Killed before its microtask: never registered.
  gsap.ticker.tick();
  assert.deepEqual(calls, ['plain']); // Not added mid-frame.
  await Promise.resolve();
  calls.length = 0;
  gsap.ticker.tick();
  assert.deepEqual(calls, ['first', 'plain']);
  unmount();
  calls.length = 0;
  gsap.ticker.tick();
  assert.deepEqual(calls, []);
});

test('useRaf registers nothing during server rendering', async t => {
  global(t, 'window', undefined);
  const added = [];
  const useRaf = await load('composables/useRaf.ts.tpl', {}, { gsap: { gsap: { ticker: { add: listener => added.push(listener), remove() {} } } } });
  useRaf().addTicker(() => {});
  useRaf().addTicker(() => {}, { priority: true });
  assert.deepEqual(added, []);
});

test('scroll lock blocks page gestures, allows marked containers until their edge, and cleans up', async t => {
  const win = counted();
  global(t, 'window', win);
  global(t, 'HTMLElement', FakeElement);
  global(t, 'Element', FakeElement);
  const useScrollLock = await load('composables/useScrollLock.ts.tpl');
  const instance = mount(t, useScrollLock);
  instance.value.create();
  instance.value.create();
  assert.equal(win.listeners('wheel'), 1);
  const modal = Object.assign(element(), { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
  const inside = Object.assign(element(), { closest: () => modal });
  const outside = Object.assign(element(), { closest: () => null });
  const wheel = (target, deltaY) => {
    let prevented = false;
    const event = new Event('wheel', { cancelable: true });
    Object.assign(event, { deltaY, preventDefault: () => { prevented = true; } });
    Object.defineProperty(event, 'target', { value: target });
    win.dispatchEvent(event);
    return prevented;
  };
  assert.equal(wheel(outside, 50), true);
  assert.equal(wheel(inside, 50), false);
  assert.equal(wheel(inside, -50), true); // Already at the top: do not chain to the page.
  modal.scrollTop = 600;
  assert.equal(wheel(inside, 50), true); // At the bottom.
  instance.unmount();
  for (const event of ['wheel', 'touchstart', 'touchmove', 'keydown']) assert.equal(win.listeners(event), 0);
});

function virtualDom(t) {
  const win = counted();
  Object.assign(win, {
    innerHeight: 800,
    scrollTo() {},
    matchMedia: () => ({ matches: false }),
    CSS: { supports: () => true },
    getComputedStyle: () => ({ willChange: 'auto', top: '0px' })
  });
  global(t, 'window', win);
  global(t, 'HTMLElement', FakeElement);
  const focus = { page: true };
  global(t, 'document', { hasFocus: () => focus.page });
  const sections = [0, 1000, 2000].map(top => element({ dataset: { scroll: '' }, top, height: 1000 }));
  const parent = Object.assign(counted(), { style: style(), dataset: {}, scrollTop: 0, clientHeight: 800, getBoundingClientRect: () => ({ top: 0, height: 800 }) });
  const root = Object.assign(element({ top: 0, height: 3000 }), { parentElement: parent, querySelectorAll: () => sections });
  return { win, root, parent, sections, focus };
}

test('virtual scroll eases to wheel targets, sleeps at rest, and removes every listener', async t => {
  const raf = frames(t);
  const { win, root, parent, sections } = virtualDom(t);
  const useRaf = await load('composables/useRaf.ts.tpl');
  const useScrollVirtual = await load('composables/useScrollVirtual.ts.tpl', { useRaf });
  const instance = mount(t, useScrollVirtual);
  const updates = [];
  instance.value.create({ el: root, update: data => updates.push(data), position: 0 });
  assert.equal(parent.style.overflow, 'clip');
  assert.equal(parent.style.height, undefined); // CSS keeps the root at 100svh.
  assert.equal(sections[0].style.willChange, 'transform');
  assert.equal(raf.pending(), 0); // Nothing to animate yet.

  const wheel = new Event('wheel', { cancelable: true });
  Object.assign(wheel, { deltaY: 500, deltaMode: 0 });
  parent.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, true);
  raf.flush(200);
  assert.equal(raf.pending(), 0); // Slept once the target was reached.
  assert.equal(updates.at(-1).current, 500);
  assert.equal(updates.at(-1).direction, 'down');
  assert.equal(sections[0].style.transform, 'translate3d(0, -500px, 0)');
  assert.equal(sections[2].style.transform, 'translate3d(0, 0px, 0)'); // Below the viewport.

  // Clamped to content height minus viewport.
  Object.assign(wheel, { deltaY: 10000 });
  parent.dispatchEvent(wheel);
  raf.flush(300);
  assert.equal(updates.at(-1).current, 2200);
  assert.equal(updates.at(-1).bounding, 2200);
  assert.equal(sections[0].style.transform, 'translate3d(0, -1000px, 0)'); // Parked above the viewport.

  let writes = 0;
  const transform = Object.getOwnPropertyDescriptor(sections[2].style, 'transform');
  Object.defineProperty(sections[2].style, 'transform', { configurable: true, get: () => transform.value, set: value => { writes++; transform.value = value; } });
  instance.value.to(2200);
  raf.flush(5);
  assert.equal(writes, 0); // Unchanged positions are not rewritten.
  Object.defineProperty(sections[2].style, 'transform', { configurable: true, writable: true, value: transform.value });

  instance.value.disable(true);
  Object.assign(wheel, { deltaY: -500 });
  parent.dispatchEvent(wheel);
  assert.equal(raf.pending(), 0);
  instance.value.disable(false);

  instance.unmount();
  assert.equal(parent.listeners('wheel'), 0);
  for (const event of ['touchstart', 'touchmove', 'touchend', 'focusin']) assert.equal(root.listeners(event), 0, event);
  assert.equal(win.listeners('keydown'), 0);
  assert.equal(parent.style.overflow, undefined);
  assert.equal(sections[0].style.transform, undefined);
  assert.equal(sections[0].style.willChange, undefined);
});

test('find in page hands the position to a native root scroll and returns from where it left', async t => {
  const raf = frames(t);
  const { win, root, parent, sections, focus } = virtualDom(t);
  // A section nested in another keeps a transform relative to its parent.
  const inner = element({ dataset: { scroll: '' }, top: 1200, height: 200 });
  sections[1].children.push(inner);
  root.querySelectorAll = () => [...sections, inner];
  const useRaf = await load('composables/useRaf.ts.tpl');
  const useScrollVirtual = await load('composables/useScrollVirtual.ts.tpl', { useRaf });
  const instance = mount(t, useScrollVirtual);
  const updates = [];
  instance.value.create({ el: root, update: data => updates.push(data), position: 1500 });
  assert.equal(sections[0].style.transform, 'translate3d(0, -1000px, 0)'); // Parked above.
  const key = (code, extra = {}) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
    win.dispatchEvent(event);
    return event;
  };

  // Cmd+F: not prevented, root becomes a real scroll container at the same position.
  assert.equal(key('KeyF', { metaKey: true }).defaultPrevented, false);
  assert.equal(parent.style.overflow, 'hidden auto');
  assert.equal(parent.dataset.scrollFind, '');
  assert.equal(parent.scrollTop, 1500);
  // Top-level sections stay in place, including off-screen ones; nested ones keep their offset.
  for (const section of sections) assert.equal(section.style.transform, 'translate3d(0, 0px, 0)');
  assert.equal(inner.style.transform, 'translate3d(0, -1500px, 0)');

  // The browser scrolls the root to a match above.
  parent.scrollTop = 200;
  parent.dispatchEvent(new Event('scroll'));
  assert.equal(updates.at(-1).current, 200);

  // The first wheel returns to virtual mode from there, without a jump.
  const wheel = new Event('wheel', { cancelable: true });
  Object.assign(wheel, { deltaY: 100, deltaMode: 0 });
  parent.dispatchEvent(wheel);
  assert.equal(parent.scrollTop, 0);
  assert.equal(parent.style.overflow, 'clip');
  assert.equal(parent.dataset.scrollFind, undefined);
  assert.equal(updates.at(-1).current, 200);
  // Window blur during an animation waits; the animation stopping unfocused starts search mode.
  focus.page = false;
  win.dispatchEvent(new Event('blur'));
  assert.equal(parent.dataset.scrollFind, undefined);
  raf.flush(200);
  assert.equal(updates.at(-1).current, 300);
  assert.equal(parent.dataset.scrollFind, '');
  assert.equal(parent.scrollTop, 300);

  // A handled key reaching the page leaves search mode.
  focus.page = true;
  assert.equal(key('ArrowDown').defaultPrevented, true);
  assert.equal(parent.dataset.scrollFind, undefined);
  raf.flush(200);
  assert.equal(updates.at(-1).current, 400);

  // A blur at rest enters; scrollTo leaves.
  win.dispatchEvent(new Event('blur'));
  assert.equal(parent.dataset.scrollFind, '');
  instance.value.to(0, { immediate: true });
  assert.equal(parent.dataset.scrollFind, undefined);
  assert.equal(updates.at(-1).current, 0);

  // Outside search mode, native scrolls of the root are undone.
  parent.scrollTop = 120;
  parent.dispatchEvent(new Event('scroll'));
  assert.equal(parent.scrollTop, 0);

  // Disabled (modal open): neither the shortcut nor a blur moves the page underneath.
  win.dispatchEvent(new Event('blur'));
  instance.value.disable(true);
  assert.equal(parent.dataset.scrollFind, undefined);
  key('KeyF', { ctrlKey: true });
  key('F3');
  win.dispatchEvent(new Event('blur'));
  assert.equal(parent.dataset.scrollFind, undefined);
  assert.equal(parent.style.overflow, 'clip');
  instance.value.disable(false);

  // Destroying during search restores the root.
  key('KeyG', { metaKey: true });
  assert.equal(parent.dataset.scrollFind, '');
  instance.unmount();
  assert.equal(parent.dataset.scrollFind, undefined);
  assert.equal(parent.scrollTop, 0);
  assert.equal(parent.style.overflow, undefined);
  assert.equal(win.listeners('blur'), 0);
  assert.equal(parent.listeners('scroll'), 0);
});

test('virtual scroll falls back to moving the whole content when nothing is marked', async t => {
  frames(t);
  const { root } = virtualDom(t);
  root.querySelectorAll = () => [];
  const useRaf = await load('composables/useRaf.ts.tpl');
  const useScrollVirtual = await load('composables/useScrollVirtual.ts.tpl', { useRaf });
  const instance = mount(t, useScrollVirtual);
  instance.value.create({ el: root, update() {}, position: 300 });
  assert.equal(root.style.transform, 'translate3d(0, -300px, 0)');
  instance.unmount();
  assert.equal(root.style.transform, undefined);
});

test('native scroll uses the Scroll root as scroll container instead of the window', async t => {
  const raf = frames(t);
  const win = counted();
  let windowScrolls = 0;
  Object.assign(win, { innerHeight: 900, scrollTo: () => { windowScrolls++; }, matchMedia: () => ({ matches: false }) });
  global(t, 'window', win);
  global(t, 'document', { getElementById: id => (id === 'about' ? about : null) });
  const scroller = counted(new FakeElement());
  Object.assign(scroller, {
    scrollTop: 0, clientHeight: 800, scrollHeight: 3000,
    getBoundingClientRect: () => ({ top: 50 }),
    scrollTo({ top }) { this.scrollTop = top; this.dispatchEvent(new Event('scroll')); }
  });
  const section = Object.assign(element({ dataset: { scrollSetProgress: '' } }), {
    getBoundingClientRect: () => ({ top: 50 + 1000 - scroller.scrollTop, height: 400, left: 0, right: 0, bottom: 0 })
  });
  const about = { dataset: { scrollTargetOffset: '20' }, getBoundingClientRect: () => ({ top: 50 + 1500 - scroller.scrollTop, height: 200 }) };
  const root = Object.assign(element(), { parentElement: scroller, querySelectorAll: () => [section] });
  const useRaf = await load('composables/useRaf.ts.tpl');
  const useScrollNative = await load('composables/useScrollNative.ts.tpl', { useRaf });
  const instance = mount(t, useScrollNative);
  const updates = [];
  instance.value.create({ el: root, update: data => updates.push(data), position: 200 });
  assert.equal(scroller.scrollTop, 200);
  assert.equal(scroller.listeners('scroll'), 1);
  assert.equal(win.listeners('scroll'), 0);
  assert.equal(updates.at(-1).bounding, 2200);
  assert.equal(section.dataset.scrollProgress, '0.00');

  scroller.scrollTo({ top: 1400 });
  raf.flush(200);
  assert.equal(raf.pending(), 0);
  assert.equal(updates.at(-1).current, 1400);
  assert.equal(section.dataset.scrollProgress, '1.00'); // (1400 - 1000 + 800) / (400 + 800)

  instance.value.to('#about');
  assert.equal(scroller.scrollTop, 1480);
  instance.value.reset();
  assert.equal(scroller.scrollTop, 0);
  assert.equal(windowScrolls, 0);
  instance.unmount();
  assert.equal(scroller.listeners('scroll'), 0);
  assert.equal(win.listeners('keydown'), 0);
});

test('native scroll answers scroll keys only while focus is outside the root and nothing is typing', async t => {
  frames(t);
  const win = counted();
  Object.assign(win, { innerHeight: 900, scrollTo() {}, matchMedia: () => ({ matches: false }) });
  global(t, 'window', win);
  global(t, 'document', { getElementById: () => null });
  global(t, 'Node', FakeElement);
  global(t, 'HTMLElement', FakeElement);
  const inside = element();
  const scroller = counted(new FakeElement());
  const moves = [];
  Object.assign(scroller, {
    scrollTop: 0, clientHeight: 800, scrollHeight: 3000,
    contains: target => target === inside,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo({ top, behavior }) { moves.push([top, behavior]); this.scrollTop = top; }
  });
  const root = Object.assign(element(), { parentElement: scroller, querySelectorAll: () => [] });
  const useRaf = await load('composables/useRaf.ts.tpl');
  const useScrollNative = await load('composables/useScrollNative.ts.tpl', { useRaf });
  const instance = mount(t, useScrollNative);
  instance.value.create({ el: root, update() {}, position: 0 });
  moves.length = 0;
  const press = (code, { target = element(), ...keys } = {}) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { code, ...keys });
    Object.defineProperty(event, 'target', { value: target });
    win.dispatchEvent(event);
    return event;
  };
  const tops = [['ArrowDown', {}, 40], ['ArrowUp', {}, 0], ['ArrowUp', {}, 0], ['PageDown', {}, 720], ['PageUp', {}, 0], ['Space', {}, 720], ['Space', { shiftKey: true }, 0], ['End', {}, 2200], ['Home', {}, 0]];
  for (const [code, keys, top] of tops) {
    assert.equal(press(code, keys).defaultPrevented, true, code);
    assert.deepEqual(moves.at(-1), [top, 'smooth'], code);
  }
  moves.length = 0;
  const button = Object.assign(element(), { tagName: 'BUTTON' });
  const field = Object.assign(element(), { tagName: 'INPUT' });
  const editable = Object.assign(element(), { isContentEditable: true });
  const ignored = [
    press('Space', { target: button }), press('ArrowDown', { target: field }), press('ArrowDown', { target: editable }),
    press('ArrowDown', { target: inside }), press('ArrowDown', { metaKey: true }), press('ArrowDown', { ctrlKey: true }), press('ArrowDown', { altKey: true }), press('KeyA')
  ];
  for (const event of ignored) assert.equal(event.defaultPrevented, false);
  // Space on a button activates it, but its arrows still scroll.
  assert.equal(press('ArrowDown', { target: button }).defaultPrevented, true);
  moves.length = 0;
  instance.value.disable(true);
  assert.equal(press('ArrowDown').defaultPrevented, false);
  instance.value.disable(false);
  assert.equal(press('ArrowDown').defaultPrevented, true);
  assert.equal(moves.length, 1);
  instance.unmount();
  assert.equal(win.listeners('keydown'), 0);
});

test('auto mode is native only on touch with a mobile layout, and native mode follows disable()', async t => {
  frames(t);
  const engine = name => ({ name, created: 0, destroyed: 0, disabled: [], updates: 0,
    create() { this.created++; }, destroy() { this.destroyed++; }, disable(value) { this.disabled.push(value); },
    update() { this.updates++; }, reset() {}, to() {} });
  const virtual = engine('virtual');
  const native = engine('native');
  const device = { touch: Vue.ref(false), isDesktop: Vue.ref(false), isTabletLandscape: Vue.ref(false) };
  const tickers = new Set();
  let observed;
  global(t, 'ResizeObserver', class { constructor(callback) { observed = callback; } observe() {} disconnect() {} });
  const useScrollStore = await load('stores/useScrollStore.ts.tpl');
  const useScroll = await load('composables/useScroll.ts.tpl', {
    useRoute: () => undefined,
    useDevice: () => device,
    useResize: () => ({ onResize: Vue.ref(false) }),
    useScrollLock: () => ({ create() {}, destroy() {} }),
    useRaf: () => ({ addTicker: ticker => tickers.add(ticker), killTicker: ticker => tickers.delete(ticker) }),
    useScrollVirtual: () => virtual,
    useScrollNative: () => native
  }, { './store/useScrollStore': { default: useScrollStore } });
  const pinia = Pinia.createPinia();
  const instance = mount(t, () => { const store = useScrollStore(); return { store, scroll: useScroll() }; }, app => app.use(pinia));
  const { store, scroll } = instance.value;
  const el = { dataset: {} };
  scroll.init({ el });
  const expectMode = async (touch, isDesktop, isTabletLandscape, expected, label) => {
    device.touch.value = touch;
    device.isDesktop.value = isDesktop;
    device.isTabletLandscape.value = isTabletLandscape;
    await Vue.nextTick();
    assert.equal(store.activeMode, expected, label);
    assert.equal(el.dataset.scrollMode, expected, label);
  };
  assert.equal(store.activeMode, 'virtual');
  await expectMode(true, false, false, 'native', 'touch with a mobile layout');
  await expectMode(true, false, true, 'virtual', 'landscape tablet');
  await expectMode(true, true, false, 'virtual', 'touch laptop');
  await expectMode(false, true, false, 'virtual', 'desktop');
  await expectMode(false, false, false, 'virtual', 'no touch, without device styles');
  await expectMode(true, false, false, 'native', 'touch, without device styles');

  store.disable(true);
  await Vue.nextTick();
  assert.deepEqual([native.disabled.at(-1), virtual.disabled.at(-1)], [true, true]);
  store.disable(false);
  await Vue.nextTick();
  assert.equal(native.disabled.at(-1), false);
  store.setMode('virtual');
  await Vue.nextTick();
  assert.equal(store.activeMode, 'virtual');

  // Bursts of size changes measure once, on the next shared frame.
  observed();
  observed();
  assert.equal(tickers.size, 1);
  const [flush] = tickers;
  const updates = virtual.updates;
  flush();
  assert.equal(virtual.updates, updates + 1);
  assert.equal(tickers.size, 0);
  observed();
  assert.equal(tickers.size, 1);
  instance.unmount();
  assert.equal(tickers.size, 0);
});

test('scrollbar sizes and follows the thumb, drags, pages toward held clicks, jumps on Alt-click, and cleans up', async t => {
  global(t, 'window', { getComputedStyle: () => ({ paddingTop: '2px', paddingBottom: '2px' }) });
  global(t, 'Node', FakeElement);
  const timers = new Map();
  let timerId = 0;
  global(t, 'setTimeout', (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; });
  global(t, 'clearTimeout', id => timers.delete(id));
  const runTimers = delay => {
    for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); }
  };
  const useScrollStore = await load('stores/useScrollStore.ts.tpl');
  const pinia = Pinia.createPinia();
  const store = mount(t, () => useScrollStore(), app => app.use(pinia)).value;
  // A virtual engine stand-in: scrollTo jumps and reports through the store.
  const targets = [];
  const data = current => ({ current, currentVertical: current, speed: 0, direction: 'down', bounding: 3200, inTarget: true });
  store.register({ to: (value, options) => { targets.push([value, options]); store.setData(data(value)); }, update() {}, reset() {} });
  store.setData(data(0));
  const useScrollBar = await load('composables/useScrollBar.ts.tpl', {}, { './store/useScrollStore': { default: useScrollStore } });
  const thumb = element();
  const attributes = {};
  let valueWrites = 0;
  const track = Object.assign(element(), {
    clientHeight: 804,
    setAttribute(name, value) { attributes[name] = value; if (name === 'aria-valuenow') valueWrites++; },
    setPointerCapture() {}, getBoundingClientRect: () => ({ top: 0 })
  });
  thumb.contains = target => target === thumb;
  const instance = mount(t, useScrollBar, app => app.use(pinia));
  instance.value.create({ track, thumb });
  // 800px of travel for a 804px viewport over 3200px of overflow: 800 * 804 / 4004.
  assert.equal(thumb.style.height, `${800 * 804 / 4004}px`);
  assert.equal(track.dataset.overflow, 'true');
  assert.equal(attributes['aria-valuenow'], '0');
  const size = 800 * 804 / 4004;
  const travel = 800 - size;

  store.setData(data(1600));
  assert.equal(thumb.style.transform, `translate3d(0, ${travel / 2}px, 0)`);
  assert.equal(attributes['aria-valuenow'], '50');
  // The attribute only changes per percent, not per frame.
  const writes = valueWrites;
  store.setData(data(1601));
  store.setData(data(1602));
  assert.equal(valueWrites, writes);
  store.setData(data(1600));
  assert.equal(track.dataset.visible, ''); // Shown while scrolling...
  runTimers(1000);
  assert.equal(track.dataset.visible, undefined); // ...and hidden after the idle delay.

  const pointer = (type, clientY, { target = track, altKey = false } = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientY, button: 0, pointerId: 1, altKey });
    Object.defineProperty(event, 'target', { value: target });
    track.dispatchEvent(event);
    return event;
  };
  // Drag the thumb by 100px: the scroll moves 100 * bounding / travel, immediately.
  const grabY = 2 + travel / 2 + 10;
  assert.equal(pointer('pointerdown', grabY, { target: thumb }).defaultPrevented, true);
  assert.equal(track.dataset.active, '');
  pointer('pointermove', grabY + 100);
  assert.ok(Math.abs(targets.at(-1)[0] - (1600 + 100 / travel * 3200)) < 1e-6);
  assert.deepEqual(targets.at(-1)[1], { immediate: true });
  pointer('pointerup', grabY + 100);
  assert.equal(track.dataset.active, undefined);

  // Track click below the thumb pages down by 90% of the viewport and repeats while held.
  store.setData(data(0));
  targets.length = 0;
  pointer('pointerdown', 700);
  assert.deepEqual(targets, [[804 * 0.9, undefined]]);
  runTimers(300);
  runTimers(60);
  assert.equal(targets.length, 3);
  for (let i = 0; i < 20; i++) runTimers(60);
  // Stops once the thumb reaches the pointer.
  const reached = targets.at(-1)[0] / 3200 * travel + 2;
  assert.ok(700 >= reached && 700 <= reached + size, 'thumb under pointer');
  pointer('pointerup', 700);
  assert.equal([...timers.values()].filter(timer => timer.delay === 60).length, 0);

  // Alt-click centres the thumb on the pointer and keeps dragging.
  pointer('pointerdown', 2 + size / 2 + travel / 4, { altKey: true });
  assert.ok(Math.abs(targets.at(-1)[0] - 800) < 1e-6);
  pointer('pointerup', 0);

  // No overflow hides the bar.
  store.setData({ ...data(0), bounding: 0 });
  assert.equal(track.dataset.overflow, 'false');
  assert.equal(attributes['aria-valuenow'], '0');

  // The thumb turns light over dark backgrounds, read from the element behind it.
  const backgrounds = new Map();
  const body = Object.assign(element(), { parentElement: null });
  const section = Object.assign(element(), { parentElement: body });
  backgrounds.set(body, 'rgb(0, 0, 0)');
  backgrounds.set(section, 'rgba(0, 0, 0, 0)'); // Transparent: the body behind decides.
  window.getComputedStyle = node => ({ paddingTop: '2px', paddingBottom: '2px', backgroundColor: backgrounds.get(node) ?? 'rgba(0, 0, 0, 0)' });
  track.contains = target => target === track || target === thumb;
  global(t, 'document', { elementsFromPoint: () => [thumb, track, section, body] });
  store.setData({ ...data(0), bounding: 3200 });
  runTimers(1000);
  store.setData(data(100));
  assert.equal(track.dataset.background, 'dark');
  runTimers(1000);
  backgrounds.set(section, 'rgb(255, 255, 255)');
  store.setData(data(200)); // Reappearing samples again.
  assert.equal(track.dataset.background, 'light');
  runTimers(1000);
  backgrounds.set(section, 'oklch(0.2 0 0)');
  store.setData(data(300)); // Unknown formats fall back to the CSS defaults.
  assert.equal(track.dataset.background, undefined);

  instance.unmount();
  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'pointerenter']) assert.equal(track.listeners(event), 0, event);
  const calls = targets.length;
  store.setData(data(500));
  assert.equal(targets.length, calls);
  assert.equal(timers.size, 0);
});

test('scroll store delegates to the registered controller and reports data to sync watchers', async t => {
  const useScrollStore = await load('stores/useScrollStore.ts.tpl');
  const pinia = Pinia.createPinia();
  const { value: store } = mount(t, () => useScrollStore(), app => app.use(pinia));
  const calls = [];
  const unregister = store.register({ to: (...args) => calls.push(['to', ...args]), update: () => calls.push(['update']), reset: () => calls.push(['reset']) });
  store.scrollTo('#about', { immediate: true });
  store.update();
  store.reset();
  assert.deepEqual(calls, [['to', '#about', { immediate: true }], ['update'], ['reset']]);
  unregister();
  store.scrollTo(10);
  assert.equal(calls.length, 3);
  assert.equal(store.addRenderCallback, undefined);
  assert.equal(store.removeRenderCallback, undefined);
  const seen = [];
  const stop = Vue.watch(() => store.data, data => seen.push(data.current), { flush: 'sync' });
  store.setData({ current: 42, currentVertical: 42, speed: 0, direction: 'down', bounding: 100, inTarget: true });
  assert.deepEqual(seen, [42]); // Same frame as the update.
  stop();
});
