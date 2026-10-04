'use strict';

function assertNoLegacyAppData({ fs, path, dataDir, resetLegacy = false }) {
  for (const filename of ['molan.db', 'molan.db-wal', 'users.json', 'novels.json']) {
    const target = path.join(dataDir, filename);
    if (!fs.existsSync(target) || !fs.statSync(target).size) continue;
    if (filename.endsWith('.json')) {
      const content = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (Array.isArray(content) ? !content.length : content && typeof content === 'object' && !Object.keys(content).length) continue;
    }
    if (resetLegacy) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.rmSync(target + suffix, { force: true }); } catch (_) {}
      }
      continue;
    }
    throw Object.assign(new Error(`Native JSON storage cannot ignore legacy authoritative data: ${target}`), {
      code: 'LEGACY_APP_DATA_REQUIRES_MIGRATION'
    });
  }
}

function createNativeDomainService({
  postgresqlMode,
  appStore,
  dataDir,
  path,
  maxNovelsPerUser,
  maxNovelStateBytes,
  guardNovelWrite,
  onNovelChanged,
  postgresRepository,
  appRepositoryFactory,
  createMemoryStore,
  createNativeBillingService,
  createNativeAuthService,
  crypto,
  readBody,
  json,
  respondError,
  createPasswordRecord,
  verifyPassword,
  hashSessionToken,
  allowAuthAttempt,
  isAdminUser,
  normalizeAvatar,
  findPlatformModel,
  canChooseModel,
  currentDefaultModel,
  sessionTtlMs,
  creditCostForUser,
  roundCreditValue,
  toTokenCount,
  matchesTokenUsageReservation,
  normalizeUserRole,
  storedAvatar,
  buildUsageSummary,
  publicUsageRow,
  novelListSummary
}) {
  let repository;
  let auth;
  let billing;
  let memory;

  function appRepository() {
    if (!repository) repository = appRepositoryFactory(path.join(dataDir, 'app-json'), {
      maxNovelsPerUser, maxNovelStateBytes, guardNovelWrite, onNovelChanged
    });
    return repository;
  }

  function memoryDomainStore() {
    if (!postgresqlMode && appStore !== 'json') return null;
    if (!memory) memory = createMemoryStore(postgresqlMode
      ? { backend: 'postgres', repository: postgresRepository }
      : { backend: 'json', repository: appRepository().repository,
          getAccess: input => appRepository().getAccess(input) });
    return memory;
  }

  function nativeBillingService() {
    if (!billing) billing = createNativeBillingService({
      repository: appRepository(), isAdminUser, creditCostForUser,
      roundCreditValue, toTokenCount, matchesTokenUsageReservation
    });
    return billing;
  }

  function nativeAuthService() {
    if (!auth) auth = createNativeAuthService({
      repository: appRepository(), crypto, readBody, json, respondError,
      createPasswordRecord, verifyPassword, hashSessionToken,
      publicUser: nativePublicUser, allowAuthAttempt, isAdminUser, normalizeAvatar,
      findPlatformModel, canChooseModel, currentDefaultModel, sessionTtlMs
    });
    return auth;
  }

  async function nativeUsageSummary(userId, limit = 0) {
    const rows = await appRepository().summarizeTokenUsage({ userId });
    const usageRows = rows.map(row => ({ ...row.usage, creditCost: row.actualCost, reservedCost: row.reservedCost }));
    const summary = buildUsageSummary(usageRows);
    if (limit) summary.recent = usageRows.slice(0, limit).map(publicUsageRow);
    return summary;
  }

  async function nativePublicUser(user) {
    const role = normalizeUserRole(user);
    const admin = role === 'admin';
    return { userId: user.userId, email: user.email, name: user.name, avatar: storedAvatar(user.avatar),
      bio: String(user.bio || ''), defaultModel: String(user.defaultModel || ''), role, level: role, plan: role,
      costMultiplier: admin ? 0 : role === 'vip' ? 1 : 2, isAdmin: admin, unlimitedCredits: admin,
      credits: admin ? null : user.credits, spent: Math.round(Number(user.spent || 0) * 100) / 100,
      createdAt: user.createdAt, usage: await nativeUsageSummary(user.userId) };
  }

  function summarizeNativeNovel(novel) {
    return novelListSummary({ id: novel.id, workspace_id: novel.workspaceId, project_id: novel.projectId,
      title: novel.title, state_json: JSON.stringify(novel.state), word_count: novel.wordCount,
      created_at: novel.createdAt, updated_at: novel.updatedAt, revision: novel.revision,
      state_bytes: Buffer.byteLength(JSON.stringify(novel.state), 'utf8') });
  }

  return { appRepository, memoryDomainStore, nativeBillingService, nativeAuthService,
    nativeUsageSummary, nativePublicUser, summarizeNativeNovel,
    close: () => repository ? repository.close() : Promise.resolve() };
}

module.exports = { createNativeDomainService, assertNoLegacyAppData };
