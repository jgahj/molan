"""Test SSH connection to ECS."""
import os
import sys
import paramiko

HOST = os.environ.get("MOLAN_SSH_HOST", "8.138.128.184")
PORT = int(os.environ.get("MOLAN_SSH_PORT", "22"))
USER = os.environ.get("MOLAN_SSH_USER", "root")
PASSWORD = os.environ.get("MOLAN_SSH_PASS", "")

if not PASSWORD:
    print("ERROR: MOLAN_SSH_PASS env var not set")
    sys.exit(1)

print(f"[*] Connecting to {USER}@{HOST}:{PORT} ...")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=15, banner_timeout=10, auth_timeout=10)
except Exception as e:
    print(f"[FAIL] {type(e).__name__}: {e}")
    sys.exit(2)

print("[OK] Connected")

# Run a few probes
for cmd in ["whoami", "uname -a", "cat /etc/os-release | head -3", "node --version 2>&1 || echo NO_NODE", "which systemctl"]:
    print(f"\n$ {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=10)
    out = stdout.read().decode(errors="replace").strip()
    err = stderr.read().decode(errors="replace").strip()
    if out: print(out)
    if err: print(f"(stderr) {err}")

client.close()
print("\n[DONE]")