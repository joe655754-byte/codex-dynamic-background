import assert from 'node:assert/strict';
import { installWallpaper, stylesheet } from '../skills/codex-dynamic-background/scripts/runtime/renderer.mjs';

class Element extends EventTarget {
  constructor() { super(); this.style = {}; this.attributes = new Map(); this.removed = false; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  remove() { this.removed = true; }
}
class Video extends Element {
  readyState = 2; networkState = 1; videoWidth = 1920; videoHeight = 1080;
  currentTime = 0; duration = 2; paused = true;
  load() { this.loaded = true; }
  play() { this.paused = false; setTimeout(() => { this.currentTime += .1; }, 10); return Promise.resolve(); }
  pause() { this.paused = true; }
  getVideoPlaybackQuality() { return { totalVideoFrames: 6 }; }
}
function fixture(duration = 2) {
  const root = new Element();
  const classes = new Set(['light']);
  root.classList = { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name),
    toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) };
  const video = new Video(); video.duration = duration;
  let resets = 0, disposed = 0;
  const controller = { check: async () => ({}), diagnostics: () => ({ presentedFrames: Math.floor(video.currentTime * 60) }), resetProgress: () => resets++, dispose: () => disposed++ };
  const head = { children: [], append(element) { this.children.push(element); } };
  const body = { children: [], prepend(...elements) { this.children.unshift(...elements); } };
  globalThis.location = { protocol: 'app:', hostname: '-', pathname: '/index.html', href: 'app://-/index.html' };
  globalThis.document = { documentElement: root, head, body, visibilityState: 'visible', createElement: tag => tag === 'video' ? video : new Element() };
  return { root, video, head, body, controller, counts: () => ({ resets, disposed }) };
}

try {
  // Exercise the real installation function with DOM/media stubs. The explicit
  // objectFit applies to the entire viewport-sized video at any window ratio.
  for (const [requested, expected] of [[undefined, 'contain'], ['contain', 'contain'], ['cover', 'cover']]) {
    const fixtureState = fixture();
    const result = await installWallpaper([Buffer.from('media stub').toString('base64')], stylesheet, () => fixtureState.controller, requested);
    assert.equal(result.installed, true);
    assert.equal(result.advancing, true);
    assert.equal(fixtureState.video.style.objectFit, expected);
    assert.equal(fixtureState.video.loop, true);
    assert.equal(fixtureState.video.muted, true);
    assert.match(fixtureState.head.children[0].textContent, /width: 100vw; height: 100vh; object-fit: contain;/);
    assert.equal(fixtureState.root.classList.contains('dark'), true);
    globalThis.__codexDynamicBackground.cleanup();
    assert.equal(fixtureState.video.removed, true);
    assert.equal(fixtureState.video.paused, true);
    assert.equal(fixtureState.root.classList.contains('light'), true);
    assert.equal(fixtureState.root.getAttribute('data-codex-dynamic-background'), null);
    assert.deepEqual(fixtureState.counts(), { resets: 1, disposed: 1 });
    assert.equal(globalThis.__codexDynamicBackground, undefined);
  }
  {
    const state = fixture(31);
    await assert.rejects(installWallpaper([], stylesheet, () => state.controller), /at most 30 seconds/);
    assert.equal(state.video.removed, true);
    assert.equal(state.counts().disposed, 1);
  }
  {
    fixture(); globalThis.location.href = 'app://-/index.html?initialRoute=avatar-overlay';
    assert.deepEqual(await installWallpaper([], stylesheet, () => { throw new Error('Must not create a controller for auxiliary pages.'); }), { skipped: true });
  }
  console.log('Renderer fit, installation readiness, cleanup, duration limit, and auxiliary-page exclusion tests passed.');
} finally {
  globalThis.__codexDynamicBackground?.cleanup?.();
  delete globalThis.document; delete globalThis.location;
}
