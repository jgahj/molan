import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export async function reserveLocalPort(port = 0) {
  const probe = http.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolve);
  });
  return {
    port: probe.address().port,
    close: () => new Promise(resolve => probe.close(resolve))
  };
}

export async function runLocalSession(argv = process.argv.slice(2), dependencies = {}) {
  const cli = dependencies.cli || await import('./run-benchmark-experiments.mjs');
  const options = cli.parseArguments(argv);
  if (!options.execute || options.help) return cli.main(argv);
  if (options['base-url'] || options.adapter || options.review || options['export-blind']) {
    throw new Error('wrapper只管理独立本机会话，不连接外部/已有服务或混合评审操作');
  }
  const projectRoot = dependencies.projectRoot || root;
  const environment = dependencies.environment || process.env;
  const outputDirectory = path.resolve(options.out || path.join(projectRoot, 'data', 'genre-lab', 'benchmark-suite', 'runs', `${Date.now()}-${crypto.randomUUID()}`));
  let runtimeDirectory;
  let port = 0;
  if (options.resume) {
    if (!options.out) throw new Error('wrapper续跑必须显式--out原目录');
    const manifest = cli.readFrozenManifest(outputDirectory, projectRoot);
    const store = cli.createCheckpointStore(outputDirectory);
    if (!store.state) throw new Error('没有可续跑账本，不启动服务');
    if (store.state.planHash !== manifest.planHash || store.state.configHash !== manifest.configHash) {
      throw new Error('账本与冻结manifest不一致，不启动服务');
    }
    if (store.state.records.some(record => record.status !== 'completed') ||
      store.state.records.length >= store.state.plan.expectedGenerations || options['max-calls'] === '0') {
      return cli.main(argv);
    }
    const transport = manifest.config.transport;
    if (transport?.kind !== 'local-http' || transport.protocol !== 'benchmark-local-v2') throw new Error('不是独立本地会话凭证');
    runtimeDirectory = cli.validateRuntimeDirectory(transport.runtimeDirectory, projectRoot);
    const address = new URL(transport.baseUrl);
    if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || address.username ||
      address.password || address.pathname !== '/' || address.search || address.hash || !address.port) {
      throw new Error('冻结地址必须为独立数字回环端口');
    }
    port = Number(address.port);
    const metadata = JSON.parse(fs.readFileSync(path.join(runtimeDirectory, 'runtime.json'), 'utf8'));
    if (metadata.kind !== 'benchmark-local-runtime-v1' || metadata.port !== port ||
      metadata.outputDirectory !== outputDirectory || metadata.localStorage !== true || metadata.cloudProxy !== false) {
      throw new Error('runtime无secret指针与manifest不一致，禁止重建或补余额');
    }
  } else {
    if (fs.existsSync(outputDirectory) && fs.readdirSync(outputDirectory).length) throw new Error('新会话输出目录非空，禁止覆盖');
    if (!options.model || !options['pipeline-version']) throw new Error('实跑须显式模型及pipeline-version');
    runtimeDirectory = cli.validateRuntimeDirectory(path.join(projectRoot, 'data', 'benchmark-local-runtime', crypto.randomUUID()), projectRoot, false);
  }
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  const lockPath = path.join(runtimeDirectory, 'session.lock');
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  let reservation;
  let app;
  let tokenHash;
  let previousEnvironment;
  try {
    reservation = await (dependencies.reservePort || reserveLocalPort)(port);
    port = reservation.port;
    const token = crypto.randomBytes(32).toString('hex');
    const overlay = {
      PORT: String(port), MOLAN_HOST: '127.0.0.1', MOLAN_DATA_DIR: runtimeDirectory,
      MOLAN_CONFIG_DIR: path.join(projectRoot, 'data'), MOLAN_LOCAL_ONLY: '1',
      MOLAN_PUBLIC_MODE: '0', MOLAN_REQUIRE_SQLITE: '1', MOLAN_TOKEN: token,
      MOLAN_BENCHMARK_RUNTIME_DIR: runtimeDirectory,
      MOLAN_BENCHMARK_CALL_TIMEOUT_MS: environment.MOLAN_BENCHMARK_CALL_TIMEOUT_MS || '180000'
    };
    previousEnvironment = Object.fromEntries(Object.keys(overlay).map(key => [key, environment[key]]));
    Object.assign(environment, overlay);
    if (dependencies.loadApp) app = await dependencies.loadApp();
    else {
      const serverPath = require.resolve('../server');
      if (require.cache[serverPath]) throw new Error('本进程已加载用户server，拒绝复用或重启');
      app = require(serverPath);
    }
    app.initDB();
    const email = 'local-benchmark@localhost.invalid';
    if (!options.resume) {
      app.saveUser({ email, name: '本地评测专用账户', role: 'vip', level: 'vip', plan: 'vip', credits: 1000000, spent: 0, createdAt: new Date().toISOString() });
      cli.writeNewJson(path.join(runtimeDirectory, 'runtime.json'), {
        kind: 'benchmark-local-runtime-v1', outputDirectory, localStorage: true, cloudProxy: false,
        port, createdAt: new Date().toISOString(), configReadOnly: true,
        externalInference: true, upstreamFees: '供应商实际费用以其账单为准；本地积分不是费用证明'
      });
    }
    tokenHash = app.hashSessionToken(token);
    app.sessions.set(tokenHash, { email, scope: 'client', expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    await reservation.close();
    reservation = null;
    await new Promise((resolve, reject) => {
      const failed = error => { app.server.off('listening', listening); reject(error); };
      const listening = () => { app.server.off('error', failed); resolve(); };
      app.server.once('error', failed);
      app.server.once('listening', listening);
      app.server.listen(port, '127.0.0.1');
    });
    return await cli.main([...argv, '--out', outputDirectory, '--base-url', `http://127.0.0.1:${port}`]);
  } finally {
    if (app && tokenHash) app.sessions.delete(tokenHash);
    try {
      if (app?.server.listening) {
        app.server.closeAllConnections();
        await new Promise(resolve => app.server.close(resolve));
      }
      if (reservation) await reservation.close();
    } finally {
      for (const [key, value] of Object.entries(previousEnvironment || {})) {
        if (value === undefined) delete environment[key];
        else environment[key] = value;
      }
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalSession().catch(() => {
    console.error('本地评测会话未完成；已有凭证保留，未自动重试，未部署或修改真实配置。');
    process.exitCode = 1;
  });
}
