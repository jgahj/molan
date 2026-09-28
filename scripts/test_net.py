"""Test download speeds/connectivity to Node sources from ECS."""
import os, sys, paramiko

HOST = "8.138.128.184"
PORT = 22
USER = "root"
PASSWORD = os.environ.get("MOLAN_SSH_PASS", "")
if not PASSWORD:
    print("ERROR: MOLAN_SSH_PASS not set"); sys.exit(1)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=15, banner_timeout=10, auth_timeout=10)
print("[OK] connected")

tests = [
    'curl -fsSL -m 25 -o /dev/null -w "nodesource gpg: %{http_code} %{size_download}B %{time_total}s\\n" https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key',
    'curl -fsSL -m 25 -o /dev/null -w "nodejs.org: %{http_code} %{size_download}B %{time_total}s\\n" https://nodejs.org/dist/v22.22.0/node-v22.22.0-linux-x64.tar.xz',
    'curl -fsSL -m 25 -o /dev/null -w "npmmirror node: %{http_code} %{size_download}B %{time_total}s\\n" https://registry.npmmirror.com/-/binary/node/v22.22.0/node-v22.22.0-linux-x64.tar.xz',
]
for t in tests:
    print(f"$ {t}")
    stdin, stdout, stderr = client.exec_command(t, timeout=35)
    out = stdout.read().decode(errors="replace").strip()
    err = stderr.read().decode(errors="replace").strip()
    code = stdout.channel.recv_exit_status()
    print(f"  exit={code} {out} {('ERR:'+err) if err else ''}")

client.close()
print("[DONE]")