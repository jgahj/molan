# 本地固定评测套件

## 冻结范围与状态

| 阶段 | 固定范围 | 生成请求数 |
| --- | --- | ---: |
| P0 | 六题材 × 两原创路线 × 前三章，仅 control | 36 |
| P3 | 18 道原创单章，同条件 control/candidate | 36 |
| P4 | 玄幻、科幻末世各一条十章路线，仅 candidate | 20 |

默认 dry-run，不登录、不推理，状态只能是 `not_executed`。真实推理由主代理决定。`--max-calls` 限制生成请求数，不限制一个请求内的模型调用数；生产管线可包含起草、审计、择优、局部修订与重审。

P0 的 `control-prompt.txt` 逐字取自 provenance 中记录的 Git 提交、`completion-editor.js` 的 `baseWritingDirectives`。它只是固定起草控制 prompt，不是完整历史动态上下文、范文检索、审计和修订主链路重放。P0 没有候选输出，不宣称 A/B。

P3 的两臂使用相同任务、合同、空 ledger、模型、目标篇幅与公开参数，调用先后交替。控制臂不执行双稿与 patch；这些管线差异及费用差异是比较对象，不能声称等用量。v2 未开放 seed、topP、maxTokens，配置明确为 null；实际分阶段参数必须来自 `calls`，不可推测为已固定。

P0、P4 均按各自 `seriesId/chapterIndex` 累积审计确认的事实、关系、知识与伏笔，跨系列重置。前章结尾取最后 1200 个 Unicode 码点，截取政策显式写入 `continuity`；ledger 和已确认章节摘要不静默裁剪。上下文超预算由服务明确拒绝。

## 主代理 pilot 命令

在 `molan-home` 下，先由主代理通过**进程环境**设置 `MOLAN_BASE_URL=http://127.0.0.1:<随机端口>` 和 `MOLAN_TOKEN`；不要把 token 写进参数、报告或文件。

```powershell
& ../tools/node22_runtime/node.exe scripts/run-benchmark-experiments.mjs --phase P0 --execute --model gpt-5.6-luna --pipeline-version benchmark-local-v2 --max-calls 1 --out "<独立的新输出目录>"
```

`--pipeline-version` 必填可追溯版本标识；manifest 另外记录当前本地实现文件哈希，但不冒充已启动服务的版本证明。`--out` 不可复用非空旧目录。默认输出也使用时间与 UUID 新建目录，不覆盖既有 report。

续跑原目录：

```powershell
& ../tools/node22_runtime/node.exe scripts/run-benchmark-experiments.mjs --execute --resume --out "<原输出目录>" --max-calls 1
```

计划、参数、控制 prompt、传输地址或注入适配器源文件变化会拒绝续跑。`in_flight/uncertain/failed/audit_failed` 不自动重新调用；先人工核对本机服务幂等凭证。不会通过换 requestId 自动补跑失败项。

## 生成接口

纯数据构造与可恢复调度通过依赖注入调用 `generateChapter(params)`；不在库里登录或访问文件系统。执行时另外注入 `saveCheckpoint(state)`，每次请求前先持久化 `in_flight`。

CLI 默认使用已修复的 `molan-node-client.login/requestJson`。每次请求 preflight：

```json
{"protocol":"benchmark-local-v2","localStorage":true,"cloudProxy":false}
```

仅通过本机 `/api/benchmark/generate`。参数包含：

- 稳定合法 `requestId`（哈希，符合 `[A-Za-z0-9_-]{8,100}`）；
- `prompt,genre,modelId,targetWords,contract,factLedger,previousEnding,continuity`；
- `control,controlSystem,temperature,maxRounds`；
- `localStorage:true,persist:false`（不是关闭服务幂等凭证；存储安全由 capabilities 与服务本地模式共同保证）。

返回完整保留 `{text,audit,status,calls,usage,humanReviewStatus,protocol,candidates}`，包括附加字段。识别 `status:passed/needs_review`，覆盖信息直接读 `audit.coverage`，**不是** `audit.semantic.coverage`。只有 `audit.passed===true` 且 `audit.contentHash` 与正文相符，才能确认该章并提交有逐字证据的 ledger 增量。

- `needs_review`：保存正文（即便为空）、完整响应与真实用量，标 `audit_failed`，不续写。
- 管线 `failed_or_unknown`、未知状态、抛错或连接中断：保存已有凭证，标 `blocked_uncertain`，不重试。
- 模型审计通过而 `humanReviewStatus:pending`：生成完成，人工仍 `pending_review`，不是模型生成失败。
- `usage.complete`、逐调用 input/output 用量、实际模型、实际参数和请求/输出哈希不完整：显式 `missing_evidence`；不补零、不伪造。

逐调用支持 `modelId/model`、`outputHash/textHash`。`parameters` 要显式记录 `temperature,maxTokens,topP,seed`；未设置值为 null。总用量可由完整 `calls[].usage` 验证输入/输出，不仅凭 totalTokens 判完整。

可选 `--adapter <mjs>` 注入 `export async function generateChapter(params)`，便于自包含模拟测试；不会隐式导入外部供应商 SDK。

## 持久化与盲评

每次新运行在首次请求前写不可覆盖的 `manifest.json`：固定题集全文、控制 prompt 全文及来源、计划/配置/实现哈希。`checkpoint-000001.json` 起的追加式快照有链式哈希，每次 `wx` 新建并 fsync；竞争写入会停止而非覆盖。旧报告不更新，summary 使用唯一文件名。

只有**完整 P3 双臂**能导出盲评：

```powershell
& ../tools/node22_runtime/node.exe scripts/run-benchmark-experiments.mjs --resume --out "<P3运行目录>" --export-blind
```

将 `blind-*.json` 交评审，`private/mapping-*.json` 只给组织者。`benchmark-review.html` 可本地静态打开，无网络请求；加载哈希校验的纯匿名包，拒绝额外身份字段。正文自报模型身份会阻止直接导出，不静默篡改原文。

评审的偏好、四项 1–5 分、双方关系/知识/伏笔的 pass/fail 与逐字引文、理由均无预填，完整才可导出。人工结果由 `--review <JSON> --packet <盲评包> --mapping <私钥> --resume --out <目录>` 再次校验并绑定原始正文哈希。不得把页面按钮或测试夹具当真人证据。

P0/P4 不伪造 A/B；单臂人工审读尚未接入此页，明确保持 `pending_review`。

## 长篇评分与验证

```powershell
& ../tools/node22_runtime/node.exe scripts/run-longform-eval.mjs --dir "<十章目录>" --genre 玄幻 --output "<新报告路径>"
& ../tools/node22_runtime/node.exe --test test/benchmark-experiments.test.js
```

纯指标高分不能通过。缺章、重复章号、重复正文、空章、不足十章显式失败；缺语义审计或真人结果为 `pending_review`，逐项列出关系/知识/伏笔缺证据。已有文件评估不声称本轮真实生成。显式旧 `--output` 用 `wx` 拒绝覆盖。

可用 `--semantic-audit` 与 `--human-review` 传规范化证据包：`{status:"reviewed",entries:[...]}`；每章 entry 需 `chapterIndex,textHash,status:"reviewed",reviewer,reviewedAt,stateChecks`，三个 stateChecks 都需 `status:pass|fail,evidence:<正文逐字引文>`。真人 entry 另需完整 `scores,preference,reason`。未审项目不可预填 pass。模型的 coverage 标记原样保留在运行账本，不能直接当逐字状态证据填入此包。

仅运行本文件定向 Node22 测试；测试 fixture、CLI dryrun 和模拟 pilot 都写系统临时目录并清理，不导入 server、不跑会写真实 data 的旧全套，不执行真实推理。
