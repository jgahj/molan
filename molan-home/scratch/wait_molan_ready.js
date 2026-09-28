const { spawnSync } = require('child_process');

function check() {
  const res = spawnSync('ssh.exe', [
    '-i', 'C:/Users/lyh/.ssh/id_ed25519',
    '-o', 'StrictHostKeyChecking=no',
    'root@8.138.128.184',
    'curl -s http://127.0.0.1:3000/api/health'
  ], { encoding: 'utf8' });
  const out = res.stdout || '';
  console.log(`[${new Date().toLocaleTimeString()}] Health: ${out.slice(0, 120)}`);
  if (out.includes('"db":"ready"')) {
    console.log('>>> SERVER IS FULLY READY!');
    process.exit(0);
  }
}

let count = 0;
const timer = setInterval(() => {
  count++;
  if (count > 25) {
    console.log('Timeout waiting for server ready');
    process.exit(1);
  }
  check();
}, 3000);

check();
