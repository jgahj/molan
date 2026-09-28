# 马良写作 Clone · AI 小说创作平台

一个高度还原 [maliangwriter.com](https://maliangwriter.com/) 写作工作台的 **AI 小说创作平台**。
零依赖（仅用 Node 内置模块），`node server.js` 即可运行，前端通过自建后端代理调用 **DeepSeek**，API Key 仅存于服务端，前端永不接触。

## ✨ 功能

- **三栏工作台**：左侧书架/章节树 · 中间富文本编辑器 · 右侧 AI 助手
- **六大智能体动作**
  - ⏩ 续写：顺着光标前正文继续写
  - ✨ 润色 / 🔄 改写：选中文本后处理，结果可「应用到正文」
  - 📝 生成章节：基于本书设定与章节标题生成正文
  - 🗺️ 写大纲 / 🌍 写设定：生成三级大纲与世界观设定（可保存到本书）
- **AI 对话**：右侧面板多轮对话，自动携带本书设定/大纲上下文
- **流式输出**：DeepSeek 回复逐字流式渲染，可随时「停止」
- **本地持久化**：小说/章节/设定存于浏览器 localStorage，刷新不丢
- **模型切换**：DeepSeek V3 (deepseek-chat) / R1 (deepseek-reasoner)

## 🚀 运行

```bash
cd maliangwriter-clone
node server.js
# 浏览器打开 http://localhost:3000
```

> 需 Node 16+。无需 `npm install`（零依赖）。
> 端口可用环境变量覆盖：`PORT=8080 node server.js`

## 🔐 密钥说明（重要）

API Key 写在 `server.js` 顶部的 `DEEPSEEK_KEY`（仅服务端）。
生产环境建议改用环境变量，避免入库：

```bash
DEEPSEEK_API_KEY=sk-xxxx node server.js
```

**切勿**把 Key 写进任何前端代码或公开仓库。

## 📁 目录结构

```
maliangwriter-clone/
├── server.js        # 零依赖 Node 服务：托管前端 + DeepSeek 代理
├── package.json
├── README.md
└── public/
    ├── index.html   # 三栏工作台结构
    ├── styles.css   # 纸感/书香视觉
    └── app.js       # 状态、编辑器、智能体、流式对话、持久化
```

## ⚠️ 合规

本项目仅用于学习与个人创作，不主张对原站「马良写作」品牌与版权素材的所有权。
商业发布前请获得原站方授权。
