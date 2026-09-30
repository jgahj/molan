# 墨阑工业级发版门禁规范 (RELEASE_GATES)

任何代码合并入 `main` 或上线生产环境，必须严格同时通过以下发版门禁。

## 1. 工程门禁 (Engineering Gate)
1. **测试零失败**：`npm test` 保持 100% 通过（当前基线 1161 个测试，0 失败）。
2. **生产依赖零反向引入**：`npm run audit:production-imports` 必须 PASS，确保 `lib/generation/*` 与 `server.js` 零引用 `lib/legacy/*`。
3. **全站功能契约门禁**：`npm run audit:features` 必须 `FEATURE GATE PASS`，所有 1600+ 交互控件均完成明确事件映射与分派。
4. **金标任务套件门禁**：`npm run audit:golden` 必须 `GOLDEN INPUT SUITE PASS`（8 大题材 80 项任务全量通过）。

## 2. 生成门禁 (Generation Gate)
1. **单生成主链原则**：唯一生成主链为 `state-machine.js -> orchestrator.js -> content-engine.js`。
2. **未知结果对齐 (Unknown Recovery)**：遇到瞬态 429/503 最多重试 2 次；超时或网络异常必须保持原 `requestId` 幂等对齐，禁止生成新 ID 重复扣费。
3. **多实例集群熔断**：特性开关与紧急熔断支持共享存储状态对齐，杜绝节点间开关漂移。

## 3. 文学质量门禁 (Literary Gate)
1. **关键维度真实测量**：当前题材对应关键质检维度（`CRITICAL_QUALITY_DIMENSIONS`）必须全部完成真实测量（无 `NOT_MEASURED` 漏出），且评分不得低于 0.4。
2. **零未核实阻断**：所有 blocker 必须具备正文逐字 quote 比对事实。
3. **AI 味风险信号隔离**：AI 套路词频作为独立 risk 信号上报，禁止伪装为文学综合分。
