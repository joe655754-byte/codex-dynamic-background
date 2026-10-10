// Both functions are serialized into the verified Codex main renderer. Keep them
// self-contained and never inspect text, chat data, or browser storage.
export function pickReadableForeground(original, backgrounds, kind = 'text', disabled = false) {
  function rgb(value) {
    if (typeof value !== 'string') return null;
    const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (hex) return [...[0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)), 1];
    const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i.exec(value.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
  }
  function luminance(color) {
    const linear = color.map(value => {
      const channel = Math.min(255, Math.max(0, value)) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  const source = rgb(original);
  if (!source || !Array.isArray(backgrounds) || !backgrounds.length) return null;
  const samples = backgrounds.filter(color => Array.isArray(color) && color.length === 3);
  if (!samples.length) return null;
  const minimum = color => Math.min(...samples.map(background => contrast(color, background)));
  // Disabled controls retain their native opacity and interaction state. The
  // lower target keeps disabled text visibly distinct from enabled text.
  const target = disabled ? 3 : 4.5;
  const originalContrast = Math.min(...samples.map(background => {
    const visible = background.map((value, index) => value * (1 - source[3]) + source[index] * source[3]);
    return contrast(visible, background);
  }));
  if (originalContrast >= target) return null;
  // Retain warning/success/link color cues when lifting contrast.
  const semantic = disabled ? 'disabled' :
    source[0] > source[1] + 45 && source[0] > source[2] + 35 ? 'danger' :
    source[1] > source[0] + 35 && source[1] > source[2] + 20 ? 'success' :
    kind === 'accent' || source[2] > 125 && source[2] > source[0] + 35 && source[2] > source[1] + 12 ? 'accent' : 'text';
  const palette = {
    text: ['#f5f9ff', '#11243b'],
    accent: ['#d1f3ff', '#163d5a'],
    danger: ['#ffe3e6', '#661d2a'],
    success: ['#ddffdf', '#18502b'],
    disabled: ['#bdcde0', '#465b70']
  };
  const [light, dark] = palette[semantic];
  const lightContrast = minimum(rgb(light)), darkContrast = minimum(rgb(dark));
  let chosen = lightContrast >= darkContrast
    ? { tone: `${semantic}-light`, color: light, contrast: lightContrast }
    : { tone: `${semantic}-dark`, color: dark, contrast: darkContrast };
  // For middle luminances a tinted color can miss 4.5:1 even though pure
  // black or white can pass. Use an extreme only when the semantic tint fails.
  if (chosen.contrast < target) {
    const whiteContrast = minimum([255, 255, 255]), blackContrast = minimum([0, 0, 0]);
    chosen = whiteContrast >= blackContrast
      ? { tone: 'neutral-light', color: '#ffffff', contrast: whiteContrast }
      : { tone: 'neutral-dark', color: '#000000', contrast: blackContrast };
  }
  // A label may span bright flare and dark sky. Evaluate the actual opaque
  // local scrim instead of claiming an unmeasured threshold.
  if (chosen.contrast < target) {
    const scrimmed = samples.map(background => background.map((value, index) => value * .04 + [3, 12, 25][index] * .96));
    const scrimContrast = Math.min(...scrimmed.map(background => contrast(rgb(light), background)));
    return { tone: `${semantic}-scrim`, color: light, contrast: scrimContrast, originalContrast };
  }
  return { ...chosen, originalContrast };
}

export function createAdaptiveContrast(video, shade, root, pick, doc = document, win = window) {
  const tracked = new Map();
  const savedVariables = new Map();
  const attribute = 'data-codex-dynamic-contrast-tone';
  const variableNames = ['--codex-wallpaper-surface', '--codex-wallpaper-panel', '--codex-wallpaper-secondary', '--codex-wallpaper-link'];
  const sampleSize = 72;
  const toneColors = {
    'text-light': '#f5f9ff', 'text-dark': '#11243b',
    'accent-light': '#d1f3ff', 'accent-dark': '#163d5a',
    'danger-light': '#ffe3e6', 'danger-dark': '#661d2a',
    'success-light': '#ddffdf', 'success-dark': '#18502b',
    'disabled-light': '#bdcde0', 'disabled-dark': '#465b70',
    'neutral-light': '#ffffff', 'neutral-dark': '#000000'
  };
  let disposed = false, timer = null, sampleCount = 0, shadeAlpha = .34, lastError = null, brightPalette = false;
  let mode = 'starting';
  const canvas = doc.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  let probeCanvas = null, probeContext = null;
  for (const name of variableNames) savedVariables.set(name, [root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]);
  function parseColor(value) {
    if (typeof value !== 'string' || value === 'transparent') return null;
    if (colorCache.has(value)) return colorCache.get(value);
    const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (hex) {
      const result = [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 1];
      colorCache.set(value, result); return result;
    }
    const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i.exec(value.trim());
    if (match) {
      const result = [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
      colorCache.set(value, result); return result;
    }
    // Chromium may keep modern color functions such as oklch() in computed
    // styles. Normalize those with a separate one-pixel canvas, once per
    // unique color, without touching the sampled video image.
    try {
      if (!probeCanvas) {
        probeCanvas = doc.createElement('canvas'); probeCanvas.width = probeCanvas.height = 1;
        probeContext = probeCanvas.getContext('2d', { willReadFrequently: true });
      }
      if (!probeContext) return null;
      probeContext.clearRect(0, 0, 1, 1);
      probeContext.fillStyle = '#010203';
      probeContext.fillStyle = value;
      if (probeContext.fillStyle === '#010203') return null;
      probeContext.fillRect(0, 0, 1, 1);
      const pixel = probeContext.getImageData(0, 0, 1, 1).data;
      const result = [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
      colorCache.set(value, result); return result;
    } catch { return null; }
  }
  function blend(bottom, top) {
    const opacity = Math.min(1, Math.max(0, top[3]));
    return bottom.map((value, index) => value * (1 - opacity) + top[index] * opacity);
  }
  function luminance(color) {
    const linear = color.map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  }
  function setVariables(panelOpacity) {
    if (!brightPalette && shadeAlpha > .56) brightPalette = true;
    else if (brightPalette && shadeAlpha < .44) brightPalette = false;
    root.style.setProperty('--codex-wallpaper-surface', `rgba(7,14,29,${Math.min(.9, panelOpacity).toFixed(2)})`);
    root.style.setProperty('--codex-wallpaper-panel', `rgba(5,13,28,${Math.min(.84, panelOpacity - .07).toFixed(2)})`);
    root.style.setProperty('--codex-wallpaper-secondary', brightPalette ? '#e6effb' : '#cad9ee');
    root.style.setProperty('--codex-wallpaper-link', brightPalette ? '#e1f7ff' : '#c8efff');
    shade.style.background = `rgba(3,9,20,${shadeAlpha.toFixed(2)})`;
  }
  function fallback(error) {
    lastError = error?.message || String(error);
    mode = 'safe-fallback';
    shadeAlpha = .76;
    setVariables(.92);
    for (const [element] of tracked) element.removeAttribute(attribute);
    tracked.clear();
  }
  function frame() {
    const width = win.innerWidth || video.clientWidth;
    const height = win.innerHeight || video.clientHeight;
    if (!context || !width || !height || !video.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error('Video pixels unavailable for adaptive contrast.');
    canvas.width = sampleSize;
    canvas.height = Math.max(24, Math.min(80, Math.round(sampleSize * height / width)));
    const scale = (video.style.objectFit === 'cover' ? Math.max : Math.min)(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const drawWidth = video.videoWidth * scale, drawHeight = video.videoHeight * scale;
    context.fillStyle = '#050b16';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
    return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height, viewWidth: width, viewHeight: height };
  }
  function at(image, x, y) {
    const sx = Math.max(0, Math.min(image.width - 1, Math.floor(x / image.viewWidth * image.width)));
    const sy = Math.max(0, Math.min(image.height - 1, Math.floor(y / image.viewHeight * image.height)));
    const offset = (sy * image.width + sx) * 4;
    return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
  }
  function points(rect, image) {
    const left = Math.max(0, rect.left), right = Math.min(image.viewWidth, rect.right);
    const top = Math.max(0, rect.top), bottom = Math.min(image.viewHeight, rect.bottom);
    if (right <= left || bottom <= top) return [];
    const x = [left + (right - left) * .2, left + (right - left) * .5, left + (right - left) * .8];
    const y = [top + (bottom - top) * .25, top + (bottom - top) * .5, top + (bottom - top) * .75];
    return [[x[0], y[0]], [x[2], y[0]], [x[1], y[1]], [x[0], y[2]], [x[2], y[2]]];
  }
  function appearance(element, cache) {
    if (!cache.has(element)) cache.set(element, win.getComputedStyle(element));
    return cache.get(element);
  }
  function backgrounds(element, image, coordinates, cache) {
    const chain = [];
    for (let current = element; current && current !== doc.body && current !== root; current = current.parentElement) chain.unshift(current);
    return coordinates.map(([x, y]) => {
      let color = blend(at(image, x, y), [3, 9, 20, shadeAlpha]);
      for (const ancestor of chain) {
        const background = parseColor(appearance(ancestor, cache).backgroundColor);
        if (background) color = blend(color, background);
      }
      return color;
    });
  }
  function classify(element) {
    const semantic = element.closest?.('a[href], [role="link"]');
    const disabled = !!element.closest?.(':disabled, [aria-disabled="true"]');
    return { kind: semantic ? 'accent' : 'text', disabled };
  }
  function apply(element, choice, backdrop, kind, disabled) {
    const record = tracked.get(element) || { tone: null, pending: null, repeats: 0 };
    const desired = choice?.tone || null;
    if (record.tone === desired) { record.pending = null; record.repeats = 0; }
    else {
      record.repeats = record.pending === desired ? record.repeats + 1 : 1;
      record.pending = desired;
      // Severe contrast failures are fixed immediately. Other changes need
      // consecutive samples so brief highlights do not flash the text color.
      // A sudden scene change can make the old corrected color unreadable.
      // Switch immediately in that case; keep hysteresis for ordinary changes.
      const oldColor = toneColors[record.tone];
      const oldFailure = oldColor ? pick(oldColor, backdrop, kind, disabled) : null;
      const oldContrast = oldFailure?.originalContrast ?? Infinity;
      if (record.repeats >= 2 || (!record.tone && choice && choice.originalContrast < 3.2) ||
          (record.tone && oldContrast < (disabled ? 2 : 3.2))) {
        if (desired) element.setAttribute(attribute, desired);
        else element.removeAttribute(attribute);
        record.tone = desired; record.pending = null; record.repeats = 0;
      }
    }
    if (record.tone) element.setAttribute(attribute, record.tone);
    else element.removeAttribute(attribute);
    if (record.tone || record.pending) tracked.set(element, record);
    else tracked.delete(element);
  }
  function sample() {
    if (disposed || doc.hidden) return;
    try {
      // Remove our previous overrides while reading the application's own
      // computed colors. This happens in one task before the browser paints.
      for (const [element] of tracked) {
        if (!element.isConnected) tracked.delete(element);
        else element.removeAttribute(attribute);
      }
      const image = frame();
      const levels = [];
      for (let offset = 0; offset < image.data.length; offset += 4) levels.push(luminance([image.data[offset], image.data[offset + 1], image.data[offset + 2]]));
      levels.sort((a, b) => a - b);
      const high = levels[Math.floor(levels.length * .9)] || 0;
      const target = Math.min(.68, Math.max(.32, .30 + Math.max(0, high - .12) * .52));
      // Darken immediately when a bright scene appears; relax the shade
      // gradually when the scene becomes dark again.
      shadeAlpha = target > shadeAlpha ? target : Math.max(target, shadeAlpha - .09);
      setVariables(Math.min(.9, .56 + shadeAlpha * .43));
      const cache = new Map(), seen = new Set(), decisions = [];
      const candidates = doc.querySelectorAll('#root a, #root button, #root [role="link"], #root [role="button"], #root input, #root textarea, #root [contenteditable="true"], #root span, #root small, #root em, #root strong, #root label, #root p, #root h1, #root h2, #root h3, #root h4, #root h5, #root h6, #root [class*="text-blue"], #root [class*="text-sky"]');
      let examined = 0;
      for (const element of candidates) {
        if (examined >= 600) break;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 48 && rect.height <= 48 && element.querySelector?.('svg')) continue;
        const coordinates = points(rect, image);
        if (!coordinates.length) continue;
        const style = appearance(element, cache);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        examined++; seen.add(element);
        const { kind, disabled } = classify(element);
        const original = parseColor(style.color);
        const foreground = original ? `rgba(${original[0]},${original[1]},${original[2]},${original[3]})` : style.color;
        const backdrop = backgrounds(element, image, coordinates, cache);
        const choice = pick(foreground, backdrop, kind, disabled);
        decisions.push([element, choice, backdrop, kind, disabled]);
      }
      // Keep geometry/style reads together, then make attribute writes. This
      // avoids a layout recalculation after every adjusted label.
      for (const [element, choice, backdrop, kind, disabled] of decisions) apply(element, choice, backdrop, kind, disabled);
      for (const [element] of tracked) if (!seen.has(element)) { element.removeAttribute(attribute); tracked.delete(element); }
      sampleCount++; lastError = null; mode = 'adaptive';
    } catch (error) { fallback(error); }
  }
  function start() {
    if (disposed || timer !== null) return;
    sample();
    timer = win.setInterval(sample, 1800);
  }
  return { start, sample, diagnostics: () => ({ mode, samples: sampleCount, adjustedElements: tracked.size, shadeAlpha, lastError }), dispose() {
    disposed = true;
    if (timer !== null) win.clearInterval(timer);
    for (const [element] of tracked) element.removeAttribute(attribute);
    tracked.clear();
    for (const [name, [value, priority]] of savedVariables) {
      if (value) root.style.setProperty(name, value, priority);
      else root.style.removeProperty(name);
    }
  } };
}
