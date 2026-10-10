// Standalone function: serialized into the Codex renderer and imported by tests.
export function createPlaybackController(video, doc = document, win = window, clock = performance) {
  let disposed = false, repairing = false, recoveryStage = 0;
  let recoveries = 0, reloads = 0, lastError = null, lastRecovery = null, movingSamples = 0;
  let lastTime = video.currentTime, lastFrames = video.getVideoPlaybackQuality().totalVideoFrames;
  let lastClockAt = clock.now(), lastFrameAt = lastClockAt, graceUntil = lastClockAt + 5000;
  let presentedFrames = 0, frameCallback = null, playingPromise = null;
  let loopCount = 0, lastPresentedTime = null;
  const hasFrameCallbacks = typeof video.requestVideoFrameCallback === 'function';
  const presentationCount = () => {
    const quality = video.getVideoPlaybackQuality();
    return hasFrameCallbacks ? presentedFrames : Math.max(0, quality.totalVideoFrames - quality.droppedVideoFrames);
  };
  let lastPresented = presentationCount(), lastPresentedAt = lastClockAt;
  let report = { state: 'checking', advancing: false };
  const history = [];
  const listeners = [];
  const timers = new Map();
  function listen(target, event, handler) { target.addEventListener(event, handler); listeners.push(() => target.removeEventListener(event, handler)); }
  function timeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { timers.delete(timer); reject(new Error(label)); }, ms);
      timers.set(timer, reject);
      Promise.resolve(promise).then(value => { clearTimeout(timer); timers.delete(timer); resolve(value); }, error => { clearTimeout(timer); timers.delete(timer); reject(error); });
    });
  }
  function resetProgress(grace = 4500) {
    lastTime = video.currentTime; lastFrames = video.getVideoPlaybackQuality().totalVideoFrames;
    lastPresented = presentationCount();
    lastClockAt = lastFrameAt = lastPresentedAt = clock.now(); graceUntil = lastClockAt + grace; movingSamples = 0;
  }
  async function play() {
    if (disposed || doc.hidden) return;
    if (playingPromise) return playingPromise.catch(() => {});
    video.playbackRate = 1;
    playingPromise = timeout(video.play(), 3500, 'Wallpaper play() did not resume within 3.5 seconds.');
    try { await playingPromise; if (!disposed) lastError = null; }
    catch (error) { if (!disposed) lastError = error.message; }
    finally { playingPromise = null; }
  }
  function visible() {
    if (disposed) return;
    resetProgress(5000);
    if (doc.hidden) video.pause(); else void play();
  }
  listen(doc, 'visibilitychange', visible);
  listen(win, 'focus', () => { if (!doc.hidden && !disposed) { graceUntil = clock.now() + 2000; void play(); } });
  listen(win, 'pageshow', visible);
  listen(video, 'error', () => { lastError = video.error?.message || `Media error ${video.error?.code || 'unknown'}`; });
  if (hasFrameCallbacks) {
    const track = (_now, metadata) => {
      if (disposed) return;
      presentedFrames = metadata.presentedFrames;
      if (lastPresentedTime !== null && Number.isFinite(video.duration) && video.duration > 0 &&
          lastPresentedTime > video.duration * .65 && metadata.mediaTime < video.duration * .35) loopCount++;
      lastPresentedTime = metadata.mediaTime;
      frameCallback = video.requestVideoFrameCallback(track);
    };
    frameCallback = video.requestVideoFrameCallback(track);
  }
  async function repair(now) {
    if (disposed || repairing || doc.hidden) return;
    while (history.length && now - history[0] > 60000) history.shift();
    if (history.length >= 3) { lastError = 'Playback recovery limited to three attempts per minute.'; return; }
    repairing = true; history.push(now); recoveries++;
    const targetTime = Number.isFinite(video.duration) && video.duration > .5 ? (video.currentTime + .15) % video.duration : 0;
    try {
      video.pause();
      if (recoveryStage === 0 && !video.error && video.readyState >= 1) {
        recoveryStage = 1; lastRecovery = 'seek-and-resume';
        video.currentTime = targetTime;
      } else {
        recoveryStage = 2; reloads++; lastRecovery = 'reload-and-resume';
        video.load();
        // Metadata may already be cached for a complete local Blob.
        if (video.readyState < 1) {
          let removeReady;
          try {
            await timeout(new Promise((resolve, reject) => {
              const ready = () => resolve();
              const failed = () => reject(new Error('Wallpaper reload failed.'));
              removeReady = () => { video.removeEventListener('loadedmetadata', ready); video.removeEventListener('error', failed); };
              video.addEventListener('loadedmetadata', ready); video.addEventListener('error', failed);
            }), 4500, 'Wallpaper reload timed out.');
          } finally { removeReady?.(); }
        }
        if (disposed) return;
        video.currentTime = targetTime;
      }
      if (!disposed && !doc.hidden) await play();
    } catch (error) { if (!disposed) lastError = error.message; }
    finally { repairing = false; if (!disposed) resetProgress(4500); }
  }
  async function check() {
    if (disposed) return { state: 'stopped', advancing: false };
    const now = clock.now();
    const quality = video.getVideoPlaybackQuality();
    const clockStep = Math.abs(video.currentTime - lastTime);
    const frameStep = quality.totalVideoFrames - lastFrames;
    const presented = presentationCount();
    const presentedStep = presented - lastPresented;
    const clockMoved = clockStep > .001;
    const frameMoved = quality.totalVideoFrames !== lastFrames;
    if (clockMoved) lastClockAt = now;
    if (frameMoved) lastFrameAt = now;
    if (presented !== lastPresented) lastPresentedAt = now;
    lastTime = video.currentTime; lastFrames = quality.totalVideoFrames;
    lastPresented = presented;
    const advancing = clockMoved && frameMoved && presentedStep > 0 && !video.paused;
    // A seek may deliver only one frame before freezing again. Confirm two
    // sustained samples before forgetting that a soft recovery was attempted.
    movingSamples = advancing && clockStep > .25 && frameStep >= 3 && presentedStep >= 2 ? movingSamples + 1 : 0;
    if (movingSamples >= 2) { recoveryStage = 0; lastError = null; }
    const staleMs = Math.max(now - lastClockAt, now - lastFrameAt, now - lastPresentedAt);
    let state = doc.hidden ? 'suspended' : advancing ? 'active' : repairing ? 'recovering' : 'buffering';
    if (!doc.hidden && now >= graceUntil && (staleMs > 4500 || video.paused || video.error)) {
      await repair(now);
      state = history.length >= 3 && lastError ? 'stalled' : 'recovering';
    }
    report = { state, width: video.videoWidth, height: video.videoHeight, paused: video.paused,
      advancing: state === 'active', visibility: doc.visibilityState, currentTime: video.currentTime,
      readyState: video.readyState, networkState: video.networkState, decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames,
      presentedFrames: presented, presentationMode: hasFrameCallbacks ? 'video-frame-callback' : 'total-minus-dropped',
      loopCount, droppedFrames: video.getVideoPlaybackQuality().droppedVideoFrames,
      staleMs: Math.round(staleMs), recoveries, reloads, lastRecovery, lastError };
    return report;
  }
  return { check, diagnostics: () => ({ ...report, loopCount, presentedFrames: presentationCount(),
    presentationMode: hasFrameCallbacks ? 'video-frame-callback' : 'total-minus-dropped' }), resetProgress, dispose() {
    disposed = true;
    for (const remove of listeners) remove();
    if (frameCallback !== null) video.cancelVideoFrameCallback?.(frameCallback);
    for (const [timer, reject] of timers) { clearTimeout(timer); reject(new Error('Wallpaper controller stopped.')); }
    timers.clear();
  } };
}
