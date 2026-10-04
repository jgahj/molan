"""Deploy molan-home to ECS: Node22 binary + source + systemd.

Platform model requests connect directly to each configured baseURL. Remove
the legacy MOLAN_PROXY drop-in so deployments cannot restore an SSH tunnel.
"""
import os, sys, time, tarfile, tempfile, json

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    import builtins
    _orig_open = builtins.open
    def _utf8_open(file, mode='r', *args, **kwargs):
        if 'b' not in mode and 'encoding' not in kwargs:
            kwargs['encoding'] = 'utf-8'
        return _orig_open(file, mode, *args, **kwargs)
    builtins.open = _utf8_open

import paramiko

HOST = '8.138.128.184'; PORT = 22; USER = 'root'; PW = os.environ.get('MOLAN_SSH_PASS')
SSH_KEY = os.environ.get('MOLAN_SSH_KEY', os.path.expanduser('~/.ssh/id_ed25519'))
# 用 tempfile.gettempdir()（= Git Bash 的 /tmp = AppData\Local\Temp），避免原生 Windows Python 把 /tmp 误解析成 C:\tmp
BASE = os.path.join(tempfile.gettempdir(), 'ecsdeploy')
LOCAL_NODE = os.path.join(BASE, 'node22', 'node-v22.22.2-linux-x64')
LOCAL_TAR = os.path.join(BASE, 'molan.tar.gz')
PROJ_DIR = 'C:/Users/lyh/Desktop/小说专属网页/molan-home'
LOCAL_CONFIG = os.path.join(PROJ_DIR, 'data', 'config.json')
REMOTE_DIR = '/opt/molan'
REMOTE_RELEASE_ROOT = '/opt/molan-releases'
REMOTE_BACKUP_ROOT = '/opt/molan-backups'
LOCAL_ONLY_ROOT_FILES = {
    'benchmark-summary.json', 'evidence-index.json', 'gap-analysis.json',
    'generalization-report.json', 'generalization-report.md',
    'optimization-plan.json', 'quality-report.json', 'quality-report.md',
    'regression-report.json', 'regression-report.md',
    'self-evolution-report.json', 'self-evolution-report.md',
    'last_prompt.txt', 'transcript_tail.txt', 'P0-P4_LOCAL_RESULT.md',
}

def sh(ssh, cmd, timeout=120):
    stdin, out, err = ssh.exec_command(cmd, timeout=timeout)
    code = out.channel.recv_exit_status()
    return code, out.read().decode(errors='replace'), err.read().decode(errors='replace')

def build_tar():
    os.makedirs(BASE, exist_ok=True)
    print('[tar] building molan.tar.gz (exclude local generated content and runtime data) ...')
    data_whitelist_dirs = ('genre-baselines', 'genre-rules', 'genre-evidence', 'correction-library', 'evolution', 'pipelines', 'evaluation-input')
    data_whitelist_files = ('ai-flavor-lexicon.json', 'feature-contracts.json', 'quality_issue_map.json', 'style-fingerprints.json', 'config.example.json')
    with tarfile.open(LOCAL_TAR, 'w:gz') as tf:
        for root, dirs, files in os.walk(PROJ_DIR):
            rel = os.path.relpath(root, PROJ_DIR)
            parts = rel.split(os.sep)
            if any(p in ('node_modules', '.git', '.workbuddy', 'scripts', 'test', 'generated') for p in parts):
                dirs[:] = []; continue
            if rel == os.path.join('lib', 'character-material'):
                dirs[:] = []; continue
            if rel == 'lib':
                dirs[:] = [d for d in dirs if d != 'character-material']
            if rel == 'data':  # 仅放行结构化资产白名单目录与必要系统配置文件，不传本地私密数据
                dirs[:] = [d for d in dirs if d in data_whitelist_dirs]
                for f in files:
                    if f in data_whitelist_files:
                        fp = os.path.join(root, f)
                        tf.add(fp, arcname=os.path.join(rel, f))
                continue
            if len(parts) > 1 and parts[0] == 'data' and parts[1] not in data_whitelist_dirs:
                dirs[:] = []; continue
            for f in files:
                if (rel == '.' and f in LOCAL_ONLY_ROOT_FILES) or f.lower().endswith('.log') or f == '.env' or f.startswith('.env.'):
                    continue
                fp = os.path.join(root, f)
                tf.add(fp, arcname=os.path.join(rel, f))

def main():
    build_tar()
    print('[tar] size', os.path.getsize(LOCAL_TAR))
    ssh = paramiko.SSHClient()
    # 只接受本机 known_hosts 中已经核验过的服务器指纹，拒绝首次自动信任。
    ssh.load_system_host_keys()
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    auth = {'password': PW} if PW else {'key_filename': SSH_KEY} if os.path.exists(SSH_KEY) else None
    if auth is None:
        raise RuntimeError('MOLAN_SSH_PASS 未设置，且 SSH 密钥不存在：' + SSH_KEY)
    ssh.connect(HOST, port=PORT, username=USER, timeout=30, **auth)
    sftp = ssh.open_sftp()
    print('[1] connected')

    # Node22 (官方 tar 包 bin/ 仅含 node，molan 零依赖运行时不需 npm/npx)
    print('[2] install node22 ...')
    node_bin = os.path.join(LOCAL_NODE, 'bin', 'node')
    if os.path.exists(node_bin):
        sh(ssh, 'rm -rf /opt/node22 && mkdir -p /opt/node22')
        sftp.put(node_bin, '/opt/node22/node')
        sh(ssh, 'ln -sf /opt/node22/node /usr/local/bin/node; chmod 755 /opt/node22/node')
    else:
        print('   local node linux binary not found, ensuring remote /opt/node22/node is linked...')
        sh(ssh, 'test -f /opt/node22/node && ln -sf /opt/node22/node /usr/local/bin/node || true')
    c,o,e = sh(ssh, 'node --version'); print('   node', o.strip() or e.strip())

    # source: stage and switch atomically while preserving the live data directory.
    # The old release is retained so a failed health check can roll back without
    # losing users, novels, skills, sessions, credits, or token ledgers.
    deploy_tag = time.strftime('%Y%m%d-%H%M%S')
    release_dir = REMOTE_RELEASE_ROOT + '/release-' + deploy_tag
    previous_dir = REMOTE_RELEASE_ROOT + '/previous-' + deploy_tag
    backup_dir = REMOTE_BACKUP_ROOT + '/data-' + deploy_tag
    print('[3] stage molan source ...')
    sh(ssh, 'systemctl stop molan || true')
    sh(ssh, "id -u molan >/dev/null 2>&1 || useradd --system --home-dir /opt/molan --shell /usr/sbin/nologin molan")
    sh(ssh, 'sync')
    sh(ssh, 'mkdir -p ' + REMOTE_RELEASE_ROOT + ' ' + REMOTE_BACKUP_ROOT + ' ' + release_dir + '/data')
    sh(ssh, 'if [ -d ' + REMOTE_DIR + '/data ]; then cp -a ' + REMOTE_DIR + '/data ' + backup_dir + '; fi')
    sh(ssh, 'if [ -d ' + REMOTE_DIR + '/data ]; then cp -a ' + REMOTE_DIR + '/data/. ' + release_dir + '/data/; fi')
    sftp.put(LOCAL_TAR, release_dir + '/molan.tar.gz')
    sh(ssh, 'cd ' + release_dir + ' && tar -xzf molan.tar.gz && rm molan.tar.gz')
    sh(ssh, 'if [ -d ' + REMOTE_DIR + '/node_modules ]; then cp -a ' + REMOTE_DIR + '/node_modules ' + release_dir + '/; fi')
    preserve_cmd = (
        'if [ -d ' + REMOTE_DIR + '/generated ]; then cp -a ' + REMOTE_DIR + '/generated ' + release_dir + '/generated; fi'
        ' && if [ -d ' + REMOTE_DIR + '/lib/character-material ]; then mkdir -p ' + release_dir + '/lib'
        ' && cp -a ' + REMOTE_DIR + '/lib/character-material ' + release_dir + '/lib/; fi'
    )
    code, _, err = sh(ssh, preserve_cmd)
    if code:
        raise RuntimeError('failed to preserve remote generated/material assets: ' + err.strip())
    c,o,e = sh(ssh, 'ls ' + release_dir + ' | head'); print('   staged:', o.strip()[:200])

    # Keep the live platform config together with the persistent data. Admin
    # model defaults and credit rates are written to this file at runtime, so
    # an ordinary code deploy must never overwrite an existing remote config.
    # A fresh installation may still bootstrap it from the local deployment
    # bundle when no remote config exists yet.
    remote_config = release_dir + '/data/config.json'
    if os.path.exists(LOCAL_CONFIG):
        code, out, err = sh(ssh, 'test -f ' + remote_config + ' && echo present || echo missing')
        if out.strip() == 'missing':
            print('[3b] bootstrap data/config.json (DeepSeek key) ...')
            sftp.put(LOCAL_CONFIG, remote_config)
        else:
            print('[3b] sync platformModels into remote data/config.json ...')
            with open(LOCAL_CONFIG, 'r', encoding='utf-8') as lf:
                local_cfg = json.load(lf)
            code, rem_str, _ = sh(ssh, 'cat ' + remote_config)
            try:
                remote_cfg = json.loads(rem_str)
            except Exception:
                remote_cfg = {}
            local_models = local_cfg.get('platformModels', [])
            remote_models = remote_cfg.get('platformModels', [])
            merged_models = []
            seen_ids = set()
            for rm in remote_models:
                if isinstance(rm, dict) and 'id' in rm:
                    merged_models.append(dict(rm))
                    seen_ids.add(rm['id'])
            for lm in local_models:
                if isinstance(lm, dict) and 'id' in lm:
                    if lm['id'] not in seen_ids:
                        merged_models.append(dict(lm))
                        seen_ids.add(lm['id'])
                    else:
                        for existing in merged_models:
                            if existing.get('id') == lm['id']:
                                for key in ('baseURL', 'apiKey', 'model', 'contextWindowTokens', 'supportsReasoning', 'supportsThinking', 'group'):
                                    if key in lm:
                                        existing[key] = lm[key]
            remote_cfg['platformModels'] = merged_models
            if local_cfg.get('deepseekApiKey') and not remote_cfg.get('deepseekApiKey'):
                remote_cfg['deepseekApiKey'] = local_cfg['deepseekApiKey']
            tmp_cfg = os.path.join(BASE, 'config_merged.json')
            with open(tmp_cfg, 'w', encoding='utf-8') as cf:
                json.dump(remote_cfg, cf, ensure_ascii=False, indent=2)
            sftp.put(tmp_cfg, remote_config)
            print('   merged ' + str(len(merged_models)) + ' models into remote config')
    else:
        print('[3b] keep remote data/config.json (local file not found)')

    # Apply any pending postgres migrations
    print('[3c] apply pending postgres migrations ...')
    migration_cmd = (
        'for f in $(ls -1 ' + release_dir + '/db/migrations/*.sql 2>/dev/null | sort -V); do '
        '  v=$(basename "$f" .sql); '
        '  applied=$(sudo -u postgres psql -d molan -t -A -c "SELECT 1 FROM luna.schema_migrations WHERE version=\'$v\';" 2>/dev/null); '
        '  if [ "$applied" != "1" ]; then '
        '    echo "   applying migration $v ..."; '
        '    sudo -u postgres psql -d molan -f "$f" >/dev/null || exit 1; '
        '    csum=$(sha256sum "$f" | cut -d" " -f1); '
        '    sudo -u postgres psql -d molan -c "INSERT INTO luna.schema_migrations(version, checksum) VALUES (\'$v\', \'$csum\') ON CONFLICT (version) DO NOTHING;" >/dev/null || exit 1; '
        '  fi; '
        'done'
    )
    c, o, e = sh(ssh, migration_cmd)
    if c != 0:
        raise RuntimeError('failed to apply postgres migrations: ' + e.strip())
    print('   postgres migrations up to date')

    sh(ssh, 'if [ -d ' + REMOTE_DIR + ' ]; then mv ' + REMOTE_DIR + ' ' + previous_dir + '; fi')
    sh(ssh, 'mv ' + release_dir + ' ' + REMOTE_DIR)
    c,o,e = sh(ssh, 'ls ' + REMOTE_DIR + ' | head'); print('   active:', o.strip()[:200])

    # systemd: 保留现有 upstream-proxy.conf drop-in；当前模型请求依赖
    # 主机上的 SSH 隧道，不在发布时改动或关闭该转发。
    print('[4] write molan systemd ...')
    unit = '''[Unit]
Description=Molan Writing SaaS
After=network.target

[Service]
WorkingDirectory=/opt/molan
Environment=NODE_ENV=production
Environment=MOLAN_PUBLIC_MODE=1
ExecStart=/usr/local/bin/node --experimental-sqlite --no-warnings server.js
Restart=on-failure
RestartSec=5
User=molan
Group=molan
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectHome=true
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=/opt/molan/data
[Install]
WantedBy=multi-user.target
'''
    with sftp.open('/etc/systemd/system/molan.service','w') as f: f.write(unit)
    # 源码只读、数据目录由服务账户写入；阻止其他本机用户读取作品和账号文件。
    sh(ssh, 'chown -R root:molan ' + REMOTE_DIR)
    sh(ssh, 'find ' + REMOTE_DIR + ' -type d -exec chmod 750 {} +')
    sh(ssh, 'find ' + REMOTE_DIR + ' -type f -exec chmod 640 {} +')
    sh(ssh, 'chmod 770 ' + REMOTE_DIR + '/data')
    # SQLite/WAL and legacy JSON files must remain writable by the service
    # account. Atomic JSON writers still create new files with UMask=0077.
    sh(ssh, 'find ' + REMOTE_DIR + '/data -type d -exec chmod 770 {} +')
    sh(ssh, 'find ' + REMOTE_DIR + '/data -type f -exec chmod 660 {} +')
    sh(ssh, 'if [ -f ' + REMOTE_DIR + '/data/config.json ]; then chmod 640 ' + REMOTE_DIR + '/data/config.json; fi')
    print('[4b] preserve molan.service.d drop-ins ...')
    sh(ssh, 'systemctl daemon-reload'); sh(ssh, 'systemctl enable molan')
    sh(ssh, 'systemctl restart molan')
    status = ''
    for _ in range(12):
        time.sleep(2)
        c, o, e = sh(ssh, 'systemctl is-active molan')
        status = o.strip()
        if status == 'active':
            break
    print('   molan active:', status)
    if status != 'active':
        print('   !! molan failed, journal:')
        c2, j, _ = sh(ssh, 'journalctl -u molan -n 30 --no-pager')
        print(j.encode('ascii', errors='replace').decode('ascii'))
        print('   !! rolling back previous release ...')
        sh(ssh, 'systemctl stop molan || true')
        sh(ssh, 'mv ' + REMOTE_DIR + ' ' + REMOTE_RELEASE_ROOT + '/failed-' + deploy_tag)
        sh(ssh, 'mv ' + previous_dir + ' ' + REMOTE_DIR)
        sh(ssh, 'systemctl start molan || true')
        ssh.close(); sys.exit(1)

    print('[5] health check ...')
    health = None
    last_health = ''
    health_deadline = time.monotonic() + 180
    while time.monotonic() < health_deadline:
        c, o, e = sh(ssh, 'curl -fsS --max-time 3 http://127.0.0.1:3000/api/health', timeout=8)
        try:
            candidate = json.loads(o)
            if isinstance(candidate, dict) and candidate.get('ok') is True and candidate.get('db') == 'ready' and int(candidate.get('models') or 0) > 0:
                health = candidate
                break
            last_health = json.dumps(candidate, ensure_ascii=False)
        except (TypeError, ValueError):
            last_health = (o or e).strip()
        time.sleep(min(2, max(0, health_deadline - time.monotonic())))

    if not health:
        print('   health check failed:', last_health[:500] or 'timeout')
        _, journal, _ = sh(ssh, 'journalctl -u molan -n 40 --no-pager')
        print(journal.encode('ascii', errors='replace').decode('ascii'))
        code, _, _ = sh(ssh, 'test -d ' + previous_dir)
        if code == 0:
            print('   !! rolling back unhealthy release ...')
            sh(ssh, 'systemctl stop molan || true')
            sh(ssh, 'mv ' + REMOTE_DIR + ' ' + REMOTE_RELEASE_ROOT + '/failed-' + deploy_tag)
            sh(ssh, 'mv ' + previous_dir + ' ' + REMOTE_DIR)
            sh(ssh, 'systemctl start molan || true')
        ssh.close()
        sys.exit(1)

    print('   ', json.dumps(health, ensure_ascii=False))

    # 保留有限的回滚点，避免每次发布复制完整 data 后持续吃满根分区。
    sh(ssh, "ls -1dt " + REMOTE_RELEASE_ROOT + "/previous-* 2>/dev/null | tail -n +6 | xargs -r rm -rf")
    sh(ssh, "ls -1dt " + REMOTE_RELEASE_ROOT + "/failed-* 2>/dev/null | tail -n +4 | xargs -r rm -rf")
    sh(ssh, "ls -1dt " + REMOTE_BACKUP_ROOT + "/data-* 2>/dev/null | tail -n +11 | xargs -r rm -rf")

    # Historical releases/backups are root-only. They can contain source,
    # account records, session hashes, model configuration, and novel text.
    sh(ssh, 'chmod 700 ' + REMOTE_RELEASE_ROOT + ' ' + REMOTE_BACKUP_ROOT)
    sh(ssh, 'find ' + REMOTE_RELEASE_ROOT + ' ' + REMOTE_BACKUP_ROOT + ' -mindepth 1 -type d -exec chmod 700 {} +')
    sh(ssh, 'find ' + REMOTE_RELEASE_ROOT + ' ' + REMOTE_BACKUP_ROOT + ' -type f -exec chmod 600 {} +')

    ssh.close(); print('DONE')

if __name__ == '__main__':
    main()
