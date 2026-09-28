# P1 本地题材证据资产

## 接口

`lib/genre-evidence.js` 为 CommonJS 纯函数模块，不读文件、不调用网络。由主 pipeline 读取 JSON 并注入：

```js
const { loadGenreRuntime } = require('./lib/genre-evidence.js');
const runtime = loadGenreRuntime(genre, { evidence, rules });
```

也接受 `{ evidenceByGenre, rulesByGenre }`，键为六题材中文名。不传资产不会隐式读盘，返回 `incomplete` 和空 block。

- `status`: `ready` 只表示资产格式、题材、规则来源关联可供使用，不表示审稿通过。缺失或失效为 `incomplete`，不支持题材为 `unsupported`，规则形状错误可为 `invalid-rules`。
- `writingBlock` / `reviewBlock`: 抽象方法、局部观察摘要、段落编号、适用限制；不输出证据原文长段，不输出量化阈值。非 ready 均为空。
- `evidenceStatus`: 有效资产为 `excerpt-reviewed`；否则 `missing-or-invalid`。
- `humanReviewStatus` / `fullChapterReviewStatus`: 均为 `pending`。
- `sourceVerification`: runtime 为 `not-run`。纯函数无法证明当前磁盘原文未变化，不应将结构验证冒充来源核验。
- `coverage`: 两本、六个完整切章结果、零个人工评读完成章、零个整章语义评读完成章。
- `validation` / `ruleValidation`: 错误详情，可用于主代理记录降级原因。

另导出 `loadGenreAssets`（返回隔离副本）、`validateGenreRules`、`validateGenreEvidence`、`resolveEvidenceParagraph`、`decodeSource`、`extractCompleteChapters`、`sha256`。

`validateGenreEvidence(evidence, { sourceBuffers })` 的 `sourceBuffers` 按 `book.source.path` 索引完整原始 Buffer；会重做解码、原始 SHA256、完整章节边界、全部段落及摘录核验。只提供 `sourceTexts` 可核验解码文本，但 `sourceVerified` 仍为 false，因未核验原始字节。

`resolveEvidenceParagraph(decodedText, paragraph, { decodedSha256 })` 按半开区间 `[start,end)` 回查，拒绝偏移、文本或哈希不符。段落 ID 仅书内唯一，应同时使用 `book.id`。

## 来源和阅读范围

- `selection.json` 固定六题材各两本来源和完整文件 SHA256，并保存摘段解释及规则方法。来源变化时构建失败，不自动将旧解释贴到新原文。
- 原文仅从工作区同级 `资源库/小说原本/<题材>/<书名>.txt` 只读获取；不读取或改写 protected 数据目录，不访问既有 4251 样本数据。
- 完整文件严格解码；UTF-8 和 UTF-16 BOM 可自动确认，GB18030 需显式选择；拒绝用非 UTF-8 回退掩盖截断或损坏字节。
- 从编号第一章开始，要求连续编号并有下一章标题证明终点。序章不占“前三章”；无下一标题的 EOF 章保守不认完整，缺号不跳号补齐。没有最短字数门禁，不凭短章就跳过。
- 支持中文/阿拉伯数字、标题不带空格、BOM、CRLF。章节完整性仅指当前文件边界；无法证明采集缺页、伪标题、正文中途被采集器删节等问题不存在。
- 原始字节哈希为文件 SHA256；解码全文、章（含标题）、正文、段落和摘录哈希均对原样字符串 UTF-8 编码计算。所有偏移采用 UTF-16 code unit，BOM保留，不做 Unicode 或换行归一化。
- 36章全部建立段落元数据，未复制整章。仅保存已引用段落前160个 Unicode 字符，`truncated` 显式标记摘录是否截短；段落完整范围与哈希另存可回查。
- 本轮代理只阅读列明摘段及必要相邻段，作事实与局部解释。**不是36章全文精读、人工审读或全书质量验收完成**。未评段落仅建机器索引；后文兑现、人物弧线、亲密关系边界、史实/科学可行性仍待评。
- 便利样本带明显子类型偏差，例如历史两本都是三国混合系统文，科幻末世两本为游戏化求生；目录标签不是质量标签。规则因此只提供可选方法，旧无原文定位的范作结论、自造“范句”和固定指标已撤下。

## 度量和构建

计量版本 `2-utf16-nonwhitespace-line-sentences`：各入口的非空白字数使用 UTF-16 单位；指纹与结构共用按行切句，计入无终止标点尾句，闭引号不另算句；中文、ASCII、角引号识别保持一致。`null`、空串和缺失值不当数值0，真0仍计入。结尾是末三段关键词启发式，未命中为 `unknown`，不是语义裁决。

原始作者注和分隔符不删除，因此会影响描述统计和启发式；没有把这些结果当文学质量评分。新旧计量版本不能无标记混用；本任务不重算或改写原有4251样本。

在 `molan-home` 下运行：

```powershell
& ../tools/node22_runtime/node.exe scripts/build-genre-evidence.mjs
& ../tools/node22_runtime/node.exe scripts/build-genre-evidence.mjs --check
& ../tools/node22_runtime/node.exe scripts/build-genre-baselines.mjs --books 20 --chapters 3
& ../tools/node22_runtime/node.exe --test test/genre-evidence.test.js
```

- evidence 构建同时生成六题材 evidence、六题材 rules 和 evidence 索引；固定路径，不接受任意输出路径。所有来源及规则关联先验证，再写输出。
- `--check` 重新读取固定范本并构建内存期望值，逐文件比对，不写磁盘。
- 基线默认仅六题材，每题材按文件名排序考察前20个候选；跳过失败来源并记录原因，不继续补样到20本。
- 测试使用内存夹具和明确原文的只读核验；不跑 token-usage 全套，不写真实样本数据，不部署或网络推理。
