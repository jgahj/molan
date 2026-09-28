import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgresRepository } = require('../lib/postgres-repository.js');

function runNodeProcess(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(import.meta.dirname, 'postgres-multi-instance-smoke.mjs'), ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      let result = null;
      try { result = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).pop() || 'null'); } catch (_) {}
      resolve({ code, result, stderr: stderr.slice(-500) });
    });
  });
}

async function saveProfileInChild(encodedInput) {
  const input = JSON.parse(Buffer.from(encodedInput, 'base64url').toString('utf8'));
  const repository = createPostgresRepository(process.env);
  try {
    const saved = await repository.saveProfile(input);
    process.stdout.write(JSON.stringify({ ok: true, revision: saved.revision }) + '\n');
  } catch (error) {
    const code = String(error && error.code || 'postgres_child_save_failed');
    process.stdout.write(JSON.stringify({ ok: false, code }) + '\n');
    if (code !== 'revision_conflict') process.exitCode = 1;
  } finally {
    await repository.close();
  }
}

/** 使用两个独立连接池验证并发 CAS、撤权和连接作用域清理。 */
async function main() {
  const firstRepository = createPostgresRepository(process.env);
  const secondRepository = createPostgresRepository(process.env);
  if (!firstRepository.enabled || !secondRepository.enabled) throw new Error('未配置 PostgreSQL');
  const suffix = Date.now().toString(36);
  const owner = `usr_pg_multi_owner_${suffix}`;
  const editor = `usr_pg_multi_editor_${suffix}`;
  const workspaceId = `ws_pg_multi_${suffix}`;
  const projectId = `n_pg_multi_${suffix}`;
  const state = { title: '多实例并发作品', volumes: [] };
  const authTokenHash = `a${crypto.createHash('sha256').update(`auth-${suffix}`, 'utf8').digest('hex').slice(1)}`;
  const authEvents = [];
  try {
    await firstRepository.subscribeAuthSessionInvalidation(event => authEvents.push(event));
    await secondRepository.createAuthSession({
      sessionId: crypto.randomUUID(),
      userId: owner,
      legacyId: owner,
      tokenHash: authTokenHash,
      scope: 'client',
      expiresAt: Date.now() + 600000
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!authEvents.some(event => event.event === 'created' && event.tokenHash === authTokenHash)) throw new Error('共享会话创建通知未同步');
    if (!(await firstRepository.listAuthSessions()).some(session => session.tokenHash === authTokenHash)) throw new Error('第二连接池未读取共享会话');
    await secondRepository.revokeAuthSession(authTokenHash);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!authEvents.some(event => event.event === 'revoked' && event.tokenHash === authTokenHash)) throw new Error('共享会话撤销通知未同步');
    if ((await firstRepository.listAuthSessions()).some(session => session.tokenHash === authTokenHash)) throw new Error('共享会话撤销未生效');

    await firstRepository.saveProfile({ userId: owner, workspaceId, projectId, title: state.title, state });
    if (await secondRepository.getProfile(editor, projectId, workspaceId)) throw new Error('第二连接池越权读取');
    await firstRepository.upsertWorkspaceMember(owner, workspaceId, editor, 'member');
    await firstRepository.upsertProjectMember(owner, workspaceId, projectId, editor, 'editor', false, false, false, null);
    const ownerRead = await firstRepository.getProfile(owner, projectId, workspaceId);
    const editorRead = await secondRepository.getProfile(editor, projectId, workspaceId);
    if (!ownerRead || !editorRead || editorRead.access.role !== 'editor') throw new Error('第二连接池授权读取失败');
    const concurrent = await Promise.allSettled([
      firstRepository.saveProfile({
        userId: owner,
        workspaceId,
        projectId,
        title: 'owner update',
        state: { ...state, title: 'owner update' },
        expectedRevision: ownerRead.revision
      }),
      secondRepository.saveProfile({
        userId: editor,
        workspaceId,
        projectId,
        title: 'editor update',
        state: { ...state, title: 'editor update' },
        expectedRevision: editorRead.revision
      })
    ]);
    const succeeded = concurrent.filter(result => result.status === 'fulfilled' && result.value && result.value.ok);
    const conflicts = concurrent.filter(result => result.status === 'rejected' && String(result.reason && result.reason.code || '') === 'revision_conflict');
    if (succeeded.length !== 1 || conflicts.length !== 1) throw new Error('双连接池 CAS 竞争未形成一胜一冲突');
    await firstRepository.deactivateProjectMember(owner, workspaceId, projectId, editor);
    if (await secondRepository.getProfile(editor, projectId, workspaceId)) throw new Error('撤权后第二连接池仍可读取');
    const processBase = await firstRepository.getProfile(owner, projectId, workspaceId);
    const processInputs = ['独立进程 A 保存', '独立进程 B 保存'].map(title => Buffer.from(JSON.stringify({
      userId: owner,
      workspaceId,
      projectId,
      title,
      state: { ...processBase.state, title },
      expectedRevision: processBase.revision
    }), 'utf8').toString('base64url'));
    const processResults = await Promise.all(processInputs.map(encoded => runNodeProcess(['--save-profile', encoded])));
    if (processResults.some(result => result.code !== 0 || !result.result)) {
      throw new Error('独立 Node 进程写入失败：' + JSON.stringify(processResults.map(result => ({ code: result.code, result: result.result, stderr: result.stderr }))));
    }
    const processSuccesses = processResults.filter(result => result.result.ok && result.result.revision === processBase.revision + 1);
    const processConflicts = processResults.filter(result => !result.result.ok && result.result.code === 'revision_conflict');
    if (processSuccesses.length !== 1 || processConflicts.length !== 1) throw new Error('独立 Node 进程 CAS 未形成一胜一冲突');
    const healthA = await firstRepository.health();
    const healthB = await secondRepository.health();
    if (!healthA.available || !healthB.available) throw new Error('两个连接池健康检查失败');
    process.stdout.write(JSON.stringify({
      ok: true,
      workspaceId,
      projectId,
      checks: ['two-pools', 'independent-node-process-cas', 'shared-session-revocation', 'cross-pool-isolation', 'concurrent-cas', 'revocation', 'health']
    }) + '\n');
  } finally {
    await Promise.all([firstRepository.close(), secondRepository.close()]);
  }
}

const childPayload = process.argv[2] === '--save-profile' ? process.argv[3] : '';
const execution = childPayload ? saveProfileInChild(childPayload) : main();
execution.catch(error => {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: String(error && error.code || 'postgres_multi_instance_failed'),
    error: String(error && error.message || 'PostgreSQL 多实例烟测失败')
  }) + '\n');
  process.exitCode = 1;
});
