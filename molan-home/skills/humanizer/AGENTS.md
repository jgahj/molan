# AGENTS.md

面向在此仓库中工作的 AI 编码代理的维护说明。

## 仓库性质

这是一个完全用 Markdown 实现的可移植 agent Skill。运行时核心文件是 `SKILL.md`：代理读取 YAML frontmatter 中的元数据和允许工具，再读取正文编辑提示。没有构建步骤，也没有必须运行的业务代码。措辞应保持跨工具兼容，不绑定单一平台。

## 关键文件

- `SKILL.md`：Skill 本体。YAML frontmatter 包含 `name`、`version`、`description`、`compatibility`、`allowed-tools`，正文包含模式清单和改写流程。这是唯一事实源。
- `README.md`：给人看的安装、使用、模式概述和版本历史。
- `.claude-plugin/plugin.json`：可选 Claude Code 插件清单。
- `.claude-plugin/marketplace.json`：可选 marketplace 条目。

## 维护约定

`SKILL.md` 和 `README.md` 应保持同步。改行为或内容时：

- **模式数量**：当前 Skill 定义 33 类检测模式。增加、删除或重编号时，同步更新 README 中的模式表、标题和交叉引用。除非明确重编号，否则保持编号稳定。
- **版本**：`SKILL.md` frontmatter、`README.md` 版本历史和 `.claude-plugin/plugin.json` 版本需要一起更新。
- **兼容性**：安装和使用说明保持平台中立。Skill 应适用于任何能加载 Markdown Skill 指令的 agent 环境。
- **非显而易见修复**：若为处理反复误改、意外语气偏移等问题而修改提示，在 README 版本历史中简短说明修复内容和原因。

## 编辑 `SKILL.md`

- 保持 YAML frontmatter 有效。
- frontmatter 下方正文就是产品。把它当成严谨的说明文档编辑，而不是普通代码。