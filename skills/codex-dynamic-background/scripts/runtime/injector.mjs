import fs from 'node:fs/promises';
import path from 'node:path';
import { parseOptions, integerOption, connectTo, isAppPage, verifyOwner, ownerCheckAction } from './cdp.mjs';
import { createPlaybackController } from './playback-controller.mjs';
import { createAdaptiveContrast, pickReadableForeground } from './adaptive-contrast.mjs';
import { stylesheet, installWallpaper } from './renderer.mjs';

const args = parseOptions(process.argv.slice(2), ['port', 'owner-pid', 'official-exe', 'video', 'runtime', 'profile', 'run-id', 'fit']);
const port = integerOption(args, 'port', 1024, 65535);
const ownerPid = integerOption(args, 'owner-pid', 1, 2147483647);
for (const required of ['official-exe', 'video', 'runtime', 'profile', 'run-id']) {
  if (!args[required]) throw new Error(`Missing --${required}.`);
}
const officialExe = path.resolve(args['official-exe']);
const videoPath = path.resolve(args.video);
const runtime = path.resolve(args.runtime);
const profile = path.resolve(args.profile);
const runId = args['run-id'];
const fit = args.fit || 'contain';
if (!['contain', 'cover'].includes(fit)) throw new Error('--fit must be contain or cover.');
if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error('Invalid runtime run ID.');
const base = `http://127.0.0.1:${port}`;
const stopFile = path.join(runtime, 'stop.request');
const statusFile = path.join(runtime, 'status.json');
const sessions = new Map();
let stopping = false;
let lastOwnerCheck = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = message => console.log(`${new Date().toISOString()} ${message}`);
const connect = url => connectTo(url, port);
async function status(state, details = {}) {
  const value = { state, time: new Date().toISOString(), runId, injectorPid: process.pid, ...details };
  const temporary = `${statusFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2));
  await fs.rename(temporary, statusFile);
}

const videoStat = await fs.stat(videoPath);
if (!videoStat.isFile() || videoStat.size === 0 || videoStat.size > 300 * 1024 * 1024) throw new Error('The video must be a regular file between 1 byte and 300 MB.');
const binary = await fs.readFile(videoPath);
if (binary.length === 0 || binary.length > 300 * 1024 * 1024) throw new Error('The video must be nonempty and smaller than 300 MB.');
const chunks = [];
for (let offset = 0; offset < binary.length; offset += 192 * 1024) chunks.push(binary.subarray(offset, offset + 192 * 1024).toString('base64'));
async function inject(connection) {
  await connection.evaluate('globalThis.__codexDynamicBackgroundTransfer = []');
  for (const chunk of chunks) await connection.evaluate(`globalThis.__codexDynamicBackgroundTransfer.push(${JSON.stringify(chunk)})`);
  const installed = await connection.evaluate(`(async () => { try { return await (${installWallpaper.toString()})(globalThis.__codexDynamicBackgroundTransfer, ${JSON.stringify(stylesheet)}, (${createPlaybackController.toString()}), ${JSON.stringify(fit)}, (video, shade, root) => (${createAdaptiveContrast.toString()})(video, shade, root, (${pickReadableForeground.toString()}))); } finally { delete globalThis.__codexDynamicBackgroundTransfer; } })()`);
  if (!installed?.installed) throw new Error('The target is no longer the Codex main page.');
  log(`Wallpaper installed (${installed.width || 0} x ${installed.height || 0}; paused=${installed.paused}).`);
  await status('active', { width: installed.width, height: installed.height, paused: installed.paused, advancing: installed.advancing, visibility: installed.visibility, decodedFrames: installed.decodedFrames, presentedFrames: installed.presentedFrames });

}
async function cleanup() {
  for (const connection of sessions.values()) {
    try { await connection.evaluate('globalThis.__codexDynamicBackground?.cleanup?.(); delete globalThis.__codexDynamicBackgroundTransfer; true'); } catch { }
    connection.close();
  }
  sessions.clear(); await status('stopped'); log('Wallpaper helper stopped; injected content removed from reachable app pages.');
}
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
await fs.mkdir(runtime, { recursive: true });
async function openBrowserAnchor() {
  const response = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new Error(`Browser debugger returned HTTP ${response.status}.`);
  const version = await response.json();
  return connect(version.webSocketDebuggerUrl);
}
async function verifyCurrentOwner() {
  await verifyOwner({ port, ownerPid, officialExe, profile });
  lastOwnerCheck = Date.now();
}
await status('verifying');
let browserAnchor = null, endpointFailures = 0;
try {
  while (!stopping) {
    if (await fs.access(stopFile).then(() => true, () => false)) break;
    if (!browserAnchor || browserAnchor.closed || Date.now() - lastOwnerCheck > 30000) {
      try { await verifyCurrentOwner(); }
      catch (error) {
        if (ownerCheckAction(error) === 'stop') { log(`The verified Codex owner was lost: ${error.message}`); break; }
        await status('reconnecting', { reason: `Temporarily unable to verify Codex: ${error.message}` });
        await sleep(1500); continue;
      }
    }
    if (!browserAnchor || browserAnchor.closed) {
      try {
        browserAnchor = await openBrowserAnchor();
        endpointFailures = 0;
        await status('waiting');
        log('Connected to the verified official Codex browser debugger.');
      } catch (error) {
        await status('reconnecting', { reason: `Waiting for the verified browser debugger: ${error.message}` });
        await sleep(1500); continue;
      }
    }
    let targets;
    try {
      const response = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      targets = await response.json(); endpointFailures = 0;
    } catch (error) {
      endpointFailures++;
      if (endpointFailures % 3 === 0) {
        try { await verifyCurrentOwner(); }
        catch (ownerError) {
          if (ownerCheckAction(ownerError) === 'stop') { log(`The verified Codex owner was lost: ${ownerError.message}`); break; }
        }
      }
      await status('reconnecting', { reason: `Debugger page list temporarily unavailable: ${error.message}` });
      await sleep(Math.min(5000, 1000 * endpointFailures)); continue;
    }
    const current = new Set();
    for (const target of targets) {
      if (target.type !== 'page' || !isAppPage(target.url) || !target.webSocketDebuggerUrl) continue;
      current.add(target.id);
      if (browserAnchor.closed) break;
      let connection = sessions.get(target.id);
      try {
        if (!connection || connection.closed) {
          connection = await connect(target.webSocketDebuggerUrl); sessions.set(target.id, connection);
        }
        const state = await connection.evaluate('({ready:!!document.body,url:location.href,visibility:document.visibilityState,installed:!!globalThis.__codexDynamicBackground,version:globalThis.__codexDynamicBackground?.version,video:!!document.getElementById("codex-dynamic-background-video")})');
        if (state?.ready && isAppPage(state.url)) {
          if (!state.installed || !state.video || state.version !== 4) {
            if (state.visibility === 'visible') await inject(connection);
            else await status('suspended', { visibility: state.visibility, advancing: false });
          }
          else {
            const health = await connection.evaluate('globalThis.__codexDynamicBackground.health()');
            if (health) {
              const { state: playbackState, ...details } = health;
              await status(playbackState, details);
              if ((health.recoveries || 0) > (connection.reportedRecoveries || 0)) log(`Playback recovery: ${health.lastRecovery}; attempts=${health.recoveries}; error=${health.lastError || 'none'}.`);
              connection.reportedRecoveries = health.recoveries || 0;
            }
          }
        }
      } catch (error) {
        await status('waiting', { reason: error.message });
        log(`App page temporarily unavailable: ${error.message}`); connection?.close(); sessions.delete(target.id);
      }
    }
    for (const [id, connection] of sessions) if (!current.has(id)) { connection.close(); sessions.delete(id); }
    await sleep(1500);
  }
} finally { await cleanup(); browserAnchor?.close(); }
