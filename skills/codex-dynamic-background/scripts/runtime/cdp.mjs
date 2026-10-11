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

export function parseListeningSockets(output, port) {
  const listeners = [];
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length !== 5 || columns[0] !== 'TCP' || columns[3] !== 'LISTENING') continue;
    const delimiter = columns[1].lastIndexOf(':');
    if (delimiter < 0 || Number(columns[1].slice(delimiter + 1)) !== port) continue;
    listeners.push({ address: columns[1], pid: Number(columns[4]) });
  }
  return listeners;
}

export class OwnershipLostError extends Error {
  constructor(message) { super(message); this.name = 'OwnershipLostError'; }
}

export function ownerCheckAction(error) {
  return error instanceof OwnershipLostError ? 'stop' : 'retry';
}

export function assertOwnedLoopbackListeners(listeners, port, ownerPid) {
  if (listeners.some(listener => listener.address !== `127.0.0.1:${port}` || listener.pid !== ownerPid))
    throw new OwnershipLostError('The Codex debugger is no longer exclusively owned by the verified IPv4 loopback listener.');
}

export async function verifyOwner({ port, ownerPid, officialExe, profile }) {
  if (process.platform !== 'win32') throw new Error('The Codex background runtime requires Windows.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(ownerPid) || ownerPid < 1) throw new Error('Invalid debugger owner or port.');
  if (!officialExe || !profile) throw new Error('The expected official executable and profile are required.');
  // netstat avoids Get-NetTCPConnection's long CIM stall on a busy Windows PC.
  // Include every listener for this port so wildcard or IPv6 exposure fails.
  const { stdout: sockets } = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], { windowsHide: true, timeout: 10000 });
  const listeners = parseListeningSockets(sockets, port);
  if (!listeners.length) {
    // An absent socket can be a short debugger restart. A missing or replaced
    // process is a definitive ownership loss and should stop the helper.
    const escapedExe = String(officialExe).replaceAll("'", "''");
    const processCheck = `$p=Get-Process -Id ${ownerPid} -ErrorAction SilentlyContinue; if (!$p -or ![string]::Equals($p.Path,'${escapedExe}',[StringComparison]::OrdinalIgnoreCase)){exit 9}; 'alive'`;
    try { await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', processCheck], { windowsHide: true, timeout: 10000 }); }
    catch (error) {
      if (Number(error.code) === 9) throw new OwnershipLostError('The verified Codex process has exited or changed.');
      throw error;
    }
    throw new Error('The local debugger listener is temporarily unavailable.');
  }
  assertOwnedLoopbackListeners(listeners, port, ownerPid);
  const quote = value => String(value).replaceAll("'", "''");
  const command = `$ErrorActionPreference='Stop';
    $p=Get-Process -Id ${ownerPid} -ErrorAction SilentlyContinue;
    if (!$p -or ![string]::Equals($p.Path,'${quote(officialExe)}',[StringComparison]::OrdinalIgnoreCase)){exit 9};
    $metadata=Get-CimInstance Win32_Process -Filter 'ProcessId = ${ownerPid}';
    if (!$metadata -or !$metadata.CommandLine){exit 9};
    $m=[regex]::Match($metadata.CommandLine,'(?:^|\\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\\s"]+))');
    if (!$m.Success) {exit 9};
    $actual=if ($m.Groups[1].Success) {$m.Groups[1].Value} elseif ($m.Groups[2].Success) {$m.Groups[2].Value} else {$m.Groups[3].Value};
    if (![string]::Equals([IO.Path]::GetFullPath($actual),'${quote(profile)}',[StringComparison]::OrdinalIgnoreCase)){exit 9};
    'verified'`;
  let stdout;
  try {
    ({ stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 30000 }));
  } catch (error) {
    if (Number(error.code) === 9) throw new OwnershipLostError('The debugger PID, official executable, or profile no longer matches.');
    throw error;
  }
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
