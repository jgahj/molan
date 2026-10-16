'use strict';

/**
 * 本地 SQLite 数据库引导（自 server.js 下沉，行为逐字节保持不变）。
 * 职责：打开本地库（原生 node:sqlite 或纯 JS 引擎）、建 90+ 张表与索引、
 *       执行各域 schema 初始化与历史数据迁移、异常时安全置空。
 * 模块级 db 由调用方经 setDatabase 回调写回（server.js 保留 initDB 委托桩，
 * 其工厂缺失报错文案是 test/sqlite-factory-injection.test.js 的源码断言锚点）。
 */
function createLocalDatabaseBootstrap(deps) {
  const {
    DATA_DIR,
    dbEnabled,
    POSTGRES_MODE,
    projectScope,
    projectResources,
    memorySystem,
    styleSystem,
    migrateUsersToDb,
    migrateAdminAuditToDb,
    releaseStaleCreditReservations,
    migrateSkillsToDb,
    migrateGlobalSkillsToDb,
    migrateOpenSkillsToDb,
    setDatabase
  } = deps || {};

  const fs = require('node:fs');
  const path = require('node:path');
  const { assertJsonSource } = require('../lib/repositories/assert-json-source');

  return function initLocalDatabase(options = {}) {
  if (!dbEnabled) return false;
  if (POSTGRES_MODE) return true;
  const DatabaseSync = options.databaseFactory;
  if (typeof DatabaseSync !== 'function') {
    // 6d04c8b 起 databaseFactory 由调用方注入；缺失时不再静默失败，
    // 否则 SQLite 模式下 db 恒为 null，云端写操作全部 503 且无任何日志。
    console.error('❌ 未注入 databaseFactory，本地 SQLite 引擎未初始化（云端读写将不可用）');
    return false;
  }
  try {
    const dbPath = path.join(DATA_DIR, 'molan.db');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (DatabaseSync.name === 'PureJsDatabase') assertJsonSource(dbPath, { resetLegacy: true });
    const database = new DatabaseSync(dbPath);
    setDatabase(database);
      database.exec('PRAGMA journal_mode = WAL');        // 并发读 + 写不阻塞
      database.exec('PRAGMA synchronous = NORMAL');      // 折衷性能与安全
      database.exec('PRAGMA busy_timeout = 5000');       // 短暂写竞争时等待，避免瞬时 SQLITE_BUSY
      database.exec('PRAGMA temp_store = MEMORY');
      database.exec('PRAGMA cache_size = -8192');        // 约 8 MiB 页缓存，适配低内存服务器
      database.exec('PRAGMA wal_autocheckpoint = 1000');
      database.exec('PRAGMA mmap_size = 268435456');     // 有条件时使用 256 MiB 映射，降低读拷贝
    database.exec('PRAGMA foreign_keys = ON');
    database.exec(`CREATE TABLE IF NOT EXISTS accounts (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      default_model TEXT NOT NULL DEFAULT '',
      salt TEXT NOT NULL,
      pwd TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'normal',
      level TEXT NOT NULL DEFAULT 'normal',
      plan TEXT NOT NULL DEFAULT 'normal',
      credits REAL NOT NULL DEFAULT 500,
      spent REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    const accountColumns = database.prepare('PRAGMA table_info(accounts)').all().map(row => row.name);
    if (!accountColumns.includes('avatar')) database.exec("ALTER TABLE accounts ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");
    if (!accountColumns.includes('bio')) database.exec("ALTER TABLE accounts ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
    if (!accountColumns.includes('default_model')) database.exec("ALTER TABLE accounts ADD COLUMN default_model TEXT NOT NULL DEFAULT ''");
    if (!accountColumns.includes('user_id')) database.exec("ALTER TABLE accounts ADD COLUMN user_id TEXT");
    database.exec('CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role)');
    migrateUsersToDb();
    database.prepare('SELECT email FROM accounts WHERE user_id IS NULL OR user_id = ?').all('').forEach(row => {
      database.prepare('UPDATE accounts SET user_id = ? WHERE email = ? AND (user_id IS NULL OR user_id = ?)')
        .run(projectScope.stableUserId(row.email), row.email, '');
    });
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)');
    database.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'client',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    )`);
    try { database.exec("ALTER TABLE auth_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    database.prepare('SELECT token_hash, email, user_id FROM auth_sessions WHERE user_id = ?').all('').forEach(row => {
      const account = database.prepare('SELECT user_id FROM accounts WHERE email = ?').get(String(row.email || '').trim().toLowerCase());
      if (account && account.user_id) database.prepare('UPDATE auth_sessions SET user_id = ? WHERE token_hash = ?').run(account.user_id, row.token_hash);
    });
    database.exec('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, expires_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_auth_sessions_email ON auth_sessions(email, expires_at)');
    database.exec(`CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      title TEXT NOT NULL,
      state_json TEXT NOT NULL,
      word_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0
    )`);
    const novelColumns = database.prepare('PRAGMA table_info(novels)').all().map(row => row.name);
    if (!novelColumns.includes('revision')) database.exec('ALTER TABLE novels ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
    if (!novelColumns.includes('workspace_id')) database.exec('ALTER TABLE novels ADD COLUMN workspace_id TEXT');
    if (!novelColumns.includes('project_id')) database.exec('ALTER TABLE novels ADD COLUMN project_id TEXT');
    if (!novelColumns.includes('owner_user_id')) database.exec("ALTER TABLE novels ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT ''");
    database.prepare(`SELECT id, user_email FROM novels WHERE owner_user_id = '' OR owner_user_id IS NULL`).all().forEach(row => {
      const account = database.prepare('SELECT user_id FROM accounts WHERE email = ?').get(String(row.user_email || '').trim().toLowerCase());
      if (account && account.user_id) database.prepare('UPDATE novels SET owner_user_id = ? WHERE id = ?').run(account.user_id, row.id);
    });
    database.exec('CREATE INDEX IF NOT EXISTS idx_novels_user ON novels(user_email, updated_at DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_novels_owner ON novels(owner_user_id, updated_at DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_novels_project_scope ON novels(workspace_id, project_id, updated_at DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_novels_project_id ON novels(project_id)');
    projectScope.initializeSchema(database);
    projectResources.initializeSchema(database);
    memorySystem.initializeSchema(database);
    styleSystem.initializeSchema(database);
    database.prepare("UPDATE memory_generation_runs SET status = 'provider_unknown', updated_at = ? WHERE status IN ('queued', 'running', 'cancel_requested')").run(Date.now());
    projectScope.migrateExistingScopes(database);
    database.exec(`CREATE TABLE IF NOT EXISTS token_usage (
      request_id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      project_id TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER,
      cached_tokens INTEGER,
      cache_write_tokens INTEGER,
      usage_source TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      credit_cost REAL NOT NULL DEFAULT 0,
      reserved_cost REAL NOT NULL DEFAULT 0,
      skill_ids_json TEXT NOT NULL DEFAULT '[]',
      skill_audit_json TEXT NOT NULL DEFAULT '{}',
      messages_sha256 TEXT NOT NULL DEFAULT ''
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_token_usage_user ON token_usage(user_email, created_at DESC)');
    const tokenColumns = database.prepare('PRAGMA table_info(token_usage)').all().map(row => row.name);
    if (!tokenColumns.includes('user_id')) database.exec("ALTER TABLE token_usage ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
    if (!tokenColumns.includes('workspace_id')) database.exec("ALTER TABLE token_usage ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''");
    if (!tokenColumns.includes('project_id')) database.exec("ALTER TABLE token_usage ADD COLUMN project_id TEXT NOT NULL DEFAULT ''");
    database.prepare('SELECT request_id, user_email FROM token_usage WHERE user_id = ?').all('').forEach(row => {
      const account = database.prepare('SELECT user_id FROM accounts WHERE email = ?').get(String(row.user_email || '').trim().toLowerCase());
      if (account && account.user_id) database.prepare('UPDATE token_usage SET user_id = ? WHERE request_id = ?').run(account.user_id, row.request_id);
    });
    if (!tokenColumns.includes('cached_tokens')) database.exec('ALTER TABLE token_usage ADD COLUMN cached_tokens INTEGER');
    if (!tokenColumns.includes('cache_write_tokens')) database.exec('ALTER TABLE token_usage ADD COLUMN cache_write_tokens INTEGER');
    if (!tokenColumns.includes('reserved_cost')) database.exec('ALTER TABLE token_usage ADD COLUMN reserved_cost REAL NOT NULL DEFAULT 0');
    if (!tokenColumns.includes('skill_ids_json')) database.exec("ALTER TABLE token_usage ADD COLUMN skill_ids_json TEXT NOT NULL DEFAULT '[]'");
    if (!tokenColumns.includes('skill_audit_json')) database.exec("ALTER TABLE token_usage ADD COLUMN skill_audit_json TEXT NOT NULL DEFAULT '{}'");
    if (!tokenColumns.includes('messages_sha256')) database.exec("ALTER TABLE token_usage ADD COLUMN messages_sha256 TEXT NOT NULL DEFAULT ''");
    database.exec('CREATE INDEX IF NOT EXISTS idx_token_usage_user_id ON token_usage(user_id, created_at DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_token_usage_scope ON token_usage(workspace_id, project_id, created_at DESC)');
    database.prepare("UPDATE token_usage SET skill_audit_json = ? WHERE skill_audit_json IS NULL OR skill_audit_json = '{}' OR skill_audit_json = ''").run(JSON.stringify({ version: 1, status: 'legacy-unavailable', audited: false, skills: [], actualSkillIds: [], declaredSkillIds: [], promptHash: '' }));
    database.exec(`CREATE TABLE IF NOT EXISTS user_skills (
      user_email TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      instruction TEXT NOT NULL,
      files_json TEXT NOT NULL DEFAULT '[]',
      size INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_email, id)
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_email, updated_at DESC)');
    database.exec(`CREATE TABLE IF NOT EXISTS global_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      instruction TEXT NOT NULL,
      files_json TEXT NOT NULL DEFAULT '{}',
      targets_json TEXT NOT NULL DEFAULT '["all"]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    const globalSkillColumns = database.prepare('PRAGMA table_info(global_skills)').all().map(row => row.name);
    if (!globalSkillColumns.includes('files_json')) database.exec("ALTER TABLE global_skills ADD COLUMN files_json TEXT NOT NULL DEFAULT '{}'");
    database.exec('CREATE INDEX IF NOT EXISTS idx_global_skills_updated ON global_skills(updated_at DESC)');
    database.exec(`CREATE TABLE IF NOT EXISTS open_skills (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      instruction TEXT NOT NULL,
      files_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'published',
      downloads INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_open_skills_status_updated ON open_skills(status, updated_at DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_open_skills_owner ON open_skills(owner_email, updated_at DESC)');
    database.exec(`CREATE TABLE IF NOT EXISTS admin_audit (
      id TEXT PRIMARY KEY,
      admin_email TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC)');
    database.exec(`CREATE TABLE IF NOT EXISTS dissections (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      owner_user_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL DEFAULT '',
      source_text TEXT NOT NULL,
      depth TEXT NOT NULL DEFAULT 'standard',
      purpose TEXT NOT NULL DEFAULT 'new-writer',
      selected_model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'queued',
      phase_index INTEGER NOT NULL DEFAULT 0,
      progress INTEGER NOT NULL DEFAULT 0,
      estimated_credits REAL NOT NULL DEFAULT 0,
      actual_credits REAL NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL DEFAULT '{}',
      meta_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    const dissectionColumns = database.prepare('PRAGMA table_info(dissections)').all().map(row => row.name);
    if (!dissectionColumns.includes('owner_user_id')) database.exec("ALTER TABLE dissections ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT ''");
    database.prepare('SELECT id, user_email FROM dissections WHERE owner_user_id = ?').all('').forEach(row => {
      const account = database.prepare('SELECT user_id FROM accounts WHERE email = ?').get(String(row.user_email || '').trim().toLowerCase());
      if (account && account.user_id) database.prepare('UPDATE dissections SET owner_user_id = ? WHERE id = ?').run(account.user_id, row.id);
    });
    database.exec('CREATE INDEX IF NOT EXISTS idx_dissections_user ON dissections(user_email, updated_at DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_dissections_owner ON dissections(owner_user_id, updated_at DESC)');
    // 拆书角色库（F203）
    database.exec(`CREATE TABLE IF NOT EXISTS character_library (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      dissection_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      function TEXT NOT NULL DEFAULT '',
      goal TEXT NOT NULL DEFAULT '',
      conflict TEXT NOT NULL DEFAULT '',
      arc TEXT NOT NULL DEFAULT '',
      first_appearance TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_character_lib_uniq ON character_library(user_email, name)');
    // 角色卡可编辑字段（兼容旧库：新列不存在时补充）
    try { database.exec("ALTER TABLE character_library ADD COLUMN notes TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    // 拆书版本历史（F205）
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_versions (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_dv ON dissection_versions(dissection_id, user_email)');
    // 拆书分享（F204 团队/协作）
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_shares (
      token TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL DEFAULT 0
    )`);
    // 协作扩展列：指定成员邮箱 + 角色（view/edit），兼容旧库
    try { database.exec("ALTER TABLE dissection_shares ADD COLUMN grantee_email TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    try { database.exec("ALTER TABLE dissection_shares ADD COLUMN role TEXT NOT NULL DEFAULT 'view'"); } catch (_) {}
    database.exec('CREATE INDEX IF NOT EXISTS idx_dissection_shares_grantee ON dissection_shares(grantee_email)');
    // ★ 千万字级拆书 · 分层流水线：章节原文库 / 章节事实库 / 批次任务（断点续跑）
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_chapters (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_dchapters_diss ON dissection_chapters(dissection_id, chapter_no)');
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_chapter_facts (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL DEFAULT 0,
      fact_json TEXT NOT NULL DEFAULT '{}',
      tokens INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_dcfacts_uniq ON dissection_chapter_facts(dissection_id, chapter_id)');
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_batch_tasks (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      batch_no INTEGER NOT NULL DEFAULT 0,
      chapter_from INTEGER NOT NULL DEFAULT 0,
      chapter_to INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      tokens INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_dbatch_diss ON dissection_batch_tasks(dissection_id, batch_no)');
    // ★ 阶段1 · 证据与图谱层：每次运行 / 文本单元 / 证据 claim / 实体 / 别名 / 提及 / 事件 / 事件关系 / 实体状态 / 分层摘要
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_runs (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      pipeline_version TEXT NOT NULL DEFAULT '1',
      skill_version TEXT NOT NULL DEFAULT '',
      prompt_version TEXT NOT NULL DEFAULT '',
      model_policy_version TEXT NOT NULL DEFAULT '',
      source_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      unit_total INTEGER NOT NULL DEFAULT 0,
      unit_completed INTEGER NOT NULL DEFAULT 0,
      fact_coverage REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_druns_diss ON dissection_runs(dissection_id)');
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_units (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      parent_id TEXT NOT NULL DEFAULT '',
      unit_type TEXT NOT NULL DEFAULT 'chapter',
      ordinal INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      source_file TEXT NOT NULL DEFAULT '',
      source_start INTEGER NOT NULL DEFAULT 0,
      source_end INTEGER NOT NULL DEFAULT 0,
      text_hash TEXT NOT NULL DEFAULT '',
      char_count INTEGER NOT NULL DEFAULT 0,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_dunits_diss ON dissection_units(dissection_id, ordinal)');
    // 兼容旧库补 text 列（断点续跑需从库重建批次文本）
    try { database.exec("ALTER TABLE dissection_units ADD COLUMN text TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    // ★ 阶段4 · FTS5 关键词检索（trigram 支持中文子串匹配），供"按章节/剧情片段定位"
    try {
      database.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS dissection_units_fts USING fts5(dissection_id UNINDEXED, unit_type UNINDEXED, ordinal UNINDEXED, title, body, tokenize='trigram')`);
    } catch (_) {}
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_claims (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      claim_type TEXT NOT NULL DEFAULT 'event',
      subject_id TEXT NOT NULL DEFAULT '',
      predicate TEXT NOT NULL DEFAULT '',
      object_value TEXT NOT NULL DEFAULT '',
      evidence_type TEXT NOT NULL DEFAULT 'direct',
      source_start INTEGER NOT NULL DEFAULT 0,
      source_end INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'confirmed',
      run_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_dclaims_diss ON dissection_claims(dissection_id, unit_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_dclaims_subj ON dissection_claims(dissection_id, subject_id)');
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_entities (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      canonical_name TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL DEFAULT 'character',
      first_unit_id TEXT NOT NULL DEFAULT '',
      last_unit_id TEXT NOT NULL DEFAULT '',
      mention_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'confirmed',
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_dentities_diss ON dissection_entities(dissection_id, canonical_name)');
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_entity_aliases (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      alias TEXT NOT NULL DEFAULT '',
      first_unit_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_daliases_diss ON dissection_entity_aliases(dissection_id, entity_id)');
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_entity_mentions (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      alias TEXT NOT NULL DEFAULT '',
      unit_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_dmentions_diss ON dissection_entity_mentions(dissection_id, entity_id)');
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_events (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      unit_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      participants_json TEXT NOT NULL DEFAULT '[]',
      narrative_volume TEXT NOT NULL DEFAULT '',
      narrative_unit TEXT NOT NULL DEFAULT '',
      world_time TEXT NOT NULL DEFAULT '',
      pre_state TEXT NOT NULL DEFAULT '',
      post_state TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      evidence_offset_start INTEGER NOT NULL DEFAULT 0,
      evidence_offset_end INTEGER NOT NULL DEFAULT 0,
      related_event_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_devents_diss ON dissection_events(dissection_id, unit_id)');
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_event_edges (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      source_event_id TEXT NOT NULL DEFAULT '',
      target_event_id TEXT NOT NULL DEFAULT '',
      relation_type TEXT NOT NULL DEFAULT 'causes',
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_dedges_diss ON dissection_event_edges(dissection_id, source_event_id)');
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_entity_states (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      stage_key TEXT NOT NULL DEFAULT '',
      unit_from INTEGER NOT NULL DEFAULT 0,
      unit_to INTEGER NOT NULL DEFAULT 0,
      state_snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_dstates_diss ON dissection_entity_states(dissection_id, entity_id)');
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_summaries (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      summary_type TEXT NOT NULL DEFAULT 'unit',
      owner_id TEXT NOT NULL DEFAULT '',
      child_ids_json TEXT NOT NULL DEFAULT '[]',
      content_json TEXT NOT NULL DEFAULT '{}',
      evidence_ids_json TEXT NOT NULL DEFAULT '[]',
      coverage_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'ok',
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_dsummaries_diss ON dissection_summaries(dissection_id, summary_type)');
    // ★ 阶段2 · 伏笔生命周期表（埋设/强化/部分回收/已回收/烂尾 + 证据 + 置信度）
    database.exec(`CREATE TABLE IF NOT EXISTS dissection_foreshadows (
      id TEXT PRIMARY KEY,
      dissection_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned',
      strength TEXT NOT NULL DEFAULT 'medium',
      setup_chapter INTEGER NOT NULL DEFAULT 0,
      payoff_chapter INTEGER NOT NULL DEFAULT 0,
      first_unit_id TEXT NOT NULL DEFAULT '',
      last_reinforced_unit_id TEXT NOT NULL DEFAULT '',
      payoff_unit_id TEXT NOT NULL DEFAULT '',
      related_entity_ids TEXT NOT NULL DEFAULT '[]',
      evidence_ids TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.6,
      run_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_dforeshadows_diss ON dissection_foreshadows(dissection_id, status)');
    // 伏笔表补证据与置信度列（兼容旧库）
    try { database.exec("ALTER TABLE dissection_foreshadows ADD COLUMN evidence_ids TEXT NOT NULL DEFAULT '[]'"); } catch (_) {}
    try { database.exec("ALTER TABLE dissection_foreshadows ADD COLUMN confidence REAL NOT NULL DEFAULT 0.6"); } catch (_) {}
    try { database.exec("ALTER TABLE dissection_foreshadows ADD COLUMN related_entity_ids TEXT NOT NULL DEFAULT '[]'"); } catch (_) {}
    try { database.exec("ALTER TABLE dissection_foreshadows ADD COLUMN run_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    // ★ Q1 · 创书域：新书（creationBook）与其独立、可版本化的创作圣经（creationBible）
    database.exec(`CREATE TABLE IF NOT EXISTS creation_books (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      bible_id TEXT NOT NULL DEFAULT '',
      source_brief_id TEXT NOT NULL DEFAULT '',
      current_state_version INTEGER NOT NULL DEFAULT 0,
      current_chapter_no INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      visibility TEXT NOT NULL DEFAULT 'private',
      created_by TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_books_user ON creation_books(user_email, updated_at)');
    try { database.exec("ALTER TABLE creation_books ADD COLUMN novel_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    try { database.exec("ALTER TABLE creation_books ADD COLUMN plan_json TEXT NOT NULL DEFAULT '{}'"); } catch (_) {}
    try { database.exec("ALTER TABLE creation_books ADD COLUMN budget_limit REAL NOT NULL DEFAULT 0"); } catch (_) {}
    try { database.exec("ALTER TABLE creation_books ADD COLUMN spent_cost REAL NOT NULL DEFAULT 0"); } catch (_) {}
    try { database.exec("ALTER TABLE creation_books ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    try { database.exec("ALTER TABLE creation_books ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    try { database.exec("ALTER TABLE creation_books ADD COLUMN project_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    database.prepare('SELECT id, user_email, novel_id, owner_user_id, workspace_id, project_id FROM creation_books WHERE owner_user_id = ? OR workspace_id = ?').all('', '').forEach(row => {
      const account = database.prepare('SELECT user_id, email, name FROM accounts WHERE email = ?').get(String(row.user_email || '').trim().toLowerCase());
      if (!account || !account.user_id) return;
      const ownerUserId = String(account.user_id);
      const workspaceId = String(row.workspace_id || projectScope.personalWorkspaceId(ownerUserId));
      projectScope.ensureUserWorkspace(database, { userId: ownerUserId, email: account.email, name: account.name });
      database.prepare('UPDATE creation_books SET owner_user_id = ?, workspace_id = ?, project_id = ? WHERE id = ?')
        .run(ownerUserId, workspaceId, String(row.project_id || row.novel_id || ''), row.id);
    });
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_books_owner ON creation_books(owner_user_id, updated_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_books_scope ON creation_books(workspace_id, project_id, updated_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_books_novel ON creation_books(user_email, novel_id)');
    database.exec(`CREATE TABLE IF NOT EXISTS creation_core_jobs (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL DEFAULT '',
      user_email TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      received_chars INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      bible_version INTEGER NOT NULL DEFAULT 0,
      credit_cost REAL
    )`);
    try { database.exec("ALTER TABLE creation_core_jobs ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    try { database.exec("ALTER TABLE creation_core_jobs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    try { database.exec("ALTER TABLE creation_core_jobs ADD COLUMN project_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    database.prepare('SELECT id, user_email, user_id, workspace_id, project_id FROM creation_core_jobs WHERE user_id = ? OR workspace_id = ?').all('', '').forEach(row => {
      const account = database.prepare('SELECT user_id FROM accounts WHERE email = ?').get(String(row.user_email || '').trim().toLowerCase());
      if (!account || !account.user_id) return;
      const ownerUserId = String(account.user_id);
      database.prepare('UPDATE creation_core_jobs SET user_id = ?, workspace_id = ? WHERE id = ?')
        .run(ownerUserId, String(row.workspace_id || projectScope.personalWorkspaceId(ownerUserId)), row.id);
    });
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_core_jobs_owner ON creation_core_jobs(user_id, updated_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_core_jobs_scope ON creation_core_jobs(workspace_id, project_id, updated_at)');
    database.prepare("UPDATE creation_core_jobs SET status = 'provider_unknown', code = 'process_interrupted', error = '服务进程中断，结果需要人工核对，未自动重试', updated_at = ? WHERE status IN ('running','cancelling')")
      .run(Date.now());
    database.exec(`CREATE TABLE IF NOT EXISTS creation_bibles (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL DEFAULT '',
      current_version INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_bibles_book ON creation_bibles(book_id)');
    database.exec(`CREATE TABLE IF NOT EXISTS creation_bible_versions (
      id TEXT PRIMARY KEY,
      bible_id TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}',
      payload_hash TEXT NOT NULL DEFAULT '',
      source_brief_id TEXT NOT NULL DEFAULT '',
      parent_version INTEGER NOT NULL DEFAULT 0,
      change_summary TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_bible_ver ON creation_bible_versions(bible_id, version)');
    database.exec(`CREATE TABLE IF NOT EXISTS creation_state_snapshots (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL DEFAULT '',
      chapter_no INTEGER NOT NULL DEFAULT 0,
      bible_version INTEGER NOT NULL DEFAULT 0,
      state_version INTEGER NOT NULL DEFAULT 0,
      character_states_json TEXT NOT NULL DEFAULT '{}',
      relationship_states_json TEXT NOT NULL DEFAULT '{}',
      world_states_json TEXT NOT NULL DEFAULT '{}',
      timeline_json TEXT NOT NULL DEFAULT '[]',
      open_foreshadows_json TEXT NOT NULL DEFAULT '[]',
      recent_facts_json TEXT NOT NULL DEFAULT '[]',
      outline_impact_json TEXT NOT NULL DEFAULT '{}',
      content_ref TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      audit_status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    const creationSnapshotColumns = database.prepare('PRAGMA table_info(creation_state_snapshots)').all().map(row => row.name);
    if (!creationSnapshotColumns.includes('outline_impact_json')) database.exec("ALTER TABLE creation_state_snapshots ADD COLUMN outline_impact_json TEXT NOT NULL DEFAULT '{}'");
    if (!creationSnapshotColumns.includes('actor_user_id')) database.exec("ALTER TABLE creation_state_snapshots ADD COLUMN actor_user_id TEXT NOT NULL DEFAULT ''");
    if (!creationSnapshotColumns.includes('workspace_id')) database.exec("ALTER TABLE creation_state_snapshots ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''");
    if (!creationSnapshotColumns.includes('project_id')) database.exec("ALTER TABLE creation_state_snapshots ADD COLUMN project_id TEXT NOT NULL DEFAULT ''");
    database.exec(`UPDATE creation_state_snapshots
      SET actor_user_id = COALESCE((SELECT owner_user_id FROM creation_books WHERE creation_books.id = creation_state_snapshots.book_id), ''),
          workspace_id = COALESCE((SELECT workspace_id FROM creation_books WHERE creation_books.id = creation_state_snapshots.book_id), ''),
          project_id = COALESCE((SELECT project_id FROM creation_books WHERE creation_books.id = creation_state_snapshots.book_id), '')
      WHERE actor_user_id = '' OR workspace_id = '' OR project_id = ''`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_snap_book ON creation_state_snapshots(book_id, chapter_no)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_snap_scope ON creation_state_snapshots(workspace_id, project_id, actor_user_id, created_at)');
    require('../lib/benchmark-commit').initializeCommitReceipts(database);
    // ★ P0-1 · 章节审计结果落库：commit 时服务端复核，禁止信任前端上报的 auditStatus
    database.exec(`CREATE TABLE IF NOT EXISTS creation_chapter_audits (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      user_email TEXT NOT NULL DEFAULT '',
      chapter_no INTEGER NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      passed INTEGER NOT NULL DEFAULT 0,
      quality_gate TEXT NOT NULL DEFAULT '',
      originality_status TEXT NOT NULL DEFAULT '',
      blocker_count INTEGER NOT NULL DEFAULT 0,
      audit_credit_cost REAL NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    const chapterAuditColumns = database.prepare('PRAGMA table_info(creation_chapter_audits)').all().map(row => row.name);
    if (!chapterAuditColumns.includes('bible_version')) database.exec('ALTER TABLE creation_chapter_audits ADD COLUMN bible_version INTEGER NOT NULL DEFAULT 0');
    if (!chapterAuditColumns.includes('state_version')) database.exec('ALTER TABLE creation_chapter_audits ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0');
    if (!chapterAuditColumns.includes('context_hash')) database.exec("ALTER TABLE creation_chapter_audits ADD COLUMN context_hash TEXT NOT NULL DEFAULT ''");
    if (!chapterAuditColumns.includes('delta_hash')) database.exec("ALTER TABLE creation_chapter_audits ADD COLUMN delta_hash TEXT NOT NULL DEFAULT ''");
    if (!chapterAuditColumns.includes('plan_hash')) database.exec("ALTER TABLE creation_chapter_audits ADD COLUMN plan_hash TEXT NOT NULL DEFAULT ''");
    if (!chapterAuditColumns.includes('actor_user_id')) database.exec("ALTER TABLE creation_chapter_audits ADD COLUMN actor_user_id TEXT NOT NULL DEFAULT ''");
    if (!chapterAuditColumns.includes('workspace_id')) database.exec("ALTER TABLE creation_chapter_audits ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''");
    if (!chapterAuditColumns.includes('project_id')) database.exec("ALTER TABLE creation_chapter_audits ADD COLUMN project_id TEXT NOT NULL DEFAULT ''");
    database.exec(`UPDATE creation_chapter_audits
      SET actor_user_id = COALESCE((SELECT owner_user_id FROM creation_books WHERE creation_books.id = creation_chapter_audits.book_id), ''),
          workspace_id = COALESCE((SELECT workspace_id FROM creation_books WHERE creation_books.id = creation_chapter_audits.book_id), ''),
          project_id = COALESCE((SELECT project_id FROM creation_books WHERE creation_books.id = creation_chapter_audits.book_id), '')
      WHERE actor_user_id = '' OR workspace_id = '' OR project_id = ''`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_chapter_audits ON creation_chapter_audits(book_id, chapter_no, created_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_creation_chapter_audits_scope ON creation_chapter_audits(workspace_id, project_id, actor_user_id, created_at)');
    // ★ Q2 · 模型用量账本（不可变，按 requestId 幂等）：token / 费用 / 重试 / 延迟（方案 7.6）
    database.exec(`CREATE TABLE IF NOT EXISTS model_usage (
      request_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      project_id TEXT NOT NULL DEFAULT '',
      record_id TEXT NOT NULL DEFAULT '',
      workflow_id TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '',
      unit_id TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      prompt_version TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      credit_cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    )`);
    try { database.exec("ALTER TABLE model_usage ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    try { database.exec("ALTER TABLE model_usage ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    try { database.exec("ALTER TABLE model_usage ADD COLUMN project_id TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    database.exec('CREATE INDEX IF NOT EXISTS idx_model_usage_record ON model_usage(record_id, stage)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_model_usage_user ON model_usage(user_id, created_at DESC)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_model_usage_scope ON model_usage(workspace_id, project_id, created_at DESC)');
    try { database.exec("ALTER TABLE model_usage ADD COLUMN credit_known INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
    try { database.exec("ALTER TABLE model_usage ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'unknown'"); } catch (_) {}
      migrateSkillsToDb();
      migrateGlobalSkillsToDb();
      migrateOpenSkillsToDb();
      migrateAdminAuditToDb();
      releaseStaleCreditReservations();
      console.log('🗄   本地存储引擎已就绪 → ' + dbPath);
    return true;
  } catch (e) {
    console.error('❌ 本地存储引擎初始化失败：' + e.message);
    setDatabase(null);
    if (e.code === 'LEGACY_SQLITE_REQUIRES_MIGRATION' || e.code === 'JSON_STORE_CORRUPT') throw e;
    return false;
  }
}
}

module.exports = { createLocalDatabaseBootstrap };