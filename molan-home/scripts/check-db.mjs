import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'molan.db');

try {
  const db = new DatabaseSync(dbPath);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables count:', tables.length);
  console.log('Tables:', tables.map(t => t.name).join(', '));
} catch (err) {
  console.error('DB error:', err);
}
