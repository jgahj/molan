# 墨阑 P0–P3 未完成任务与暂停交接

记录日期：2026-10-01。因 agy 额度不足停止新增分发，本文件补充 `p0-p3-model-handoff-20261001.md`，不替代原文中的权限、环境与用户改动边界。

## 当前状态

- 当前 HEAD 仍为 `d895749`：原生小说导出与 JSON 禁止 SQL fallback 已提交。此前成果不要重做。
- 本轮没有新增 Git 提交或暂存，没有推送、部署、安装依赖或付费文学 A/B。
- 工作树有已落盘但未完成最终审计的改动；不能把工作树等同于已提交成果。
- agy 的 link-novel 批次正常返回；拆书批次报 `RESOURCE_EXHAUSTED` 中断；费用批次 CLI 已停止，没有取得最终验收报告。
- 本轮启动的三个 agy CLI 进程已不在运行。原有 14:26 启动的 agy 进程未动；停止 CLI 不作为共享后台任务已全部取消的证明。恢复前先核实原后台任务状态，避免重复分发。

## 本轮实际验证

父代理使用现有 Node24，本地合成供应商和隔离测试数据，不代表真实模型文学质量。

| 检查 | 实际结果 | 能证明什么 |
| --- | --- | --- |
| link-novel 定向测试 | 13/13 通过 | 权限、同目标并发幂等、异目标拒绝、字段与证据保留、软删除/只读、回滚和重启合同 |
| 拆书只读领域测试 | 7/7 通过 | 查询、分页、来源状态、导出夹具、重启与零写入；不证明主入口已接通 |
| P2/P3 定向检查 | 27/27 通过 | 确定性预算、回放、拥堵夹具至少 30% 估算节约，以及证据/晋级拒绝门禁 |
| 原生 JSON 文件仓储及旧源保护 | 7/7 通过 | CAS、不可变账本、多文件恢复、坏文件与旧二进制源保护 |
| 真实隔离 PG 既有费用冒烟 | 通过 | 预占/结算幂等、未知保留、actor 隔离与预算保护 |
| 真实隔离 PG 派发专项 | 通过 | 派发落盘、重复拒绝、活动不回收、过期未知不退款、费用 null、精确结算一次、结算后拒绝派发 |
| 当前七个关键 JS 文件语法检查 | 全部通过 | 仅语法有效，不代表 HTTP 或取消行为正确 |
| 最终费用日志定向检查 | 未通过、运行中止 | 前八项输出通过；新增取消竞态测试超时，同步 `openUpstream` 抛错测试也未通过 |

费用测试初次运行曾有两项夹具失败；后续当前代码的“缺 recorder”与“缓存重试”已输出通过，但新增加的两项仍阻止验收。不要沿用初次 11/13 统计冒称当前全绿。

agy 自报 link-novel 关联回归 69/69；父代理本次独立复验的是上述 13 项。更早的真实 PG 检查证明当时加载代码的合同，不代替费用批次中断后的最终集成验收。

## 按优先级继续

### 1. 收尾当前费用日志批次（最高优先级）

已有改动：

- `services/chat-service.js`
- `services/native-billing-service.js`
- `lib/repositories/json-app-repository.js`
- `lib/postgres-repository.js`
- `server.js` 的最小派发、汇总及恢复接线
- `test/native-chat-dispatch-journal.test.js`
- `test/postgres-token-usage-idempotency.test.js`
- `test/native-dispatch-integration.test.js`

必须完成：

1. 定位并修复 `native-chat-dispatch-journal.test.js` 新增的派发持久化期间取消测试超时，以及同步 `openUpstream` 抛错测试失败；不能删测试、跳过或降低断言。
2. 复核 await 持久化期间取消/总超时与结算的竞态：落盘失败不得外呼；已有派发证据但无法确认发送/费用时不得误退款；释放并发槽与关闭响应不得悬挂。
3. 审计第二遍和缓存重试的独立 attempt、已知首遍费用归属、写盘失败及恢复路径。
4. 审计 PG 启动恢复的 cutoff/lease 与多实例边界，不能恢复另一实例仍活动的请求。
5. 当前 `server.js` 还新增了旧 SQL/旧 JSON 分支派发处理，需要检查是否真正保留 attempt、重复请求与未知费用保护；只更新 `status` 不等于完整派发日志。
6. 普通聊天、断连取消、两遍生成、主入口重启、PG 真实派发合同均需最终重跑。当前费用批次不可提交为“已完成”。

### 2. link-novel 最终审计与独立提交

已有实现及定向验证，不再从零编写：

- `lib/repositories/json-creation-repository.js`
- `services/native-creation-service.js`
- `test/native-creation-link-novel.test.js`

剩余：父代理完整审计该批 `git diff`，复跑受影响创作回归及主入口 HTTP 联调，再按任务边界独立提交。核实账本复制不会造成成本双计；ID/版本、状态、债务、历史质量证据和不可变来源不得丢失。13/13 通过不是整套 P0 完成。

### 3. 拆书只读扩展：接线、权限和真实产物验收

已落盘但未接主入口：

- `lib/repositories/json-dissection-repository.js`
- `services/native-dissection-service.js`
- 新文件 `services/native-dissection-query-service.js`
- 新测试 `test/native-dissection-query.test.js`

新增 query dispatch 覆盖 GET `export/coverage/entities/foreshadows/summaries/validation/search`。当前 `server.js` 原生拆书匹配仍只接 `units/cancel/retry`，没有调用新 query dispatch，新接口仍不能算上线可用。

剩余：

1. 审计代码及来源/缺失语义，核实统计来自真实原生产物，不能用空数组或估算伪装迁移完成。
2. 注入既有导出、result view、完整性校验和 CORS 依赖，并接入原生主入口；不能只扩大 allowlist 后落回旧 SQL。
3. 补真实 HTTP 验收：未登录 401、成员权限、跨用户 404、软删除 404、分页排序、真实 DOCX/Markdown/JSON、重启及 GET 零写入。
4. 复跑 `json-dissection-repository` 与 `native-dissection-worker` 回归。agy 因额度中断，尚无最终审计/验收报告。

### 4. P0 其余原生领域迁移

- 创建领域：`plan-expand`、`plan-review`、`regenerate-asset`、`core-jobs`。
- 拆书写操作与上下文：`apply`、`creative-brief`、`creation-context`、`audit`、`rebuild`，以及历史 dissection 扩展；只读批次还需按上一节收尾。
- 管理领域：除 auth/skills 外的 `overview/models/audit/data/users`。
- 各领域必须保留旧 URL/响应、权限、CAS、幂等、支出证据、取消与重启行为，走原生异步领域接口；不能包装 SQL/PureJs 冒充完成。

### 5. 退出默认 SQL/PureJs 链

- 先迁完调用者，再退出默认 `initDB`、SQL dispatcher 与 postgres-memory-bridge/PureJs 兼容路径，落实默认本地 JSON。
- 旧本地库显式迁移，禁止自动变成空仓储或覆盖用户数据。
- 普通测试与日常脚本退出 SQLite；允许保留隔离迁移工具，禁止挪普通测试到 legacy 凑门禁。
- 生产导入审计仍有阻塞条件，不得放宽门禁。

### 6. P1 服务入口收敛

- `server.js` 仍约九千行，未达到不超过 300 行目标。
- 按领域继续抽离业务服务、初始化与后台生命周期，显式注入依赖。
- 不把整个巨石搬到另一个 runtime 文件；不拆前端编辑器；保留 Cookie、SSE、取消与原 API。

### 7. P2/P3 最终验收

- P2：现有固定拥堵样本的 30% 估算节约检查通过；仍需全链集成和真实调用用量证据。任务/硬事实/视角/禁令/到期债务不能剪，全局事实审计不能缩。
- P3：规范现有 19 个评分维度；23 个画像字段不等于 23 个评分。实际 23 维需求要按正式证据规范处理。
- Golden 仍为 `metadata_only`；真实正文任务集与费用上限未批准提供。真实文学 A/B、配置晋级和依赖真实质量通过的最小看板继续 BLOCKED。
- 真正集成完成后再执行全量 tests、production-import、Golden、feature 门禁。当前没有最终全量验收。

## 用户改动与恢复纪律

- 不覆盖或混入提交：`lib/evolution/quality-loop.js`、`lib/evolution/soak-sqlite-store.js`、`services/dissection-pipeline-store.js` 原注释、`services/generation-service.js` 原日志、`lib/pure-js-database.js`，以及 `server.js` 原八处 PureJs/import/log 差异。
- `server.js` 禁止整文件直接暂存，继续使用原交接中的选择性 index 工具并审计 staged diff。
- 本轮初始 tracked diff 留存在 `C:/Users/lyh/AppData/Local/Temp/molan-agy-audit-20261001/baseline.patch`；未跟踪路径清单同目录 `untracked-paths.txt`。该 patch 不是 untracked 文件内容备份。
- agy 实际模型标识 `gemini-3.8-flash-high`；不能同时传 `--effort max`，CLI 会拒绝。当前会话没有可读取的 `$call-agy` 技能，使用的是本机 CLI。
- 不推送、不部署、不重新启动用户现有主服务、不付费模型调用、不碰受保护数据目录。PG 环境及密码文件路径继续参考原交接，不输出密码。

建议下一轮先收尾费用失败和当前三批 diff，再逐域分发；只要求 agy 回报路径、摘要、实际验证和缺口，父代理直接审计 Git diff，不索取文件全文。
