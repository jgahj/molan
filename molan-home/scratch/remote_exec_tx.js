const { spawnSync } = require('child_process');

const cmd = process.argv.slice(2).join(' ');
const res = spawnSync('ssh.exe', [
  '-i', 'C:/Users/lyh/.ssh/id_rsa',
  'ubuntu@129.204.195.26',
  cmd
], { encoding: 'utf8' });

if (res.stdout) console.log(res.stdout);
if (res.stderr) console.error(res.stderr);
process.exit(res.status || 0);
