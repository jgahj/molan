import os
import paramiko

ssh = paramiko.SSHClient()
ssh.load_system_host_keys()
ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
ssh_key = os.path.expanduser('~/.ssh/id_ed25519')
ssh.connect('8.138.128.184', port=22, username='root', key_filename=ssh_key, timeout=10)

nginx_conf = """server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;

        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
"""

ssh.exec_command("rm -f /etc/nginx/conf.d/molan_proxy.conf")
sftp = ssh.open_sftp()
with sftp.file("/etc/nginx/sites-available/default", "w") as f:
    f.write(nginx_conf)
sftp.close()

stdin, stdout, stderr = ssh.exec_command("nginx -t")
print("Nginx -t:\n", stdout.read().decode(), stderr.read().decode())

stdin, stdout, stderr = ssh.exec_command("systemctl restart nginx")
print("Restart output:\n", stdout.read().decode(), stderr.read().decode())

stdin, stdout, stderr = ssh.exec_command("systemctl is-active nginx")
print("Nginx active:", stdout.read().decode().strip())

stdin, stdout, stderr = ssh.exec_command("curl -i -s http://127.0.0.1/api/health")
print("Local 80 /api/health:\n", stdout.read().decode())

ssh.close()
