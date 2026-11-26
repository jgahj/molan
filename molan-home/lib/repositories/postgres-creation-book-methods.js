'use strict';

const crypto = require('node:crypto');
const { hashValue } = require('../generation/manifest');

/**
 * PostgreSQL 创作书（Creation Book / Bible / Causal Debt / Chapter Audit & Commit）子仓储方法集。
 * 自 lib/postgres-repository.js 领域化拆出，所有 SQL 均通过父仓储注入的事务边界执行。
 */
function createPostgresCreationBookMethods({
  PROJECT_WRITE_ROLES,
  UUID_PATTERN,
  internalUuid,
  normalizeLegacyId,
  repositoryError,
  parseJsonValue,
  parseJsonDocument,
  jsonHash,
  hasRole,
  withTransaction,
  ensureActor,
  accessForClient,
  ensureScope,
  publicJob
}) {
  /** 将 PG 创作书行转换为现有创书界面使用的稳定对象。 */
  function publicCreationBook(row) {
    if (!row) return null;
    const plan = parseJsonValue(row.plan);
    return {
      id: String(row.legacy_id || row.id || ''),
      title: String(row.title || ''),
      novelId: String(row.project_legacy_id || row.project_id || ''),
      bibleId: String(row.bible_legacy_id || ''),
      sourceBriefId: String(row.source_brief_id || ''),
      currentStateVersion: Number(row.current_state_version) || 0,
      currentChapterNo: Number(row.current_chapter_no) || 0,
      status: String(row.status || 'draft'),
      budgetLimit: Number(row.budget_limit) || 0,
      spentCost: Number(row.spent_cost) || 0,
      plan,
      ownerUserId: String(row.owner_legacy_id || row.owner_user_id || ''),
      workspaceId: String(row.workspace_legacy_id || row.workspace_id || ''),
      projectId: String(row.project_legacy_id || row.project_id || ''),
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : 0
    };
  }

  /** 查询当前 actor 可见的创作书和其项目作用域。 */
  async function creationBookForClient(client, bookId, lock = false) {
    const result = await client.query(
      `SELECT cb.*, p.legacy_id AS project_legacy_id, w.legacy_id AS workspace_legacy_id,
              owner_user.legacy_id AS owner_legacy_id,
              bible.legacy_id AS bible_legacy_id, bible.revision AS bible_revision
       FROM luna.creation_books cb
       JOIN luna.projects p ON p.workspace_id = cb.workspace_id AND p.id = cb.project_id
       JOIN luna.workspaces w ON w.id = cb.workspace_id
       LEFT JOIN luna.users owner_user ON owner_user.id = cb.owner_user_id
       LEFT JOIN LATERAL (
         SELECT legacy_id, revision
         FROM luna.creation_bibles
         WHERE workspace_id = cb.workspace_id AND project_id = cb.project_id AND book_id = cb.id
         ORDER BY revision DESC
         LIMIT 1
       ) bible ON true
       WHERE cb.id = $1::uuid
       LIMIT 1${lock ? ' FOR UPDATE OF cb' : ''}`,
      [internalUuid(normalizeLegacyId(bookId, 'bookId'))]
    );
    return result.rows[0] || null;
  }

  /** 在已有项目事务中创建创书占位，供创书任务与预算预占共用同一事务。 */
  async function ensureCreationBookPlaceholderForClient(client, scope, input) {
    const bookId = normalizeLegacyId(input.bookId, 'bookId');
    const title = String(input.title || '未命名小说').trim().slice(0, 200) || '未命名小说';
    const plan = input.plan && typeof input.plan === 'object' && !Array.isArray(input.plan) ? input.plan : {};
    const current = await client.query(
      `SELECT owner_user_id
       FROM luna.creation_books
       WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
       FOR UPDATE`,
      [scope.workspaceUuid, scope.projectUuid, internalUuid(bookId)]
    );
    if (current.rows.length) {
      if (String(current.rows[0].owner_user_id) !== internalUuid(input.userId)) {
        throw repositoryError('resource_conflict', '创作书标识已绑定其他项目', 409);
      }
      return;
    }
    await client.query(
      `INSERT INTO luna.creation_books
        (workspace_id, project_id, id, legacy_id, owner_user_id, title, status, plan,
         revision, source_brief_id, budget_limit, spent_cost)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, 'generating', $7::jsonb,
               1, $8::text, $9::numeric, 0)`,
      [
        scope.workspaceUuid, scope.projectUuid, internalUuid(bookId), bookId,
        internalUuid(input.userId), title, JSON.stringify(plan),
        String(input.sourceBriefId || '').slice(0, 160), Number(input.budgetLimit) || 0
      ]
    );
  }

  /** 在创建任务事务内预占额度；任务失败/未知由 worker 终态函数释放或保留。 */
  async function reserveJobBudgetForClient(client, scope, jobId, input) {
    const reservation = input && input.budgetReservation && typeof input.budgetReservation === 'object'
      ? input.budgetReservation : null;
    if (!reservation) return null;
    const amountMinor = Math.max(0, Math.floor(Number(reservation.amountMinor) || 0));
    if (amountMinor < 1) throw repositoryError('invalid_amount', '任务预算预占金额必须为正整数', 422);
    if (!scope.access.can_spend) throw repositoryError('spend_forbidden', '当前账户没有任务支出权限', 403);
    const reservationId = normalizeLegacyId(reservation.reservationId || `reservation:${jobId}`, 'reservationId');
    const periodStart = String(reservation.periodStart || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const parsedPeriodStart = Date.parse(`${periodStart}T00:00:00Z`);
    if (!Number.isFinite(parsedPeriodStart)) throw repositoryError('invalid_period', '预算周期开始日期无效', 422);
    const periodEnd = String(reservation.periodEnd || new Date(parsedPeriodStart + 86400000).toISOString().slice(0, 10)).slice(0, 10);
    if (periodEnd <= periodStart) throw repositoryError('invalid_period', '预算周期结束日期必须晚于开始日期', 422);
    const existing = await client.query(
      `SELECT id, amount_minor, state
       FROM luna.budget_reservations
       WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND job_id = $3::uuid
       FOR UPDATE`,
      [scope.workspaceUuid, scope.projectUuid, internalUuid(jobId)]
    );
    if (existing.rows.length) {
      if (Number(existing.rows[0].amount_minor) !== amountMinor) {
        throw repositoryError('idempotency_conflict', '同一创书任务的预算预占金额不一致', 409);
      }
      return {
        id: String(reservationId), amountMinor, state: String(existing.rows[0].state || ''), idempotent: true
      };
    }
    let budget = await client.query(
      `SELECT *
       FROM luna.budgets
       WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND period_start = $3::date
       FOR UPDATE`,
      [scope.workspaceUuid, scope.projectUuid, periodStart]
    );
    if (!budget.rows.length) {
      const limitMinor = Math.max(0, Math.floor(Number(reservation.limitMinor) || 0));
      if (!limitMinor) throw repositoryError('budget_missing', '项目预算尚未设置', 409);
      await client.query(
        `INSERT INTO luna.budgets
          (workspace_id, project_id, period_start, period_end, limit_minor, currency)
         VALUES ($1::uuid, $2::uuid, $3::date, $4::date, $5::bigint, $6::text)`,
        [scope.workspaceUuid, scope.projectUuid, periodStart, periodEnd, limitMinor, String(reservation.currency || 'CREDIT').slice(0, 20)]
      );
      budget = await client.query(
        `SELECT *
         FROM luna.budgets
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND period_start = $3::date
         FOR UPDATE`,
        [scope.workspaceUuid, scope.projectUuid, periodStart]
      );
    }
    const usage = await client.query(
      `SELECT
         coalesce((SELECT sum(bl.amount_minor)
           FROM luna.billing_ledger bl
           JOIN luna.budget_reservations charged
             ON charged.workspace_id = bl.workspace_id
            AND charged.project_id = bl.project_id
            AND charged.id = bl.reservation_id
           WHERE bl.workspace_id = $1::uuid AND bl.project_id = $2::uuid
             AND bl.entry_type = 'charge' AND charged.period_start = $3::date), 0)::bigint AS used_minor,
         coalesce((SELECT sum(amount_minor)
           FROM luna.budget_reservations
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid
             AND state = 'reserved' AND period_start = $3::date), 0)::bigint AS reserved_minor`,
      [scope.workspaceUuid, scope.projectUuid, periodStart]
    );
    const usedMinor = Number(usage.rows[0] && usage.rows[0].used_minor) || 0;
    const reservedMinor = Number(usage.rows[0] && usage.rows[0].reserved_minor) || 0;
    const limitMinor = Number(budget.rows[0] && budget.rows[0].limit_minor) || 0;
    if (usedMinor + reservedMinor + amountMinor > limitMinor) {
      throw repositoryError('budget_exceeded', '本次任务预算预占超过项目额度', 402);
    }
    await client.query(
      `INSERT INTO luna.budget_reservations
        (workspace_id, project_id, id, job_id, amount_minor, state, period_start)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, 'reserved', $6::date)`,
      [scope.workspaceUuid, scope.projectUuid, internalUuid(reservationId), internalUuid(jobId), amountMinor, periodStart]
    );
    return { id: String(reservationId), amountMinor, state: 'reserved', idempotent: false };
  }

  /** 在当前用户的项目RLS事务中提供已解析的创作书作用域。 */
  async function withCreationBookTransaction(input, operation) {
    return withTransaction(input.userId, async client => {
      const actorUuid = await ensureActor(client, input.userId);
      const book = await creationBookForClient(client, input.bookId);
      if (!book) throw repositoryError('not_found', '创作书不存在或当前账户未获授权', 404);
      const access = await accessForClient(client, book.project_id, book.workspace_id);
      if (!access) throw repositoryError('not_found', '创作书不存在或当前账户未获授权', 404);
      if (input.write && !hasRole(access, PROJECT_WRITE_ROLES)) {
        throw repositoryError('forbidden', '当前账户无权修改该作品', 403);
      }
      return operation(client, {
        actorUuid,
        access,
        book,
        bookUuid: String(book.id),
        bookId: String(book.legacy_id || input.bookId),
        workspaceUuid: String(book.workspace_id),
        projectUuid: String(book.project_id),
        workspaceId: String(book.workspace_legacy_id || book.workspace_id),
        projectId: String(book.project_legacy_id || book.project_id)
      });
    });
  }

  /** 按当前用户 RLS 查找记忆运行所属创作书，供独立运行状态路由使用。 */
  async function findStoryMemoryRun(userId, runId) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const result = await client.query(
        `SELECT cb.legacy_id AS book_legacy_id
         FROM luna.story_memory_generation_runs run
         JOIN luna.creation_books cb
           ON cb.workspace_id = run.workspace_id
          AND cb.project_id = run.project_id
          AND cb.id = run.book_id
         WHERE run.id = $1::text
         LIMIT 1`,
        [String(runId || '')]
      );
      return result.rows[0] ? { bookId: String(result.rows[0].book_legacy_id || '') } : null;
    });
  }

  /** 列出当前用户显式加入项目中的创作书。 */
  async function listCreationBooks(userId) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const result = await client.query(
        `SELECT cb.*, p.legacy_id AS project_legacy_id, w.legacy_id AS workspace_legacy_id,
                owner_user.legacy_id AS owner_legacy_id,
                bible.legacy_id AS bible_legacy_id
         FROM luna.creation_books cb
         JOIN luna.projects p ON p.workspace_id = cb.workspace_id AND p.id = cb.project_id
         JOIN luna.workspaces w ON w.id = cb.workspace_id
         LEFT JOIN luna.users owner_user ON owner_user.id = cb.owner_user_id
         LEFT JOIN LATERAL (
           SELECT legacy_id
           FROM luna.creation_bibles
           WHERE workspace_id = cb.workspace_id AND project_id = cb.project_id AND book_id = cb.id
           ORDER BY revision DESC
           LIMIT 1
         ) bible ON true
         WHERE p.status <> 'deleted'
         ORDER BY cb.updated_at DESC`
      );
      return result.rows.map(publicCreationBook);
    });
  }

  /** 在指定项目下创建创作书和首版 Bible，重复请求可安全返回已有版本。 */
  async function createCreationBook(input) {
    const bookId = normalizeLegacyId(input.bookId, 'bookId');
    const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? input.payload : {};
    const title = String(input.title || '未命名小说').trim().slice(0, 200) || '未命名小说';
    const plan = input.plan && typeof input.plan === 'object' && !Array.isArray(input.plan) ? input.plan : {};
    const projectId = normalizeLegacyId(input.projectId || `n_${bookId.replace(/[^A-Za-z0-9]/g, '').slice(0, 28)}`, 'projectId');
    const bibleId = normalizeLegacyId(input.bibleId || `bible_${bookId}`, 'bibleId');
    return withTransaction(input.userId, async client => {
      const scope = await ensureScope(client, {
        userId: input.userId,
        workspaceId: input.workspaceId,
        projectId,
        title
      });
      if (!hasRole(scope.access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权创建创作书', 403);
      let book = await creationBookForClient(client, bookId);
      if (!book) {
        await client.query(
          `INSERT INTO luna.creation_books
            (workspace_id, project_id, id, legacy_id, owner_user_id, title, status, plan,
             revision, source_brief_id, budget_limit, spent_cost)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, 'ready', $7::jsonb,
                   1, $8::text, $9::numeric, $10::numeric)`,
          [
            scope.workspaceUuid, scope.projectUuid, internalUuid(bookId), bookId, internalUuid(input.userId),
            title, JSON.stringify(plan), String(input.sourceBriefId || ''), Number(input.budgetLimit) || 0, Number(input.initialCost) || 0
          ]
        );
        await client.query(
          `INSERT INTO luna.creation_bibles
            (workspace_id, project_id, book_id, legacy_id, revision, payload, payload_hash, changed_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, 1, $5::jsonb, $6::text, $7::uuid)`,
          [
            scope.workspaceUuid, scope.projectUuid, internalUuid(bookId), bibleId,
            JSON.stringify(payload), jsonHash(payload), internalUuid(input.userId)
          ]
        );
      } else {
        if (book.workspace_id !== scope.workspaceUuid || book.project_id !== scope.projectUuid) {
          throw repositoryError('resource_conflict', '创作书标识已绑定其他项目', 409);
        }
      }
      book = await creationBookForClient(client, bookId);
      const bible = await client.query(
        `SELECT revision, legacy_id, payload, payload_hash
         FROM luna.creation_bibles
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid
         ORDER BY revision DESC LIMIT 1`,
        [scope.workspaceUuid, scope.projectUuid, internalUuid(bookId)]
      );
      return {
        ok: true,
        reused: Boolean(book && Number(book.revision) > 1),
        book: publicCreationBook(book),
        bible: bible.rows[0] ? {
          bibleId: String(bible.rows[0].legacy_id || ''),
          version: Number(bible.rows[0].revision) || 1,
          payload: parseJsonValue(bible.rows[0].payload),
          payloadHash: String(bible.rows[0].payload_hash || '')
        } : null
      };
    });
  }

  /** 创建仅含项目范围和规划的创书占位，不伪造空 Bible，供持久任务断点续跑。 */
  async function createCreationBookPlaceholder(input) {
    const bookId = normalizeLegacyId(input.bookId, 'bookId');
    const projectId = normalizeLegacyId(input.projectId || `n_${bookId.replace(/[^A-Za-z0-9]/g, '').slice(0, 28)}`, 'projectId');
    const title = String(input.title || '未命名小说').trim().slice(0, 200) || '未命名小说';
    const plan = input.plan && typeof input.plan === 'object' && !Array.isArray(input.plan) ? input.plan : {};
    return withTransaction(input.userId, async client => {
      const scope = await ensureScope(client, {
        userId: input.userId,
        workspaceId: input.workspaceId,
        projectId,
        title
      });
      if (!hasRole(scope.access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权创建创书任务', 403);
      const current = await client.query(
        `SELECT *
         FROM luna.creation_books
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
         FOR UPDATE`,
        [scope.workspaceUuid, scope.projectUuid, internalUuid(bookId)]
      );
      if (current.rows.length) {
        const row = current.rows[0];
        if (String(row.owner_user_id) !== internalUuid(input.userId)) {
          throw repositoryError('resource_conflict', '创作书标识已绑定其他项目', 409);
        }
        return { ok: true, reused: true, book: publicCreationBook(await creationBookForClient(client, bookId)) };
      }
      await client.query(
        `INSERT INTO luna.creation_books
          (workspace_id, project_id, id, legacy_id, owner_user_id, title, status, plan,
           revision, source_brief_id, budget_limit, spent_cost)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, 'generating', $7::jsonb,
                 1, $8::text, $9::numeric, 0)`,
        [
          scope.workspaceUuid, scope.projectUuid, internalUuid(bookId), bookId, internalUuid(input.userId),
          title, JSON.stringify(plan), String(input.sourceBriefId || '').slice(0, 160),
          Number(input.budgetLimit) || 0
        ]
      );
      return { ok: true, reused: false, book: publicCreationBook(await creationBookForClient(client, bookId)) };
    });
  }

  /** 读取创作书当前 Bible 版本，访问权随项目成员实时校验。 */
  async function getCreationBible(userId, bookId) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const book = await creationBookForClient(client, bookId);
      if (!book) return null;
      const bible = await client.query(
        `SELECT revision, legacy_id, payload, payload_hash
         FROM luna.creation_bibles
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid
         ORDER BY revision DESC LIMIT 1`,
        [book.workspace_id, book.project_id, book.id]
      );
      return {
        book: publicCreationBook({ ...book, bible_legacy_id: bible.rows[0] && bible.rows[0].legacy_id }),
        bible: bible.rows[0] ? {
          bibleId: String(bible.rows[0].legacy_id || ''),
          version: Number(bible.rows[0].revision) || 1,
          payload: parseJsonValue(bible.rows[0].payload),
          payloadHash: String(bible.rows[0].payload_hash || '')
        } : null
      };
    });
  }

  /** 以 Bible revision CAS 保存手工修订，禁止旧版本静默覆盖。 */
  async function putCreationBible(input) {
    const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? input.payload : {};
    const expectedRevision = Number(input.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw repositoryError('revision_required', 'Bible 保存必须提供当前版本', 428);
    const additionalCost = Math.max(0, Number(input.additionalCost) || 0);
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const book = await creationBookForClient(client, input.bookId, true);
      if (!book) throw repositoryError('not_found', '创作书不存在或无权访问', 404);
      const access = await accessForClient(client, book.project_id, book.workspace_id);
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权修改创作圣经', 403);
      if (additionalCost > 0 && !access.can_spend) throw repositoryError('spend_forbidden', '当前账户没有创作任务支出权限', 403);
      const budgetLimit = Math.max(0, Number(book.budget_limit) || 0);
      const spentCost = Math.max(0, Number(book.spent_cost) || 0);
      if (budgetLimit > 0 && spentCost + additionalCost > budgetLimit + 1e-9) {
        throw repositoryError('budget_exceeded', '本次创作圣经变更会超过预算上限', 402);
      }
      const current = await client.query(
        `SELECT revision, legacy_id
         FROM luna.creation_bibles
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid
         ORDER BY revision DESC LIMIT 1
         FOR UPDATE`,
        [book.workspace_id, book.project_id, book.id]
      );
      if (!current.rows.length || Number(current.rows[0].revision) !== expectedRevision) {
        throw repositoryError('revision_conflict', '创作圣经已更新，请重新读取最新版本', 409);
      }
      const nextRevision = expectedRevision + 1;
      await client.query(
        `INSERT INTO luna.creation_bibles
          (workspace_id, project_id, book_id, legacy_id, revision, payload, payload_hash, changed_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::jsonb, $7::text, $8::uuid)`,
        [book.workspace_id, book.project_id, book.id, String(current.rows[0].legacy_id || `bible_${input.bookId}`), nextRevision, JSON.stringify(payload), jsonHash(payload), internalUuid(input.userId)]
      );
      await client.query(
        `UPDATE luna.creation_books
         SET revision = revision + 1, spent_cost = spent_cost + $5::numeric, updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid AND revision = $4::bigint`,
        [book.workspace_id, book.project_id, book.id, book.revision, additionalCost]
      );
      return { ok: true, bibleVersion: nextRevision, payloadHash: jsonHash(payload), additionalCost, spentCost: spentCost + additionalCost };
    });
  }

  /** 将创作书及 Bible 原子关联到另一个有写权限的 PG 项目。 */
  async function linkCreationBook(input) {
    const targetProjectId = normalizeLegacyId(input.targetProjectId, 'projectId');
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const book = await creationBookForClient(client, input.bookId, true);
      if (!book) throw repositoryError('not_found', '创作书不存在或无权访问', 404);
      const sourceAccess = await accessForClient(client, book.project_id, book.workspace_id);
      if (!hasRole(sourceAccess, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权关联创作书', 403);
      const targetAccess = await accessForClient(client, targetProjectId, input.targetWorkspaceId || '');
      if (!hasRole(targetAccess, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权写入目标小说', 403);
      if (String(book.project_id) === String(targetAccess.project_uuid)) {
        return { ok: true, book: publicCreationBook(book), idempotent: true };
      }
      const activeJobs = await client.query(
        `SELECT count(*)::integer AS count
         FROM luna.jobs j
         JOIN luna.job_inputs ji
           ON ji.workspace_id = j.workspace_id AND ji.project_id = j.project_id AND ji.job_id = j.id
         WHERE j.workspace_id = $1::uuid AND j.project_id = $2::uuid
           AND ji.payload->>'bookId' = $3::text
           AND j.state IN ('queued', 'claimed', 'running', 'cancel_requested')`,
        [book.workspace_id, book.project_id, String(book.legacy_id || input.bookId)]
      );
      if (Number(activeJobs.rows[0] && activeJobs.rows[0].count) > 0) {
        throw repositoryError('creation_job_active', '创作任务运行中，完成或对账后才能关联小说', 409);
      }
      const updated = await client.query(
        `UPDATE luna.creation_books
         SET workspace_id = $4::uuid, project_id = $5::uuid, revision = revision + 1, updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
         RETURNING *`,
        [book.workspace_id, book.project_id, book.id, targetAccess.workspace_uuid, targetAccess.project_uuid]
      );
      if (!updated.rows.length) throw repositoryError('revision_conflict', '创作书关联在并发期间发生变化', 409);
      const moved = await creationBookForClient(client, input.bookId);
      return { ok: true, book: publicCreationBook(moved), idempotent: false };
    });
  }

  /** 将 PostgreSQL 因果债务行转换为创作端稳定对象。 */
  function publicCausalDebt(row) {
    if (!row) return null;
    const timestamp = value => value ? new Date(value).getTime() : null;
    return {
      id: String(row.id || ''),
      originChapter: Number(row.origin_chapter) || 1,
      type: String(row.type || 'arc'),
      debtCategory: String(row.debt_category || 'general'),
      seed: String(row.seed || ''),
      immediateCost: String(row.immediate_cost || ''),
      status: String(row.status || 'active'),
      maturationChapter: Number(row.maturation_chapter) || 1,
      payoffTier: Number(row.payoff_tier) || 1,
      suggestedPayoffAction: String(row.suggested_payoff_action || ''),
      redeemedChapter: row.redeemed_chapter == null ? null : Number(row.redeemed_chapter) || 0,
      payoffAction: String(row.payoff_action || ''),
      redeemedAt: timestamp(row.redeemed_at),
      settledReason: String(row.settled_reason || ''),
      settledAt: timestamp(row.settled_at),
      recordedAt: timestamp(row.recorded_at) || Date.now(),
      updatedAt: timestamp(row.updated_at) || Date.now()
    };
  }

  /** 计算因果债务的成熟、微债沉降和容量上限，不依赖文件或 SQLite。 */
  function applyCausalDebtLifecycle(debts, currentChapter) {
    const chapter = Math.max(1, Number(currentChapter) || 1);
    const result = (Array.isArray(debts) ? debts : []).map(debt => ({ ...debt }));
    for (const debt of result) {
      if (debt.status !== 'active' && debt.status !== 'matured') continue;
      if (debt.type === 'micro' && chapter - debt.originChapter > 5) {
        debt.status = 'settled';
        debt.settledReason = '自然沉降为角色生活履历背景';
        continue;
      }
      if (chapter >= debt.maturationChapter) debt.status = 'matured';
    }
    for (const type of ['major', 'arc', 'micro']) {
      const active = result
        .filter(debt => (debt.status === 'active' || debt.status === 'matured') && debt.type === type)
        .sort((left, right) => left.originChapter - right.originChapter || left.recordedAt - right.recordedAt || left.id.localeCompare(right.id));
      const limit = type === 'major' ? 3 : type === 'arc' ? 3 : 3;
      for (const debt of active.slice(0, Math.max(0, active.length - limit))) {
        debt.status = 'settled';
        debt.settledReason = '超出同类因果债务容量，沉降为背景';
      }
    }
    return result;
  }

  /** 查询 PostgreSQL 因果债务，并返回与旧接口兼容的分层视图。 */
  async function getCausalDebts(input) {
    const currentChapter = Math.max(1, Number(input && input.chapterNo) || 1);
    return withCreationBookTransaction({ ...input, write: false }, async (client, scope) => {
      const rows = await client.query(
        `SELECT id, origin_chapter, type, debt_category, seed, immediate_cost, status,
                maturation_chapter, payoff_tier, suggested_payoff_action,
                redeemed_chapter, payoff_action, redeemed_at, settled_reason,
                settled_at, recorded_at, updated_at
         FROM luna.creation_causal_debts
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid
         ORDER BY origin_chapter ASC, recorded_at ASC, id ASC`,
        [scope.workspaceUuid, scope.projectUuid, scope.bookUuid]
      );
      const allDebts = applyCausalDebtLifecycle(rows.rows.map(publicCausalDebt), currentChapter);
      const active = allDebts.filter(debt => debt.status === 'active');
      const matured = allDebts.filter(debt => debt.status === 'matured');
      return {
        allDebts,
        active,
        matured,
        allActiveCount: active.length + matured.length,
        majorDebts: active.filter(debt => debt.type === 'major').concat(matured.filter(debt => debt.type === 'major')),
        arcDebts: active.filter(debt => debt.type === 'arc').concat(matured.filter(debt => debt.type === 'arc')),
        microDebts: active.filter(debt => debt.type === 'micro').concat(matured.filter(debt => debt.type === 'micro'))
      };
    });
  }

  /** 在 PostgreSQL 中新增一项因果债务，并在同一事务内执行容量治理。 */
  async function recordCausalDebt(input) {
    const seed = String(input && (input.seed || input.description) || '').trim().slice(0, 2000);
    if (!seed) throw repositoryError('debt_invalid', '因果债务必须包含 seed 描述', 422);
    const type = ['major', 'arc', 'micro'].includes(String(input.type || '')) ? String(input.type) : 'arc';
    const originChapter = Math.max(1, Number(input.originChapter || input.chapter || input.chapterNum) || 1);
    const debtId = normalizeLegacyId(input.id || `debt_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`, 'debtId');
    const maturationChapter = Math.max(1, Number(input.maturationChapter) || (type === 'major' ? originChapter + 25 : type === 'arc' ? originChapter + 10 : originChapter + 3));
    const recordedAt = Number(input.recordedAt);
    return withCreationBookTransaction({ ...input, write: true }, async (client, scope) => {
      const inserted = await client.query(
        `INSERT INTO luna.creation_causal_debts
          (workspace_id, project_id, book_id, id, origin_chapter, type, debt_category,
           seed, immediate_cost, status, maturation_chapter, payoff_tier,
           suggested_payoff_action, recorded_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::integer, $6::text, $7::text,
                 $8::text, $9::text, 'active', $10::integer, $11::integer, $12::text,
                 COALESCE($13::timestamptz, now()), now())
         RETURNING *`,
        [
          scope.workspaceUuid, scope.projectUuid, scope.bookUuid, debtId, originChapter, type,
          String(input.debtCategory || input.category || 'general').slice(0, 80), seed,
          String(input.immediateCost || input.stakes || '').slice(0, 1000), maturationChapter,
          Math.max(1, Number(input.payoffTier) || (type === 'major' ? 3 : type === 'arc' ? 2 : 1)),
          String(input.suggestedPayoffAction || '').slice(0, 1000),
          Number.isFinite(recordedAt) && recordedAt > 0 ? new Date(recordedAt) : null
        ]
      );
      const result = applyCausalDebtLifecycle([publicCausalDebt(inserted.rows[0])], originChapter);
      if (result[0].status === 'settled') {
        await client.query(
          `UPDATE luna.creation_causal_debts
           SET status = 'settled', settled_reason = $4::text, settled_at = now(), updated_at = now()
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid AND id = $5::text`,
          [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, result[0].settledReason, debtId]
        );
      }
      return { ok: true, debt: result[0] };
    });
  }

  /** 在 PostgreSQL 中平账一项尚未结束的因果债务。 */
  async function settleCausalDebt(input) {
    const debtId = normalizeLegacyId(input && input.debtId, 'debtId');
    const reason = String(input && (input.reason || input.settledReason) || '已平账').slice(0, 1000);
    return withCreationBookTransaction({ ...input, write: true }, async (client, scope) => {
      const updated = await client.query(
        `UPDATE luna.creation_causal_debts
         SET status = 'settled', settled_reason = $4::text, settled_at = now(), updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid
           AND id = $5::text AND status IN ('active', 'matured')
         RETURNING *`,
        [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, reason, debtId]
      );
      return updated.rows.length ? { ok: true, debt: publicCausalDebt(updated.rows[0]) } : null;
    });
  }

  /** 读取创作书状态快照，正文提交状态与 Bible 版本分开返回。 */
  async function getCreationState(userId, bookId, chapterNo = 0) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const book = await creationBookForClient(client, bookId);
      if (!book) return null;
      const bible = await client.query(
        `SELECT revision, legacy_id, payload, payload_hash
         FROM luna.creation_bibles
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid
         ORDER BY revision DESC LIMIT 1`,
        [book.workspace_id, book.project_id, book.id]
      );
      const snapshots = await client.query(
        `SELECT id, legacy_id, bible_revision, state_revision, payload, created_at
         FROM luna.context_snapshots
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND ($3::integer = 0 OR COALESCE(NULLIF(payload->>'chapterNo', ''), '0')::integer <= $3::integer)
         ORDER BY state_revision DESC
         LIMIT 200`,
        [book.workspace_id, book.project_id, Math.max(0, Number(chapterNo) || 0)]
      );
      return {
        book: publicCreationBook({ ...book, bible_legacy_id: bible.rows[0] && bible.rows[0].legacy_id }),
        bible: bible.rows[0] ? {
          bibleId: String(bible.rows[0].legacy_id || ''),
          version: Number(bible.rows[0].revision) || 1,
          payload: parseJsonValue(bible.rows[0].payload),
          payloadHash: String(bible.rows[0].payload_hash || '')
        } : null,
        snapshots: snapshots.rows.map(row => ({
          id: String(row.legacy_id || row.id),
          internalId: String(row.id),
          bibleVersion: Number(row.bible_revision) || 0,
          stateVersion: Number(row.state_revision) || 0,
          ...parseJsonValue(row.payload),
          createdAt: row.created_at ? new Date(row.created_at).getTime() : 0
        }))
      };
    });
  }

  /** Read persisted audit evidence for this book, never infer quality from snapshots. */
  async function getCreationQualityReport(userId, bookId) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const book = await creationBookForClient(client, bookId);
      if (!book) return null;
      const audits = await client.query(
        `SELECT a.id, a.subject_hash, a.result, a.chapter_no, a.created_at
         FROM luna.audits a
         LEFT JOIN luna.generation_runs g
           ON g.workspace_id = a.workspace_id AND g.project_id = a.project_id AND g.id = a.generation_id
         WHERE a.workspace_id = $1::uuid AND a.project_id = $2::uuid
           AND (COALESCE(g.input->>'creationBookId', g.input->>'bookId') = $3::text
             OR (a.generation_id IS NULL AND a.result->>'bookId' = $3::text))
         ORDER BY a.created_at ASC, a.id ASC`,
        [book.workspace_id, book.project_id, String(book.legacy_id)]
      );
      const records = audits.rows.map(row => ({ id: String(row.id), contentHash: String(row.subject_hash),
        chapterNo: Number(row.chapter_no ?? row.result?.chapterNo),
        createdAt: new Date(row.created_at).getTime(), evidence: parseJsonDocument(row.result) || {} }));
      return require('../creation-quality-report').buildCreationQualityReport(records);
    });
  }

  /** 读取项目创作域导出数据，保留版本、任务输入和迁移兼容负载。 */
  async function getCreationPackageData(userId, projectId, workspaceId = '') {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const access = await accessForClient(client, projectId, workspaceId);
      if (!access) return null;
      const books = await client.query(
        `SELECT cb.*, p.legacy_id AS project_legacy_id, w.legacy_id AS workspace_legacy_id,
                owner_user.legacy_id AS owner_legacy_id,
                bible.legacy_id AS bible_legacy_id
         FROM luna.creation_books cb
         JOIN luna.projects p ON p.workspace_id = cb.workspace_id AND p.id = cb.project_id
         JOIN luna.workspaces w ON w.id = cb.workspace_id
         LEFT JOIN luna.users owner_user ON owner_user.id = cb.owner_user_id
         LEFT JOIN LATERAL (
           SELECT legacy_id
           FROM luna.creation_bibles
           WHERE workspace_id = cb.workspace_id AND project_id = cb.project_id AND book_id = cb.id
           ORDER BY revision DESC
           LIMIT 1
         ) bible ON true
         WHERE cb.workspace_id = $1::uuid AND cb.project_id = $2::uuid
         ORDER BY cb.updated_at ASC, cb.id ASC`,
        [access.workspace_uuid, access.project_uuid]
      );
      const bibleVersions = await client.query(
        `SELECT cb.legacy_id AS book_legacy_id, bible.legacy_id AS bible_legacy_id,
                bible.revision, bible.payload, bible.payload_hash, bible.created_at
         FROM luna.creation_bibles bible
         JOIN luna.creation_books cb
           ON cb.workspace_id = bible.workspace_id
          AND cb.project_id = bible.project_id
          AND cb.id = bible.book_id
         WHERE bible.workspace_id = $1::uuid AND bible.project_id = $2::uuid
         ORDER BY cb.legacy_id ASC, bible.revision ASC`,
        [access.workspace_uuid, access.project_uuid]
      );
      const snapshots = await client.query(
        `SELECT snapshot.legacy_id,
                snapshot.bible_revision, snapshot.state_revision,
                snapshot.payload, snapshot.created_at
         FROM luna.context_snapshots snapshot
         WHERE snapshot.workspace_id = $1::uuid AND snapshot.project_id = $2::uuid
         ORDER BY snapshot.state_revision ASC, snapshot.id ASC`,
        [access.workspace_uuid, access.project_uuid]
      );
      const jobs = await client.query(
        `SELECT j.*, p.legacy_id AS project_legacy_id, w.legacy_id AS workspace_legacy_id
         FROM luna.jobs j
         JOIN luna.projects p ON p.workspace_id = j.workspace_id AND p.id = j.project_id
         JOIN luna.workspaces w ON w.id = j.workspace_id
         WHERE j.workspace_id = $1::uuid AND j.project_id = $2::uuid
         ORDER BY j.created_at ASC, j.id ASC`,
        [access.workspace_uuid, access.project_uuid]
      );
      const jobInputs = await client.query(
        `SELECT ji.job_id, j.legacy_id AS job_legacy_id, ji.payload, ji.payload_hash, ji.created_at
         FROM luna.job_inputs ji
         JOIN luna.jobs j
           ON j.workspace_id = ji.workspace_id
          AND j.project_id = ji.project_id
          AND j.id = ji.job_id
         WHERE ji.workspace_id = $1::uuid AND ji.project_id = $2::uuid
         ORDER BY j.created_at ASC, ji.job_id ASC`,
        [access.workspace_uuid, access.project_uuid]
      );
      const legacyPayloads = await client.query(
        `SELECT source_kind, legacy_id, payload, payload_hash, created_at, updated_at
         FROM luna.legacy_payloads
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
         ORDER BY source_kind ASC, legacy_id ASC`,
        [access.workspace_uuid, access.project_uuid]
      );
      return {
        books: books.rows.map(publicCreationBook),
        bibleVersions: bibleVersions.rows.map(row => ({
          bookId: String(row.book_legacy_id || ''),
          bibleId: String(row.bible_legacy_id || ''),
          version: Number(row.revision) || 1,
          payload: parseJsonDocument(row.payload),
          payloadHash: String(row.payload_hash || ''),
          createdAt: row.created_at ? new Date(row.created_at).getTime() : 0
        })),
        snapshots: snapshots.rows.map(row => {
          const payload = parseJsonDocument(row.payload);
          const bookId = payload && typeof payload === 'object' && !Array.isArray(payload) && payload.bookId
            ? String(payload.bookId)
            : books.rows.length === 1 ? String(books.rows[0].legacy_id || books.rows[0].id || '') : '';
          return {
          id: String(row.legacy_id || ''),
          bookId,
          bibleVersion: Number(row.bible_revision) || 0,
          stateVersion: Number(row.state_revision) || 0,
          payload,
          createdAt: row.created_at ? new Date(row.created_at).getTime() : 0
          };
        }),
        jobs: jobs.rows.map(publicJob),
        jobInputs: jobInputs.rows.map(row => ({
          jobId: String(row.job_legacy_id || row.job_id || ''),
          payload: parseJsonDocument(row.payload),
          payloadHash: String(row.payload_hash || ''),
          createdAt: row.created_at ? new Date(row.created_at).getTime() : 0
        })),
        legacyPayloads: legacyPayloads.rows.map(row => ({
          sourceKind: String(row.source_kind || ''),
          legacyId: String(row.legacy_id || ''),
          payload: parseJsonDocument(row.payload),
          payloadHash: String(row.payload_hash || ''),
          createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
          updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0
        }))
      };
    });
  }

  /** 保存缺少 Generation V2 语义证据的旧式章节审计，并明确标为待复核。 */
  async function createChapterAudit(input) {
    const content = String(input.content || '');
    const subjectHash = jsonHash(content);
    if (input.contentHash && String(input.contentHash) !== subjectHash) {
      throw repositoryError('content_hash_mismatch', '正文哈希与内容不一致', 422);
    }
    if (!content.trim()) throw repositoryError('audit_blocked', '正文为空，不能完成章节审计', 422);
    const auditId = normalizeLegacyId(input.auditId || `audit_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`, 'auditId');
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const book = await creationBookForClient(client, input.bookId);
      if (!book) throw repositoryError('not_found', '创作书不存在或无权访问', 404);
      const access = await accessForClient(client, book.project_id, book.workspace_id);
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权审计该章节', 403);
      const result = {
        source: 'local-deterministic',
        bookId: String(book.legacy_id),
        chapterNo: Math.max(1, Number(input.chapterNo) || 1),
        passed: false,
        blockerCount: null,
        qualityGate: 'needs_review',
        originalityStatus: 'not_run',
        reason: '缺少绑定 Generation Run 的确定性、语义和质量审计证据',
        contentHash: subjectHash
      };
      await client.query(
        `INSERT INTO luna.audits
          (workspace_id, project_id, id, subject_hash, status, result, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, 'needs_review', $5::jsonb, $6::uuid)`,
        [book.workspace_id, book.project_id, internalUuid(auditId), subjectHash, JSON.stringify(result), internalUuid(input.userId)]
      );
      return { ok: true, auditId, status: 'needs_review', passed: false, subjectHash, result };
    });
  }

  /** 从处于 committing 状态的 Generation Run 读取并持久化通过门禁的章节证据。 */
  async function createGenerationChapterAudit(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const generationId = String(input.generationId || '').trim();
    const chapterNo = Number(input.chapterNo);
    const content = String(input.content || '');
    const contentHash = jsonHash(content);
    if (!UUID_PATTERN.test(generationId)) throw repositoryError('invalid_id', 'generationId格式无效', 422);
    if (!Number.isInteger(chapterNo) || chapterNo < 1) throw repositoryError('invalid_chapter', 'chapterNo格式无效', 422);
    if (!content.trim() || String(input.contentHash || '') !== contentHash) {
      throw repositoryError('content_hash_mismatch', '正文哈希与内容不一致', 422);
    }
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const book = await creationBookForClient(client, input.bookId);
      if (!book) throw repositoryError('not_found', '创作书不存在或无权访问', 404);
      const access = await accessForClient(client, book.project_id, book.workspace_id);
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权审计该章节', 403);
      const runResult = await client.query(
        `SELECT result, state, chapter_id
         FROM luna.generation_runs
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND id = $3::uuid AND requested_by = $4::uuid AND state = 'committing'
         FOR UPDATE`,
        [book.workspace_id, book.project_id, internalUuid(generationId), actorUuid]
      );
      const run = runResult.rows[0];
      if (!run) throw repositoryError('audit_blocked', '审计必须绑定正在提交的 Generation Run', 409);
      const result = parseJsonDocument(run.result) || {};
      const checked = require('../generation/audit-evidence').validateGenerationAuditEvidence({
        generationId, chapterNo, content, contentHash, result
      });
      if (!checked.ok) throw repositoryError('audit_blocked', checked.message, 409);

      const existingResult = await client.query(
        `SELECT id, subject_hash, status, result, chapter_no
         FROM luna.audits
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND generation_id = $3::uuid
         LIMIT 1`,
        [book.workspace_id, book.project_id, internalUuid(generationId)]
      );
      if (existingResult.rows.length) {
        const existing = existingResult.rows[0];
        const evidence = parseJsonDocument(existing.result) || {};
        if (existing.status !== 'passed' || String(existing.subject_hash) !== contentHash ||
            String(evidence.generationId || '') !== generationId || Number(existing.chapter_no) !== chapterNo) {
          throw repositoryError('audit_blocked', 'Generation Run 已绑定到不同章节审计证据', 409);
        }
        return { ok: true, auditId: String(existing.id), status: 'passed', passed: true, idempotent: true, subjectHash: contentHash, result: evidence };
      }

      const auditId = normalizeLegacyId(input.auditId || `audit_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`, 'auditId');
      await client.query(
        `INSERT INTO luna.audits
          (workspace_id, project_id, id, subject_hash, status, result, created_by, generation_id, chapter_no)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, 'passed', $5::jsonb, $6::uuid, $7::uuid, $8::integer)`,
        [book.workspace_id, book.project_id, internalUuid(auditId), contentHash,
          JSON.stringify(checked.evidence), actorUuid, internalUuid(generationId), chapterNo]
      );
      return { ok: true, auditId, status: 'passed', passed: true, idempotent: false, subjectHash: contentHash, result: checked.evidence };
    });
  }

  /** 原子提交章节正文、状态快照、commit receipt 和 outbox 事件。 */
  async function commitChapter(input) {
    const content = String(input.content || '');
    const contentHash = jsonHash(content);
    if (String(input.contentHash || '') !== contentHash) throw repositoryError('content_hash_mismatch', '正文哈希与内容不一致', 422);
    const generationId = String(input.generationId || '').trim();
    if (!UUID_PATTERN.test(generationId)) throw repositoryError('audit_blocked', '正式提交必须绑定 Generation Run', 409);
    const chapterNo = Number(input.chapterNo);
    if (!Number.isInteger(chapterNo) || chapterNo < 1) throw repositoryError('invalid_chapter', 'chapterNo格式无效', 422);
    const projectionInput = input.projection && typeof input.projection === 'object' && !Array.isArray(input.projection)
      ? input.projection
      : {};
    const projection = {
      characterStates: projectionInput.characterStates && typeof projectionInput.characterStates === 'object' ? projectionInput.characterStates : {},
      relationshipStates: projectionInput.relationshipStates && typeof projectionInput.relationshipStates === 'object' ? projectionInput.relationshipStates : {},
      worldStates: projectionInput.worldStates && typeof projectionInput.worldStates === 'object' ? projectionInput.worldStates : {},
      timeline: Array.isArray(projectionInput.timeline) ? projectionInput.timeline : [],
      openForeshadows: Array.isArray(projectionInput.openForeshadows) ? projectionInput.openForeshadows : [],
      recentFacts: Array.isArray(projectionInput.recentFacts) ? projectionInput.recentFacts : [],
      causalDebts: projectionInput.causalDebts && typeof projectionInput.causalDebts === 'object' ? projectionInput.causalDebts : {},
      outlineImpact: projectionInput.outlineImpact && typeof projectionInput.outlineImpact === 'object' ? projectionInput.outlineImpact : {},
      factLedgerDelta: projectionInput.factLedgerDelta && typeof projectionInput.factLedgerDelta === 'object' ? projectionInput.factLedgerDelta : {}
    };
    const projectionHash = jsonHash(projection);
    return withTransaction(input.userId, async client => {
      const actorUuid = await ensureActor(client, input.userId);
      const generationResult = await client.query(
        `SELECT state, result, chapter_id
         FROM luna.generation_runs
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           AND requested_by = $4::uuid AND state = 'committing'
           AND lease_owner::text = $5::text AND fencing_token = $6::bigint
           AND lease_until > now()
         FOR UPDATE`,
        [internalUuid(input.workspaceId || ''), internalUuid(input.projectId || ''), internalUuid(generationId), actorUuid,
          String(input.runLeaseOwner || ''), Number(input.fencingToken) || 0]
      );
      const generationRun = generationResult.rows[0];
      if (!generationRun) throw repositoryError('audit_blocked', 'Generation Run 不处于有效的提交租约中', 409);
      const generationResultJson = parseJsonDocument(generationRun.result) || {};
      const previousReceipt = generationResultJson.commitReceipt;
      if (previousReceipt) {
        if (String(previousReceipt.contentHash || '') !== contentHash || Number(previousReceipt.chapterNo) !== chapterNo) {
          throw repositoryError('idempotency_conflict', 'Generation Run 已提交不同正文', 409);
        }
        return { ok: true, ...previousReceipt, committed: true, idempotent: true };
      }
      const checkedEvidence = require('../generation/audit-evidence').validateGenerationAuditEvidence({
        generationId, chapterNo, content, contentHash, result: generationResultJson
      });
      if (!checkedEvidence.ok) throw repositoryError('audit_blocked', checkedEvidence.message, 409);
      const book = await creationBookForClient(client, input.bookId, true);
      if (!book) throw repositoryError('not_found', '创作书不存在或无权访问', 404);
      const access = await accessForClient(client, book.project_id, book.workspace_id);
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权提交章节', 403);
      const auditId = normalizeLegacyId(input.auditId || `audit_generation_${generationId}`, 'auditId');
      const latestAudit = await client.query(
        `SELECT id, subject_hash, status, result, generation_id, chapter_no
         FROM luna.audits
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND generation_id = $3::uuid
         LIMIT 1 FOR UPDATE`,
        [book.workspace_id, book.project_id, internalUuid(generationId)]
      );
      let audit = latestAudit.rows[0];
      if (audit) {
        const persistedEvidence = parseJsonDocument(audit.result) || {};
        if (audit.status !== 'passed' || String(audit.subject_hash) !== contentHash ||
            String(audit.generation_id || '') !== internalUuid(generationId) || Number(audit.chapter_no) !== chapterNo ||
            hashValue(persistedEvidence) !== hashValue(checkedEvidence.evidence)) {
          throw repositoryError('audit_blocked', '正文没有匹配的已通过服务端审计', 409);
        }
      } else {
        const auditUuid = internalUuid(auditId);
        await client.query(
          `INSERT INTO luna.audits
            (workspace_id, project_id, id, subject_hash, status, result, created_by, generation_id, chapter_no)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, 'passed', $5::jsonb, $6::uuid, $7::uuid, $8::integer)`,
          [book.workspace_id, book.project_id, auditUuid, contentHash, JSON.stringify(checkedEvidence.evidence),
            actorUuid, internalUuid(generationId), chapterNo]
        );
        audit = {
          id: auditUuid, subject_hash: contentHash, status: 'passed', result: checkedEvidence.evidence,
          generation_id: internalUuid(generationId), chapter_no: chapterNo
        };
      }
      const currentStateVersion = Number(book.current_state_version) || 0;
      const baseStateVersion = input.baseStateVersion == null ? currentStateVersion : Number(input.baseStateVersion);
      if (!Number.isInteger(baseStateVersion) || baseStateVersion !== currentStateVersion) {
        throw repositoryError('revision_conflict', '创作状态已更新，请重新读取后提交', 409);
      }
      if (chapterNo !== Number(book.current_chapter_no || 0) + 1) {
        throw repositoryError('chapter_order_conflict', '章节必须按顺序提交', 409);
      }
      const actualCost = Math.max(0, Number(input.actualCost) || 0);
      const budgetLimit = Number(book.budget_limit) || 0;
      const spentCost = Number(book.spent_cost) || 0;
      if (budgetLimit > 0 && spentCost + actualCost > budgetLimit + 1e-9) {
        throw repositoryError('budget_exceeded', '本次提交会超过创作预算', 402);
      }
      const nextStateVersion = currentStateVersion + 1;
      const manuscriptId = internalUuid(`manuscript:${input.bookId}:chapter:${chapterNo}`);
      const snapshotId = internalUuid(`snapshot:${input.bookId}:${chapterNo}:${nextStateVersion}`);
      const commitId = internalUuid(input.commitId || `commit:${input.bookId}:${chapterNo}:${nextStateVersion}`);
      const manuscript = await client.query(
        `SELECT revision FROM luna.manuscripts
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
         FOR UPDATE`,
        [book.workspace_id, book.project_id, manuscriptId]
      );
      const manuscriptRevision = manuscript.rows.length ? Number(manuscript.rows[0].revision) + 1 : 1;
      if (!manuscript.rows.length) {
        await client.query(
          `INSERT INTO luna.manuscripts
            (workspace_id, project_id, id, kind, continuity_id, revision, head_revision, status, created_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'chapter', 'main', $4::bigint, $4::bigint, 'committed', $5::uuid)`,
          [book.workspace_id, book.project_id, manuscriptId, manuscriptRevision, internalUuid(input.userId)]
        );
      } else {
        await client.query(
          `UPDATE luna.manuscripts
           SET revision = $4::bigint, head_revision = $4::bigint, status = 'committed', updated_at = now()
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid`,
          [book.workspace_id, book.project_id, manuscriptId, manuscriptRevision]
        );
      }
      await client.query(
        `INSERT INTO luna.manuscript_revisions
          (workspace_id, project_id, manuscript_id, revision, body, body_hash, changed_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text, $6::text, $7::uuid)`,
        [book.workspace_id, book.project_id, manuscriptId, manuscriptRevision, content, contentHash, internalUuid(input.userId)]
      );
      const snapshotPayload = {
        bookId: String(input.bookId),
        chapterNo,
        contentRef: String(input.contentRef || ''),
        contentHash,
        auditStatus: 'passed',
        ...projection,
        projectionHash
      };
      await client.query(
        `INSERT INTO luna.context_snapshots
          (workspace_id, project_id, id, legacy_id, bible_revision, state_revision, input_hash, payload, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::bigint, $7::text, $8::jsonb, $9::uuid)`,
        [book.workspace_id, book.project_id, snapshotId, snapshotId, Number(book.bible_revision || 1), nextStateVersion, jsonHash(snapshotPayload), JSON.stringify(snapshotPayload), internalUuid(input.userId)]
      );
      const projectRevision = Number(access.revision) || 1;
      if (input.expectedProjectRevision != null && Number(input.expectedProjectRevision) !== projectRevision) {
        throw repositoryError('revision_conflict', '作品已在其他操作中更新，请重新读取后提交', 409);
      }
      await client.query(
        `INSERT INTO luna.commits
          (workspace_id, project_id, id, base_project_revision, audit_id, status, proposed_by, committed_by, committed_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::uuid, 'committed', $6::uuid, $6::uuid, now())`,
        [book.workspace_id, book.project_id, commitId, projectRevision, audit.id, internalUuid(input.userId)]
      );
      await client.query(
        `INSERT INTO luna.commit_items
          (workspace_id, project_id, commit_id, item_no, manuscript_id, before_revision, after_revision, delta)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4::uuid, $5::bigint, $6::bigint, $7::jsonb)`,
        [book.workspace_id, book.project_id, commitId, manuscriptId, manuscriptRevision - 1, manuscriptRevision, JSON.stringify({ chapterNo, contentHash })]
      );
      const bookUpdate = await client.query(
        `UPDATE luna.creation_books
         SET current_state_version = $4::bigint, current_chapter_no = $5::integer,
             spent_cost = spent_cost + $6::numeric, revision = revision + 1, updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           AND current_state_version = $7::bigint
         RETURNING current_state_version`,
        [book.workspace_id, book.project_id, book.id, nextStateVersion, chapterNo, actualCost, currentStateVersion]
      );
      if (!bookUpdate.rows.length) throw repositoryError('revision_conflict', '创作状态已更新，请重新读取后提交', 409);
      const projectUpdate = await client.query(
        `UPDATE luna.projects
         SET revision = revision + 1, updated_at = now()
         WHERE workspace_id = $1::uuid AND id = $2::uuid AND revision = $3::bigint`,
        [book.workspace_id, book.project_id, projectRevision]
      );
      if (!projectUpdate.rowCount) throw repositoryError('revision_conflict', '作品已在其他操作中更新，请重新读取后提交', 409);
      await client.query(
        `INSERT INTO luna.outbox
          (workspace_id, project_id, id, aggregate_type, aggregate_id, aggregate_revision, event_seq, event_type, payload, commit_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'commit', $4::uuid, $5::bigint, 1, 'commit.committed', $6::jsonb, $4::uuid)`,
        [book.workspace_id, book.project_id, internalUuid(`outbox:${input.bookId}:${chapterNo}:${nextStateVersion}`), commitId, nextStateVersion, JSON.stringify({ chapterNo, contentHash, snapshotId: snapshotId.toString(), projectionHash })]
      );
      const receipt = {
        ok: true,
        committed: true,
        idempotent: false,
        stateVersion: nextStateVersion,
        currentStateVersion: nextStateVersion,
        spentCost: spentCost + actualCost,
        snapshotId: snapshotId.toString(),
        commitId: commitId.toString(),
        auditId,
        contentHash,
        projection,
        projectionHash
      };
      const savedReceipt = await client.query(
        `UPDATE luna.generation_runs
         SET result = jsonb_set(result, '{commitReceipt}', $5::jsonb, true), updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           AND requested_by = $4::uuid AND state = 'committing'
           AND lease_owner::text = $6::text AND fencing_token = $7::bigint
           AND result->>'outputHash' = $8::text`,
        [book.workspace_id, book.project_id, internalUuid(generationId), actorUuid, JSON.stringify(receipt),
          String(input.runLeaseOwner || ''), Number(input.fencingToken) || 0, contentHash]
      );
      if (Number(savedReceipt.rowCount || 0) !== 1) {
        throw repositoryError('revision_conflict', 'Generation Run 提交租约或正文摘要已变化', 409);
      }
      return receipt;
    });
  }

  return {
    ensureCreationBookPlaceholderForClient,
    reserveJobBudgetForClient,
    methods: {
      listCreationBooks,
      createCreationBook,
      createCreationBookPlaceholder,
      linkCreationBook,
      getCreationBible,
      withCreationBookTransaction,
      getCausalDebts,
      recordCausalDebt,
      settleCausalDebt,
      findStoryMemoryRun,
      putCreationBible,
      getCreationState,
      getCreationQualityReport,
      getCreationPackageData,
      createChapterAudit,
      createGenerationChapterAudit,
      commitChapter
    }
  };
}

module.exports = {
  createPostgresCreationBookMethods
};
