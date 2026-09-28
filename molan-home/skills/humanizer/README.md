# Humanizer

一个可移植的 agent Skill，用于去除文本中的 AI 写作痕迹，让内容更自然、更像真人写作。它是纯 Markdown，因此可在任何支持 Skill 式说明的 agent 环境中使用。

## 安装

### Skills CLI

使用跨 agent skills CLI 安装：

```bash
npx skills add blader/humanizer
```

更新已有安装：

```bash
npx skills update humanizer
```

安装到所有受支持的 agent 环境：

```bash
npx skills add blader/humanizer --agent '*'
```

指定某个已配置环境：

```bash
npx skills add blader/humanizer --agent <agent-name>
```

### Claude Code 插件

Claude Code 用户也可以作为插件安装：

```text
/plugin marketplace add blader/humanizer
/plugin install humanizer@humanizer
```

随后可用 `/humanizer:humanizer` 调用。

### 手动安装

任何 agent 环境都可以直接使用 `SKILL.md`。把它放到对应的 Skill 目录，或复制进已有 Skill 文件夹。

```bash
git clone https://github.com/blader/humanizer.git /path/to/your/skills/humanizer
```

已有仓库时：

```bash
mkdir -p /path/to/your/skills/humanizer
cp SKILL.md /path/to/your/skills/humanizer/
```

## 使用

按你的 agent 环境支持的方式调用 Skill，例如斜杠命令或直接请求：

```text
/humanizer

[paste your text here]
```

```text
Please humanize this text: [your text]
```

### 声音校准

若要匹配你的个人写作风格，提供自己的样文：

```text
/humanizer

Here's a sample of my writing for voice matching:
[paste 2-3 paragraphs of your own writing]

Now humanize this text:
[paste AI text to humanize]
```

Skill 会分析句子节奏、用词和个人习惯，再应用到改写中，而不是产出通用“干净文本”。

## 概述

本 Skill 参考 Wikipedia 的 “Signs of AI writing” 指南和 WikiProject AI Cleanup 的观察经验，总结常见 AI 生成痕迹，并加入最终“是否仍明显像 AI”自查与二次改写步骤。

## 33 类检测模式

### 内容模式

| # | 模式 | 问题 | 改法 |
|---|---|---|---|
| 1 | 意义膨胀 | 把普通事实写成历史转折 | 改成具体事实 |
| 2 | 知名度堆砌 | 罗列媒体和名人 | 写具体来源中的具体信息 |
| 3 | 肤浅分析 | “体现、彰显、释放潜能” | 删除或补真实依据 |
| 4 | 宣传腔 | “令人惊叹、必去、充满活力” | 写可观察内容 |
| 5 | 模糊归因 | “专家认为、业内人士表示” | 给来源或删除 |
| 6 | 挑战展望模板 | 泛泛“未来可期” | 写具体问题和后果 |

### 语言模式

| # | 模式 | 问题 | 改法 |
|---|---|---|---|
| 7 | AI 高频词 | 赋能、抓手、闭环等 | 能直说就直说 |
| 8 | 回避简单判断 | 用复杂词替代“是/有” | 回到简单句 |
| 9 | 否定排比 | “不只是……更是……” | 直接陈述 |
| 10 | 三分法滥用 | 强行三个点 | 按内容真实数量写 |
| 11 | 同义词轮换 | 反复换称呼 | 清楚时重复原词 |
| 12 | 假范围 | “从 X 到 Y”不成尺度 | 直接列举 |
| 13 | 被动/无主句 | 隐藏动作主体 | 需要时补主体 |

### 风格模式

| # | 模式 | 问题 | 改法 |
|---|---|---|---|
| 14 | 破折号滥用 | 破折号堆节奏 | 改成句号、逗号、冒号或重写 |
| 15 | 粗体滥用 | 机械强调 | 改普通文字 |
| 16 | 内联标题列表 | 像 PPT | 合并成自然段 |
| 17 | 标题过度格式化 | 英文 Title Case 滥用 | 使用自然标题 |
| 18 | emoji 装饰 | 不服务内容 | 删除 |
| 19 | 引号噪音 | 排版不统一 | 按平台统一 |
| 26 | 连字符滥用 | 英文复合词机械加连字符 | 只在需要时使用 |
| 27 | 权威姿态套话 | “真正的问题是” | 直接说观点 |
| 28 | 预告式开场 | “让我们深入了解” | 直接进入内容 |
| 29 | 标题后空转句 | 标题下重复标题 | 删除空转句 |
| 30 | 改动叙事腔 | 写“新增用于替代” | 写当前功能 |
| 31 | 制造金句短句 | 连续重锤短句 | 用自然节奏和具体判断 |
| 32 | 箴言公式 | “X 是 Y 的语言” | 写实际意思 |
| 33 | 假坦诚开场 | “说实话？” | 直接给结论 |

### 交流、填充和结尾

| # | 模式 | 问题 | 改法 |
|---|---|---|---|
| 20 | 聊天机器人残留 | “希望这有帮助” | 删除 |
| 21 | 知识截止/猜测补洞 | “截至我的更新”或编私生活 | 找来源、标未知或删除 |
| 22 | 谄媚语气 | “你完全正确” | 直接回应内容 |
| 23 | 填充短语 | “由于……这一事实” | 改“因为” |
| 24 | 过度含糊 | “可能也许在某种程度上” | 保留必要不确定 |
| 25 | 通用积极结论 | “未来可期” | 写具体计划或停止在事实处 |

## 版本历史

- **2.8.2**：将 Skill 主说明中文化，保留 33 类检测模式与跨 agent 用法。
- **2.8.1**：加入跨 agent 安装说明和二手文本误判保护。
- **2.8.0**：加入制造金句、箴言公式和假坦诚开场等模式。
- **2.7.0**：加入改动叙事腔；强化破折号处理和猜测补洞检查。
- **2.6.0**：整理工作流，收束个性化语气规则。
- **1.0.0**：初始版本。

## License

MIT