"""Deploy molan-home to ECS in one shot."""
import os
import sys
import time
import stat
import posixpath
import paramiko

HOST = "8.138.128.184"
PORT = 22
USER = "root"
PASSWORD = os.environ.get("MOLAN_SSH_PASS", "")
LOCAL_DIR = r"C:\Users\lyh\Desktop\小说专属网页\molan-home"
REMOTE_DIR = "/opt/molan-home"
SERVICE_NAME = "molan"

# Exclude from upload (server is zero-dep)
EXCLUDE_DIRS = {"node_modules", ".git", ".workbuddy", "test", ".ds-profile"}
EXCLUDE_FILES = {".DS_Store", "Thumbs.db"}

def log(s):
    print(s, flush=True)

def run(client, cmd, timeout=180, check=True):
    log(f"\n$ {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    if out.strip(): log(out.rstrip())
    if err.strip(): log(f"[stderr] {err.rstrip()}")
    code = stdout.channel.recv_exit_status()
    if check and code != 0:
        log(f"[FAIL] exit {code}")
        sys.exit(code)
    return code, out, err

def sftp_upload_dir(sftp, local_root, remote_root):
    """Recursively upload local_root to remote_root, excluding EXCLUDE_DIRS."""
    uploaded = 0
    for entry in os.scandir(local_root):
        name = entry.name
        if name in EXCLUDE_DIRS or name in EXCLUDE_FILES:
            log(f"  skip: {name}")
            continue
        local_path = entry.path
        remote_path = posixpath.join(remote_root, name)
        if entry.is_dir():
            try:
                sftp.mkdir(remote_path)
            except IOError:
                pass
            uploaded += sftp_upload_dir(sftp, local_path, remote_path)
        elif entry.is_file():
            sftp.put(local_path, remote_path)
            uploaded += 1
            log(f"  + {name}")
    return uploaded

def main():
    if not PASSWORD:
        log("ERROR: MOLAN_SSH_PASS env var not set"); sys.exit(1)

    log(f"=== Deploy molan-home to {USER}@{HOST} ===")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=15, banner_timeout=10, auth_timeout=10)
    log("[OK] SSH connected")

    # --- Phase 1: Check & install Node.js 22 ---
    log("\n=== Phase 1: Install Node.js 22 ===")
    code, out, _ = run(client, "node --version 2>/dev/null || echo MISSING", check=False)
    has_node = "MISSING" not in out and out.strip().startswith("v")
    if has_node:
        log(f"Node already installed: {out.strip()}")
        if "v22." in out:
            log("[OK] Node 22.x present")
        else:
            log("[WARN] Node version is not 22.x; will install Node 22 anyway")
            has_node = False

    if not has_node:
        log("Installing Node.js 22 via NodeSource...")
        run(client, "apt-get update -qq", timeout=120)
        run(client, "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg 2>&1 | tail -3", timeout=120)
        run(client, "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg", timeout=60)
        run(client, 'echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list')
        run(client, "apt-get update -qq", timeout=120)
        run(client, "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs 2>&1 | tail -5", timeout=300)
        run(client, "node --version")
        run(client, "npm --version")

    # --- Phase 2: Prepare remote directory ---
    log("\n=== Phase 2: Prepare /opt/molan-home ===")
    run(client, f"mkdir -p {REMOTE_DIR}")
    run(client, f"mkdir -p {REMOTE_DIR}/data")

    # --- Phase 3: Upload project files via SFTP ---
    log("\n=== Phase 3: Upload project files (zero-dep, no node_modules) ===")
    sftp = client.open_sftp()
    try:
        count = sftp_upload_dir(sftp, LOCAL_DIR, REMOTE_DIR)
        log(f"\n[OK] Uploaded {count} files")
    finally:
        sftp.close()

    # Verify upload
    run(client, f"ls -la {REMOTE_DIR}")
    run(client, f"ls {REMOTE_DIR}/pages | head -5")
    run(client, f"cat {REMOTE_DIR}/package.json")

    # --- Phase 4: Create systemd service ---
    log("\n=== Phase 4: Create systemd service ===")
    service_unit = f"""[Unit]
Description=Molan Novel Writing (墨阑)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory={REMOTE_DIR}
ExecStart=/usr/bin/node --experimental-sqlite --no-warnings server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
"""
    # Write via heredoc
    heredoc = f"cat > /etc/systemd/system/{SERVICE_NAME}.service <<'EOF'\n{service_unit}EOF"
    run(client, heredoc)
    run(client, f"cat /etc/systemd/system/{SERVICE_NAME}.service")
    run(client, "systemctl daemon-reload")
    run(client, f"systemctl enable {SERVICE_NAME}.service")
    run(client, f"systemctl restart {SERVICE_NAME}.service")
    time.sleep(2)
    run(client, f"systemctl status {SERVICE_NAME}.service --no-pager -l", check=False)

    # --- Phase 5: Verify ---
    log("\n=== Phase 5: Verify ===")
    code, out, err = run(client, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/", check=False)
    log(f"GET / -> {out.strip()}")
    code, out, err = run(client, "curl -s http://localhost:3000/api/health", check=False)
    log(f"GET /api/health -> {out.strip()}")
    code, out, err = run(client, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/pages/editor.html", check=False)
    log(f"GET /pages/editor.html -> {out.strip()}")
    run(client, "ss -tlnp | grep :3000 || netstat -tlnp 2>/dev/null | grep :3000", check=False)
    run(client, f"tail -10 {REMOTE_DIR}/data/molan.db-wal 2>/dev/null; ls -lh {REMOTE_DIR}/data/")

    # --- Phase 6: Public reachability (via Aliyun security group check) ---
    log("\n=== Phase 6: Public reachability ===")
    code, out, err = run(client, "curl -s -m 5 -o /dev/null -w 'http://8.138.128.184:3000 -> %{http_code}\\n' http://8.138.128.184:3000/", check=False)
    log(out.strip() if out else "(no output)")

    client.close()
    log("\n=== DONE ===")
    log(f"Service: systemctl status {SERVICE_NAME}")
    log(f"Logs:    journalctl -u {SERVICE_NAME} -f")
    log(f"Local:   http://8.138.128.184:3000/   (if security group opens :3000)")

if __name__ == "__main__":
    main()