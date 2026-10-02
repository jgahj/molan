# 墨阑 P0–P3 模型交接（2026-10-01）

后续暂停检查点见 `p0-p3-unfinished-20261001.md`：包含本轮未提交 link-novel、费用派发日志与拆书只读扩展的实际状态、验收失败和未完成清单。继续工作时先读该检查点，再沿用本文的环境与用户改动边界。

## 任务与授权

继续落实已批准的 P0–P3 方案：原生 PostgreSQL 生产与 fs JSON 本地仓储；领域服务/路由拆分；确定性上下文预算；真实质量防退化。用户已授权实施、配置隔离环境及分阶段 Git 提交。不要再次要求批准同一方案，不推送、不部署、不拆前端编辑器。禁止将兼容驱动替换或把巨石挪到另一文件视为完成。

项目：`C:/Users/lyh/Desktop/小说专属网页/molan-home`；Git 根为上级工作区，当前 main。遵守工作区 AGENTS.md：PowerShell、login=false、UTF-8、优先 rg、限定搜索、apply_patch 编辑。保护 books/raws/deploy_tmp/tmp-booktest，不扫描依赖和数据。用户指定子代理 `gpt-6-luna`，reasoning `max`；父代理负责复杂问题、合并与复核。已有方案与替代方案检索已做且获授权，不重新从零开始。

## 已提交成果（不要重复实现）

- `441fea2`：聊天编排抽至 services/chat-service.js，显式注入并复用并发、模型传输与流式运行时；90/90 定向检查通过。
- `c3f6b24`：原生独立创作书，owner+book 哈希分区与全局书/Bible 索引。支持创建、列表、Bible CAS、状态、债务、质量报告，不造占位小说。未关联时章节合同和提交返回 CREATION_PROJECT_REQUIRED。8/8 原生创建/回滚/启动检查通过。
- `9b99914`：creation-scope 与文风 HTTP 测试迁为原生 JSON；跨账户 404、Bible/state/debts 与共享仓储重开。2/2 通过。
- `67f961e`：取消/未知供应商费用保护。JSON 与 PG 保留 provider_unknown 预占，费用 null，过期回收不退款，后续完整用量幂等结算。两遍任一遍缺用量时不冒称精确；重置 second-pass lastUsage，避免沿用首遍。65/65 聊天/费用检查及 PG 合同2/2通过。
- `ee6c716`：quality-loop 普通测试改原生 JSON，保留 replay/shadow/block/failure/不可覆写与重启检查，5/5通过。
- 更早已完成 PG memory/style 原生领域链、JSON generation、服务拆分、A/B 比较/证据校验/配置晋级门禁等，先核验现有文件，不重做。

## 真实验证

已提交快照目录：`C:/Users/lyh/AppData/Local/Temp/molan-committed-validation-AMqMIE`，目前刷新到 ee6c716 前后的已提交成果（快照不包括尚未提交路由改动）。其中 node_modules 是 junction，不递归删除。

刷新：使用 `C:/Users/lyh/AppData/Local/Temp/molan-refresh-committed.cjs <project>`，从 HEAD 刷新任务文件；刷新结束再验证。

在仅含提交内容的快照，原生启动/重启、普通聊天、断连取消、两遍部分用量、创建权限、文风重开、PG费用合同共8/8通过。完整 `scripts/postgres-http-smoke.mjs` 和 `scripts/postgres-billing-smoke.mjs` 均在真实本机 PostgreSQL 18.6 隔离库通过，覆盖 RLS/成员隔离、CAS、素材资料包、创作流程存储、记忆/文风/债务、任务、软删除以及未知费用保留/过期不退款/精确结算一次。

上述模型响应及章节质量证据是本地合成夹具，只证明存储/接口合同；不是付费模型文学质量证据。

Node24：`C:/Users/lyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。

真实 PG 每次独立 exec 显式设置：

```powershell
$env:MOLAN_PG_ENABLED='1'
$env:MOLAN_PG_HOST='127.0.0.1'
$env:MOLAN_PG_PORT='55439'
$env:MOLAN_PG_DATABASE='molan_quality_acceptance_20261001'
$env:MOLAN_PG_USER='novel_runtime'
$env:MOLAN_PG_PASSWORD_FILE='C:/Users/lyh/AppData/Local/Temp/molan-quality-pg-20261001-342de1b1f58040f3a8309bac3da3c992/runtime-password.tmp'
```

worker角色 novel_worker_runtime，同目录 worker-password.tmp；PG bin 为 `C:/Users/lyh/AppData/Local/molan-postgresql/pgsql-18.6/pgsql/bin`。不得输出密码或指向生产库。环境变量不跨 exec 自动保留。

## 未提交内容与用户差异边界

交接前已验证并准备提交的路由批次（以最终 git log 为准）：

- routes/novel-domain-handlers.js：新增原生小说导出，repository.read 同事务取得正文与 canExport，再复用既有 parseNovelExportRange/sendNovelExport，保持 TXT/EPUB/DOCX、范围和成员权限语义。
- server.js：仅本任务新增 JSON 导出接线/允许路径，以及三个纯 registry catalog 的独立分发接线；仍混有用户原8处差异，不能整文件 git add。
- lib/memory-routes.js：JSON native 未匹配请求明确 404/401，不再落回 SQL dispatcher 或旧 style 路径。
- services/native-knowledge-catalog-service.js 与 test/native-knowledge-catalog-http.test.js：只接管三个精确 GET：genre-catalog/model-capabilities/style-catalog，响应与旧 API 一致，不扩大其他接口允许范围。
- test/native-memory-routing.test.js、test/native-startup.test.js：验证 JSON miss 禁止 SQL fallback、catalog主入口与重启。4/4通过。
- docs/native-storage-operations.md：最新迁移缺口说明，未提交。
- test/project-scope.test.js：已迁 JSON并通过1/1；保留旧HTTP导出、记忆变化集审批/提交/幂等、成员、资料包、资源历史等断言，原生memory记录精确验证outbox为1条。只移除了SQLite creation_core_jobs表存在性的实现细节断言（该原生能力仍未迁，不能据此称已完成）。原始用户版本备份见下。

用户原差异（不要未经区分纳入提交）：lib/evolution/quality-loop.js、lib/evolution/soak-sqlite-store.js、server.js 原8处 PureJs/import/log改动、services/dissection-pipeline-store.js原注释、services/generation-service.js原onError日志、未跟踪lib/pure-js-database.js。PureJs不是最终仓储，不能作为P0完成依据。

原 creation-scope/quality-loop 测试中的用户临时PureJs import已因必要JSON迁移替换，先备份到 Temp：molan-creation-scope.test.js.before-native-migration、molan-home-quality-loop.test.js.before-json-store.20261001.bak。project-scope备份为 molan-project-scope.test.js.before-native-json-migration。

server选择性暂存工具：`C:/Users/lyh/AppData/Local/Temp/molan-stage-task-domains.cjs <project> server.js`，自动剔除原8处用户差异，仅写index；检查 staged diff后提交。原用户patch为 `C:/Users/lyh/AppData/Local/Temp/molan-server-user.patch`。不要 `git commit <server path>`，会绕过index。

## 下一步执行顺序

1. 先 git status/log 核验最新路由批次与提交，刷新已提交快照，复验原生导出、catalog和JSON fallback的主入口行为；工作树定向5项已通过。保留原export合同及精确outbox断言，不改TODO。用户差异继续保留，server选择性暂存。
2. 原生 `/api/creation-books/:id/link-novel` 尚未实施（只做了只读核查，未落盘）。旧入口 server.js handleCreationBookLinkNovel 接受已有 novelId，不创建小说；书需可写，目标小说需真实存在且调用者具 WRITE_ROLES。实现 owner独立书→真实项目关联的跨分区事务，更新book/Bible/活动状态/INDEX，保留IDs、版本、成本、历史证据；权限冲突完整回滚，跨用户404；不绕过immutable ledger（不可删改，只保留来源与必要目标证据，避免成本双算）。已关联书的重链与冲突行为需明确保留旧兼容语义或安全拒绝。修改限定 json-creation-repository、native-creation-service及定向测试。
3. P0仍未完成：JSON creation缺 plan-expand/plan-review/regenerate-asset/core-jobs；拆书缺 export/apply/creative-brief/creation-context/audit/coverage/entities/foreshadows/summaries/validation/search/rebuild及历史dissection扩展；admin除auth/skills外overview/models/audit/data/users仍依赖SQL。逐域完成异步领域接口迁移，不能仅扩大allowlist。
4. 默认运行链仍 initDB/旧SQL，生产导入审计故意BLOCKED。迁完调用者再退出postgres-memory-bridge/SQL/PureJs链、默认JSON、本地旧库显式迁移；普通测试与日常脚本零SQLite，隔离迁移工具允许保留。禁止移动普通测试到legacy凑门禁。
5. 已提交未知费用修复尚缺“调用派发前持久化attempt/journal”：发送后写盘失败或进程中断时reserved仍可能被reaper退款。设计持久派发记录、恢复未知、失败前禁止供应商调用；不要宣称现有finalize hold已完整解决。public用量汇总目前partial total可能被算入preciseRequestCount，需保持未知证据口径，费用null不可伪造0。
6. P1 server约8900行，目标<=300未达成。继续按业务域抽离服务、生命周期与依赖注入，不仅复制到另一个runtime巨石。现有routes已拆七域，优先搬业务服务及初始化/后台生命周期，保留URL、Cookie、SSE、取消行为。
7. P2已有context.js/compiler-v5、八层预算、场景机制与债务窗口、回放清单等；先检查 generation-context-compiler-p2.test.js及实际调用链。守住任务/硬事实/视角/禁令/到期债务不可剪，全局事实审计不缩；固定拥堵样本估算节约目标30%，真实调用用量独立记录。
8. P3已有 compare-quality-vectors/run-quality-ab/promote-quality-config CLI与证据门禁。真实评分规范是19维，画像23个顶层字段并非23个评分，别造分数。Golden canonical仍metadata_only，真实正文任务集与费用上限未提供，真实A/B及配置晋级继续BLOCKED；不要擅自付费调用或将夹具标ready。实际23维需求需按证据规范处理，不能自报完成。真实质量通过后才交最小看板。
9. 每阶段定向验证、独立Git提交；集成真正完成后现有tests、production-import、Golden、feature门禁各一次，失败定位复验。不能靠mock宣称PG验收，当前真实实例可用。文档记录真实结果与剩余限制。

工作中中文简短更新，最终只报实际结果/验证/阻塞。持续完成授权任务，不因子代理收尾或通过一小批测试就冒称整个P0–P3完成。
