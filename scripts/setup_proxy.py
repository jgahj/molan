"""Deploy xray-core to ECS (localhost-only proxy) and verify egress."""
import os, sys, time, paramiko

HOST = '8.138.128.184'
PORT = 22
USER = 'root'
PW = os.environ.get('MOLAN_SSH_PASS')
LOCAL_XRAY = '/tmp/ecsdeploy/xray/xray'
LOCAL_CFG = '/tmp/ecsdeploy/xray_config.json'

def sh(ssh, cmd, timeout=60):
    stdin, out, err = ssh.exec_command(cmd, timeout=timeout)
    code = out.channel.recv_exit_status()
    o = out.read().decode(errors='replace')
    e = err.read().decode(errors='replace')
    return code, o, e

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PW, timeout=30)
    sftp = ssh.open_sftp()
    print('[1] connected')

    for d in ['/usr/local/bin', '/usr/local/etc/xray', '/var/log/xray', '/run/xray']:
        sh(ssh, 'mkdir -p ' + d)

    print('[2] upload xray binary ...')
    sftp.put(LOCAL_XRAY, '/usr/local/bin/xray')
    sh(ssh, 'chmod 755 /usr/local/bin/xray')
    code, o, e = sh(ssh, '/usr/local/bin/xray version | head -1')
    print('    xray:', o.strip() or e.strip())

    print('[3] upload config ...')
    sftp.put(LOCAL_CFG, '/usr/local/etc/xray/config.json')

    print('[4] write systemd unit ...')
    unit = '''[Unit]
Description=Xray Core Proxy (localhost only)
After=network.target

[Service]
ExecStart=/usr/local/bin/xray run -c /usr/local/etc/xray/config.json
Restart=on-failure
RestartSec=5
User=root
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
'''
    with sftp.open('/etc/systemd/system/xray.service', 'w') as f:
        f.write(unit)

    sh(ssh, 'systemctl daemon-reload')
    sh(ssh, 'systemctl enable xray')
    code, o, e = sh(ssh, 'systemctl restart xray')
    time.sleep(4)
    code, o, e = sh(ssh, 'systemctl is-active xray')
    print('    xray active:', o.strip())
    if o.strip() != 'active':
        print('    !! xray failed, journal:')
        c2, j, _ = sh(ssh, 'journalctl -u xray -n 25 --no-pager')
        print(j)
        ssh.close(); sys.exit(1)

    print('[5] check listeners ...')
    c, o, e = sh(ssh, "ss -ltnp 2>/dev/null | grep -E '10808|10809' || netstat -ltnp 2>/dev/null | grep -E '10808|10809' || echo 'no-listener-tool'")
    print('   ', o.strip() or e.strip())

    print('[6] egress test (via 127.0.0.1:10809) ...')
    test = (
        "python3 - <<'PY'\n"
        "import urllib.request, sys\n"
        "ph={'http':'http://127.0.0.1:10809','https':'http://127.0.0.1:10809'}\n"
        "op=urllib.request.build_opener(urllib.request.ProxyHandler(ph))\n"
        "for u in ['https://www.google.com','https://api.openai.com','http://192.220.47.188:8080/v1/models']:\n"
        "    try:\n"
        "        r=op.open(u, timeout=15); print('OK', u, r.status)\n"
        "    except Exception as ex:\n"
        "        print('FAIL', u, str(ex)[:120])\n"
        "PY"
    )
    c, o, e = sh(ssh, test, timeout=90)
    print(o)
    if e.strip():
        print('   stderr:', e.strip())

    ssh.close()
    print('DONE')

if __name__ == '__main__':
    main()
