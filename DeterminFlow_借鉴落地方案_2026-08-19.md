# DeterminFlow 借鉴 · 墨阑写作落地实施计划

> 版本：v1.0（2026-08-19）· 基于 `molan-home/pages/editor.js` 实测代码行号编写
> 原则：只借鉴**设计理念与流程**，不复制代码（DeterminFlow 为 AGPL-3.0-only，直接抄码有传染风险）。

---

## 一、现状盘点（已逐行核实，行号以今日文件为准）

| 借鉴点 | 墨阑现状（真实位置） | 差距 |
|---|---|---|
| 结构化输出校验+重试 | `extractEntitiesFromText`（editor.js:4591）`onDone` 中 `mergeExtracted(full)` 失败仅 `toast('抽取结果解析失败')`；`parseJSONSafe`（:4647）已有 JSON 兜底解析 | 无自动修复重试，失败即失败 |
| 断点恢复 | `recoverInterruptedAITasks`（:6073）仅把 running/queued 标记为 interrupted；`extractKnowledge`（:4573）分块循环**无进度持久化** | 中断后从头跑 |
| 下游拒绝→上游返工 | `validateChapterDraft`（:3646）已生成 review（modernTerms/correctionRisks/continuity）；`generateNextChapter`（:3978）已调用它，但 `needs_review` 仅展示，**不回传重写** | 无定向返工闭环 |
| 节点级 Token 记账 | `logAICall`（:8458）已按调用记 tokens/creditCost；`state.aiTasks` 有 per-task 记录；AI 检测页 `renderAIDetect`（:8490）展示明细 | 缺「任务→节点→尝试」聚合视图，无上下文注入量展示 |
| 上下文隔离省 Token | `buildDynamicContext`（:1976）已按相关度打分召回（scoreContextEntity/rankedForeshadows/references），`meta` 含 used/budget/blocks | 理念已一致 ✅；缺"每次调用注入量可感知" |
| 人工审批显式化 | `applyAIOutputTarget`（:6214）AI 结果先进对话区、确认后落点（隐式审批） | 无显式状态机（待确认/已采纳/已拒绝/返工） |
| 可复用资产（自定义智能体） | `aiRole`/`aiStyle`/`rolePrefix()` 已有雏形；右侧面板 `#aiRoleDisplay` | 未资产化，无"人设+专属知识库"模板 |

**结论**：墨阑已有 60-80% 零件，缺的是**闭环**（校验→重试→返工→可视化），不是缺功能。

---

## 二、分期实施计划

### P0-1 · 结构化输出校验 + 自动修复重试（抽取链路）

**目标**：模型返回坏 JSON 时，自动带错误信息重试 1-2 次，不再"失败即失败"。

**改动点**：`pages/editor.js` `extractEntitiesFromText` 的 `onDone` 分支（约 :4615）。

**设计**：
```js
// 现有代码（:4615）
// try { mergeExtracted(full); result.ok = true; toast('实体抽取完成，已并入知识库'); }
// catch (e) { toast('抽取结果解析失败'); }

// 改造后：封装重试
let attempts = 0;
const tryMerge = () => {
  try {
    mergeExtracted(full);
    result.ok = true;
    toast('实体抽取完成，已并入知识库');
    finishAITask(task, '', usage, { resultExcerpt: full.slice(0, 180) });
    if (onComplete) onComplete(result);
  } catch (e) {
    if (attempts < 2) {
      attempts++;
      const repairMsg = userMsg + '\n\n【上轮输出解析失败】错误：' + String(e.message || e) +
        '。请只输出一个合法 JSON 对象（不要 Markdown 代码块、不要多余文字），并确保实体名不重复。';
      updateAITask(task, { stage: '输出解析失败，正在修复重试 ' + attempts + '/2' });
      streamChat({ model, thinking: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: repairMsg }] }, { /* 复用同一批 handler，仅 onDelta 清空 full */ });
    } else {
      toast('抽取结果解析失败（已重试 2 次），请缩小范围重试');
      result.error = 'json_parse_failed_after_retry';
      finishAITask(task, 'error', usage, { error: 'json parse failed after retry' });
      if (onComplete) onComplete(result);
    }
  }
};
tryMerge();
```

**要点**：
- 重试请求复用 `sys`（system 提示不变），userMsg 追加错误说明，模型成本增量极小（输出 ~2KB）。
- `onDelta` 需先 `full = ''` 清空再累积。
- `createAITask` 的 `retry` 字段（:6063）已支持 `{kind:'extract'}`（retryAITask :6166 已接），人工重试按钮天然可用。

**验证**：注入会产出坏 JSON 的输入 → 断言触发重试请求、最终入库或明确报错；`node --check`。

---

### P0-2 · 下游拒绝 → 上游定向返工（生成下一章闭环）

**目标**：`validateChapterDraft` 判定 `needs_review` 时，将问题清单注入上下文**自动重写一次**；仍不过则给「重写」按钮人工触发。

**改动点**：`pages/editor.js` `generateNextChapter` 的 `onDone`（约 :3971-4030）。

**设计**：
```js
// 现有（:3978）：const review = buf ? validateChapterDraft(...) : null;
// 改造：
if (buf && review && review.status === 'needs_review') {
  // 自动重写一次：把 review 的问题注入
  const problems = [
    ...(review.modernTerms || []).map(t => '现代词：' + t),
    ...(review.correctionRisks || []).map(r => '纠错风险：' + (r.term || r.reason || '')),
    ...(review.evidenceRisks || []).map(r => '证据风险：' + (r.term || r.reason || '')),
    review.continuity && review.continuity.status !== 'passed' ? '衔接：' + review.continuity.note : ''
  ].filter(Boolean).slice(0, 6);
  if (problems.length) {
    botMessage.text += '\n\n【自动校验发现问题，正在重写一次】' + problems.join('；');
    // 触发第二次 streamSkillPipeline（skillMode 'write'），userMsg 追加：
    // '【校验反馈】以下问题需修正后重写：' + problems.join('；') + '。其余剧情推进不变。'
  }
}
// 重写仍 needs_review → botMessage 追加"重写"action 按钮（复用现有 ai-msg-action 体系）
```

**要点**：
- `validateChapterDraft` 已有全部零件（现代词/纠错/证据/衔接四类检测），无需重写检测逻辑。
- 自动重写只做 **1 次**（防 token 失控），第二次仍不过交给用户手动「重写」（复用 `retryAITask` 的 `nextChapter` 分支或新增 `rewriteChapter` action）。
- `chapterWorkflowStage` 已支持 `core/writing/skill` 阶段展示，可加 `review` 阶段让用户看到"校验→返工"过程。

**验证**：注入含"现代词/证据缺失"的生成场景 → 断言出现第二次生成请求、问题清单出现在上下文。

---

### P0-3 · 长任务断点恢复（拆书 / 批量抽取）

**目标**：分块循环任务中断后，从**最后成功块**续跑，不从头来。

**改动点**：`pages/editor.js`
- `extractKnowledge`（:4573）：循环体内记录 `task.checkpoint = i`（每块成功后 `updateAITask(task,{checkpoint:i})` + `persist()`）。
- `importSettingFiles`（:4765）/`importNovelFiles`（:7782）：同法，按文件记录 `checkpoint`。
- `recoverInterruptedAITasks`（:6073）：对带 `checkpoint` 的任务，恢复为 `pending_retry` 并在任务卡片显示「从第 N 块续跑」按钮。

**设计（extractKnowledge 改造）**：
```js
const totalChunks = chunks.length;
// 现有循环 for (let i = 0; i < chunks.length; i++) {...}
// 改：从 checkpoint 继续
const resumeFrom = task && Number.isFinite(task.checkpoint) ? task.checkpoint : 0;
for (let i = resumeFrom; i < chunks.length; i++) {
  const result = await extractEntitiesFromTextP(chunks[i], '当前正文');
  if (result.creditExhausted) { toast('积分不足，进度已保存至第 ' + i + '/' + totalChunks + ' 段'); break; }
  updateAITask(task, { checkpoint: i + 1, progress: Math.round(((i + 1) / totalChunks) * 100) });
  persist(); // 关键：每块落盘
}
```

**要点**：
- **每块 `persist()`** 是核心——否则页面刷新丢失进度（`persist()` :1131 已有，直接复用）。
- `createAITask` 传入 `kind:'extractKnowledge'` 的任务需带 `checkpoint` 初始 0；`retryAITask` 增加该分支（:6166 附近，仿照 `extract` 分支）。
- 积分耗尽（402）时**保留 checkpoint 不清零**，充值后一键续跑——这是 DeterminFlow「Task 冻结+检查点」的直接体现。

**验证**：造 10 块输入 → 中断（abort 或 reload）→ 断言 checkpoint 存在 → 续跑只处理剩余块。

---

### P1-1 · 上下文注入量可感知（省 Token 可视化）

**目标**：AI 检测页展示**每次调用实际注入的上下文规模**（字符/块数/被裁剪设定数），让"节点级上下文隔离省 Token"看得见。

**改动点**：`pages/editor.js`
- `logAICall`（:8458）：调用前先取 `buildDynamicContext` 的 `meta`，记录 `contextChars: meta.used`、`contextBlocks: meta.blocks.length`、`ignoredEntities`。
- `renderAIDetect`（:8490）明细行：追加 `<span>上下文 1.2K 字符 · 5 块 · 忽略 38 条设定</span>`。

**要点**：
- `buildDynamicContext`（:1976）的 `meta` 已含 used/budget/blocks/ignoredEntities，**零成本拿数据**，只缺落库与展示。
- `logAICall` 目前只收 `(opType, model, usage, result)` 四参，改为可选第五参 `ctxMeta`（向后兼容，旧调用不传不影响）。

**验证**：发起一次续写 → AI 检测页出现上下文规模字段；刷新后仍在（持久化到 `aiCallLog`）。

---

### P1-2 · 人工审批显式状态机

**目标**：AI 消息（保存到设定/伏笔/正文）带「待确认 → 已采纳 → 已拒绝 → 返工」状态徽章。

**改动点**：`pages/editor.js`
- `applyAIOutputTarget`（:6214）：落点成功给 message 加 `approval:'accepted'`；对话区新增「采纳 / 拒绝 / 返工」三个操作（复用 `ai-msg-action` 按钮体系，:6051 已有 saveSetting/saveForeshadow 先例）。
- `aiMessageDisplay`（消息渲染）：按 `message.approval` 显示徽章（待确认=amber / 已采纳=green / 已拒绝=gray / 返工=blue）。
- 新状态字段：`message.approval`（默认 'pending'），随 `persist()` 落盘。

**要点**：这是 DeterminFlow Approval Node 的轻量版——不引入新任务类型，只在现有消息上加状态机，改动量最小。

**验证**：触发保存到设定 → 消息显示"已采纳"；手动点拒绝 → 徽章翻转且数据未落库。

---

### P2 · 自定义智能体资产化（人设 + 专属知识库）

**目标**：把「智能体人设 Prompt + 关联资料/Skill」打包为可复用资产，右侧面板可选。

**改动点**：
- `state` 新增 `aiProfiles[]`（id/name/systemPrompt/entityIds/skillIds）。
- `rolePrefix()`（已有）：`state.aiProfiles` 命中当前 profile 时输出其 systemPrompt。
- 右侧面板 `#aiRoleDisplay`（editor.html:975）改为下拉选择 profile + 「保存为模板」。
- 参考站文档承诺的「自定义智能体：给每个 AI 配人设和专属知识库」正好落在这里。

**要点**：资产化后与现有 Skill 体系（`state.skills`/`aiSkillDefinitions`）对齐，可同步到云端。

---

## 三、验证方式（统一口径）

1. 语法：`node --check pages/editor.js`。
2. 浏览器级：playwright-core `channel:'msedge'` + `ctx.route` 绕缓存（MEMORY 坑①），**localStorage 注入必须带 `:guest` 后缀键**（`molan_editor_novels:guest`，MEMORY 坑：不带后缀会被 defaultState 覆盖）。
3. 每项 P0 完成后跑对应断言脚本，用后删除，不留项目根目录。

---

## 四、风险与注意事项

| 风险 | 对策 |
|---|---|
| editor.js 已 8500+ 行，改动集中易回归 | 每项改动独立提交；先 P0-1（最小闭环）验证流水线再继续 |
| 重试可能放大 token 消耗 | 重试上限 1-2 次；重试请求上下文增量仅 ~2KB；失败走人工按钮 |
| AGPL 传染 | 只借鉴流程设计，不复制代码；如需参考实现，clone `DeterminFlow-Plugins/bishu-novel` 仅阅读编排思路 |
| 检查点持久化频率 | 每块 persist 会写 localStorage + fire-and-forget 云端 PUT，量小可接受；勿在循环内做同步大对象 |
| 旧数据兼容 | `logAICall` 新参可选；`message.approval` 缺省按 'pending' 处理；`task.checkpoint` 缺省 0 |

---

## 五、建议执行顺序（4 个冲刺）

| 冲刺 | 内容 | 预估改动 |
|---|---|---|
| S1 | P0-1 抽取重试闭环 | editor.js ~40 行 |
| S2 | P0-2 下一章定向返工 | editor.js ~60 行 |
| S3 | P0-3 断点恢复（含积分耗尽续跑） | editor.js ~80 行 |
| S4 | P1-1 + P1-2（记账可视化 + 审批状态机） | editor.js ~90 行 + editor.html 少量 |
| S5 | P2 自定义智能体资产化 | editor.js ~120 行 + editor.html 面板 |

> P0 三件套（S1-S3）做完，即覆盖 DeterminFlow 最核心的「校验→重试→恢复」可靠性闭环；P1/P2 为体验与资产化增强。

---

*参考：https://github.com/alikon-art/DeterminFlow（AGPL-3.0）· 笔枢写作生产案例 bishu-novel 插件*
