# 质量向量 A/B 评测

## 口径

`GeneratedNovelProfile` 的 23 个顶层字段包含元数据和题材描述。可直接比较的规范 `quality-vector-v2` 当前有 19 个评分维度；本工具按这 19 个真实评分比较，不把其余画像字段转换成虚构分数。

候选与基线必须使用相同任务、输入哈希、模型、模型参数、评测器版本和评审版本。报告还要绑定双方各自的流水线、Prompt、题材配置、文风配置版本。Golden Manifest 至少有 80 条完整、可回放任务，并带有匹配任务集的 SHA-256 指纹；`test_fixture`、`metadata_only` 或输入不完整的语料不能晋级。

晋级还要求仓库 `data/evolution/golden/manifest.json` 的原有 `manifestVersion: 1` 清单完成真实语料审批：`fixtureStatus: "ready"`、`promotionEligible: true`、`taskRecordsIncluded: true`、`replaySnapshotsIncluded: true`，并以 `qualityAbManifestHash` 固定经审核的 A/B 任务清单摘要。现有清单仍是 `metadata_only`，所以当前所有报告都不能晋级；本次没有改写清单状态或补造真实语料。
摘要校验用于检测版本和内容错配，不是来源签名。评分、费用和证据引用须来自可信生成及评审记录；当前离线工具尚未自动解析这些记录，不能单凭自报 JSON 宣称真实质量改善。

每个任务的两臂都必须提供正文哈希、完整 `quality-vector-v2`、19 个维度的数值、证据状态和证据引用。每个生成结果还要重复绑定共享模型、参数、评测器、评审版本，声明所属的基线/候选版本，并复述任务输入哈希；无法与报告顶层绑定逐项匹配时阻断。证据状态仅接受 `MEASURED`、`JUDGED` 或 `HUMAN_REVIEWED` 参与晋级；`ESTIMATED`、`NOT_MEASURED`、缺少证据或两臂状态不一致都会阻断。分数必须显式声明统一量表 `scoreScale: 1` 或 `100`，每维变化先换算到 0–1，再应用 0.03 最大下降门槛。目标维度必须改善；`ai_flavor` 按越低越好计算。

报告同时重新计算 `data/evolution/regressions/policy.json` 中的既有回归门禁。所有 8 个类别、continuity、originality、genreFit、styleFit、stability、cost 和目标指标都要有证据；其门槛比逐维 0.03 检查更严格时，按既有门禁处理。成本按配对任务累加，并保留货币和账本证据。

## 离线比较

CLI 只读取已保存的 JSON 结果，不调用模型，也不会产生推理费用：

```powershell
node scripts/compare-quality-vectors.mjs --input path\to\quality-ab-input.json
node scripts/compare-quality-vectors.mjs --input path\to\quality-ab-input.json --out path\to\quality-ab-report.json
```

只生成校验回执，不修改候选配置：

```powershell
node scripts/compare-quality-vectors.mjs --verify-promotion --report path\to\quality-ab-report.json --candidate-config path\to\promotion-target.json --out path\to\promotion-receipt.json
```

受门禁约束的晋级命令会重新核验报告与候选版本，只在 `PASS` 时原子更新命令明确指定的候选配置文件，并写入报告哈希；`BLOCKED`、`REJECTED` 或版本不匹配时不修改候选配置：

```powershell
node scripts/promote-quality-config.mjs --report path\to\quality-ab-report.json --candidate-config path\to\promotion-target.json
```

当前 canonical Golden 仍为 `metadata_only`，因此晋级命令会返回退出码 `2`，并保留候选配置原样。它只记录候选配置的晋级凭据，不自动部署或切换生产配置。

`--out` 只新建文件，已有文件会报错，不会被覆盖。退出码 `0` 表示 `PROMOTION_READY`，`1` 表示 `REJECTED`，`2` 表示 `BLOCKED`。报告写到标准输出时也包含状态、阻断原因、19 维差异和既有门禁结果。

输入根对象使用 `schemaVersion: "quality-vector-ab-input-v1"`、`evaluationMode: "saved_results_only"`。必需字段包括：

- `binding`: `model`、64 位 `modelParametersHash`、`evaluatorVersion`、`reviewerVersion`。
- `versions.baseline` 和 `versions.candidate`: 各含 `pipelineVersion`、`promptVersion`、`genreProfileVersion`、`styleVersion`。
- `golden`: `quality-ab-golden-manifest-v1`、`fixtureStatus: "ready"`、`dataStatus: "complete"`、至少 80 条唯一任务及 SHA-256 `manifestHash`。Manifest 的哈希覆盖除 `manifestHash` 自身外的全部字段。
- `tasks`: 与 Golden 任务逐条匹配的 `task_id`、`genre`、`input_hash`；两臂各有 `generationId`、64 位 `outputHash`、`qualityVector` 和带证据的 `cost`。
- `targetDimensions`: 至少一个 `quality-vector-v2` 维度；`safety_gate.categoryResults` 和 `safety_gate.metricValues` 提供既有回归门禁所需的类别与安全指标证据。

离线比较器不会启动真实 A/B 生成。真实模型执行入口 `scripts/run-quality-ab.mjs` 默认展示任务数、生成/评审调用数及费用上界估算；仅 `--execute --max-cost <amount> --out <new-directory>` 发起请求。费用币种和单价由固定计划显式声明。未知用量、网络错误或超额会保留失败并停止后续调用；费用是供应商Token用量乘显式单价，不是支付账单。此轮未调用真实模型。

```powershell
node scripts/run-quality-ab.mjs --plan path\to\live-plan.json
node scripts/run-quality-ab.mjs --plan path\to\live-plan.json --execute --max-cost 5 --out path\to\new-run
node scripts/compare-quality-vectors.mjs --input path\to\new-run\results.json --artifacts path\to\new-run --out path\to\report.json
```

显式执行还需 `MOLAN_AB_ENDPOINT`（完整chat-completions兼容URL）和 `MOLAN_AB_API_KEY`。计划schema为 `quality-ab-live-plan-v1`，共享 `binding`、`versions`、`modelParameters`，其摘要须匹配 `modelParametersHash`；`maxOutputTokens` 和 `pricing {currency,inputPerMillion,outputPerMillion}` 必填。每任务提供 `task_id`、`genre`、`snapshot`、`input_hash=hashJson(snapshot)`、`prompts {baseline,candidate}` 和固定 `judgePrompt`。评审必须返回 `quality-vector-v2` 的19维数值，每维状态只能为 `JUDGED`，并提供 `explanation`；不接受模型冒称人工或实测。Golden与安全门禁证据未批准时依旧BLOCKED。

比较器现在必须提供 `--artifacts` 才能验收证据。目录 `artifacts.json` 使用 `quality-ab-artifact-index-v1`，每项含唯一 `id`、目录内相对 `path`、`kind`（json/text）和文件字节 `sha256`；绝对路径、越界及符号链接拒绝。每臂 `artifact_id` 对应 `quality-ab-generation-artifact-v1`，固定正文文件、输入快照、生成binding、质量向量及成本。证据引用使用 `artifact-id#/JSON/pointer` 或文本文件整件 `artifact-id#`。哈希不证明评分正确，但可检出文件篡改与虚构引用；人工批准语料与可信评审仍需真实证据。本工具不把示例或fixture标成真实评测。

晋级目标 JSON 使用 `schemaVersion: "quality-promotion-target-v1"`，并填写 `qualityReportHash`、`inputHash`、`model`、`modelParametersHash`、完整候选 `versions`、`configuration` 和 `configurationHash`。A/B 输入必须显式提供 `configurations.baseline/candidate` 快照（包含 `pipeline`、`prompt`、`genreProfile`、`style`）及对应 `configurationHashes`，缺失或哈希不一致阻断晋级。候选配置内容哈希必须与报告中的候选哈希一致。

晋级命令还必须指定 `--input <results.json> --artifacts <artifact目录>`，从原始输入和保存证据重新计算报告并核对报告哈希；仅有报告和候选文件不能晋级。Provider 账本记录实际请求参数、消息、模型和版本，参数哈希及评估输入必须与保存的输入和生成内容匹配。安全分类证据必须引用包含匹配 `status` 的对象，指标证据必须引用包含匹配 `baseline`、`candidate` 的对象；任意文本引用不能作为安全放行依据。通过后将报告哈希写入指定候选文件，不代表生产部署。

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
