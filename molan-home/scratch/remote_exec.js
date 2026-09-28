const { spawn } = require('child_process');

const cmd = process.argv.slice(2).join(' ') || 'uptime';
const child = spawn('ssh.exe', [
  '-i', 'C:/Users/lyh/.ssh/id_ed25519',
  '-o', 'StrictHostKeyChecking=no',
  'root@8.138.128.184',
  cmd
], { stdio: 'inherit' });

child.on('close', code => process.exit(code || 0));
