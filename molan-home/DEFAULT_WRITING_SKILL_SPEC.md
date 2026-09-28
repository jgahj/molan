# 默认写作 Skill 与纠错库 Spec

## 目标

所有正文写作请求都自动使用项目内置的高张力写作 Skill，并由服务端强制注入通用纠错策略。用户不选择额外 Skill 时也必须生效。

## 现状与兼容决策

用户指定的 `C:\Users\lyh\Desktop\小说专属网页\write-high-tension-xuanhuan` 路径当前不存在；仓库中的 `skills/write-high-tension-fiction` 已明确由该玄幻 Skill 改造成通用版本，并包含现有引用文件。因此本轮以该仓库 Skill 作为默认实现，保留 `write-high-tension-fiction` ID，避免已有作品和 Skill 选择记录失效。

## 约束优先级

1. 当前请求明确点名的技法、比喻或句式，仅对该次对应表达放行。
2. 用户纠错库中的表达与叙事质量规则。
3. 当前作品事实、设定、人物关系和剧情顺序；纠错库不得改写这些事实。
4. 默认写作 Skill 的方法论。

## 请求边界

- `stage=writing`：自动注入默认 Skill，并强制启用纠错策略。
- `stage=humanizer`：继续使用纠错策略；由写作管线决定是否额外注入润色 Skill。
- `jsonMode=true`：拆书、创书及其他结构化任务不注入散文 Skill，也不注入散文纠错提示，以保证合法 JSON 和字段完整性。
- 默认 Skill 不完整或无法加载时，写作请求失败并返回明确错误，不降级为无 Skill 生成。

## 验证

- 服务端自动注入的默认 Skill 通过 Skill 文件、清单和指令哈希审计。
- 客户端未提交 Skill 审计声明时，写作请求仍能完成默认 Skill 审计。
- `correctionPolicy=false` 不能关闭写作阶段的纠错策略。
- 结构化 JSON 请求仍保留原有例外。
