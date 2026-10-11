// Standalone function: serialized into the Codex renderer and imported by tests.
export function createPlaybackController(video, doc = document, win = window, clock = performance, fallback = null) {
  let disposed = false, repairing = false, recoveryStage = 0;
  let recoveries = 0, reloads = 0, lastError = null, lastRecovery = null, movingSamples = 0;
  let lastResumeAttemptAt = -Infinity, resumeFailures = 0;
  let nextDestructiveAt = 0, hardAttempts = 0, fallbackShown = false;
  const oldVideoVisibility = video.style?.visibility || '';
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
  function capturePoster() {
    if (!fallback || !doc.createElement || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
    try {
      const canvas = doc.createElement('canvas');
      canvas.width = Math.min(1280, video.videoWidth);
      canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      fallback.src = canvas.toDataURL('image/jpeg', .82);
      return true;
    } catch { return false; }
  }
  function showFallback() {
    // Reuse the already decoded image. Replacing img.src immediately before
    // hiding the video could expose a blank frame while the new JPEG decodes.
    if (!fallback?.src) capturePoster();
    if (!fallback?.src) return;
    fallback.style.visibility = 'visible';
    video.style.visibility = 'hidden';
    fallbackShown = true;
  }
  function hideFallback() {
    if (!fallbackShown) return;
    video.style.visibility = oldVideoVisibility;
    fallback.style.visibility = 'hidden';
    fallbackShown = false;
  }
  async function waitForCurrentFrame(ms, label) {
    if (video.readyState >= 2 && video.videoWidth > 0 && !video.seeking) return;
    let detach;
    try {
      await timeout(new Promise((resolve, reject) => {
        const ready = () => { if (video.readyState >= 2 && video.videoWidth > 0 && !video.seeking) resolve(); };
        const failed = () => reject(new Error('Wallpaper video decoding failed.'));
        const events = ['loadeddata', 'canplay', 'seeked'];
        for (const event of events) video.addEventListener(event, ready);
        video.addEventListener('error', failed);
        detach = () => {
          for (const event of events) video.removeEventListener(event, ready);
          video.removeEventListener('error', failed);
        };
        ready();
      }), ms, label);
    } finally { detach?.(); }
  }
  async function play() {
    if (disposed || doc.hidden) return;
    if (playingPromise) return playingPromise.catch(() => {});
    video.playbackRate = 1;
    playingPromise = timeout(video.play(), 3500, 'Wallpaper play() did not resume within 3.5 seconds.');
    try { await playingPromise; if (!disposed && !video.paused && video.readyState >= 2) lastError = null; }
    catch (error) { if (!disposed) lastError = error.message; }
    finally { playingPromise = null; }
  }
  function visible() {
    if (disposed) return;
    resetProgress(5000);
    if (doc.hidden) video.pause();
    else void play().then(() => { if (video.readyState >= 2 && !video.paused) hideFallback(); });
  }
  listen(doc, 'visibilitychange', visible);
  listen(win, 'focus', () => { if (!doc.hidden && !disposed) { graceUntil = clock.now() + 2000; void play().then(() => { if (video.readyState >= 2 && !video.paused) hideFallback(); }); } });
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
    // A short window/decoder stall can leave an otherwise healthy element
    // paused. Resume it without clearing the last visible frame or consuming
    // one of the limited seek/reload attempts.
    if (video.paused && !video.error && resumeFailures < 2) {
      if (now - lastResumeAttemptAt < 4000) return;
      lastResumeAttemptAt = now; repairing = true; lastRecovery = 'resume-only';
      try {
        await play();
        if (!disposed && !video.paused && video.readyState >= 2) {
          resumeFailures = 0; hideFallback(); resetProgress(4500);
        } else if (!disposed) resumeFailures++;
      } finally { repairing = false; }
      return;
    }
    // Retry a failed hard reload with bounded backoff while the saved frame
    // remains visible. A permanent three-attempt cap can strand a black video.
    if (now < nextDestructiveAt) return;
    repairing = true; recoveries++;
    const targetTime = Number.isFinite(video.duration) && video.duration > .5 ? (video.currentTime + .15) % video.duration : 0;
    try {
      if (recoveryStage === 0 && !video.error && video.readyState >= 2 && !video.paused) {
        recoveryStage = 1; lastRecovery = 'seek-and-resume';
        // Seeking during playback keeps the current frame visible. A failed
        // play() request after pause must not strand the wallpaper black.
        video.currentTime = targetTime;
        nextDestructiveAt = now + 3000;
      } else {
        recoveryStage = 2; reloads++; lastRecovery = 'reload-and-resume';
        hardAttempts++;
        nextDestructiveAt = now + Math.min(20000, 6000 * 2 ** (hardAttempts - 1));
        showFallback();
        video.pause();
        video.load();
        // HAVE_METADATA (1) is not a drawable image. A seek can invalidate
        // that frame, so wait for decoded data before and after seeking.
        await waitForCurrentFrame(4500, 'Wallpaper reload did not decode a frame.');
        if (disposed) return;
        video.currentTime = targetTime;
        await waitForCurrentFrame(3000, 'Wallpaper seek did not decode a frame.');
      }
      if (!disposed && !doc.hidden && video.paused) await play();
      if (!disposed && !video.paused && video.readyState >= 2) {
        resumeFailures = 0; hideFallback();
      }
    } catch (error) {
      if (!disposed) {
        lastError = error.message;
        if (lastRecovery === 'seek-and-resume') recoveryStage = 0;
        if (!doc.hidden && video.paused && !video.error) await play();
        if (!video.paused && video.readyState >= 2) hideFallback();
      }
    }
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
    if (movingSamples >= 2) {
      recoveryStage = 0; resumeFailures = 0; hardAttempts = 0;
      nextDestructiveAt = 0; lastError = null;
    }
    if (fallbackShown && video.readyState >= 2 && !video.paused) hideFallback();
    const staleMs = Math.max(now - lastClockAt, now - lastFrameAt, now - lastPresentedAt);
    let state = doc.hidden ? 'suspended' : advancing ? 'active' : repairing ? 'recovering' : 'buffering';
    if (!doc.hidden && now >= graceUntil && (staleMs > 4500 || video.paused || video.error)) {
      await repair(now);
      state = 'recovering';
    }
    report = { state, width: video.videoWidth, height: video.videoHeight, paused: video.paused,
      advancing: state === 'active', visibility: doc.visibilityState, currentTime: video.currentTime,
      readyState: video.readyState, networkState: video.networkState, decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames,
      presentedFrames: presented, presentationMode: hasFrameCallbacks ? 'video-frame-callback' : 'total-minus-dropped',
      loopCount, droppedFrames: video.getVideoPlaybackQuality().droppedVideoFrames,
      staleMs: Math.round(staleMs), recoveries, reloads, lastRecovery, lastError,
      fallbackShown, retryAfterMs: Math.max(0, Math.round(nextDestructiveAt - now)) };
    return report;
  }
  return { check, diagnostics: () => ({ ...report, loopCount, presentedFrames: presentationCount(),
    presentationMode: hasFrameCallbacks ? 'video-frame-callback' : 'total-minus-dropped' }), resetProgress, capturePoster, dispose() {
    disposed = true;
    for (const remove of listeners) remove();
    if (frameCallback !== null) video.cancelVideoFrameCallback?.(frameCallback);
    for (const [timer, reject] of timers) { clearTimeout(timer); reject(new Error('Wallpaper controller stopped.')); }
    timers.clear();
    if (fallbackShown) hideFallback();
  } };
}
