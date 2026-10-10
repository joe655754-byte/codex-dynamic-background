#!/usr/bin/env node
// Reads only the wallpaper's media diagnostics; never captures or reads chat content.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, integerOption, verifyOwner, isAppPage, connectTo, readEndpoint } from './runtime/cdp.mjs';
import { didPlaybackAdvance } from './runtime/verification.mjs';

const sampleExpression = `(() => {
  const wallpaper = globalThis.__codexDynamicBackground;
  const video = document.getElementById('codex-dynamic-background-video');
  if (!wallpaper || !video || wallpaper.video !== video) return null;
  const quality = video.getVideoPlaybackQuality();
  const diagnostics = wallpaper.diagnostics();
  return { time: video.currentTime, duration: video.duration, width: video.videoWidth, height: video.videoHeight,
    paused: video.paused, visibility: document.visibilityState, frames: quality.totalVideoFrames,
    droppedFrames: quality.droppedVideoFrames, presentedFrames: diagnostics.presentedFrames,
    presentationMode: diagnostics.presentationMode,
    loops: diagnostics.loopCount, recoveries: diagnostics.recoveries || 0,
    mediaError: video.error?.message || video.error?.code || null };
})()`;

async function main() {
  const args = parseOptions(process.argv.slice(2), ['runtime', 'seconds']);
  if (!args.runtime) throw new Error('Usage: node verify_playback.mjs --runtime BUNDLE/.runtime --seconds 65');
  const seconds = integerOption(args, 'seconds', 1, 600, 65);
  const runtime = path.resolve(args.runtime);
  const readJson = async name => JSON.parse((await fs.readFile(path.join(runtime, name), 'utf8')).replace(/^\uFEFF/, ''));
  const state = await readJson('state.json');
  const status = await readJson('status.json');
  if (!state.runId || state.runId !== status.runId || status.state === 'stopped') throw new Error('No matching active wallpaper runtime exists.');
  const owner = { port: state.debugPort, ownerPid: state.codexPid, officialExe: state.executable, profile: state.profile };
  await verifyOwner(owner);
  const version = await readEndpoint(owner.port, 'version');
  const anchor = await connectTo(version.webSocketDebuggerUrl, owner.port);
  let connection;
  try {
    const targets = await readEndpoint(owner.port, 'list');
    for (const target of targets) {
      if (target.type !== 'page' || !isAppPage(target.url) || !target.webSocketDebuggerUrl) continue;
      const candidate = await connectTo(target.webSocketDebuggerUrl, owner.port);
      const present = await candidate.evaluate(sampleExpression);
      if (present) { connection = candidate; break; }
      candidate.close();
    }
    if (!connection) throw new Error('No wallpaper is installed on the Codex main page.');
    const first = await connection.evaluate(sampleExpression);
    if (!Number.isFinite(first.duration) || first.duration <= 0 || first.duration > 30.1) throw new Error('Wallpaper duration is invalid or exceeds 30 seconds.');
    if (seconds < first.duration * 2 + 2) throw new Error(`Use --seconds ${Math.ceil(first.duration * 2 + 2)} or longer to observe two full loops.`);
    const started = performance.now();
    let previous = first, lastMovement = started, lastOwnerCheck = started;
    let samples = 0, movingSamples = 0, maxStillMs = 0, observedRollovers = 0;
    const interval = Math.max(25, Math.min(750, first.duration * 1000 / 5));
    let latest = first;
    while (performance.now() - started < seconds * 1000) {
      await new Promise(resolve => setTimeout(resolve, interval));
      if (anchor.closed || connection.closed) throw new Error('The verified Codex debugger disconnected.');
      if (performance.now() - lastOwnerCheck > 10000) { await verifyOwner(owner); lastOwnerCheck = performance.now(); }
      latest = await connection.evaluate(sampleExpression);
      if (!latest) throw new Error('The wallpaper was removed or the page changed.');
      if (latest.visibility !== 'visible') throw new Error('Keep the wallpaper Codex window visible during verification; hidden windows intentionally pause.');
      if (latest.mediaError) throw new Error(`Video decoder error: ${latest.mediaError}`);
      if (latest.recoveries !== first.recoveries) throw new Error('Playback needed recovery during verification; inspect runtime status and run verification again.');
      if (latest.width <= 0 || latest.height <= 0) throw new Error('The video has no decoded dimensions.');
      const now = performance.now();
      const advanced = didPlaybackAdvance(previous, latest);
      maxStillMs = Math.max(maxStillMs, now - lastMovement);
      if (advanced) { lastMovement = now; movingSamples++; }
      if (now - lastMovement > 4500) throw new Error('The media clock, decoded frames, or actually presented frames stopped advancing for more than 4.5 seconds.');
      if (previous.time > first.duration * .65 && latest.time < first.duration * .35) observedRollovers++;
      previous = latest; samples++;
    }
    const callbackLoops = Math.max(0, (latest.loops || 0) - (first.loops || 0));
    const loops = Math.max(observedRollovers, callbackLoops);
    if (loops < 2 || movingSamples < 2 || latest.frames <= first.frames || latest.presentedFrames <= first.presentedFrames) throw new Error(`Only ${loops} loop transitions with ${movingSamples} progressing samples were observed; increase --seconds and check playback.`);
    return { passed: true, checkedAt: new Date().toISOString(), elapsedSeconds: +((performance.now() - started) / 1000).toFixed(2),
      durationSeconds: first.duration, width: latest.width, height: latest.height, loops, samples, movingSamples,
      decodedFrames: latest.frames - first.frames, presentedFrames: Math.max(0, latest.presentedFrames - first.presentedFrames), presentationMode: latest.presentationMode,
      maxGapBetweenProgressSamplesMs: Math.round(maxStillMs), recoveriesDuringCheck: latest.recoveries - first.recoveries };
  } finally { connection?.close(); anchor.close(); }
}

try { console.log(JSON.stringify(await main(), null, 2)); }
catch (error) { console.log(JSON.stringify({ passed: false, error: error.message }, null, 2)); process.exitCode = 1; }
