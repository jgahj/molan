import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { VERSION, DOMAINS } = require('../lib/repositories/json-file-repository');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = args.indexOf('--data-dir');
if (args.length !== 0 && (args.length !== 2 || option !== 0 || !args[1])) {
  console.error('Usage: node scripts/check-db.mjs [--data-dir <native repository directory>]');
  process.exitCode = 1;
} else {
  const directory = path.resolve(option >= 0 ? args[option + 1] : path.join(process.env.MOLAN_DATA_DIR || path.join(root, 'data'), 'app-json'));
  try {
    const files = await fs.readdir(directory);
    let novelFiles = [];
    try { novelFiles = (await fs.readdir(path.join(directory, 'novels'))).filter(name => /^[a-f0-9]{64}\.json$/.test(name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const paths = [...(files.includes('accounts.json') ? ['accounts.json'] : []), ...novelFiles.map(name => path.join('novels', name))];
    const counts = Object.fromEntries(DOMAINS.map(domain => [domain, 0]));
    for (const filename of paths) {
      const document = JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8'));
      if (document.schemaVersion !== VERSION || !Number.isSafeInteger(document.revision) || document.revision < 0 ||
          !document.domains || typeof document.domains !== 'object' || Array.isArray(document.domains) ||
          (filename === 'accounts.json' ? document.scope !== null : typeof document.scope !== 'string' || !document.scope)) {
        throw new Error(`Invalid repository document: ${filename}`);
      }
      if (document.scope !== null && path.basename(filename) !== createHash('sha256').update(document.scope).digest('hex') + '.json') {
        throw new Error(`Scope and filename do not match: ${filename}`);
      }
      for (const [domain, records] of Object.entries(document.domains)) {
        if (!DOMAINS.includes(domain) || !records || typeof records !== 'object' || Array.isArray(records) ||
            (domain === 'accounts') !== (document.scope === null)) throw new Error(`Invalid domain in ${filename}: ${domain}`);
        counts[domain] += Object.keys(records).length;
      }
    }
    const recoveryRequired = files.includes('.commit.json');
    console.log(JSON.stringify({ backend: 'json', directory, documents: paths.length, counts, recoveryRequired }, null, 2));
    if (recoveryRequired) process.exitCode = 1;
  } catch (error) {
    console.error(`Native repository check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
