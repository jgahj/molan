# 全站设计系统与样式变量矩阵 (UI_TOKEN_MATRIX)

本规范确立 `pages/tokens.css` 作为墨阑全站唯一设计真理源（Single Source of Truth），所有页面与组件均从该文件继承变量。

## 1. 核心设计变量映射表

| 变量名称 | 说明 | 浅色模式 (Molan Light - 默认) | 沉浸创作 (Molan Focus) |
| :--- | :--- | :--- | :--- |
| `--ink` | 主文本墨色 | `#0a0a0a` | `#f0f0f0` |
| `--ink-soft` | 次级文本 | `#292927` | `#e2e2dc` |
| `--paper` | 卡片底色 | `#ffffff` | `#242427` |
| `--paper-warm` | 暖底纸张色 | `#fbfbf9` | `#1f1f22` |
| `--canvas` | 视口工作底色 | `#f3f3f0` | `#1b1b1d` |
| `--line` | 细微边框线 | `#e7e7e2` | `#3a3a3e` |
| `--line-strong`| 强调边框线 | `#d6d6d0` | `#52524e` |
| `--muted` | 弱化辅助字 | `#74746e` | `#bfc4cc` |
| `--green` | 成功/已完成 | `#25845a` | `#34d399` |
| `--blue` | 交互重点 | `#385c91` | `#60a5fa` |
| `--amber` | 预警/阻断 | `#a86b20` | `#fbbf24` |
| `--danger` | 破坏性操作 | `#ae3d3d` | `#f87171` |
| `--sans` | 无衬线操作字体 | 苹方 / 微软雅黑 / Segoe UI | 苹方 / 微软雅黑 / Segoe UI |
| `--serif` | 文学正文衬线字体 | 思源宋体 / 宋体 / SimSun | 思源宋体 / 宋体 / SimSun |

## 2. 挂载合规清单

全站 20 个 HTML 页面均已在 `<head>` 中引入统一样式表：
1. `index.html` -> `<link rel="stylesheet" href="./pages/tokens.css">`
2. `benchmark-review.html` -> `<link rel="stylesheet" href="./pages/tokens.css">`
3. `pages/*.html` (18 个子页面) -> `<link rel="stylesheet" href="./tokens.css">`

禁止任何组件新写独立的 `--ml-*`、`--login-*` 等未由 `tokens.css` 继承映射的孤立变量。
