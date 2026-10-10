// These variable names are present in the tested Codex 26.924 build's app-shared and app-initial CSS.
export const stylesheet = `
html[data-codex-dynamic-background="on"] {
  color-scheme: dark !important;
  --codex-wallpaper-surface: rgba(7,14,29,.72);
  --codex-wallpaper-panel: rgba(5,13,28,.65);
  --codex-wallpaper-secondary: #cad9ee;
  --codex-wallpaper-link: #c8efff;
  --color-surface: transparent !important;
  --color-surface-secondary: var(--codex-wallpaper-surface) !important;
  --color-surface-tertiary: rgba(10,20,38,.64) !important;
  --color-surface-elevated: rgba(13,24,43,.96) !important;
  --color-surface-elevated-secondary: rgba(15,29,49,.97) !important;
  --app-color-background-surface: transparent !important;
  --app-color-background-surface-under: transparent !important;
  --app-color-background-elevated-primary: rgba(10,20,37,.65) !important;
  --app-color-background-elevated-primary-opaque: #0d182b !important;
  --app-color-background-elevated-secondary: rgba(13,25,44,.82) !important;
  --app-color-background-elevated-secondary-opaque: #101e33 !important;
  --app-color-background-editor-opaque: #0b1627 !important;
  --app-color-background-card: rgba(13,25,44,.76) !important;
  --app-shell-panel-background: var(--codex-wallpaper-panel) !important;
  --app-shell-tab-background: rgba(7,17,32,.60) !important;
  --composer-layout-surface-background: rgba(9,20,37,.84) !important;
  --composer-layout-surface-backdrop-filter: blur(14px) !important;
  --color-background-composer-primary: rgba(9,20,37,.84) !important;
  --color-background-user-message: rgba(28,47,77,.72) !important;
  --color-background-panel: rgba(7,17,31,.55) !important;
  --color-background-control-opaque: #172740 !important;
  --color-text-primary-solid: #eef4ff !important;
  --color-text-secondary: var(--codex-wallpaper-secondary) !important;
  --color-token-text-primary: #eef4ff !important;
  --color-token-text-secondary: var(--codex-wallpaper-secondary) !important;
  --app-color-text-foreground: #eef4ff !important;
  --app-color-text-foreground-secondary: var(--codex-wallpaper-secondary) !important;
  --app-color-text-foreground-tertiary: #c1d1e6 !important;
  --text-primary: #eef4ff !important;
  --text-secondary: var(--codex-wallpaper-secondary) !important;
  --app-color-text-accent: var(--codex-wallpaper-link) !important;
  --color-token-text-link-foreground: var(--codex-wallpaper-link) !important;
  --color-text-accent: var(--codex-wallpaper-link) !important;
  --color-text-info: var(--codex-wallpaper-link) !important;
  --app-color-background-button-primary: #dceeff !important;
  --app-color-text-button-primary: #10243b !important;
  --app-color-text-button-secondary: #f5f9ff !important;
  --app-color-text-button-tertiary: var(--codex-wallpaper-link) !important;
  --color-border: rgba(166,197,238,.19) !important;
  --color-border-subtle: rgba(166,197,238,.12) !important;
  --color-border-strong: rgba(166,197,238,.32) !important;
  --border-default: rgba(166,197,238,.19) !important;
  --border-heavy: rgba(166,197,238,.32) !important;
  --app-color-border: rgba(166,197,238,.19) !important;
  --app-color-border-light: rgba(166,197,238,.12) !important;
  --chat-background-color: transparent !important;
  --main-surface-secondary: rgba(12,23,40,.70) !important;
  --codeblock-background-color: rgba(6,15,29,.85) !important;
  background: #050b16 !important;
}
html[data-codex-dynamic-background="on"] body { background: transparent !important; color: #eef4ff !important; isolation: isolate; }
html[data-codex-dynamic-background="on"] #root { position: relative; z-index: 1; background: transparent !important; }
#codex-dynamic-background-video { position: fixed; inset: 0; width: 100vw; height: 100vh; object-fit: contain; object-position: center; z-index: 0; pointer-events: none; user-select: none; }
#codex-dynamic-background-shade { position: fixed; inset: 0; z-index: 0; pointer-events: none; background: rgba(3,9,20,.34); }
html[data-codex-dynamic-background="on"] [data-theme] {
  --app-color-text-accent: var(--codex-wallpaper-link) !important;
  --color-token-text-link-foreground: var(--codex-wallpaper-link) !important;
  --color-text-accent: var(--codex-wallpaper-link) !important;
  --color-text-info: var(--codex-wallpaper-link) !important;
  --app-color-background-button-primary: #dceeff !important;
  --app-color-text-button-primary: #10243b !important;
  --app-color-text-button-secondary: #f5f9ff !important;
  --app-color-text-button-tertiary: var(--codex-wallpaper-link) !important;
}
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone$="-light"] { color: #f5f9ff !important; text-shadow: 0 1px 2px rgba(1,5,12,.9); }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone$="-dark"] { color: #11243b !important; text-shadow: 0 1px 2px rgba(245,250,255,.85); }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone$="-scrim"] { color: #f5f9ff !important; background: rgba(3,12,25,.96) !important; border-radius: .2em; box-decoration-break: clone; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="accent-light"] { color: #d1f3ff !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="accent-dark"] { color: #163d5a !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="danger-light"] { color: #ffe3e6 !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="danger-dark"] { color: #661d2a !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="success-light"] { color: #ddffdf !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="success-dark"] { color: #18502b !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="disabled-light"] { color: #bdcde0 !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="disabled-dark"] { color: #465b70 !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="neutral-light"] { color: #ffffff !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="neutral-dark"] { color: #000000 !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="accent-scrim"] { color: #d1f3ff !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="danger-scrim"] { color: #ffe3e6 !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="success-scrim"] { color: #ddffdf !important; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone="disabled-scrim"] { color: #bdcde0 !important; }
html[data-codex-dynamic-background="on"] #root input::placeholder,
html[data-codex-dynamic-background="on"] #root textarea::placeholder { color: var(--codex-wallpaper-secondary) !important; opacity: .9; }
html[data-codex-dynamic-background="on"] #root [data-codex-dynamic-contrast-tone$="-dark"]::placeholder { color: #304969 !important; }
html[data-codex-dynamic-background="on"] [role="dialog"],
html[data-codex-dynamic-background="on"] [role="menu"],
html[data-codex-dynamic-background="on"] [role="listbox"] { background-color: rgba(12,23,41,.98) !important; }
html[data-codex-dynamic-background="on"] textarea,
html[data-codex-dynamic-background="on"] [contenteditable="true"] { caret-color: #c9e0ff; }
`;


export async function installWallpaper(chunks, css, createController, fit = 'contain', createContrast) {
  if (location.protocol !== 'app:' || location.hostname !== '-' || location.pathname !== '/index.html' || new URL(location.href).searchParams.has('initialRoute')) return { skipped: true };
  globalThis.__codexDynamicBackground?.cleanup?.();
  const root = document.documentElement;
  const oldAttribute = root.getAttribute('data-codex-dynamic-background');
  const hadDark = root.classList.contains('dark');
  const hadLight = root.classList.contains('light');
  const bytes = chunks.map(chunk => Uint8Array.from(atob(chunk), c => c.charCodeAt(0)));
  const source = URL.createObjectURL(new Blob(bytes, { type: 'video/mp4' }));
  const style = document.createElement('style'); style.id = 'codex-dynamic-background-style'; style.textContent = css;
  const video = document.createElement('video');
  video.id = 'codex-dynamic-background-video'; video.setAttribute('aria-hidden', 'true');
  video.style.objectFit = fit === 'cover' ? 'cover' : 'contain';
  video.muted = true; video.defaultMuted = true; video.loop = true; video.autoplay = true; video.playsInline = true;
  video.preload = 'auto';
  video.disablePictureInPicture = true; video.setAttribute('muted', ''); video.src = source;
  const shade = document.createElement('div'); shade.id = 'codex-dynamic-background-shade'; shade.setAttribute('aria-hidden', 'true');
  root.setAttribute('data-codex-dynamic-background', 'on'); root.classList.add('dark'); root.classList.remove('light');
  document.head.append(style); document.body.prepend(video, shade);
  const controller = createController(video);
  let contrast;
  try { contrast = createContrast?.(video, shade, root); }
  catch { shade.style.background = 'rgba(3,9,20,.76)'; }
  const state = { version: 3, video, source, health: async () => ({ ...await controller.check(), contrast: contrast?.diagnostics() }), diagnostics: controller.diagnostics, contrast: () => contrast?.diagnostics(), cleanup() {
    contrast?.dispose();
    controller.dispose();
    video.pause(); video.removeAttribute('src'); video.load(); video.remove(); shade.remove(); style.remove(); URL.revokeObjectURL(source);
    if (oldAttribute === null) root.removeAttribute('data-codex-dynamic-background'); else root.setAttribute('data-codex-dynamic-background', oldAttribute);
    root.classList.toggle('dark', hadDark); root.classList.toggle('light', hadLight);
    delete globalThis.__codexDynamicBackground;
  } };
  globalThis.__codexDynamicBackground = state;
  try {
    video.load();
    const mediaReady = new Promise((resolve, reject) => {
      if (video.readyState >= 2 && video.videoWidth > 0) { resolve(); return; }
      const timeout = setTimeout(() => finish(new Error(`Video readiness timeout: readyState=${video.readyState}, networkState=${video.networkState}, visibility=${document.visibilityState}, mp4=${video.canPlayType('video/mp4; codecs="avc1.42E01E"') || 'unsupported'}, mediaError=${video.error?.message || video.error?.code || 'none'}.`)), 8000);
      const ready = () => finish();
      const failed = () => finish(new Error(`Video decoding failed: ${video.error?.message || video.error?.code || 'unknown media error'}`));
      function finish(error) {
        clearTimeout(timeout); video.removeEventListener('loadeddata', ready); video.removeEventListener('error', failed);
        error ? reject(error) : resolve();
      }
      video.addEventListener('loadeddata', ready); video.addEventListener('error', failed);
    });
    await Promise.all([mediaReady, video.play()]);
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 30.1) throw new Error('The prepared wallpaper must be at most 30 seconds.');
    const startTime = video.currentTime;
    const startPresented = controller.diagnostics().presentedFrames;
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 3000;
      const tick = () => {
        if (!video.paused && video.videoWidth > 0 && video.currentTime !== startTime && controller.diagnostics().presentedFrames > startPresented) { resolve(); return; }
        if (video.error) { reject(new Error(`Video playback failed: ${video.error.message || video.error.code}`)); return; }
        if (performance.now() > deadline) { reject(new Error('The video loaded but its clock and actually presented frames did not advance.')); return; }
        setTimeout(tick, 100);
      }; tick();
    });
    controller.resetProgress();
    contrast?.start();
    return { installed: true, width: video.videoWidth, height: video.videoHeight, paused: video.paused, advancing: true, visibility: document.visibilityState, decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames, presentedFrames: controller.diagnostics().presentedFrames };
  } catch (error) { state.cleanup(); throw error; }
}
