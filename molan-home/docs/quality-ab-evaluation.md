# 质量向量 A/B 评测

## 口径

`GeneratedNovelProfile` 的 23 个顶层字段包含元数据和题材描述。可直接比较的规范 `quality-vector-v2` 当前有 19 个评分维度；本工具按这 19 个真实评分比较，不把其余画像字段转换成虚构分数。

候选与基线必须使用相同任务、输入哈希、模型、模型参数、评测器版本和评审版本。报告还要绑定双方各自的流水线、Prompt、题材配置、文风配置版本。Golden Manifest 至少有 80 条完整、可回放任务，并带有匹配任务集的 SHA-256 指纹；`test_fixture`、`metadata_only` 或输入不完整的语料不能晋级。

每个任务的两臂都必须提供正文哈希、完整 `quality-vector-v2`、19 个维度的数值、证据状态和证据引用。证据状态仅接受 `MEASURED`、`JUDGED` 或 `HUMAN_REVIEWED` 参与晋级；`ESTIMATED`、`NOT_MEASURED`、缺少证据或两臂状态不一致都会阻断。分数必须显式声明统一量表 `scoreScale: 1` 或 `100`，每维变化先换算到 0–1，再应用 0.03 最大下降门槛。目标维度必须改善；`ai_flavor` 按越低越好计算。

报告同时重新计算 `data/evolution/regressions/policy.json` 中的既有回归门禁。所有 8 个类别、continuity、originality、genreFit、styleFit、stability、cost 和目标指标都要有证据；其门槛比逐维 0.03 检查更严格时，按既有门禁处理。成本按配对任务累加，并保留货币和账本证据。

## 离线比较

CLI 只读取已保存的 JSON 结果，不调用模型，也不会产生推理费用：

```powershell
node scripts/compare-quality-vectors.mjs --input path\to\quality-ab-input.json
node scripts/compare-quality-vectors.mjs --input path\to\quality-ab-input.json --out path\to\quality-ab-report.json
```

`--out` 只新建文件，已有文件会报错，不会被覆盖。退出码 `0` 表示 `PROMOTION_READY`，`1` 表示 `REJECTED`，`2` 表示 `BLOCKED`。报告写到标准输出时也包含状态、阻断原因、19 维差异和既有门禁结果。

输入根对象使用 `schemaVersion: "quality-vector-ab-input-v1"`、`evaluationMode: "saved_results_only"`。必需字段包括：

- `binding`: `model`、64 位 `modelParametersHash`、`evaluatorVersion`、`reviewerVersion`。
- `versions.baseline` 和 `versions.candidate`: 各含 `pipelineVersion`、`promptVersion`、`genreProfileVersion`、`styleVersion`。
- `golden`: `quality-ab-golden-manifest-v1`、`fixtureStatus: "ready"`、`dataStatus: "complete"`、至少 80 条唯一任务及 SHA-256 `manifestHash`。Manifest 的哈希覆盖除 `manifestHash` 自身外的全部字段。
- `tasks`: 与 Golden 任务逐条匹配的 `task_id`、`genre`、`input_hash`；两臂各有 `generationId`、64 位 `outputHash`、`qualityVector` 和带证据的 `cost`。
- `targetDimensions`: 至少一个 `quality-vector-v2` 维度；`safety_gate.categoryResults` 和 `safety_gate.metricValues` 提供既有回归门禁所需的类别与安全指标证据。

离线比较器不会启动真实 A/B 生成。任何真实模型评测必须先在执行端展示任务数、模型调用数和预估费用，并设置最大费用上限；结果保存后才能交给本 CLI 做离线核验。本工具不把示例或 fixture 报告标记为真实评测。

## 质量循环的本地存储

需要运行带幂等结算的 `runQualityLoop` 时，可以注入原生 JSON adapter。CLI 的离线比较本身不使用数据库或持久化 adapter：

```js
const path = require('node:path');
const { createJsonQualityLoopStore } = require('../lib/evolution/quality-loop-json-store');
const { runQualityLoop } = require('../lib/evolution/quality-loop');

const store = createJsonQualityLoopStore(path.resolve('data/evolution-runs'));
try {
  const report = await runQualityLoop({ ...input, store });
} finally {
  await store.close();
}
```

该 adapter 复用 `runQualityLoop` 的 `beginRun`、`settleRun` 和幂等读取契约；生产 PostgreSQL 适配方式由服务端仓储配置决定。

## 报告查看

在浏览器打开 [quality-evolution-report.html](../pages/quality-evolution-report.html)，选择 CLI 生成的报告 JSON。页面展示版本绑定、逐维分数和证据引用、成本及现有回归门禁；缺失证据和阻断原因会保留在报告中。
