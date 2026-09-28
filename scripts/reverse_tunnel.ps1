# Molan 本机直连 GPT 转发 + SSH 反向端口映射（Windows 本地运行）
# ECS 127.0.0.1:10809 -> 本机 127.0.0.1:7897 -> 192.220.47.188:8080
# 不依赖 Clash、Xray 或其他代理节点；SSH 断开后每 5 秒自动重连。

$ErrorActionPreference = 'SilentlyContinue'
$proxyScript = Join-Path $PSScriptRoot '..\molan-home\scripts\direct_gpt_proxy.js'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$proxyProcess = $null
$proxyStarted = $false
$key  = "$env:USERPROFILE\.ssh\id_ed25519"
$hostName = "root@8.138.128.184"
$SshArgs = @(
    "-i", $key,
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    "-R", "10809:127.0.0.1:7897",
    "-N", $hostName
)

if (-not $nodeCommand) { Write-Error 'Node.js was not found; cannot start the local direct GPT relay.'; exit 1 }
if (-not (Test-Path $proxyScript)) { Write-Error 'direct_gpt_proxy.js was not found.'; exit 1 }

try {
    $relayReady = Test-NetConnection -ComputerName 127.0.0.1 -Port 7897 -InformationLevel Quiet
    if (-not $relayReady) {
        $proxyProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @($proxyScript) -WindowStyle Hidden -PassThru
        $proxyStarted = $true
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 250
            $relayReady = Test-NetConnection -ComputerName 127.0.0.1 -Port 7897 -InformationLevel Quiet
            if ($relayReady) { break }
        }
    }
    if (-not $relayReady) { throw 'Local direct GPT relay did not start on 127.0.0.1:7897.' }

while ($true) {
    ssh @SshArgs
    Start-Sleep -Seconds 5
}
} finally {
    if ($proxyStarted -and $proxyProcess -and -not $proxyProcess.HasExited) {
        Stop-Process -Id $proxyProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
