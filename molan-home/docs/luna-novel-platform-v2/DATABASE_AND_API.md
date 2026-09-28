# 数据库与 API 实施规范

日期：2026-09-15。交付对象：Luna。状态：设计，未实施；下列 DDL 未执行，不是完整 migration，也不代表数据库、接口或多用户验收通过。

依据原《小说全套资料能力审查与优化方案-2026-09-15.md》§5、§6、§7、§8、§10：稳定 ID、五类内容分层、版本绑定、正文与增量同事务、历史恢复和无损迁移。本轮明确替代原 §5.2 的 SQLite 权威库建议，不改写原文。文内官方 URL 均为设计参考，不是本项目实现或验证证据；`current` 文档会变化，实施时须同步留存 PG18 对应版本。

## 1. 权威边界与授权

- 模块化单体 Node：路由只做协议适配，授权、资料、规划、正文、提交、任务、计费、迁移各有领域服务；所有入口共用事务仓储，不由前端决定正式状态。
- PostgreSQL 是未来正式多用户唯一权威库，**目标主版本固定 PG18**。实施环境复核并 pin 当时确切最新补丁版、镜像摘要和驱动版本；本次不安装、不迁移。SQLite 仅旧数据迁移源或显式可选单机模式，不能替代 PostgreSQL 并发、RLS、多租户验证。版本设计参考：`https://www.postgresql.org/support/versioning/`。
- `users.id` 为服务端生成且永不复用的 UUID；email 只是可变属性，不作为主键、外键、目录名或租户判断依据。登录身份另以 `(issuer, subject)` 唯一关联 user；账户合并必须保留映射和审计。
- `workspace = tenant`，数据库只用 `workspace_id` 表示租户，避免两套 ID 漂移。默认创建个人工作区；project 必属一个 workspace，不支持原地跨租户移动。
- workspace 角色固定 `owner/admin/member`，只管理工作区、成员及工作区预算；member 仅普通成员能力，不能管理预算或提权。owner 保有所有权转移和 admin 任命权，admin 不能修改 owner/admin。**未显式加入项目默认无权；workspace owner/admin 不自动继承私有项目正文、资料、审计或项目费用明细访问权，也不能自助加入已有项目。**
- 初始化个人工作区及首项目时，创建者的 workspace owner 与 project owner **同一事务原子建立**。在已有工作区新增项目，只赋创建者项目 owner，不暗中提升既有 workspace 角色。授权必须同时满足：用户有效、工作区成员有效、项目成员有效、项目状态允许操作。
- 平台运维默认无正文权限；诊断只能使用脱敏运行指标。紧急访问须另行批准、限时、限定项目且留痕，不能把数据库超级用户或运维账号当日常业务身份。

项目角色以本目录 README §3.2 冻结矩阵为准：viewer 只读非财务内容及历史；reviewer 增加对已有结果的审查、工单意见，不得改正文、正式采纳、发起推理或付费审稿 job；editor 增加资料/正文编辑、删除恢复及正式提交；admin 增加预算及成员管理；owner 增加所有权转移、项目删除恢复。admin 只能管理 editor/reviewer/viewer，不能增删改 owner/admin；只有 owner 可任命 admin。每项目恰有一个有效 owner，转移须锁项目、校验接收者工作区成员身份并原子替换；唯一索引保证“至多一个”，受控事务及延迟约束触发器补足“至少一个”。

`canSpend/canExport` 是额外服务端能力，由当前授权数据计算，不接受客户端声明。推理须同时满足 project owner/admin/editor、当前 canSpend 和可用预算；有额度不等于获准支出，给 reviewer 能力也不突破其角色限制。导出角色范围固定为owner/admin/editor，canExport默认仅owner/admin具备，editor需要显式授权；reviewer/viewer即使出现错误的能力授予记录也不能导出。创建导出、读取清单、下载每次均须当前canExport及允许的角色，曾经创建或能读正文不构成豁免。授权变更推进aclRevision，worker领取/执行、回执重放、任务结果、SSE和下载代理均重检对应能力，不返回可绕过能力撤销的长期直链。

所有项目数据，包括 jobs、audits、cache、export、billing、附件、流式订阅、搜索结果和下载，都先验 tenant+project，再验动作权限。身份/工作区控制表是必要例外：只开放本人的身份、成员关系或明确授权的容器信息，不可借此遍历项目。工作区预算只表达工作区总额度及限额，不借聚合接口下钻未加入项目的费用或名称；项目账本仍需显式项目 admin/owner。缓存键含 scope、输入哈希及版本，命中后仍授权；对象存储路径不是授权凭证。worker 使用限定项目的服务身份及有效任务授权，不能用 owner/BYPASSRLS 扫全库。默认拒绝、逐请求授权设计参考：`https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html`；缓存/存储租户边界设计参考：`https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html`。

## 2. Table inventory 与不可变约束

以下为目标物理表清单，分批落地但不得用 JSON 引用代替外键。简称 `S=(workspace_id,project_id)`；项目表均含 S，通常主键 `(S,id)`，可变头含 `revision bigint > 0`、`schema_version`、系统时间、`deleted_at`。对象名允许重复；UUID 不因改名、移章、恢复变化。通用扩展仅放命名空间 `extensions`。

| 表组 | 关键字段、引用与职责 |
| --- | --- |
| `users / auth_identities / auth_sessions / workspaces / workspace_members / workspace_budgets / projects / project_members` | 稳定身份、登录映射、共享可撤销会话、容器、工作区额度、两级显式角色；session只存受保护token摘要和生命周期，不存明文token；项目成员同时FK到项目和工作区成员；projects保存bible/plan/state/acl revision |
| `project_capability_grants` | 项目成员的 canSpend/canExport 授予或撤销；`UNIQUE(S,user_id,capability)`，复合 FK 到 project_members，受控管理写并推进 aclRevision |
| `project_profiles / bible_revisions` | 定位、题材配置、批准设定快照；`UNIQUE(S,revision)`，记录变更者及 changeset |
| `entities / entity_versions / relations / relation_versions` | 人物、地点、势力、规则、能力、物品、术语；关系两端均复合 FK 到同项目实体；关系有效故事时间、来源和方向显式列 |
| `plot_nodes / plot_versions / scene_entities` | 总纲→卷纲→章纲→场景；parent 同项目 FK，服务校验层级、无环；`UNIQUE(S,parent_id,sort_key)`，根节点另设部分唯一索引 |
| `calendars / story_times / story_events / event_entities / event_dependencies` | 历法、区间、相对锚点、精度、事件参与者及因果；相对引用无环；叙述顺序另存 plot，不用系统时间算年龄 |
| `foreshadows / foreshadow_occurrences` | 计划和实际埋设/回收分离，状态含延期/放弃；实际记录关联具体正文版本证据 |
| `manuscripts / manuscript_revisions` | 文稿类型、正史/平行范围、当前版本；正文和哈希不可变，`UNIQUE(S,manuscript_id,revision)`；后记默认不进入正史 |
| `canon_facts / fact_versions / knowledge_states` | 事实、批准/撤销版本、角色或读者认知；认知分 knows/believes/hearsay，不把发言直接当客观事实；保留故事有效期和系统修订时间 |
| `source_refs / dependencies / materials` | 证据指向确切正文版本、UTF-8 字节区间、摘录哈希；依赖与表达素材分离；分别用实体/事实/规划关联表实现类型化 FK，不用无约束 `(type,id)` |
| `issues / writing_tasks / change_sets / change_items` | 矛盾、卡点、修订原因、前后版本、影响范围；各类型 change item 使用对应 FK |
| `context_snapshots / audits / audit_findings / commits / commit_items` | 冻结上下文、选择/未选原因、审计证据、采纳回执；版本元组及哈希不可变，失效状态可另追加事件 |
| `budgets / budget_reservations / billing_ledger / provider_attempts` | 金额用最小币种单位 bigint、币种及价格快照；预算范围/周期唯一；预占与任务关联；账本追加，冲正不覆盖；供应商请求号在账户范围唯一 |
| `jobs / job_events / job_dispatch / outbox / inbox_dedup / api_idempotency` | 八态任务、attempt_no/fencing_token/租约、事务事件、消费者去重、请求回执；outbox按聚合类型+ID+版本+事件序号唯一，不按job+event_type去重；每项均带S；job_dispatch仅含调度范围ID/状态/租约，不含正文或prompt |
| `cache_entries / export_manifests / export_files / import_runs / legacy_id_map / legacy_payloads / attachments` | 派生缓存、快照导出、隔离导入、旧 ID 映射、原始 payload、对象清单；导入源哈希与旧类型/ID唯一映射到目标 scope |

所有项目对象 FK 显式包含 S，版本证据再含对象 ID 和 revision；禁止只引用全局 UUID。身份引用仍指向 users，不虚构项目用户副本。可空引用除始终非空的 S 外，对象 ID/版本须同空或同非空，以 CHECK 保证；整个引用均可空时可用 `MATCH FULL`。删除默认 RESTRICT/NO ACTION，禁止级联删正文。跨项目复制生成新 ID 并映射全部引用，不能保留跨项目 FK。复合 FK、唯一约束及删除行为设计参考：`https://www.postgresql.org/docs/current/ddl-constraints.html`。

不可变版本表 app 仅 SELECT/INSERT；头更新必须 CAS，同事务追加完整资料快照、changeset 和来源。正常请求未知字段报错；迁移未知字段存原始区并报告。未提供的字段表示保持原值，显式 null/删除操作才表示清空。列表稳定游标分页，不静默截断。

## 3. 最小 DDL 参考（未执行）

以下是可交给隔离空库核验的基础子集，无扩展依赖；UUID 由应用传入。执行者须具备创建角色/对象权限，示例角色和 schema 尚不存在；只定义 NOLOGIN 权限角色，不提供密码、实际登录账号或生产切换命令。**不是完整 migration**：未包含 inventory 全表、owner 保底触发器、类型化证据表及受控管理函数；这些缺失项默认不可用，不可先放宽权限上线。所有表由独立迁移身份创建，app 不得是表 owner、超级用户、owner 角色成员或具有 BYPASSRLS；真实登录角色的继承权限也须检查。

```sql
BEGIN;
CREATE ROLE novel_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOBYPASSRLS;
CREATE SCHEMA novel;
REVOKE ALL ON SCHEMA novel FROM PUBLIC;
SET LOCAL search_path = novel, pg_catalog;

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text,
  disabled_at timestamptz
);
CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE projects (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  bible_revision bigint NOT NULL DEFAULT 1 CHECK (bible_revision > 0),
  plan_revision bigint NOT NULL DEFAULT 1 CHECK (plan_revision > 0),
  state_revision bigint NOT NULL DEFAULT 1 CHECK (state_revision > 0),
  acl_revision bigint NOT NULL DEFAULT 1 CHECK (acl_revision > 0),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, id)
);
CREATE TABLE project_members (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN
    ('owner','admin','editor','reviewer','viewer')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (workspace_id, project_id, user_id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES projects(workspace_id, id),
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_members(workspace_id, user_id)
);
CREATE UNIQUE INDEX one_active_owner ON project_members
  (workspace_id, project_id) WHERE active AND role = 'owner';

CREATE TABLE entities (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES projects(workspace_id, id)
);
CREATE TABLE relations (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  source_id uuid NOT NULL,
  target_id uuid NOT NULL,
  kind text NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id, source_id)
    REFERENCES entities(workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id, target_id)
    REFERENCES entities(workspace_id, project_id, id)
);
CREATE TABLE manuscripts (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES projects(workspace_id, id)
);
CREATE TABLE manuscript_revisions (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  manuscript_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  body text NOT NULL,
  body_hash text NOT NULL CHECK (body_hash ~ '^[0-9a-f]{64}$'),
  author_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, manuscript_id, revision),
  FOREIGN KEY (workspace_id, project_id, manuscript_id)
    REFERENCES manuscripts(workspace_id, project_id, id)
);
ALTER TABLE manuscripts ADD CONSTRAINT manuscript_head_version
  FOREIGN KEY (workspace_id, project_id, id, revision)
  REFERENCES manuscript_revisions
    (workspace_id, project_id, manuscript_id, revision)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE jobs (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN
    ('queued','claimed','running','cancel_requested','cancelled',
     'succeeded','failed','provider_unknown')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  attempt_no integer NOT NULL DEFAULT 0 CHECK (attempt_no >= 0),
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_owner uuid,
  lease_until timestamptz,
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
  CHECK (state NOT IN ('claimed','running') OR
    (lease_owner IS NOT NULL AND attempt_no > 0 AND fencing_token > 0)),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES projects(workspace_id, id)
);
CREATE TABLE outbox (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid,
  commit_id uuid,
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('job','commit')),
  aggregate_id uuid NOT NULL,
  aggregate_revision bigint NOT NULL CHECK (aggregate_revision > 0),
  event_seq integer NOT NULL CHECK (event_seq > 0),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz,
  PRIMARY KEY (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, aggregate_type, aggregate_id,
    aggregate_revision, event_seq),
  CHECK ((job_id IS NOT NULL AND commit_id IS NULL) OR
    (job_id IS NULL AND commit_id IS NOT NULL)),
  CHECK ((aggregate_type = 'job' AND job_id IS NOT NULL
      AND aggregate_id = job_id) OR
    (aggregate_type = 'commit' AND commit_id IS NOT NULL
      AND aggregate_id = commit_id)),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES projects(workspace_id, id),
  FOREIGN KEY (workspace_id, project_id, job_id)
    REFERENCES jobs(workspace_id, project_id, id)
);
CREATE TABLE api_idempotency (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  operation text NOT NULL,
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  job_id uuid,
  http_status integer CHECK (http_status BETWEEN 100 AND 599),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, actor_id, operation, key),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES projects(workspace_id, id),
  FOREIGN KEY (workspace_id, project_id, job_id)
    REFERENCES jobs(workspace_id, project_id, id)
);

DO $ddl$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users','workspaces','workspace_members','projects','project_members',
    'entities','relations','manuscripts','manuscript_revisions',
    'jobs','outbox','api_idempotency'
  ] LOOP
    EXECUTE format('ALTER TABLE novel.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE novel.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END;
$ddl$;

CREATE POLICY self_user ON users FOR SELECT TO novel_app
  USING (id = nullif(current_setting('app.user_id', true), '')::uuid
    AND disabled_at IS NULL);
CREATE POLICY self_workspace_member ON workspace_members
  FOR SELECT TO novel_app USING (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND user_id = nullif(current_setting('app.user_id', true), '')::uuid
    AND active
  );
CREATE POLICY self_project_member ON project_members
  FOR SELECT TO novel_app USING (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND project_id = nullif(current_setting('app.project_id', true), '')::uuid
    AND user_id = nullif(current_setting('app.user_id', true), '')::uuid
    AND active
  );
CREATE FUNCTION can_project(
  target_workspace uuid, target_project uuid, allowed_roles text[]
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, novel
AS $fn$
  SELECT
    target_workspace = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND target_project = nullif(current_setting('app.project_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM novel.project_members AS membership
      JOIN novel.workspace_members AS workspace_membership
        ON workspace_membership.workspace_id = membership.workspace_id
        AND workspace_membership.user_id = membership.user_id
      JOIN novel.users AS actor ON actor.id = membership.user_id
      WHERE membership.workspace_id = target_workspace
        AND membership.project_id = target_project
        AND membership.user_id =
          nullif(current_setting('app.user_id', true), '')::uuid
        AND membership.active AND workspace_membership.active
        AND actor.disabled_at IS NULL
        AND membership.role = ANY(allowed_roles)
    )
$fn$;
REVOKE ALL ON FUNCTION can_project(uuid, uuid, text[]) FROM PUBLIC;
GRANT USAGE ON SCHEMA novel TO novel_app;
GRANT EXECUTE ON FUNCTION can_project(uuid, uuid, text[]) TO novel_app;
GRANT SELECT ON users, workspace_members, project_members TO novel_app;

DO $policies$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'projects','entities','relations','manuscripts','manuscript_revisions'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY project_read ON novel.%I FOR SELECT TO novel_app
       USING (novel.can_project(workspace_id, %I,
         ARRAY[''owner'',''admin'',''editor'',''reviewer'',''viewer'']))',
      table_name, CASE WHEN table_name = 'projects' THEN 'id' ELSE 'project_id' END
    );
    EXECUTE format('GRANT SELECT ON novel.%I TO novel_app', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY[
    'entities','relations','manuscripts','manuscript_revisions'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY project_insert ON novel.%I FOR INSERT TO novel_app
       WITH CHECK (novel.can_project(workspace_id, project_id,
         ARRAY[''owner'',''admin'',''editor'']))', table_name
    );
    EXECUTE format('GRANT INSERT ON novel.%I TO novel_app', table_name);
    IF table_name <> 'manuscript_revisions' THEN
      EXECUTE format(
        'CREATE POLICY project_update ON novel.%I FOR UPDATE TO novel_app
         USING (novel.can_project(workspace_id, project_id,
           ARRAY[''owner'',''admin'',''editor'']))
         WITH CHECK (novel.can_project(workspace_id, project_id,
           ARRAY[''owner'',''admin'',''editor'']))', table_name
      );
    END IF;
  END LOOP;
END;
$policies$;
GRANT UPDATE (name, payload, revision, deleted_at) ON entities TO novel_app;
GRANT UPDATE (source_id, target_id, kind, revision, deleted_at)
  ON relations TO novel_app;
GRANT UPDATE (revision, deleted_at) ON manuscripts TO novel_app;
COMMIT;
```

DDL 的 jobs/outbox/幂等表及 workspace 容器故意没有 app 开放策略，默认拒绝；不得把内容编辑策略整段复制到计费、导出或 ACL。正式 migration 为各表补最小动作策略、列权限和受控事务函数：财务仅 owner/admin，人工审查意见允许 reviewer 以上，推理/付费审稿须角色和 canSpend 双重授权，导出全链路须 canExport，状态推进仅受控 worker；管理函数禁止任意 SQL/任意 tenant 参数提权，固定 search_path、撤销 PUBLIC EXECUTE，不授予 app 成员表直接 UPDATE。身份/成员自读策略不调用项目策略，避免 RLS 递归。

outbox 子集只提供 job 的复合 FK、job/commit 恰一来源 CHECK 和事件唯一键，**尚无 commits 表及 commit_id 外键，不能作为完整来源约束上线**。完整 migration 必须补 `(S,commit_id) → commits(S,id)`；若扩展其他来源，逐项加显式同项目 FK 并扩充恰一来源 CHECK，不能仅靠 aggregate_type/aggregate_id。手工正式 commit 无需伪造 job：job_id 可空、commit_id 指向真实提交；同 job 同 event_type 的不同版本或同版本不同 event_seq 都可落库，序号随聚合更新原子分配，不吞状态事件。

RLS 必须 ENABLE+FORCE，缺少策略拒绝；FORCE 不能约束超级用户或 BYPASSRLS。app 禁止 DDL/TRUNCATE，新增表在授权前纳入 RLS 清单。**RLS 是 tenant+project 读范围防线：同时匹配两级 scope、当前 user 及有效项目成员，绝非只设 tenant GUC 就有项目隔离。** 示例写策略只是附加粗粒度限制；每次写仍由服务端按角色、资源类型、字段、项目状态授权，不能以 RLS 替代 CAS、软删除规则或管理动作检查。设计参考：`https://www.postgresql.org/docs/current/ddl-rowsecurity.html`。

写前必须重验对象 deleted_at、project deleted/archived 和 actor disabled；删除/归档项目禁止普通写，恢复及既有费用对账走专门受控动作。示例 can_project 虽检查 disabled_at，却未覆盖完整状态模型、能力及并发撤权，也未阻止所有软删对象更新；这些检查由服务端和正式 migration 的列/状态约束、策略或受控函数补齐，不能声称当前写策略已完备。

每个请求从 pool 获取**一个专属 client**，BEGIN 后由已验证会话及路径参数执行下例；所有仓储调用使用该 client，不可穿插 `pool.query`。事务成功 COMMIT，异常 ROLLBACK；回滚/连接状态不明则销毁连接，不归还池。禁止 session 级 scope，禁止客户端传角色或直接连库；worker 同规。`is_local=true` 仅作用当前事务，依据：`https://www.postgresql.org/docs/current/functions-admin.html`。

```sql
SELECT set_config('app.user_id', $1, true),
       set_config('app.workspace_id', $2, true),
       set_config('app.project_id', $3, true);

UPDATE novel.manuscripts
SET revision = revision + 1
WHERE workspace_id = $1::uuid AND project_id = $2::uuid
  AND id = $3::uuid AND revision = $4::bigint AND deleted_at IS NULL
RETURNING revision;
```

以上参数 SQL 是事务片段，不是独立 migration；CAS 返回零行立即终止，不转无条件 UPDATE。成功后须在提交前 INSERT 对应 manuscript_revisions，延期 FK 保证头不悬挂。正式稿还须完成下一节全量原子提交。连接借出时检查无残留事务/scope，所有路径覆盖缺失 scope 和跨租户复用；自定义 GUC 不是防 SQL 注入或伪造会话的身份系统。

### 3.1 控制面发现与首次创建，不能靠关闭RLS实现

上面的最小DDL要求项目scope，因此本身不提供跨已授权项目列表或首次建工作区的完整功能。T03必须另外实现受控的身份/发现/引导服务：

- `resolve_session`仅按提交的受保护token摘要查有效会话，返回认证所需身份元数据；撤销在所有节点生效，不向客户端或日志返回摘要/凭据。
- `list_my_workspaces`只列当前有效身份的成员关系；`list_my_projects(workspaceId)`只列其显式加入且可见的项目。返回限定列和游标，不允许通过未设置project GUC来开放所有内容表。
- 首次建工作区/项目由受控事务同时创建容器和owner成员；actor由会话确定，新ID由服务端生成，不能接收任意ownerId给别人或给自己提权。
- 发现/引导可采用专用受限函数或分离仓储身份，但不得把日常app改为table owner/BYPASSRLS。若用SECURITY DEFINER，须固定安全search_path、撤销PUBLIC EXECUTE、限制执行者、校验actor/配额/成员条件并测试恶意参数；函数只返回其声明的元数据。
- 调度服务仅领取job_dispatch的最小元数据，再以有效job/claim/fencing及当前权限进入限定项目执行，不能因跨项目排队而扫描所有正文。

这些是完整migration的必需补充。若发现/引导尚未实现，相关端点应保持不可用，不能放宽RLS换取界面可用。项目/工作区生命周期接口以README §3.4为准。

## 4. API 矩阵与错误协议

统一前缀 `P=/api/v2/workspaces/:workspaceId/projects/:projectId`，以下每行一个method+模板，共24条。`type`采用README §6.5白名单并映射固定schema/服务，禁止映射任意表名。正式事实/认知、财务、ACL和审计不能通过通用resources任意修改；正文PATCH只能保存草稿。需要审批的正式设定变化走changeset，不以普通字段更新绕过审批政策。

| # | 方法及 P 后路径 | 权限/契约 |
| --- | --- | --- |
| 1 | GET `/snapshot` | viewer+；项目元数据及 bible/plan/state/acl revision |
| 2 | GET `/resources/:type` | viewer+；游标、筛选，回收站显式 includeDeleted |
| 3 | POST `/resources/:type` | editor+；创建稳定 ID；reviewer 仅可创建工单意见 |
| 4 | GET `/resources/:type/:id` | viewer+；正文/资料及强 ETag |
| 5 | PATCH `/resources/:type/:id` | editor+；If-Match、资料历史；reviewer 仅改本人未定稿意见 |
| 6 | DELETE `/resources/:type/:id` | editor+；If-Match、影响凭证、软删 |
| 7 | POST `/resources/:type/:id/restore` | editor+；If-Match、来源版本及恢复原因 |
| 8 | GET `/resources/:type/:id/revisions` | viewer+；历史分页、可指定 revision/impact 只读比较 |
| 9 | POST `/commits` | 仅 owner/admin/editor；If-Match，按 author_owned/two_person 校验后原子采纳 |
| 10 | GET `/commits/:commitId` | viewer+；不可变回执，断线查询 |
| 11 | POST `/jobs` | 按 kind 授权；推理/付费审稿仅 owner/admin/editor 且 canSpend；导出仍须 canExport，不可用通用 job 绕过 |
| 12 | GET `/jobs/:jobId` | 普通任务 viewer+；导出任务另需当前 canExport，状态/事件/结果均不得泄露清单、下载或财务字段 |
| 13 | POST `/jobs/:jobId/cancel` | 发起者且仍有该动作权限，或 admin+；If-Match |
| 14 | POST `/exports` | owner/admin/editor且当前canExport；默认仅owner/admin，冻结版本、生成导出job |
| 15 | GET `/exports/:exportId` | owner/admin/editor且当前canExport；清单/下载均重验，viewer/reviewer不能仅凭正文可读下载他人导出 |
| 16 | POST `/imports` | admin+；mode=preflight/apply，apply 绑定检查回执及空目标项目基线 |
| 17 | GET `/budget` | admin+；预算、预占、项目账本分页 |
| 18 | PATCH `/budget` | admin+；If-Match，不能调低至已用+预占以下 |
| 19 | GET `/audits` | viewer+；版本绑定发现项、stale 和作者决策 |
| 20 | PATCH `/members/:userId` | 按 §1；If-Match 使用 aclRevision，支持受控所有权转移 |
| 21 | POST `/change-sets` | editor+；引用已保存的候选/资料版本与基线，服务端验证提出的delta，返回不可变提案及deltaId/hash；不自动确立事实、不自动调用模型 |
| 22 | GET `/change-sets/:id` | viewer+；仅授权项目的提案、版本、证据和决策状态，财务/凭据不返回 |
| 23 | POST `/change-sets/:id/reviews` | reviewer+；按策略校验独立审查资格，结论绑定提案全版本元组；不直接改正文或执行commit |
| 24 | POST `/change-sets/:id/author-decisions` | owner/admin/editor；记录实际操作者确认及理由，保留原作者；two_person下不能代替独立review；不伪造机器PASS |

项目创建/删除恢复与身份生命周期由主手册补路由，仍须使用相同 scope 和授权服务，不凭本矩阵开放旁路。

所有 POST 强制 `Idempotency-Key`；作用域 `(S,actor,method+规范化路径,key)`。请求摘要覆盖规范化 body、基线及语义选项。同 key 同摘要返回原状态/回执，异摘要 409；先授权再查幂等，撤权后不能重放读旧正文。并发通过 UNIQUE 争抢，原事务失败则整笔回滚；运行中返回同一 job 的 202。回执至少保存 30 天；未终结及 provider_unknown 不过期，付费任务关联的去重摘要随账本保留，不能清 key 后再收费。

PATCH/DELETE/恢复/采纳及依赖既有基线的 POST 必须强 `If-Match`；ETag 含资源 ID+revision，禁止 `*` 和弱标签。缺失 428，格式错 400，已过期 412；正文版本匹配但 bible/plan/state 或审计失配返回 409 `BASELINE_STALE`，不得自动合并采纳。创建无旧资源不要求 If-Match。

错误统一 `application/problem+json`：`type,title,status,code,detail,requestId,errors`；冲突仅向已授权者附currentRevision/rebaseRequired。401未登录；跨租户、无项目成员或不存在统一404；已知项目动作不足403；字段/schema/引用错误422；幂等异载荷、恢复冲突、预算/存储等业务配额不足409；请求体过大413，媒体不支持415；纯限流429附Retry-After；不可用503。If-Match缺失/错误/过期按上段428/400/412。不得返回SQL、其他项目是否存在或供应商凭据。

## 5. 原子提交、预算与异步未知

提交输入绑定 `workspaceId+projectId+chapterId+manuscriptHash+bibleRevision+planRevision+stateRevision+contextHash+deltaHash+auditPolicyVersion`，另含正文基线、auditId 或作者确认及争议理由。哈希由服务端按固定规范重算；正文按原始 UTF-8 字节，不偷偷归一化换行，delta 按版本化规范序列化。

默认审批策略 `author_owned`：有项目编辑权的owner/admin/editor可对有权编辑的候选和争议增量作出自己的确认，不强迫个人用户找第二人。原作者来自服务端版本记录，AI候选保留人类发起者；确认者记录实际actor，不冒用原作者。可选 `two_person`：当前有审查权且不同于不可变changeset.proposedBy的人，对完全相同的正文/增量/版本元组作有效审查；reviewer可审查，但执行正式commit始终仅限owner/admin/editor。审批策略及版本进入凭证，修改稿件或策略后旧确认不得复用；两种策略均不能省略结构、引用、CAS和基线检查。手工稿通过change-sets取得经验证deltaId，不必伪造模型审计或支付推理费用。

一次短事务：幂等占位 → 取得必要成员及项目锁、正文头锁 → 在锁内重验授权、审批策略、全部基线及证据 → CAS 正文头 → 插入不可变正文版本 → 应用已确认 delta 到事实/认知/关系/伏笔及资料历史 → 按变化推进 bible/plan/state revision → 记录 audit 关联、作者决策、changeset、commit 回执 → 写 outbox、幂等结果 → COMMIT。占位前仍须初步授权；无变化的版本不加一，任一步失败全回滚。网络 provider 调用绝不占用该事务。草稿保存不隐式确立事实；作者确认不冒充机器通过。旧事实依赖的审计置 stale，失效影响随事务落库。

正文提交**不锁 workspace 容器行**，避免把全租户写串行化。固定锁序：必要身份/工作区成员 → 项目 → 项目成员/能力授权 → 正文等业务头及 job → 实际发生额度变化的预算行；同类按 scope+稳定 ID 排序。授权行取共享锁保护资格，撤权/禁用取冲突写锁；项目及修改的业务头取写锁，预先确定锁模式避免升级死锁。预算仅在预占/结算/释放/调额时锁，无费用变化的手工提交不锁共享预算。撤权、项目删除、worker、预算端点遵守同序，不允许先锁预算再反向锁项目；涉及多项目先按序取得全部项目锁。锁内重新授权，不依赖任务开始时的身份快照。

PG行锁所需权限必须单独审查：不能因app对成员表只有SELECT、直接FOR SHARE遇到权限问题，就授予app任意修改成员/角色的权限。可使用专用的受控授权锁函数，在固定search_path和参数白名单下按上述顺序取得必要锁并重验资格，普通app仅获执行权。函数和RLS引用其他表时的并发行为要用真实撤权竞争测试验证，不能用单线程读取证明不存在竞态；参考PG18 RLS文档的权限表并发示例。该函数不在最小参考DDL中，属于T03/T11完整实现要求。

事务设计选 READ COMMITTED 配合显式行锁和 CAS；不能把一次普通 SELECT 当稳定快照。跨表快照导出使用只读 REPEATABLE READ，先物化快照清单再异步打包，不能逐页读取变化中的当前头。若后续选择 SERIALIZABLE，40001/40P01 只能有限重试整个纯数据库事务，并复用原幂等键、重验授权；业务 412 不自动重试，任何数据库重试均不得包含 provider 外呼。隔离设计参考：`https://www.postgresql.org/docs/current/transaction-iso.html`。

建 job、冻结上下文、必要预算预占、outbox、幂等回执同事务；不付费的内部任务无需锁额度。外呼先重验 canSpend，再锁预算行检查 `spent+reserved+本次上限<=limit`，每次修订/重试各有上限；未能预占不能外呼。outbox 至少一次投递，消费者以 `(S,eventId,consumer)` 去重。账本每个 attempt+entryType 唯一，结算/释放/冲正追加且同事务；超估价不得伪造少扣，记实际成本并阻止后续任务。

jobs 状态固定 `queued/claimed/running/cancel_requested/cancelled/succeeded/failed/provider_unknown`。通常 queued→claimed→running→succeeded/failed；取消先记录 cancel_requested，确认停止才 cancelled，可能已外呼则进入 provider_unknown，不用 cancelled 掩盖未知成本。lease_owner 是 worker 实例 UUID，不是用户 ID；每次合法领取原子递增 attempt_no、fencing_token、revision 并写租约，领取次数不等于供应商调用次数。

领取用单次条件 UPDATE 或锁定后条件 UPDATE，比较 S+id、预期 revision、可领取状态及租约条件；running 推进、续租及结果写回必须同一原子操作比较 S+id、state、revision、attempt_no、fencing_token、lease_owner 和未过期 lease_until，同时推进 revision，零行即失去写权。状态事件和 outbox 同事务追加；取消通过受控 CAS 与 worker 写回竞争，不是忽略围栏的特殊覆盖。租约到期仅可重领已证明无外部副作用的内部步骤；可能已外呼必须对账并围栏旧 worker，不能仅递增 attempt 后重发。

provider 请求前持久化 attempt、请求摘要、幂等能力、价格快照。超时/断线/崩溃且可能已送达，一律 `provider_unknown`；**不因租约过期、SDK 重试或新 requestId 自动重发**，保留预占，GET 原 job 并对账。仅有供应商可验证结果/未执行证明后续转成功或失败；无法判定需人工决定，显式新尝试记录可能重复费用并重新预占。取消是请求停止，不保证撤销已发生调用或立即退款。

## 6. 删除恢复、历史与无损切换

DELETE 先取绑定 revision 的影响预览凭证，提交时重算；有关联返回 409 及同项目影响，用户明确选择归档或修订引用，绝不级联擦除正文。软删保留 ID、版本、原卷归属和 tombstone；常规读取排除，历史/回收站仍按当前成员授权。项目删除仅 owner，禁新写/新外呼，已外呼允许受限对账；只有 owner 可经受控入口恢复，不能让普通资源接口绕过项目删除状态。

恢复不是把 revision 倒退：从选定旧版本新建修订，重新校验同项目引用、父层级、排序和唯一约束；目标也被删则 409，允许显式映射，不自动复活整条依赖链。资料每次修改、归档、删除、恢复都有不可变历史、操作者和原因。物理清理由另行批准的保留/合规策略处理，本版无公开硬删端点，历史及账本不得随业务软删消失。

迁移顺序固定：只读清点及一致性备份/恢复演练 → 隔离 PostgreSQL 导入 → 决定性旧 ID 映射与歧义人工确认 → 保留原 payload、未映射字段、资料历史、原文和来源哈希 → 比较数量、字节哈希、时间线、关系、伏笔、状态 → 影子读取 → 项目级切换唯一写入服务。资料备份包含 schema/快照/文件哈希及引用清单；导入检查路径穿越、大小、哈希、引用和 ID 冲突，默认新空项目，排除会话/密钥/其他项目数据。

旧 novels、creation_books、工作区副本映射同一 project。旧保存、圣经 PUT、聊天、benchmark、流式和内部脚本全部转同一授权/CAS/commit；不能携带版本的旧写端点返回 428 或明确停用，禁止“兼容”无条件覆盖。切换后禁旧库写、禁长期双权威；回退须先保全并重放切换后变更，不能回滚掉新稿。以上均为未来实施要求，本轮无执行证据。

## 7. 必须与主手册对齐的决策

1. PG18 唯一正式多用户权威、实施环境 pin 确切最新补丁；SQLite 单机边界及项目级切换/回退窗口。
2. workspace=tenant、角色 owner/admin/member；project 显式五角色；首次创建两级 owner 原子建立、无跨级正文继承、平台运维默认无正文权限。
3. 项目生命周期路由、删除恢复权限、RLS 两级读范围加服务端状态/动作授权；canSpend/canExport 是额外能力，导出全链路检查，reviewer 不得发起付费审稿；不得出现旧端点特权。
4. 类型注册表、历史保留/硬删审批、故事历法、正史范围、delta 规范与哈希算法版本。
5. If-Match/幂等保留、完整审计元组、默认 author_owned/可选 two_person、提交仅 owner/admin/editor；作者确认与机器通过分离，成员/项目固定锁序而非锁整个 workspace。
6. jobs 八态及 attempt/fencing/租约原子比较；outbox 按聚合版本+事件序号唯一，正式迁移补全来源 FK；预算按实际变化加锁、provider_unknown 人工对账、取消及重复费用告知。
7. Luna 须补全 migration/动作策略，并另行验证复合 FK、RLS/池串租、撤权竞态、CAS、故障原子性、无损往返；本文件仅做文档静态核对，不代写主手册或验收手册。
