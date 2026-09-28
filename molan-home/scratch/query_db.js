const { execSync } = require('child_process');

const sql = "SELECT id, status, phase, progress, error, updated_at_value FROM luna.sqlite_dissections ORDER BY updated_at_value DESC LIMIT 1;";
const out = execSync(`su - postgres -c 'psql -d molan -c "${sql}"'`).toString();
console.log(out);
