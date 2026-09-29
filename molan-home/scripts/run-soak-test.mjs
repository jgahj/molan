import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createSqliteSoakStore } = require('../lib/evolution/soak-sqlite-store.js');
const { runSoakTask } = require('../lib/evolution/soak-runner.js');

/** 解析 Soak CLI 参数并要求显式指定输入、执行适配器和状态数据库。 */
function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--manifest', '--adapter', '--state', '--task-id', '--milestone', '--lease-ms', '--wait-ms'].includes(name)) {
      throw new TypeError(`未知参数: ${name}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new TypeError(`${name} 缺少参数值`);
    options[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  for (const name of ['manifest', 'adapter', 'state']) {
    if (!options[name]) throw new TypeError(`必须指定 --${name}`);
  }
  return options;
}

/** 调用外部 Generation V2 适配器并将长篇状态保存到用户指定的 SQLite 文件。 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const manifestPath = path.resolve(ROOT, options.manifest);
  const adapterPath = path.resolve(ROOT, options.adapter);
  const statePath = path.resolve(ROOT, options.state);
  const [manifestText, adapterBytes] = await Promise.all([readFile(manifestPath, 'utf8'), readFile(adapterPath)]);
  const replayManifest = JSON.parse(manifestText);
  const loaded = await import(pathToFileURL(adapterPath).href);
  const adapter = loaded.default && typeof loaded.default === 'object' ? { ...loaded.default, ...loaded } : loaded;
  const store = createSqliteSoakStore(statePath, {
    leaseMs: Number(options.leaseMs) || 30000,
    acquireTimeoutMs: Number(options.waitMs) || 0
  });
  try {
    const report = await runSoakTask({
      taskId: options.taskId || replayManifest.sourceGenerationId,
      replayManifest,
      milestone: Number(options.milestone) || 100,
      executorHash: createHash('sha256').update(adapterBytes).digest('hex'),
      store,
      generateChapter: adapter.generateChapter,
      auditChapter: adapter.auditChapter,
      measureCheckpoint: adapter.measureCheckpoint,
      recoverUnknown: adapter.recoverUnknown
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'PASS' || report.execution_status !== 'completed') process.exitCode = 1;
    return report;
  } finally {
    store.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`SOAK RUN ERROR: ${String(error && error.message || error)}\n`);
    process.exitCode = 1;
  });
}
