$ErrorActionPreference = 'Stop'

$port = 55433
$sshKey = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
$passwordFile = Join-Path $env:LOCALAPPDATA 'molan-postgresql\cloud-runtime-password.txt'
$nodePath = Join-Path $PSScriptRoot '..\tools\node22_runtime\node.exe'

if (-not (Test-Path -LiteralPath $sshKey)) {
  throw "SSH key not found: $sshKey"
}
if (-not (Test-Path -LiteralPath $passwordFile)) {
  throw "Cloud PostgreSQL password file not found: $passwordFile"
}
if (-not (Test-Path -LiteralPath $nodePath)) {
  throw "Node 22 runtime not found: $nodePath"
}
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
  throw "Local port $port is already in use. Close its owner before starting the cloud tunnel."
}

$sshPath = (Get-Command ssh.exe -ErrorAction Stop).Source
$sshArguments = @(
  '-N',
  '-L', "127.0.0.1:${port}:127.0.0.1:5432",
  '-o', 'BatchMode=yes',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'IdentitiesOnly=yes',
  '-i', $sshKey,
  'root@8.138.128.184'
)
$tunnel = $null

try {
  $tunnel = Start-Process -FilePath $sshPath -ArgumentList $sshArguments -PassThru -WindowStyle Hidden
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    if ($tunnel.HasExited) {
      throw 'SSH tunnel exited before PostgreSQL became available.'
    }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if ($listener) {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) {
    throw "SSH tunnel did not open local port $port."
  }

  $connectionCheck = 'const repository = require("./lib/postgres-repository").createPostgresRepository(); repository.initialize().then(async info => { console.log(JSON.stringify({ ok: true, database: info.database, serverVersion: info.server_version, tableCount: info.table_count })); await repository.close(); }).catch(async error => { console.error(JSON.stringify({ ok: false, code: error.code || "pg_unavailable" })); await repository.close().catch(() => {}); process.exitCode = 1; });'
  & $nodePath -e $connectionCheck
  if ($LASTEXITCODE -ne 0) {
    throw 'Cloud PostgreSQL runtime check failed; the application was not started.'
  }

  & $nodePath --experimental-sqlite --no-warnings server.js
  exit $LASTEXITCODE
}
finally {
  if ($tunnel -and -not $tunnel.HasExited) {
    Stop-Process -Id $tunnel.Id -Force
  }
}
