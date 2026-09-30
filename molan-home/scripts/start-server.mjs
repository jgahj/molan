import { spawn } from 'node:child_process';
import process from 'node:process';

const [major, minor] = process.versions.node.split('.').map(Number);
const args = [];
if (major > 22 || (major === 22 && (minor || 0) >= 5)) {
  args.push('--experimental-sqlite');
}
args.push('--no-warnings', 'server.js', ...process.argv.slice(2));

const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
