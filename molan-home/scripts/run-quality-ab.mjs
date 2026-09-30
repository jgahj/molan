import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { planEvaluation, runEvaluation } = require('../lib/evolution/quality-ab-runner');
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
try {
  if (!option('--plan')) throw new Error('--plan is required');
  const plan = JSON.parse(fs.readFileSync(option('--plan'), 'utf8'));
  process.stdout.write(JSON.stringify(planEvaluation(plan), null, 2) + '\n');
  if (process.argv.includes('--execute')) {
    const maxCost = Number(option('--max-cost'));
    if (!option('--max-cost') || !Number.isFinite(maxCost) || maxCost <= 0) throw new Error('--execute requires --max-cost');
    if (!option('--out') || !process.env.MOLAN_AB_ENDPOINT || !process.env.MOLAN_AB_API_KEY) throw new Error('--out, MOLAN_AB_ENDPOINT and MOLAN_AB_API_KEY required');
    const endpoint = new URL(process.env.MOLAN_AB_ENDPOINT);
    if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('HTTPS endpoint required');
    const result = await runEvaluation(plan, { maxCost, directory: path.resolve(option('--out')), callModel: async body => {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MOLAN_AB_API_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      return response.json();
    } });
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.status === 'BLOCKED') process.exitCode = 2;
  }
} catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
