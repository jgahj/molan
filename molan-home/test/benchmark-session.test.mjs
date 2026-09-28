import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as cli from '../scripts/run-benchmark-experiments.mjs';
import { runLocalSession } from '../scripts/run-local-benchmark-session.mjs';

const require = createRequire(import.meta.url);
const experiments = require('../lib/benchmark-experiments.js');

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-benchmark-session-'));
  context.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('molan-benchmark-session-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (name, value = 'fixture-only-not-production') => {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, value);
    return filename;
  };
  for (const name of [...cli.IMPLEMENTATION_FILES, ...cli.GENRE_ASSET_FILES]) write(name);
  for (const name of ['manifest.json', 'suite.json', 'control-prompt.txt', 'control-provenance.json']) {
    write(`data/genre-lab/benchmark-suite/${name}`, '{}');
  }
  write('data/genre-lab/regression-prompts.json', '[]');
  const output = path.join(root, 'output');
  const environment = { MOLAN_TOKEN: 'prior-test-token', PORT: '1234', MOLAN_DATA_DIR: 'prior-test-directory' };
  let loads = 0;
  let saves = 0;
  let modelCalls = 0;
  let failMain = false;
  const sessions = [];
  const tokens = [];
  const invocations = [];
  const plan = { phase: 'P0', arms: ['control'], expectedGenerations: 36 };
  const transportConfig = () => ({
    model: 'fixture-model', parameterSource: 'pipeline-request; provider overrides not independently verified',
    transport: {
      kind: 'local-http', protocol: 'benchmark-local-v2',
      baseUrl: `http://127.0.0.1:${environment.PORT}`,
      runtimeDirectory: environment.MOLAN_BENCHMARK_RUNTIME_DIR
    }
  });
  const dependencies = {
    projectRoot: root, environment,
    cli: {
      ...cli,
      readFrozenManifest: directory => cli.readFrozenManifest(directory, root),
      main: async argv => {
        invocations.push(argv);
        const options = cli.parseArguments(argv);
        if (!options.execute) return { status: 'not_executed' };
        const existing = cli.createCheckpointStore(output);
        if (existing.state?.records.some(record => record.status !== 'completed')) return existing.state;
        if (failMain) throw new Error('fixture interrupted');
        const config = transportConfig();
        cli.freezeManifest(output, plan, config, root);
        const balanceFile = path.join(environment.MOLAN_DATA_DIR, 'balance.json');
        const balance = JSON.parse(fs.readFileSync(balanceFile, 'utf8'));
        balance.credits -= 17;
        balance.spent += 17;
        fs.writeFileSync(balanceFile, JSON.stringify(balance));
        modelCalls += 1;
        const state = existing.state || {
          plan, config, planHash: experiments.hashValue(plan), configHash: experiments.hashValue(config),
          status: 'paused', records: []
        };
        state.records.push({ status: 'completed' });
        existing.saveCheckpoint(state);
        return state;
      }
    },
    loadApp: async () => {
      loads += 1;
      const app = {
        server: http.createServer((_request, response) => { response.statusCode = 404; response.end(); }),
        sessions: new Map(),
        initDB: () => {},
        hashSessionToken: token => crypto.createHash('sha256').update(token).digest('hex'),
        saveUser: user => {
          saves += 1;
          fs.writeFileSync(path.join(environment.MOLAN_DATA_DIR, 'balance.json'), JSON.stringify({ credits: user.credits, spent: user.spent }));
        }
      };
      tokens.push(environment.MOLAN_TOKEN);
      sessions.push(app);
      return app;
    }
  };
  const argv = ['--execute', '--phase', 'P0', '--model', 'fixture-model', '--pipeline-version', 'fixture-v2', '--max-calls', '1', '--out', output];
  return {
    root, output, environment, dependencies, argv, write, tokens, sessions, invocations,
    counts: () => ({ loads, saves, modelCalls }),
    failMain: () => { failMain = true; }
  };
}

test('wrapper续跑复用manifest runtime/端口，保留已扣余额，token不落盘', async context => {
  const setup = fixture(context);
  const previous = structuredClone(setup.environment);
  await runLocalSession(setup.argv, setup.dependencies);
  const manifestFile = path.join(setup.output, 'manifest.json');
  const originalManifest = fs.readFileSync(manifestFile, 'utf8');
  const manifest = JSON.parse(originalManifest);
  const runtime = manifest.config.transport.runtimeDirectory;
  const metadataBytes = fs.readFileSync(path.join(runtime, 'runtime.json'), 'utf8');
  const firstBalance = JSON.parse(fs.readFileSync(path.join(runtime, 'balance.json'), 'utf8'));
  assert.equal(firstBalance.credits, 1000000 - 17);
  await runLocalSession([...setup.argv, '--resume'], setup.dependencies);
  assert.deepEqual(setup.counts(), { loads: 2, saves: 1, modelCalls: 2 });
  assert.equal(fs.readFileSync(manifestFile, 'utf8'), originalManifest);
  assert.equal(fs.readFileSync(path.join(runtime, 'runtime.json'), 'utf8'), metadataBytes);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runtime, 'balance.json'), 'utf8')), { credits: 1000000 - 34, spent: 34 });
  assert.equal(cli.parseArguments(setup.invocations[0])['base-url'], cli.parseArguments(setup.invocations[1])['base-url']);
  assert.notEqual(setup.tokens[0], setup.tokens[1]);
  for (const token of setup.tokens) {
    assert.ok(!originalManifest.includes(token) && !metadataBytes.includes(token));
  }
  assert.deepEqual(setup.environment, previous);
  assert.ok(setup.sessions.every(app => !app.server.listening && app.sessions.size === 0));
  assert.equal(fs.existsSync(path.join(runtime, 'session.lock')), false);
});

test('unknown/in_flight续跑不启动服务、不重新生成、不重置余额', async context => {
  const setup = fixture(context);
  await runLocalSession(setup.argv, setup.dependencies);
  for (const status of ['in_flight', 'uncertain', 'unknown', 'failed', 'audit_failed']) {
    const store = cli.createCheckpointStore(setup.output);
    store.state.records[0].status = status;
    store.saveCheckpoint(store.state);
    const result = await runLocalSession([...setup.argv, '--resume'], setup.dependencies);
    assert.equal(result.records[0].status, status);
    assert.deepEqual(setup.counts(), { loads: 1, saves: 1, modelCalls: 1 });
  }
});

test('冻结端口被占用时不选新端口、不碰占用服务、不加载server', async context => {
  const setup = fixture(context);
  await runLocalSession(setup.argv, setup.dependencies);
  const manifest = cli.readFrozenManifest(setup.output, setup.root);
  const port = Number(new URL(manifest.config.transport.baseUrl).port);
  const occupyingServer = http.createServer();
  await new Promise((resolve, reject) => {
    occupyingServer.once('error', reject);
    occupyingServer.listen(port, '127.0.0.1', resolve);
  });
  try {
    await assert.rejects(runLocalSession([...setup.argv, '--resume'], setup.dependencies), { code: 'EADDRINUSE' });
    assert.equal(occupyingServer.listening, true);
    assert.deepEqual(setup.counts(), { loads: 1, saves: 1, modelCalls: 1 });
    assert.equal(fs.existsSync(path.join(manifest.config.transport.runtimeDirectory, 'session.lock')), false);
  } finally {
    await new Promise(resolve => occupyingServer.close(resolve));
  }
});

test('runtime目录越界、同级前缀、根目录、相对路径和junction拒绝', context => {
  const setup = fixture(context);
  const allowed = path.join(setup.root, 'data', 'benchmark-local-runtime');
  fs.mkdirSync(allowed, { recursive: true });
  for (const directory of [allowed, path.join(setup.root, 'data'), `${allowed}-other/child`, '../escape']) {
    assert.throws(() => cli.validateRuntimeDirectory(directory, setup.root, false), /runtime/);
  }
  const outside = path.join(setup.root, 'elsewhere');
  fs.mkdirSync(outside);
  const junction = path.join(allowed, 'jump');
  fs.symlinkSync(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => cli.validateRuntimeDirectory(path.join(junction, 'child'), setup.root, false), /junction/);
  assert.throws(() => cli.validateRuntimeDirectory(path.join(allowed, 'gone'), setup.root), /不存在/);
});

test('runtime元数据不匹配或目录消失时不创建新runtime/余额', async context => {
  const setup = fixture(context);
  await runLocalSession(setup.argv, setup.dependencies);
  const manifest = cli.readFrozenManifest(setup.output, setup.root);
  const filename = path.join(manifest.config.transport.runtimeDirectory, 'runtime.json');
  const metadata = JSON.parse(fs.readFileSync(filename, 'utf8'));
  metadata.port += 1;
  fs.writeFileSync(filename, JSON.stringify(metadata));
  await assert.rejects(runLocalSession([...setup.argv, '--resume'], setup.dependencies), /指针/);
  assert.deepEqual(setup.counts(), { loads: 1, saves: 1, modelCalls: 1 });
});

test('已有session.lock保留不删除，不自动抢锁或启动服务', async context => {
  const setup = fixture(context);
  await runLocalSession(setup.argv, setup.dependencies);
  const manifest = cli.readFrozenManifest(setup.output, setup.root);
  const lock = path.join(manifest.config.transport.runtimeDirectory, 'session.lock');
  fs.writeFileSync(lock, 'existing-lock');
  await assert.rejects(runLocalSession([...setup.argv, '--resume'], setup.dependencies), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(lock, 'utf8'), 'existing-lock');
  assert.deepEqual(setup.counts(), { loads: 1, saves: 1, modelCalls: 1 });
});

test('wrapper异常关闭自己的服务/临时会话并还原全部环境', async context => {
  const setup = fixture(context);
  const previous = structuredClone(setup.environment);
  setup.failMain();
  await assert.rejects(runLocalSession(setup.argv, setup.dependencies), /interrupted/);
  assert.deepEqual(setup.environment, previous);
  assert.ok(setup.sessions.every(app => !app.server.listening && app.sessions.size === 0));
});

test('dryrun、外部base-url、未指定out的resume不会启动server', async context => {
  const setup = fixture(context);
  const dry = await runLocalSession(['--dry-run'], setup.dependencies);
  assert.equal(dry.status, 'not_executed');
  await assert.rejects(runLocalSession([...setup.argv, '--base-url', 'http://127.0.0.1:3000'], setup.dependencies), /已有服务/);
  await assert.rejects(runLocalSession(['--execute', '--resume'], setup.dependencies), /原目录/);
  assert.deepEqual(setup.counts(), { loads: 0, saves: 0, modelCalls: 0 });
});

test('manifest覆盖server/loader/scope和18题材资产，逐一变更均阻止续跑', context => {
  const setup = fixture(context);
  const plan = { phase: 'P0' };
  const config = { model: 'fixture' };
  const manifest = cli.freezeManifest(setup.output, plan, config, setup.root);
  assert.equal(manifest.hashCoverageVersion, 2);
  for (const name of ['server.js', 'lib/genre-evidence.js', 'lib/genre-rule-scope.js', ...cli.GENRE_ASSET_FILES]) {
    assert.match(manifest.implementationHashes[name], /^[a-f0-9]{64}$/);
    const filename = path.join(setup.root, name);
    const original = fs.readFileSync(filename, 'utf8');
    fs.writeFileSync(filename, `${original}-changed`);
    assert.throws(() => cli.freezeManifest(setup.output, plan, config, setup.root), /哈希变化/);
    fs.writeFileSync(filename, original);
  }
  assert.equal(cli.readFrozenManifest(setup.output, setup.root).manifestHash, manifest.manifestHash);
});

test('资产删除、缺失后补齐及新增baseline别名均导致哈希不一致', context => {
  const setup = fixture(context);
  const asset = cli.GENRE_ASSET_FILES[0];
  const filename = path.join(setup.root, asset);
  fs.unlinkSync(filename);
  const manifest = cli.freezeManifest(setup.output, {}, {}, setup.root);
  assert.equal(manifest.implementationHashes[asset], null);
  fs.writeFileSync(filename, 'new asset');
  assert.throws(() => cli.readFrozenManifest(setup.output, setup.root), /哈希变化/);
  fs.unlinkSync(filename);
  const alias = setup.write('data/genre-baselines/悬疑诡秘.json', '{}');
  assert.throws(() => cli.readFrozenManifest(setup.output, setup.root), /哈希变化/);
  fs.unlinkSync(alias);
  const existing = path.join(setup.root, cli.GENRE_ASSET_FILES[1]);
  fs.unlinkSync(existing);
  assert.throws(() => cli.readFrozenManifest(setup.output, setup.root), /哈希变化/);
});

test('旧覆盖不足manifest拒绝原地升级，原文件不覆盖', context => {
  const setup = fixture(context);
  const manifest = cli.freezeManifest(setup.output, {}, {}, setup.root);
  delete manifest.hashCoverageVersion;
  delete manifest.implementationHashes['server.js'];
  const { manifestHash: unused, ...body } = manifest;
  manifest.manifestHash = experiments.hashValue(body);
  const filename = path.join(setup.output, 'manifest.json');
  const original = JSON.stringify(manifest);
  fs.writeFileSync(filename, original);
  assert.throws(() => cli.freezeManifest(setup.output, {}, {}, setup.root), /覆盖不足/);
  assert.equal(fs.readFileSync(filename, 'utf8'), original);
});

test('版本或资产漂移在wrapper加载server前拒绝', async context => {
  const setup = fixture(context);
  await runLocalSession(setup.argv, setup.dependencies);
  setup.write('lib/genre-evidence.js', 'changed loader');
  await assert.rejects(runLocalSession([...setup.argv, '--resume'], setup.dependencies), /哈希变化/);
  assert.deepEqual(setup.counts(), { loads: 1, saves: 1, modelCalls: 1 });
});

test('CLI参数来源明确pipeline-request，不声称供应商已按实际参数执行', () => {
  const { config } = cli.loadFixedInputs('P0');
  assert.match(config.parameterSource, /pipeline-request/);
  assert.match(config.parameterSource, /not independently verified/);
  assert.match(config.parameterLimitations, /不证明供应商/);
  assert.equal(config.parameters.seed, null);
  assert.equal(config.parameters.topP, null);
});
