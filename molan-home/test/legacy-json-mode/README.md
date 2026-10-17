# test/legacy-json-mode — 已归档：原生 JSON 模式测试（PG-only 收敛遗留）

> **归档时间**：2026-10-17（PG-only 收敛，HANDOVER 阶段二十九）
> **归档原因**：`MOLAN_APP_STORE=json` 原生 JSON 存储模式已按用户授权（`docs/postgres-only-checkpoint-20261002.md`）整体删除，本目录中的测试所覆盖的被测模式在生产中已不存在。

## 背景

这些测试运行时会设置 `MOLAN_APP_STORE=json`（或依赖已随收敛删除的 JSON 仓储 API，如 `appRepository().saveUser/saveAccount`、`postgresRepository.runtimeAccountByEmail` 在禁用态桩上的调用）。PG-only 收敛后：

- 生产与测试环境的唯一存储模式为 PostgreSQL（`POSTGRES_MODE` 硬编码为 `true`）；
- 启动链路对缺 PG 配置的生产环境直接抛 `PRODUCTION_POSTGRES_REQUIRED` 拒绝服务；
- 本目录测试的失败签名统一为 `postgresRepository.runtimeAccountByEmail is not a function` / `app.saveUser is not a function` / `PostgreSQL 未配置：PG-only 收敛后不再支持本地 SQLite/JSON 存储` 等。

## 处置方式

- 文件以 `git mv` 原样移入本目录（内容零改动，git 历史连续可查）；
- `package.json` 的 `test` / `ci` glob 由 `test/**/*.test.js` 收紧为 `test/*.test.js`（顶层匹配），本目录不再进入常规回归；
- 全量回归基线：归档前 40 败（其中 39 个在本目录）→ 归档后预期 1 败（`structural-originality` 已另行修复则为 0）。

## 文件清单（18 个）

| 文件 | 覆盖意图（历史参考） |
|---|---|
| `auth-persistence-and-latency.test.js` | JSON 模式账户持久化与登录延迟、scrypt 异步化、userMemoryCache TTL |
| `token-usage.test.js` | JSON 模式用量记账、会话隔离、遗留令牌迁移、Skill 审计落账 |
| `open-skills.test.js` | 开放 Skill 市场（发布/下载/隔离/匿名查看） |
| `internal-chat-utf8.test.js` | 内部 SSE/JSON 跨块中文与引号保真、Provider 未知结果保留 |
| `native-chat-dispatch-journal.test.js` | 两段式 chat 派发日志、断连取消、幂等重试、fail-closed 边界 |
| `native-chat-http.test.js` | JSON 模式 chat 调用与精确计费落账 |
| `native-chat-cancel-http.test.js` | 断连取消上游、释放槽位、保留未决计费 |
| `native-chat-two-pass-billing-http.test.js` | 两段式 chat 不按部分用量计全价 |
| `native-creation-contract-http.test.js` | 创作合同 HTTP 调用与债务暴露 |
| `native-dispatch-integration.test.js` | 派发集成（link-novel 路由、启动恢复） |
| `native-startup.test.js` | JSON 模式主进程启动/重启与无遗留文件 |
| `native-app-http.test.js` | JSON 模式账户与小说 HTTP 契约 |
| `novel-write-handlers-http.test.js` | 小说创建/保存 CAS/删除/恢复的 HTTP 权限与修订 |
| `project-scope.test.js` | JSON 模式 account/project/memory/package/resource 作用域契约 |
| `style-profile-store-http.test.js` | 文风档 HTTP 存取与权威上下文版本 |
| `benchmark-http.test.js` | 本地生成 HTTP 管线（用量/审稿/幂等/失败边界） |
| `generation-legacy-chat-http.test.js` | 遗留 `/api/chat` 写作交接的幂等与 ACL |
| `story-workbench-browser.test.js` | 真实浏览器端到端（正文候选→提交→投影→刷新） |

## 若要恢复

1. 将对应文件 `git mv` 回 `test/` 顶层；
2. 恢复 `package.json` 的 `test/**/*.test.*` glob；
3. 恢复 JSON 存储模式代码（已不在 git 历史近期版本中，需从归档前的收敛前提交取，或按 PG-only 前的架构重写）。
