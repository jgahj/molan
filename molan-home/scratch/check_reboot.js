const { exec } = require('child_process');

let attempts = 0;
function testSSH() {
  attempts++;
  console.log(`[${new Date().toLocaleTimeString()}] Attempt ${attempts} connecting to 8.138.128.184...`);
  exec('ssh.exe -o ConnectTimeout=5 -o StrictHostKeyChecking=no -i C:/Users/lyh/.ssh/id_ed25519 root@8.138.128.184 "uptime"', (err, stdout, stderr) => {
    if (!err && stdout.includes('load average')) {
      console.log('>>> ECS REBOOT COMPLETED! UPTIME:', stdout.trim());
      process.exit(0);
    } else {
      console.log('Result:', (stderr || err?.message || '').trim().slice(0, 100));
      if (attempts >= 15) {
        console.log('Exceeded 15 attempts.');
        process.exit(1);
      }
      setTimeout(testSSH, 4000);
    }
  });
}

testSSH();
