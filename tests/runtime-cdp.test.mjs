import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseOptions, integerOption, isAppPage, assertLoopbackSocket } from '../skills/codex-dynamic-background/scripts/runtime/cdp.mjs';

const args = parseOptions(['--runtime', 'C:\\视频 背景\\result', '--seconds', '65'], ['runtime', 'seconds']);
assert.equal(args.runtime, 'C:\\视频 背景\\result');
assert.equal(integerOption(args, 'seconds', 1, 600), 65);
assert.equal(integerOption({}, 'seconds', 1, 600, 65), 65);
for (const argv of [['--unknown', '1'], ['--seconds'], ['--seconds', '--runtime'], ['--seconds', '1', '--seconds', '2']]) {
  assert.throws(() => parseOptions(argv, ['seconds', 'runtime']));
}
for (const value of ['NaN', '0', '-1', '601', '1.5', '']) assert.throws(() => integerOption({ seconds: value }, 'seconds', 1, 600));

assert.equal(isAppPage('app://-/index.html'), true);
assert.equal(isAppPage('app://-/index.html?theme=dark'), true);
for (const url of ['https://example.com/index.html', 'app://other/index.html', 'app://-/index.html?initialRoute=avatar-overlay', 'app://-/index.html?initialRoute=', 'app://-/settings.html', 'invalid']) {
  assert.equal(isAppPage(url), false, url);
}
assert.doesNotThrow(() => assertLoopbackSocket('ws://127.0.0.1:9335/devtools/browser/verified', 9335));
assert.doesNotThrow(() => assertLoopbackSocket('ws://localhost:9335/devtools/page/verified', 9335));
for (const url of ['ws://example.com:9335/x', 'ws://127.0.0.1:9336/x', 'wss://127.0.0.1:9335/x', 'ws://0.0.0.0:9335/x', 'ws://user:password@127.0.0.1:9335/x']) {
  assert.throws(() => assertLoopbackSocket(url, 9335));
}
console.log('Runtime CLI validation, main-page filtering, and loopback endpoint tests passed.');

if (process.platform === 'win32') {
  const launcher = fileURLToPath(new URL('../skills/codex-dynamic-background/scripts/start_background.ps1', import.meta.url)).replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';
    $tokens=$null; $parseErrors=$null;
    $ast=[Management.Automation.Language.Parser]::ParseFile('${launcher}',[ref]$tokens,[ref]$parseErrors);
    if ($parseErrors.Count) {throw ($parseErrors | Out-String)};
    foreach ($function in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
      if ($function.Name -in @('Quote-NativeArgument','Get-ProfileArgument')) {Invoke-Expression $function.Extent.Text}
    };
    $expected='C:\\资料 夜空\\.profile';
    foreach ($command in @('app.exe "--user-data-dir='+$expected+'"', 'app.exe --user-data-dir="'+$expected+'"')) {
      if ((Get-ProfileArgument $command) -cne $expected) {throw 'Quoted profile parsing failed.'}
    };
    if ((Get-ProfileArgument 'app.exe --user-data-dir=C:\\plain\\.profile') -cne 'C:\\plain\\.profile') {throw 'Unquoted profile parsing failed.'};
    $samples=@('C:\\资料 夜空\\.profile','--user-data-dir=C:\\资料 夜空\\.profile','C:\\trailing space\\','quotes"inside');
    $stdout=Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName());
    $stderr=Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName());
    try {
      $arguments=@('-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))','--')+$samples;
      $process=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList (($arguments|ForEach-Object {Quote-NativeArgument $_}) -join ' ') -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput $stdout -RedirectStandardError $stderr;
      if ($process.ExitCode -ne 0) {throw (Get-Content -LiteralPath $stderr -Raw)};
      $actual=Get-Content -LiteralPath $stdout -Raw -Encoding UTF8|ConvertFrom-Json;
      if ($actual.Count -ne $samples.Count) {throw 'Native argument count mismatch.'};
      for ($i=0;$i -lt $samples.Count;$i++) {if ($actual[$i] -cne $samples[$i]) {throw ('Native argument mismatch at '+$i)}};
    } finally {
      foreach ($file in @($stdout,$stderr)) {if (Test-Path -LiteralPath $file) {Remove-Item -LiteralPath $file}}
    }; 'Windows quoting and profile parsing passed.'`;
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000, encoding: 'utf8' });
  console.log(result.trim());
}
