import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function parseOptions(argv, allowed) {
  const result = Object.create(null);
  for (let i = 0; i < argv.length; i += 2) {
    const option = argv[i];
    if (!option.startsWith('--') || !allowed.includes(option.slice(2))) throw new Error(`Unknown option: ${option}`);
    const key = option.slice(2);
    if (Object.hasOwn(result, key)) throw new Error(`Duplicate option: ${option}`);
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${option}.`);
    result[key] = argv[i + 1];
  }
  return result;
}

export function integerOption(args, key, minimum, maximum, fallback) {
  const value = args[key] === undefined ? fallback : Number(args[key]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`--${key} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}

export function isAppPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'app:' && url.hostname === '-' && url.pathname === '/index.html' && !url.searchParams.has('initialRoute');
  } catch { return false; }
}

export function assertLoopbackSocket(value, port) {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || Number(url.port) !== port || url.username || url.password) {
    throw new Error('Refusing a debugger socket outside the verified local endpoint.');
  }
}

export async function verifyOwner({ port, ownerPid, officialExe, profile }) {
  if (process.platform !== 'win32') throw new Error('The Codex background runtime requires Windows.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(ownerPid) || ownerPid < 1) throw new Error('Invalid debugger owner or port.');
  if (!officialExe || !profile) throw new Error('The expected official executable and profile are required.');
  const quote = value => String(value).replaceAll("'", "''");
  const command = `$ErrorActionPreference='Stop';
    $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${ownerPid}';
    $listeners=@(Get-NetTCPConnection -LocalPort ${port} -State Listen);
    if (!$p -or !$listeners.Count -or ![string]::Equals($p.ExecutablePath,'${quote(officialExe)}',[StringComparison]::OrdinalIgnoreCase)){exit 9};
    foreach ($l in $listeners) {if ($l.LocalAddress -ne '127.0.0.1' -or $l.OwningProcess -ne ${ownerPid}) {exit 9}};
    $m=[regex]::Match($p.CommandLine,'(?:^|\\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\\s"]+))');
    if (!$m.Success) {exit 9};
    $actual=if ($m.Groups[1].Success) {$m.Groups[1].Value} elseif ($m.Groups[2].Success) {$m.Groups[2].Value} else {$m.Groups[3].Value};
    if (![string]::Equals([IO.Path]::GetFullPath($actual),'${quote(profile)}',[StringComparison]::OrdinalIgnoreCase)){exit 9};
    'verified'`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15000 });
  if (stdout.trim() !== 'verified') throw new Error('The Codex debugger ownership check failed.');
}

export class Connection {
  constructor(ws) {
    this.ws = ws; this.nextId = 0; this.pending = new Map(); this.closed = false;
    ws.addEventListener('message', async event => {
      try {
        let text = event.data;
        if (typeof text !== 'string') text = await text.text();
        const message = JSON.parse(text);
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
      } catch { this.close(); }
    });
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Debugger connection closed.')); }
      this.pending.clear();
    });
    ws.addEventListener('error', () => this.close());
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('Connection already closed.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout.`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Wallpaper script failed.');
    return result.result?.value;
  }

  close() { this.ws.close(); }
}

export async function connectTo(url, port) {
  assertLoopbackSocket(url, port);
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('Debugger connection timeout.')); }, 8000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Debugger connection failed.')); }, { once: true });
  });
  return new Connection(ws);
}

export async function readEndpoint(port, endpoint) {
  const response = await fetch(`http://127.0.0.1:${port}/json/${endpoint}`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new Error(`Debugger endpoint returned HTTP ${response.status}.`);
  return response.json();
}
