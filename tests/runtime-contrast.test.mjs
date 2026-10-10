import assert from 'node:assert/strict';
import { createAdaptiveContrast, pickReadableForeground } from '../skills/codex-dynamic-background/scripts/runtime/adaptive-contrast.mjs';
import { stylesheet } from '../skills/codex-dynamic-background/scripts/runtime/renderer.mjs';

const attr = 'data-codex-dynamic-contrast-tone';

// Test actual contrast decisions, including an uneven background where no
// single foreground color can cover every sampled point.
assert.equal(pickReadableForeground('#339cff', [[35, 65, 140]], 'accent').tone, 'accent-light');
assert.equal(pickReadableForeground('#339cff', [[230, 240, 255]], 'accent').tone, 'accent-dark');
assert.equal(pickReadableForeground('#339cff', [[120, 120, 120]], 'accent').tone, 'neutral-dark');
const mixed = pickReadableForeground('#339cff', [[10, 20, 50], [230, 240, 255]], 'accent');
assert.equal(mixed.tone, 'accent-scrim');
assert.ok(mixed.contrast >= 4.5);
for (const backgrounds of [[[35, 65, 140]], [[230, 240, 255]], [[80, 80, 80]], [[10, 20, 50], [230, 240, 255]]]) {
  const selected = pickReadableForeground('#339cff', backgrounds, 'accent');
  if (selected) assert.ok(selected.contrast >= 4.5, JSON.stringify({ backgrounds, selected }));
}
assert.equal(pickReadableForeground('#10243b', [[220, 238, 255]], 'text'), null);
assert.equal(pickReadableForeground('#f5f9ff', [[12, 24, 43]], 'text'), null);
assert.equal(pickReadableForeground('rgba(245,249,255,.25)', [[12, 24, 43]], 'text').tone, 'text-light');
assert.equal(pickReadableForeground('#aa4044', [[100, 47, 70]], 'text').tone, 'danger-light');
assert.equal(pickReadableForeground('#bdcde0', [[8, 20, 42]], 'text', true), null);
assert.match(stylesheet, /\[data-theme\][\s\S]*--app-color-text-accent: var\(--codex-wallpaper-link\)/);
assert.match(stylesheet, /--app-color-text-button-primary: #10243b/);
assert.match(stylesheet, /--app-color-background-button-primary: #dceeff/);
assert.match(stylesheet, /data-codex-dynamic-contrast-tone="neutral-dark"\] \{ color: #000000 !important/);
assert.match(stylesheet, /data-codex-dynamic-contrast-tone="neutral-light"\] \{ color: #ffffff !important/);
assert.doesNotMatch(stylesheet, /\bbutton\s*\{\s*color:/);

class Style {
  values = new Map();
  background = '';
  getPropertyValue(name) { return this.values.get(name)?.[0] || ''; }
  getPropertyPriority(name) { return this.values.get(name)?.[1] || ''; }
  setProperty(name, value, priority = '') { this.values.set(name, [value, priority]); }
  removeProperty(name) { this.values.delete(name); }
}
class Element {
  constructor({ color = '#339cff', backgroundColor = 'transparent', tag = 'span', disabled = false, parent = null } = {}) {
    this.color = color; this.backgroundColor = backgroundColor; this.tag = tag; this.disabled = disabled;
    this.parentElement = parent; this.style = new Style(); this.attributes = new Map(); this.isConnected = true;
    this.textContent = { toString() { throw new Error('Chat text must not be inspected.'); } };
  }
  getBoundingClientRect() { return { left: 400, top: 300, right: 520, bottom: 330 }; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector.includes(':disabled') && node.disabled) return node;
      if (selector.includes('a[href]') && node.tag === 'a') return node;
    }
    return null;
  }
}
function fixture({ pixels = [35, 65, 140], candidates = [], objectFit = 'contain', picker = pickReadableForeground } = {}) {
  let currentPixels = pixels, brightSpot = false, failRead = false, timerStopped = false;
  const root = new Element({ tag: 'html' });
  root.style.setProperty('--codex-wallpaper-surface', 'original-surface', 'important');
  const body = new Element({ tag: 'body', parent: root });
  for (const candidate of candidates) if (!candidate.parentElement) candidate.parentElement = body;
  const shade = new Element({ tag: 'div', parent: body });
  const canvas = { width: 0, height: 0 };
  const context = {
    fillRect() {}, drawImage(...args) { this.lastDraw = args; },
    getImageData() {
      if (failRead) throw new Error('Canvas read blocked');
      const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
      for (let i = 0; i < data.length; i += 4) { data[i] = currentPixels[0]; data[i + 1] = currentPixels[1]; data[i + 2] = currentPixels[2]; data[i + 3] = 255; }
      if (brightSpot) { data[0] = 255; data[1] = 255; data[2] = 255; }
      return { data };
    }
  };
  canvas.getContext = () => context;
  const document = { body, hidden: false, createElement: () => canvas, querySelectorAll: () => candidates };
  const window = { innerWidth: 1920, innerHeight: 1080, getComputedStyle: element => ({
    color: element.color, backgroundColor: element.backgroundColor, display: 'block', visibility: 'visible', opacity: '1'
  }), setInterval: () => 11, clearInterval: id => { assert.equal(id, 11); timerStopped = true; } };
  const video = { videoWidth: 1920, videoHeight: 1080, readyState: 4, style: { objectFit } };
  const controller = createAdaptiveContrast(video, shade, root, picker, document, window);
  return { root, body, shade, context, video, controller, setPixels(value) { currentPixels = value; }, setBrightSpot(value) { brightSpot = value; }, fail() { failRead = true; }, timerStopped: () => timerStopped };
}

{
  // The pale primary button keeps its existing dark text. The same blue text
  // on a transparent secondary button is corrected against the scene.
  const primary = new Element({ tag: 'button', color: '#10243b', backgroundColor: 'rgb(220,238,255)' });
  const secondary = new Element({ tag: 'button', color: '#339cff' });
  const disabled = new Element({ tag: 'button', color: '#bdcde0', disabled: true });
  const test = fixture({ pixels: [230, 240, 255], candidates: [primary, secondary, disabled] });
  test.controller.start();
  assert.equal(primary.getAttribute(attr), null);
  assert.equal(secondary.getAttribute(attr), 'accent-light');
  assert.equal(disabled.disabled, true);
  assert.ok(['disabled-light', 'disabled-dark', null].includes(disabled.getAttribute(attr)));
  assert.equal(test.controller.diagnostics().mode, 'adaptive');
  assert.ok(test.shade.style.background.startsWith('rgba(3,9,20,'));
  test.controller.dispose();
  assert.equal(secondary.getAttribute(attr), null);
  assert.equal(test.root.style.getPropertyValue('--codex-wallpaper-surface'), 'original-surface');
  assert.equal(test.root.style.getPropertyPriority('--codex-wallpaper-surface'), 'important');
  assert.equal(test.timerStopped(), true);
}
{
  // A parent glass panel is part of the actual backdrop. Sampling only video
  // pixels would choose the opposite tone for a bright video under this panel.
  const panel = new Element({ backgroundColor: 'rgba(5,13,28,.96)' });
  const text = new Element({ color: '#10243b', parent: panel });
  const test = fixture({ pixels: [245, 250, 255], candidates: [text] });
  panel.parentElement = test.body;
  test.controller.sample();
  assert.equal(text.getAttribute(attr), 'text-light');
  test.controller.dispose();
}
{
  const icon = new Element({ color: '#339cff' });
  icon.getBoundingClientRect = () => ({ left: 400, top: 300, right: 424, bottom: 324, width: 24, height: 24 });
  icon.querySelector = selector => selector === 'svg' ? {} : null;
  const test = fixture({ pixels: [230, 240, 255], candidates: [icon] });
  test.controller.sample();
  assert.equal(icon.getAttribute(attr), null, 'icon-only wrappers should not gain a text scrim');
  test.controller.dispose();
}
{
  const text = new Element({ color: '#888fa8' });
  const picker = (original, backgrounds) => {
    const darkScene = backgrounds[0][0] < 50;
    return { tone: darkScene ? 'text-light' : 'text-dark', originalContrast: darkScene && original === '#11243b' ? 1.6 : 3.5 };
  };
  const test = fixture({ pixels: [240, 245, 250], candidates: [text], picker });
  test.controller.sample(); test.controller.sample();
  assert.equal(text.getAttribute(attr), 'text-dark');
  test.setPixels([8, 20, 48]); test.controller.sample();
  assert.equal(text.getAttribute(attr), 'text-light', 'an unreadable old color must switch on the first sample');
  test.controller.dispose();
}
{
  // Changing frames must wait for two stable samples unless the original
  // contrast is severely bad. Repeated scans keep the active attribute.
  const text = new Element({ color: '#888fa8' });
  const picker = (_original, backgrounds) => ({ tone: backgrounds[0][0] < 50 ? 'text-light' : 'text-dark', originalContrast: 3.5 });
  const test = fixture({ pixels: [10, 20, 40], candidates: [text], picker });
  test.controller.sample(); assert.equal(text.getAttribute(attr), null);
  test.controller.sample(); assert.equal(text.getAttribute(attr), 'text-light');
  test.setPixels([240, 245, 250]);
  test.controller.sample(); assert.equal(text.getAttribute(attr), 'text-light');
  test.controller.sample(); assert.equal(text.getAttribute(attr), 'text-dark');
  test.setPixels([10, 20, 40]);
  test.controller.sample(); assert.equal(text.getAttribute(attr), 'text-dark');
  test.controller.dispose(); assert.equal(text.getAttribute(attr), null);
}
{
  const test = fixture({ pixels: [8, 20, 48] });
  test.setBrightSpot(true); test.controller.sample();
  assert.ok(test.controller.diagnostics().shadeAlpha < .4, 'one bright point must not flip the whole scene');
  test.video.videoWidth = 1080; test.video.videoHeight = 1920;
  test.video.style.objectFit = 'contain'; test.controller.sample();
  assert.ok(test.context.lastDraw[3] < test.context.lastDraw[4], 'contain must letterbox portrait media');
  test.video.style.objectFit = 'cover'; test.controller.sample();
  assert.ok(test.context.lastDraw[3] > 60, 'cover must crop portrait media across the viewport');
  test.video.currentTime = 29.9; test.controller.sample();
  test.video.currentTime = .1; test.controller.sample();
  assert.equal(test.controller.diagnostics().mode, 'adaptive');
  test.controller.dispose();
}
{
  const text = new Element({ color: '#339cff' });
  const test = fixture({ candidates: [text], objectFit: 'cover' });
  test.controller.sample();
  assert.equal(test.context.lastDraw[0].videoWidth, 1920);
  test.fail(); test.controller.sample();
  assert.equal(test.controller.diagnostics().mode, 'safe-fallback');
  assert.ok(test.controller.diagnostics().shadeAlpha >= .75);
  assert.equal(text.getAttribute(attr), null);
  test.controller.dispose();
}
console.log('Adaptive contrast: dark/bright/mixed scenes, semantic colors, button surfaces, glass panels, hysteresis, fallback, and cleanup passed.');
