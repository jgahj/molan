# 20 项小说写作项目调研：molan-home 值得借鉴什么

调研日期：2026-09-14。

## 一、先说结论

**不建议换框架，也不建议把几个项目的禁词表直接合并。优先补齐统一的审校规则、改写采纳条件和版本化写入保护。**

按当前项目的增量价值，我建议：

1. **oh-story-claudecode**：借中文规则的分级、引文处理、密度阈值和人工复核边界。
2. **jarvis-write**：借防过度改写的复合验收，不是再造一个审改循环。
3. **Eventide Quill**：借独立规则接口、命中定位和编辑器呈现，不搬英文词法规则。
4. **AI Novel Writing Assistant**：借写法资产的编译与绑定、任务检查点和恢复入口。
5. **OrisonSpace**：借模型补丁的字段白名单、版本检查和来源归属。
6. **Chronicler**：借可选择、可解释的上下文组装，以及事实快照与章节增量。

**Novel Agent、Andrea、Inkos/Novelix 也有明确参考价值，但分别适合后续的版本管理、实体引用索引、审查与事实提交分离。**

这不是对项目整体质量的排名，而是基于你现有代码、中文小说场景和适配成本的取舍。下面给出逐项依据。

### 核验边界

- 阅读官方仓库文档、关键源码和能够取得的许可证文本；不是逐文件审计。
- 未克隆、安装、执行外部项目，未调用真实模型，未实测生成质量、性能或检测准确率。
- 本地只读取相关源码；本轮只新增这份报告，不修改业务代码、作品或数据库。
- 链接指向调研时读取的分支，未全部固定到提交 SHA；上游后续可能变化。
- “落笔 LUOBI”“NovelForge Agent”“MuseFlow”缺少 owner，只能列出候选，不能保证是用户原指项目。
- **命中某个词不能证明作者是 AI。** 下文的“门禁”均指作者可配置的写作质量规则，不是文本来源鉴定。

## 二、20 项逐项取舍

“源码”表示读到可执行实现；“规约”表示规则文档，不等于程序强制执行。成本指在现有 Node.js/SQLite/原生前端上实现相应能力的相对成本，不是整套项目部署成本。

| # | 项目及身份 | 实际看到的机制 | 对 molan-home 的取舍 |
|---|---|---|---|
| 1 | [blackzhanzhan/novel_agent](https://github.com/blackzhanzhan/novel_agent) | 源码：Git 分支、差异、回退；草稿确认与正式归档 | **中期借鉴，高价值。** 学审核绑定稿件版本与归档前置条件；暂不把 SQLite 主存储改成 Git 工作树。适配中高成本。 |
| 2 | [AsheGeisha/ai-novel-writing-assistant](https://github.com/AsheGeisha/ai-novel-writing-assistant) | 源码：结构化写法编译器、绑定权重、工作流检查点及恢复目标 | **优先借鉴。** 与现有 JS/SQLite 路线较近，但不必引入它的 Express/Prisma 和整套导演流程。适配中等成本。 |
| 3 | [nspox-project/nspox](https://github.com/nspox-project/nspox) | 源码：Yjs 增量/光标同步、定期及离房保存、正文同步至 MongoDB | **有多人共写需求再考虑。** 协作机制有价值，当前不要为此增加跨存储同步和 Python 后端。高成本。 |
| 4 | [LumenStorm/OrisonSpace](https://github.com/LumenStorm/OrisonSpace)，审阅 `dev` | 源码：模型输出 schema 校验、字段白名单、版本匹配、补丁来源约束 | **优先借鉴安全写入边界。** 比直接复制桌面 IDE 更实用。适配中等成本。 |
| 5 | 落笔 LUOBI：候选 [qShan1/luobi-ai-writing](https://github.com/qShan1/luobi-ai-writing) | 源码：Electron 主进程、SQLite/LanceDB、章节范围检索与索引回填 | **先确认身份。** 可借检索范围与索引补建；不迁入 Electron/LanceDB。此候选不是纯 SQLite 网页应用。 |
| 6 | [XINGANLIU/web-novel-writing-skill](https://github.com/XINGANLIU/web-novel-writing-skill) | 规约：词汇、句式、结构、情节四层检查；阶段式审查与状态同步 | **适合内容规则参考，不是首选检测引擎。** 已读反 AI 味核心是 Markdown 清单，未见该清单对应的可执行评分器。借设计低成本，产品化仍需实现。 |
| 7 | [ynnyh/jarvis-write](https://github.com/ynnyh/jarvis-write) | 源码：分类加权检测、命中位置、限轮改写、无改善回退、统计倒退及过度矫正检查 | **优先借鉴复合验收。** 不搬 Python 主流程；用 JS 扩充已有采纳条件。中等成本。 |
| 8 | [JeroTan/novel-writer-english](https://github.com/JeroTan/novel-writer-english) | 源码＋规约：Markdown 事实检索库、八步流程、先审查后等待修改指令 | **择要借鉴。** 适合事实查询及审改分离；真实性审计本身是模型指令，不是确定性中文检测器。低至中等成本。 |
| 9 | NovelForge Agent：候选 [zlx362211854/novelforge-agent](https://github.com/zlx362211854/novelforge-agent)、[LvPengfei1/novelforge-agent](https://github.com/LvPengfei1/novelforge-agent) | 前者有 TS 步骤流和修订计数；后者有架构批准、输入锁定及版本检查 | **身份待确认。** 后者的批准与版本绑定值得借鉴；前者达到修订上限后可强制推进，不宜照搬其门禁策略。 |
| 10 | [GOAT-AI-lab/GOAT-Storytelling-Agent](https://github.com/GOAT-AI-lab/GOAT-Storytelling-Agent) | 源码：规格→章节规划→场景生成，HF/llama.cpp 适配 | **低优先级。** 借分阶段产物可编辑的思路；现有系统不值得为它增加 Python 推理栈。未核实专门的中文去味实现。 |
| 11 | [Narcooo/inkos](https://github.com/Narcooo/inkos) 与 [zxerai/novelix](https://github.com/zxerai/novelix)（后者对应 `@actalk/novelix`） | 源码：降级状态、审改循环、确定性检查与字数条件、章节和事实持久化 | **中期借鉴，高价值。** 借状态分类和复合审查；必须另行设计“草稿可保存、未批准事实不生效”。不能把两者直接视作同一项目。 |
| 12 | [EventideMiles/eventide-quill](https://github.com/EventideMiles/eventide-quill) | 源码：独立 linter 规则、位置/严重度/规则 ID，多个 AI 散文规则排除引号内文本 | **优先借架构，不借英文判断标准。** 将中文词库接到类似接口，适配低至中等成本。 |
| 13 | [Nicholas-Yu/InkPilot](https://github.com/Nicholas-Yu/InkPilot) | 源码：按写作/大纲/评审分流的 JS 调用层，JSON、缓存和成本记录 | **择要借鉴。** 交互与调用封装可参考；已读调用层不能证明它具有确定性反 AI 味门禁或事实提交保护。 |
| 14 | MuseFlow：候选 [Rethymus/MuseFlow](https://github.com/Rethymus/MuseFlow) | 源码：Dart 去味后处理器、模型偏差检测服务；README 为 Flutter 应用 | **先确认身份与许可。** 与清单中的 CLI 描述不一致；借定位和复核思想，不搬 Flutter，不照搬自动替换。 |
| 15 | [a9549521/chronicler](https://github.com/a9549521/chronicler) | 源码：用户选择上下文、事实快照＋逐章增量、摘要与事实同步 | **优先借长篇上下文设计。** 转成 SQLite 中的版本化记录，不另建 Markdown/YAML 主数据库。中等成本。 |
| 16 | [AndreaFrederica/andrea-novel-helper](https://github.com/AndreaFrederica/andrea-novel-helper)，审阅 `feat/time-line` | 源码：实体/别名、多模式匹配、文档版本与引用位置、实体反向索引 | **中期借鉴。** 很适合“角色在哪章出现、点选跳转”；不搬 VS Code 宿主与整套 Vue/Quasar。中等成本。 |
| 17 | [zhouxiansheng-good/miaobi-shenghua](https://github.com/zhouxiansheng-good/miaobi-shenghua) | 规约＋源码：人工确认流程、连续性账本、Node 图谱可视化及文件读写 | **借规则和只读图谱，不接管文件写入。** 原服务的路径/身份边界不能直接用于你的联网网页。图谱适配中等成本。 |
| 18 | [BlinkDL/AI-Writer](https://github.com/BlinkDL/AI-Writer) | 源码：早期 RWKV 相关中文续写实现、采样、推理服务 | **暂不集成。** 属于模型推理层，不补当前门禁、版本或长篇事实治理短板。引入旧推理环境成本高。 |
| 19 | [Tomsawyerhu/Chinese-WebNovel-Skill](https://github.com/Tomsawyerhu/Chinese-WebNovel-Skill)，审阅 `v2` | 规约＋脚本：任务模块、卷/章纲、审查模板、CSV 标签和关键词检索 | **借模块化组织，不直接打包语料。** 适合按需加载规则；检索脚本不是向量 RAG。规则/语料授权待核实。 |
| 20 | [zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode)，README 说明原 owner 为 `worldwonderer` | 源码＋规约：中文句式扫描、blocking/advisory、位置报告、引文处理、密度提示、去味保护规则 | **当前最值得研究的中文规则实现。** 拆出纯检测接口，不安装整套宿主插件；不把所有默认 blocking 直接升级为你的强制改写规则。适配中等成本。 |

## 三、四个去味重点项目：具体借什么

### 1. oh-story：借“分级、作用范围、位置”，不是全盘禁句式

实际读取：

- [story-deslop/SKILL.md](https://raw.githubusercontent.com/zenstory-ai/oh-story-claudecode/main/skills/story-deslop/SKILL.md)
- [check-ai-patterns.js](https://raw.githubusercontent.com/zenstory-ai/oh-story-claudecode/main/skills/story-deslop/scripts/check-ai-patterns.js)
- [官方去味机制说明](https://raw.githubusercontent.com/zenstory-ai/oh-story-claudecode/main/docs/how-to-remove-ai-flavor-from-web-fiction.md)

源码确有中文扫描器，不是只写一句“请去除 AI 味”。它输出规则类型、严重度、行列和片段；支持 JSON；区分只需提示的密度/结构信号与默认阻断项，并处理引号和文风白名单。部分规则有专门的台词处理，不能概括为“全部不检查对话”。

特别值得借鉴的是：**生理反应、比喻、动作堆积等采用聚集/密度提示，而不是所有词单次出现就判错。** 例如其生理反应套话检测设置最少命中数与每千字密度，说明中允许保留承担受伤、打斗等实际后果的描述。

但有三点不能误解：

1. 七个 Gate 不全是脚本能判定的内容；人物声音、情绪功能等仍需要模型或人工。
2. 轻/中/重删除比例上限出现在 Skill 规约中，本轮未证明脚本独立强制了全部上限。
3. 脚本有顶层 CLI 参数解析、文件读取及 `process.exit`，**不能直接在网页服务器里 `require` 当库用**。适配时应拆成无文件写入、无进程退出的纯检测函数。

建议将其价值落在现有检测器的“中文模式库＋命中证据”，而不是另开一套写作 Agent。

### 2. jarvis-write：借“降分不等于改好”

实际读取：

- [ai_flavor.py](https://raw.githubusercontent.com/ynnyh/jarvis-write/main/backend/app/engines/polish/ai_flavor.py)
- [polisher.py](https://raw.githubusercontent.com/ynnyh/jarvis-write/main/backend/app/engines/polish/polisher.py)

`deai_self_heal` 默认最多两轮，候选要经过：

- 模型异常或空输出：保留已有稿。
- 长度比例约束：默认相对上一份采纳稿在 0.75–1.25 之间。
- 规则分必须下降。
- 词汇/新颖度/虚词等统计项不能明显倒退。
- 不能把句段切得过度碎片化。

**这些是明确可执行的采纳条件，值得借鉴；但仍不能保证文学质量、人物声音或事实一定不变。** 此自愈函数没有调用完整的事实核验链；同文件另一个润色流程有事实锁定和核验，也不能因此推断所有去味入口都拥有同样保护。

还应纠正清单中的固定数字：调研时 README 写“9 类”，源码旧注释写“8 类”，实际 `_RULES` 已列出 **10 类**。重点是分类可维护与报告可解释，而不是照抄“九类”这个标签。

**不要复制它的阈值 6.0 到本地。** 它的分值是每千字加权命中加统计罚分，而你的检测器是 0–100 分，两者不是同一量纲。

### 3. Eventide Quill：借小而明确的规则接口

实际读取：

- [rules.ts](https://raw.githubusercontent.com/EventideMiles/eventide-quill/main/src/core/linter/rules.ts)
- [types.ts](https://raw.githubusercontent.com/EventideMiles/eventide-quill/main/src/core/linter/types.ts)

它将一条规则表达为 ID、名称、说明、严重度和检查函数，结果包含行、列、长度、提示及规则 ID。多个 AI 风格检测函数主动避开引号内文本。

这很适合你的网页：用户不只看到一个总分，还能点到“哪一句、违反什么、为什么、是否采用建议”。

**不能直接搬英文判据。** 源码依赖 `\b` 单词边界、空格词数、`-ly` 副词、英语被动语态及音节计数。中文应按自己的标点、引号和计数字段实现。统计项不宜自动等同于必须重写。

### 4. Web Novel Writing Skill：适合补审稿维度，不适合直接融合词库

实际读取：

- [skills/SKILL.md](https://raw.githubusercontent.com/XINGANLIU/web-novel-writing-skill/main/skills/SKILL.md)
- [anti-ai-patterns.md](https://raw.githubusercontent.com/XINGANLIU/web-novel-writing-skill/main/references/quality-gates/anti-ai-patterns.md)

这份清单不只是单词：还检查角色同质化、机械降神、无代价胜利、场景公式化。适合补充你的因果债务和角色行为审查。

但是其阈值主要是自然语言规约：例如“竟然”全章不超过一次、连续三个段落转折词不超过一次、词汇/句式问题出现三次以上建议润色。它不是精密统计模型。

**直接合并会产生冲突。** 该清单把“眼中闪过一丝戏谑”当作一种替代写法，而 jarvis-write 的规则恰好检测“眼中闪过一丝”。“禁止 A→替换为 B→另一套规则又禁止 B”会让系统循环改稿。

建议提取问题类型与保留剧情功能的要求；替代词由上下文决定，不维护全局一对一同义词替换表。

## 四、与你当前源码对照：真正缺的是什么

以下路径相对 `molan-home/`，行号为本轮读取位置。

### 已有能力，别再造一套

| 本地位置 | 已确认能力 | 外部项目真正能补什么 |
|---|---|---|
| `lib/ai-flavor-detector.js:181` | 词库 block/watch、句段统计、指纹比较、结构信号；总分 0–100 | 统一规则 ID、原文位置、作用域、豁免和规则版本 |
| `lib/prose-health-evaluator.js:29` | 段落、特定生理套话、道具、原话、章末与健康评级 | 消除跨模块口径不一，校准分数映射，不将异常视作该项通过 |
| `lib/benchmark-pipeline.js:191` | 最多两轮审改；候选审校完整且惩罚下降才采纳；否则保留旧稿 | 增加事实/实体/声音保护，统一其他入口的采纳条件 |
| `lib/style-fingerprint.js:136`、`lib/style-detector.js`、`lib/style-archetypes.js` | 文风基线、风格分类和原型 | 借 Ashe 的绑定、版本、适用目标和按任务编译，形成长期写法资产 |
| `lib/causal-debt-tracker.js:16` | 已有债务/承诺及到期相关记录 | 借事实来源、角色知情边界、正文版本和批准后生效，不另建一套重复伏笔表 |

当前 `package.json` 还有 `playwright-core` 运行依赖，因此“零依赖”不再完全准确；这也不构成更换 Node 内置 HTTP/SQLite 主架构的理由。

### 最该先处理的五处差异

**1. 同一个项目的两个改写入口，采纳条件不同。**

`lib/benchmark-pipeline.js:191–216` 已经“不改善就不采纳”。

而 `server.js:2530–2547` 的双阶段改写结束函数，空结果才回退；对非空结果记录前后分数和 `passedAfter`，该函数内没有“第二稿更差则保留首稿”的选择条件。异常分支 `server.js:2514–2523` 也只在没有内容时恢复首稿。

这是 jarvis-write 最有价值的落点：**统一候选验收，而不是增加第三遍、第四遍去味。** 因第二稿走流式透传，未来修复还需区分“候选预览”和“最终采纳稿”，不能简单把首稿追加到已输出的第二稿后面。

**2. 检测器异常目前被降级为该项通过。**

`lib/prose-health-evaluator.js:71–75` 捕获检测异常后使用 `score: 0, passed: true`。这不代表整个健康报告必然通过，但会掩盖该项未完成。

建议返回独立的 `error/unknown` 状态，保留稿件和报告，不自动视为通过，也不让界面一直显示“校验中”。

**3. 分数映射需要校准，而不是先加词。**

`lib/ai-flavor-detector.js:290–308` 输出 0–100 风险分，低于 40 通过；`lib/prose-health-evaluator.js:83–84` 却按 `100 - flavorScore * 25 - spasmCount * 30` 转成健康分。

数学上，风险分达到 4 时，这项健康分就归零。**这说明两个界面的评价可能严重分叉，应先核验设计目标与样本校准，不能直接判定为模型写得差。** 本轮未修改或运行测试验证业务预期。

**4. “单次命中”并不是全系统统一规则。**

通用检测器按密度和综合分判断，结构信号被标记为 advisory；健康评估器另有硬编码生理词正则，并在返回的 `passed` 中要求 `spasmCount === 0`（`lib/prose-health-evaluator.js:192`）。

也就是说，你已经有局部的“单次命中不通过”，但不同模块并不一致。当前已确认健康检查 API 调用该评估器（`server.js:14519–14527`）；**未证明所有生成出口都统一使用它作为最终门禁。**

**5. 自动替换有改变叙事事实或动作的风险。**

`lib/genre-engine.js:1431` 的 `sanitizeAiFlavor` 不只是报告问题，而会直接替换；例如把“喉结上下滚动”改为“移开视线”（第 1451 行）。这不是同一动作。

建议只保留确定性的格式清理；有叙事含义的修改用候选 diff 和确认。不能为了让词库通过，偷偷改人物行为。

## 五、架构方面最值得借鉴的设计

### A. 写法资产与任务恢复：Ashe

依据：[StyleCompiler.ts](https://raw.githubusercontent.com/AsheGeisha/ai-novel-writing-assistant/main/server/src/services/styleEngine/StyleCompiler.ts)、[NovelWorkflowService.ts](https://raw.githubusercontent.com/AsheGeisha/ai-novel-writing-assistant/main/server/src/services/novel/workflow/NovelWorkflowService.ts)。

前者把写法、权重及自检要求编译为提示词，**不是训练模型**；后者有检查点、恢复目标、输入快照、错误及心跳。

建议：

- 文风资产保存版本、适用作品/角色/任务、规则及作者确认的样本；按任务选取，不每次塞入全部规则。
- 明确区分请求状态、审校结果、作者批准和写入状态。
- 恢复以持久化记录为准；超时进入可解释终态，不自动重复模型调用。
- 心跳和“有重试按钮”不等于任意崩溃后都能无重复续跑；实际接入仍要验证幂等与中断场景。

### B. 模型只提出补丁：OrisonSpace

依据：[safety.ts](https://raw.githubusercontent.com/LumenStorm/OrisonSpace/dev/packages/story-sync/src/safety.ts)、[parser.ts](https://raw.githubusercontent.com/LumenStorm/OrisonSpace/dev/packages/story-sync/src/parser.ts)。

已读实现约束字段、动作与字段版本，来源中的 `runId/chapterId` 由调用方确定。建议将其转译到 SQLite：候选携带 `expectedVersion` 和内容哈希，批准/写入前再次核对，用户已修改正文则使旧审校失效。

注意：返回 `ok: true` 不一定有修改落地，补丁可能被全部过滤；你的 UI 应显示实际采纳数与拒绝理由。

### C. 上下文能解释来源：Chronicler

依据：[context_builder.py](https://raw.githubusercontent.com/a9549521/chronicler/main/core/context_builder.py)、[progress_tracker.py](https://raw.githubusercontent.com/a9549521/chronicler/main/core/progress_tracker.py)。

借它的上下文选择和“快照＋章节增量”，不是照抄多文件存储。建议生成前能预览：

- 本次用了哪些设定、哪一版章纲、哪些已确认事实。
- 哪些是已发生事实，哪些仅是未来计划或待确认推断。
- 哪些信息当前视角人物还不知道。
- 因长度预算未纳入哪些材料。

其多文件保存不能直接当成原子事务；你应利用现有 SQLite 明确正式事实的生效边界。

### D. 草稿、审查和事实提交分开：Inkos/Novelix

依据：[Inkos chapter-persistence.ts](https://raw.githubusercontent.com/Narcooo/inkos/master/packages/core/src/pipeline/chapter-persistence.ts)、[Novelix chapter-review-cycle.ts](https://raw.githubusercontent.com/zxerai/novelix/main/packages/core/src/pipeline/chapter-review-cycle.ts)。

值得参考的是真实状态分类和复合审查，不是宣传中的维度数量。但 Inkos 已读持久化函数在状态不是 `state-degraded` 时保存事实，`audit-failed` 本身并不阻止该调用，不能把它描述成严格的“仅通过后提交事实”。

你更适合的边界：

**候选正文随时可保存/复制；审查失败仍可保留；只有匹配当前版本且获作者批准的事实增量才进入正式设定。**

### E. 版本与索引：后续再做

- **Novel Agent**：[git_console.py](https://raw.githubusercontent.com/blackzhanzhan/novel_agent/main/novel_git_server/agents/git_console.py)、[world_draft.py](https://raw.githubusercontent.com/blackzhanzhan/novel_agent/main/novel_git_server/agents/world_draft.py)。借版本绑定归档，别把内部硬回退当普通撤销；源码包含 `reset --hard` 及分支删除策略。先做 SQLite 稿件版本，再视需求增加 Git 导出/故事分支。
- **Andrea**：[roleUsageStore.ts](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/feat/time-line/src/context/roleUsageStore.ts)、[ahoCorasickManager.ts](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/feat/time-line/src/utils/AhoCorasick/ahoCorasickManager.ts)。借实体、别名和章节引用索引。原匹配器单个字符串映射一个实体，重名/同别名消歧仍需设计。
- **NovelForge 候选 B**：[core.py](https://raw.githubusercontent.com/LvPengfei1/novelforge-agent/main/novelforge_agent/core.py)。批准和锁定输入可作为版本门禁参考；候选 A 的 [chapterReview.ts](https://raw.githubusercontent.com/zlx362211854/novelforge-agent/main/src/core/steps/chapterReview.ts) 达到三轮上限可 `forceAdvanced`，不要因此把失败稿默认为通过。

## 六、其余项目的源码依据与限制

- **nspox**：[yjs_ws_handler.py](https://raw.githubusercontent.com/nspox-project/nspox/main/backend/src/memos/api/services/yjs_ws_handler.py) 确有协作同步及保存。仅当多人编辑成为需求时，再决定引入 CRDT；不要为了“技术栈现代”迁移当前编辑器。
- **落笔候选**：[vector-store.ts](https://raw.githubusercontent.com/qShan1/luobi-ai-writing/main/electron/vector-store.ts) 有向量检索和回退。已读实现向量有结果即返回，失败/无结果才走文本回退，不能按注释直接宣称已实现两路融合排名。
- **JeroTan**：[story-library.js](https://raw.githubusercontent.com/JeroTan/novel-writer-english/main/src/mcp/story-library.js) 是真实事实查询代码；[utility-authenticity-audit.md](https://raw.githubusercontent.com/JeroTan/novel-writer-english/main/src/commands/utility-authenticity-audit.md) 是先报告、后等待指示的模型审查规约。二者要分开评价。
- **GOAT**：[storytelling_agent.py](https://raw.githubusercontent.com/GOAT-AI-lab/GOAT-Storytelling-Agent/main/goat_storytelling_agent/storytelling_agent.py) 实现生成阶段和模型适配；阶段数多不能证明长篇一致性。
- **InkPilot**：[aiManager.js](https://raw.githubusercontent.com/Nicholas-Yu/InkPilot/main/src/api/aiManager.js) 可参考调用分流和成本跟踪；`review()` 调用不等于完成业务门禁。
- **MuseFlow 候选**：[anti_ai_scent_processor.dart](https://raw.githubusercontent.com/Rethymus/MuseFlow/main/lib/features/ai/application/anti_ai_scent_processor.dart) 有实际后处理；[deviation_detection_service.dart](https://raw.githubusercontent.com/Rethymus/MuseFlow/main/lib/features/knowledge/application/deviation_detection_service.dart) 的偏差判断主要交给 LLM，不能当符号逻辑证明。
- **妙笔生花**：[03-outline/SKILL.md](https://raw.githubusercontent.com/zhouxiansheng-good/miaobi-shenghua/main/components/03-outline/SKILL.md) 的七变量连续性检查是规约；[可视化 server.js](https://raw.githubusercontent.com/zhouxiansheng-good/miaobi-shenghua/main/components/05-visualization/server/server.js) 才是运行代码。已读处理链允许客户端提供项目/读写路径，未见完整鉴权和目录边界，不能原样开放为你的网络写入接口；本轮未做漏洞利用或运行测试。
- **AI-Writer**：[src/model.py](https://raw.githubusercontent.com/BlinkDL/AI-Writer/main/src/model.py) 中虽然使用 GPT 类名，实际有 `RWKV_TimeMix/RWKV_ChannelMix`；另有 [_new_/src/model.py](https://raw.githubusercontent.com/BlinkDL/AI-Writer/main/_new_/src/model.py) 的 `RWKV_RNN`。不能说它与 RWKV 无关，也不能把早期模型等同现代指令模型；代码许可不代表外部权重和训练材料已获完整授权。
- **Chinese-WebNovel-Skill**：[consistency_review/runtime.md](https://raw.githubusercontent.com/Tomsawyerhu/Chinese-WebNovel-Skill/v2/references/modules/consistency_review/runtime.md) 有审查模板；[search_corpus_examples.py](https://raw.githubusercontent.com/Tomsawyerhu/Chinese-WebNovel-Skill/v2/scripts/search_corpus_examples.py) 是 CSV 标签/关键词筛选，不是向量检索。借模块边界，不直接分发未核实授权的例库。

## 七、建议实施顺序

以下均为建议，本轮未实施。

### P0：先统一现有链路，收益最高

1. **统一规则输出**：规则 ID、版本、类别、严重度、原文范围、计数/分母、作用域、豁免理由、建议；保留总分但不让总分掩盖单项。
2. **统一终态**：检查失败与未执行明确区分；不得把异常算通过，也不得永远停在“生成/校验中”。
3. **统一候选采纳条件**：沿用现有两轮上限；不改善、缩删过度、事实不符或正文版本改变时不自动采纳。
4. **核对分数量纲与规则重复**：优先核验健康分映射、重复扣分和三个模块的规则口径。
5. **把语义替换改成建议**：只标问题不改正文应是一等入口；复制候选和写入正式正文分开。

优先参考：oh-story、jarvis-write、Eventide。适配成本：中等；无需更换数据库或前端框架。

### P1：把审查依据和写法变成长期资产

1. 写法配置按作品/角色/任务绑定，记录版本；只使用作者自有或获准样本。
2. 审查报告绑定正文哈希、规则版本与运行 ID；作者修改后旧报告失效。
3. 任务快照、检查点、重试和恢复语义分清，禁止不确定状态下静默重跑。
4. 事实增量带原文证据和来源章节；待确认与正式生效分开。
5. 展示本次上下文选择与遗漏原因，控制模型输入预算。

优先参考：Ashe、OrisonSpace、Chronicler，以及确认身份后的 NovelForge 候选 B。适配成本：中等。

### P2：有实际需求再扩展

- 角色/地点/物品别名和章节引用索引：Andrea。
- 版本历史、剧情分支和 Git 导出：Novel Agent；先做安全版本快照。
- 多人实时协作：nspox；这是独立产品能力，不是去味功能的前置条件。
- 本地模型：不要因 AI-Writer 的存在就迁移推理栈，先明确设备、模型和实际需求。

## 八、“铁证词”建议改成三层策略

这是一套建议的产品策略，不是已经验证的检测标准：

| 层级 | 适用内容 | 建议动作 |
|---|---|---|
| 作者明确禁用 | 本作品明确禁止的词、泄漏的提示词/工程占位符等 | 按适用范围阻止自动采纳；允许作者明确豁免，保留草稿 |
| 高频风险模式 | 生理反应、套路过渡、相同句式/动作密集重复 | 结合绝对次数、密度和上下文提示，定点改写，不一票否决 |
| 风格偏好 | 长短句、破折号、解释比例、比喻、段长 | 与作品/场景基线比较，建议为主，不当作来源鉴定 |

避免把对话、引文、系统公告、受伤场景和心理叙述混用同一阈值。短文本的密度尤其不稳定，应设最小样本要求。

### 真正落地前应验证什么

不要仅验证“分数下降”，应在作者授权样本上比较：

- 人工认可正文被错误标记的比例。
- 问题定位是否准确，作者是否采纳修改。
- 修改是否保留人名、数字、事实、人物知情范围和伏笔功能。
- 是否为了降分产生碎句、干瘪或新的套话。
- 耗时、模型调用次数和最终仍需人工审查的比例。
- 正文中途修改、模型断流、检测异常、刷新恢复时，是否保留正确版本且不重复扣费调用。

这些测试本轮均未执行；这里只列后续接入的验收目标。

## 九、许可证核验记录

以下只报告取得的文本或声明，不是法律意见，也不代表外部范文、数据、模型权重都获得同样授权。

| 项目 | 调研时的许可观察 |
|---|---|
| Novel Agent | 标准根许可证路径未取得正文；不能按已确认 MIT 复制。 |
| AI Novel Writing Assistant | 标准根许可证路径未取得正文；许可待核实。 |
| nspox | [LICENSE：MIT](https://raw.githubusercontent.com/nspox-project/nspox/main/LICENSE) |
| OrisonSpace | [LICENSE：Apache-2.0](https://raw.githubusercontent.com/LumenStorm/OrisonSpace/dev/LICENSE) |
| 落笔候选 | [LICENSE：GPL v3 正文](https://raw.githubusercontent.com/qShan1/luobi-ai-writing/main/LICENSE)，[ATTRIBUTIONS 声明 GPL-3.0-or-later](https://raw.githubusercontent.com/qShan1/luobi-ai-writing/main/ATTRIBUTIONS.md) |
| Web Novel Writing Skill | [LICENSE：MIT](https://raw.githubusercontent.com/XINGANLIU/web-novel-writing-skill/main/LICENSE) |
| jarvis-write | [LICENSE：Apache-2.0](https://raw.githubusercontent.com/ynnyh/jarvis-write/main/LICENSE) |
| Novel Writer English | [LICENSE：MIT](https://raw.githubusercontent.com/JeroTan/novel-writer-english/main/LICENSE) |
| NovelForge 候选 A / B | [A：MIT](https://raw.githubusercontent.com/zlx362211854/novelforge-agent/main/LICENSE)；[B：Apache-2.0](https://raw.githubusercontent.com/LvPengfei1/novelforge-agent/main/LICENSE) |
| GOAT | [LICENSE：MIT](https://raw.githubusercontent.com/GOAT-AI-lab/GOAT-Storytelling-Agent/main/LICENSE) |
| Inkos / Novelix | [Inkos：AGPL v3 正文](https://raw.githubusercontent.com/Narcooo/inkos/master/LICENSE)；[Novelix：AGPL v3 正文](https://raw.githubusercontent.com/zxerai/novelix/main/LICENSE) |
| Eventide Quill | [LICENSE：MIT](https://raw.githubusercontent.com/EventideMiles/eventide-quill/main/LICENSE) |
| InkPilot | [LICENSE：MIT](https://raw.githubusercontent.com/Nicholas-Yu/InkPilot/main/LICENSE) |
| MuseFlow 候选 | 已检查根目录未取得 LICENSE 正文；不能据“开源”称呼推断授权。 |
| Chronicler | README 声明 AGPL-3.0，但标准根许可证路径未取得独立正文。 |
| Andrea Novel Helper | [LICENSE：MPL-2.0](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/feat/time-line/LICENSE) |
| 妙笔生花 | README 声明 MIT，根 LICENSE 未取得正文。 |
| AI-Writer | [LICENSE：Apache-2.0](https://raw.githubusercontent.com/BlinkDL/AI-Writer/main/LICENSE) |
| Chinese-WebNovel-Skill | 已读 README/根目录未确认明确许可；规则、例库与语料暂不直接打包。 |
| oh-story-claudecode | [LICENSE：MIT](https://raw.githubusercontent.com/zenstory-ai/oh-story-claudecode/main/LICENSE) |

读取某个路径返回 404，不等于证明整个仓库任何位置都不存在许可；只表示本轮未取得所需授权证据。真正复制代码前，应固定提交并检查该文件、第三方依赖及随附资产的许可。

## 最终建议

**先做一个统一、可解释、可复核的审校层，让已有生成链路共享它；再做写法资产与版本化事实提交。不要通过增加 Agent 数量、扩大禁词表或无限重写来替代这些基础工程。**

20 个条目均已列出取舍；其中 3 个名称仍不能唯一确认。外部能力仅按静态源码/文档观察评价，不宣称完成集成或验证真实生成效果。
