# 墨阑 · AI 小说创作平台（落地页）

以 `首页.html` 为范本**逐像素复刻**的落地页，并把原本的死链接变成真实可用的功能。
零依赖（仅 Node 内置模块），Node 22.5+ 执行 `npm start` 即可运行。

## ✨ 还原的 UI（1:1）
- 顶部导航（Logo「墨阑」+ 导航项 + 主题/语言/登录/开始创作）
- 公告药丸「AI 引擎 V4.0 全新上线」
- Hero：衬线大标题 + 右侧三张浮动卡片（世界观设定 / 统计仪表盘 / 文本生成预览，含浮动动画）
- 聊天式输入框（功能行图标 + 技能/高级 pill + 智能体选择器 + 圆形发送按钮）
- 底部 CTA 组（快速创建小说 / 免费注册 / 我的小说 / 导入小说）
- 页脚

## 🚀 实现的真实功能
- **AI 聊天框**：输入写作需求 → 后端代理 **DeepSeek** 流式生成，逐字渲染；可「停止 / 清空」
- **明暗主题切换**：右上角图标一键切换，偏好存 localStorage
- **中 / EN 双语切换**：导航、按钮、占位符等实时切换
- **智能体下拉**：通用写作 / 深度推理（deepseek-reasoner）/ 悬疑推理 / 爆款仿写
- **我的小说（本地书架）**：localStorage 增删改、TXT 导入、内置编辑器
- **火花按钮**：一键填入示例提示词
- **注册 / CTA 弹窗**：交互闭环

## ▶️ 运行
```bash
cd molan-home
npm start
# 打开 http://localhost:3000
```
> Node 22.5+，无需 `npm install`。端口可用 `PORT=8080 npm start` 覆盖。
>
> 也支持直接双击打开 `index.html`（file:// 协议），页面会自动尝试连接 `http://localhost:3000` 的本地服务；若服务未启动，顶部会显示黄色提示条并引导启动服务。

## 🔐 密钥
DeepSeek API Key 写在 `server.js` 顶部 `DEEPSEEK_KEY`（仅服务端）。生产建议改用环境变量：
```bash
DEEPSEEK_API_KEY=sk-xxxx npm start
```
前端永不接触密钥。

优先级：环境变量 `DEEPSEEK_API_KEY` > `data/config.json`（模板见 `data/config.example.json`，含 `platformModels/modelPolicy` 示例）。
编辑器本地纠错库/技能目录默认取仓库上级目录，可用 `MOLAN_EDITOR_LOCAL_CORRECTION_FILE`、`MOLAN_EDITOR_LOCAL_SKILL_DIR` 覆盖。

## 🧪 测试
```bash
npm test          # test/ 目录全部用例（默认跳过需复制 100MB+ 数据的慢用例）
npm run test:slow # 仅运行 v31-stage0 慢用例（MOLAN_SLOW_TESTS=1）
```

## 🛡️ 本地看护
`start-node22.bat` 检测端口占用后才启动（单实例）；`watchdog-node22.bat` 单实例锁在 `data/watchdog.lock`，连续 3 次 `/api/health` 失败才清理 3000 端口并重启，`watchdog.log` 超 2MB 自动轮转。`/api/health` 返回 `uptime/pid/activeChatStreams` 便于区分“挂了”与“忙”。

## 📁 结构
```
molan-home/
├── index.html   # 复刻后的页面（含暗色主题/弹窗/对话面板结构）
├── app.js       # 交互逻辑：聊天/主题/语言/智能体/书架
├── server.js    # 零依赖服务：托管静态 + DeepSeek 代理
├── package.json
└── README.md
```
