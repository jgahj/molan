# P0–P3 父代理审计发现（2026-10-01）

这是待处理的审计问题，不是验收通过记录。实施者直接修改文件，父代理通过 Git diff 审计；不得用删除断言、跳过测试或放宽门禁解决。

## 费用与派发

- 原暂停点的两项测试必须收尾：派发持久化期间取消测试超时、同步 `openUpstream` 抛错测试失败。核实 fixture requestId 符合真实格式，并使用有界等待，不改变强断言。
- `JsonAppRepository.settleTokenUsage` 当前只对少数 outcome 阻止已派发请求退款，直接调用时 `outcome: aborted` 或默认 succeeded、费用零且无完整用量，是否仍能绕过服务层保留预占？需要仓储边界回归；不能只在 service 防守。
- `recordDispatchAttempt` 当前是否允许已 `provider_unknown` 的预占继续授权新 attempt？恢复后的未知请求不得自动再调用供应商；明确首次调用、合法同一请求两遍/缓存重试与恢复未知的区别，并通过 JSON/PG 合同验证。
- 父代理已在隔离临时 JSON 仓储实际复现上述两项：派发后 `actualCost: 0, outcome: aborted`、无用量可退款；hold 为 `provider_unknown` 后新 attempt 返回 `authorized: true`。当前不能将费用日志批次提交为完整安全保护。
- 旧 SQL 派发只更新 status，不保留独立 attempt，旧 JSON 分支也需审核：不能声称完整 durable journal。迁移期间必须真正记录或者安全拒绝；不要扩建兼容巨石。
- PostgreSQL 恢复与过期回收要保护另一实例活动 lease。当前 attempt lease 与业务实际超时是否一致、是否更新 instanceId、是否需要续约，必须实证。

### 恢复执行后的独立审计

- 收取前轮费用批次后，父代理独立复验费用定向测试 15/15 通过；这不代表以下未覆盖边界通过。
- `runtimeRecoverInterruptedUsage` 引用未声明的 `rowTime`，配置 cutoff 的启动恢复分支存在运行时错误；已有无 cutoff 单测未触发。
- JSON 派发没有保存 `instanceId`/`leaseUntil`，主入口也没有传入这两个字段，不能据此声称跨实例活动租约保护有效。
- JSON 完整证据判定把 `null`、空字符串或布尔值经 `Number()` 转换成整数零；正金额但缺用量的结算还可能返还部分预占。已派发或未知请求必须在仓储边界统一保护。
- 现有租约 120 秒短于默认上游总时限 5 分钟。启动恢复和 reaper 都必须保护活动租约，主入口必须传入真实实例标识与覆盖调用最长时限的租约，或实施可靠续约。
- PG/兼容汇总仍有 `total_tokens IS NOT NULL` 即计为 precise 的聚合查询；只修复 JS 汇总函数不能证明全入口口径已经统一，后续必须检查 global、个人和批量用户汇总。
- 上述仓储和租约问题已发给 agy 返修；尚未作为验收通过或提交证据。

### 本轮返修后观察（最终验收尚未完成）

- 首轮返修 CLI 在 15 分钟预算后返回部分结果；没有收到最终实施报告。已核对受管理入口及 agy 进程退出，未重复启动。
- 父代理在退出后的稳定工作树独立运行费用定向测试：17/17 通过，包括新增 JSON/PG cutoff、跨实例租约、过期恢复及空证据退款防护。
- 父代理在真实本机隔离 PG 库独立验收派发、重复 attempt 拒绝、空证据/正金额不退款、跨实例活动保护、过期恢复 unknown、禁止重发及完整证据幂等结算：通过。验收脚本为本轮临时脚本，不是付费文学质量证据。
- HTTP/流式联合回归 13 项中 12 通过，`native-dispatch-integration` 在重启后的仓储断言失败：实际 `dispatched`，预期 `provider_unknown`。新增启动 cutoff 会保护刚派发记录，原夹具没有模拟已过期中断；需明确设置过期时间并补未过期活动保护断言，保留费用 null、不退款的强断言。
- 已续接同一 agy 会话处理 HTTP 夹具与三个汇总入口的口径，不暂存或提交未验收代码。

### 费用批次已验收并提交

- 提交 `039c489`：派发前持久化 attempt、JSON/PG 仓储未知费用防退款、拒绝未知请求重发、实例及租约接线、保守启动恢复、汇总未知口径和必要回归。
- 父代理最终工作树联合回归 30/30 通过：派发日志、费用、取消竞态、同步抛错、缓存重试、两遍生成、真实本地 HTTP、过期重启恢复、活动租约保护及流式行为。
- 使用独立临时 Git index 生成剔除用户原改动的候选 `server.js`，未更改真实 index；候选隔离快照回归 29/29 通过。实际暂存 server 的 blob 与该已验证候选一致，随后选择性提交七个费用文件；用户原 server 差异保留在工作树。
- 真实隔离 PG 派发专项再次通过；既有费用冒烟九项检查通过。三个实际汇总函数的本地 JSON 分支通过；三个聚合查询原文 SQL 在真实 PG 的只读合成 CTE 上执行通过，覆盖完整、部分标记、未知及预占计数。后者不是整条 PG HTTP/兼容缓存链验收。
- `native-dispatch-integration.test.js` 已补明确过期的中断夹具和未过期其他实例断言，工作树验证通过。该文件含 link-novel 集成依赖，暂未加入费用提交，待关联批次验收后提交。
- `git diff --cached --check` 在修正新增测试末尾空行后通过。没有推送、部署、安装依赖或付费文学调用。默认 SQL 链和生产导入门禁仍未完成。

## 拆书只读迁移

- `JsonDissectionRepository.searchUnits` 在短查询分支提前返回，没有调用 `transact` 校验 actor 和任务可见性。短查询、空查询同样需要 401/404 权限合同。
- 新查询服务 `isComplete` 缺依赖时用 result 非空冒充完整。导出必须使用既有完整性验证器，依赖缺失拒绝，不能通过零内容夹具。
- entities 缺来源时默认 `mention_count=1`、`status=confirmed`，foreshadows 默认 `confidence=1`：这是生成不存在的确认/计数/置信度。保留真实值或明确 unknown/null，避免伪造质量证据。
- entities 排序使用 localeCompare，cursor 过滤使用字符串大小比较，比较规则不一致会漏项或重复。相同提及次数下包含中文/拉丁名、特殊字符的多页测试必须覆盖。
- coverage 将 characters、storyTree 等数组数目放进领域 entity/event 统计，且许多缺失值固定零；不得把未建立的台账当真实零。保留必要响应字段同时明确来源与未检查，区分结果条目统计和权威领域统计。
- `server.js` 尚未调用新 query dispatch，导出/result view/完整性/CORS 依赖也未接齐。入口接通必须有真实 HTTP 权限、分页、导出、重启及 GET 零写入回归，不只是扩大路径名单。

## 创作书关联

- 已有 13 项 link-novel 测试及相关创作主入口回归通过，不要重做实现。
- 活动检测遗漏 `waiting_author`、`paused`、`needs_human`、`provider_unknown` 等可恢复或需对账状态；来源 generation 记录并未迁到目标。关联前需要明确安全拒绝或者完整迁移，不能令待确认/未知证据失去当前书的可达路径。
- 直接仓储调用在 index 已关联另一目标时先返回 ALREADY_LINKED，是否先验证调用者对来源书有权限？服务层 resolveScope 不应是仓储 ACL 的唯一保护。
- 历史 ledger 来源保留，不可删除改写；迁入副本不能形成重复结算或重复 generation 回执，验证应检查实际汇总/回执语义，而不仅检查 spentCost。

### 关联收尾追加审计

- agy 已补待确认/暂停/未知状态拒绝、已关联书先来源 ACL、来源历史无法迁移时安全拒绝和费用账本不复制；尚未提交。
- 父代理创作回归初次为 24/25：新增 viewer HTTP 夹具把原 API 的 `FORBIDDEN`+404 误写为 `BOOK_NOT_FOUND`。已限定修正该精确期望，另补直接仓储同目标/异目标 ACL 断言，不能靠 service ACL 冒充仓储保护。
- 新增费用不重复测试原先比较两个空汇总数组，证据不足。已通过真实本地仓储接口种入完整结算 3.5 和未知 pending 两条记录，保留关联前后及重复关联的账户和汇总强断言；等待最终复验。
- 父代理进一步实际复现：owner+book 专属来源分区内的 `provider_unknown` generation 行没有显式 bookId/creationBookId 时，仍可关联成功。专属分区本身已证明归属，来源不能再靠 runMatchesBook 过滤；目标共享项目仍须按书过滤。无显式书 ID 的来源 commit receipt 同理需拒绝。这一具体漏洞已交 agy 定向修正并补原子无改动回归。

## 迁移门禁

### 关联批次最终验收与提交

- 提交 `58a0416`：原生独立创作书安全关联真实小说，仓储来源 ACL、活动与未知任务拒绝、不能安全迁移的历史和回执原子拒绝、费用账本不复制。
- 父代理工作树和剔除用户原差异的候选隔离快照，创作及派发集成均为 28/28 通过。提交前再次核对四个暂存文件 blob 与已验证快照逐一一致，暂存检查通过。
- 本批只提交四个关联及集成文件，未混入用户改动或未验收的拆书查询实现。尚未接通的拆书查询和默认 SQL 链仍属于未完成范围。

2026-10-01 当前工作树 `production-import-audit.mjs` 明确失败：`server.js` 仍引用 `lib/generation/sqlite-store` 和 `lib/pure-js-database`。在所有领域调用者迁完前不得把门禁改成通过，也不能称默认 SQL 链已退出。
